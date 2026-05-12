# ============================================================
# backend/routers/sensors.py
# Endpoint /api/sensors/ingest — Réception données Netafim
# Sécurisé par clé API (X-API-Key)
# Projet Azura Irrigation IA — GOUSSA Oussama
# ============================================================

import os
import json
from datetime import datetime
from fastapi import APIRouter, HTTPException, Depends, Request, Header
from sqlalchemy.orm import Session
from sqlalchemy.exc import IntegrityError
from loguru import logger
from typing import Optional
from core.utils import filter_by_farm

from core.database import get_db
from models.sensor_model import (
    Device, SensorReading, IrrigationCycle,
    FertigationState, Alert, AlertThreshold
)

router = APIRouter(prefix="/api/sensors", tags=["Capteurs Netafim"])

# ── Clé API depuis .env ───────────────────────────────────────
SENSOR_API_KEY = os.getenv("SENSOR_API_KEY")

# ── Helpers temps restant ─────────────────────────────────────
def parse_time_to_seconds(t: str) -> int:
    """Parse HH:MM:SS ou MM:SS → secondes"""
    if not t:
        return 0
    try:
        parts = t.strip().split(":")
        if len(parts) == 3:
            return int(parts[0]) * 3600 + int(parts[1]) * 60 + int(parts[2])
        elif len(parts) == 2:
            return int(parts[0]) * 60 + int(parts[1])
    except (ValueError, IndexError):
        pass
    return 0

def seconds_to_time_str(s: int) -> str:
    """Secondes → HH:MM:SS"""
    s = max(0, s)
    h  = s // 3600
    m  = (s % 3600) // 60
    sc = s % 60
    return f"{h:02d}:{m:02d}:{sc:02d}"

def calc_water_left(prg_time: str, act_time: str) -> str:
    """Calcule remaining = T.prog - T.actuel, ignore valeur Netafim incorrecte"""
    return seconds_to_time_str(
        parse_time_to_seconds(prg_time) - parse_time_to_seconds(act_time)
    )

# ── Vérification clé API ──────────────────────────────────────
def verify_api_key(x_api_key: Optional[str] = Header(None)):
    if not SENSOR_API_KEY:
        raise HTTPException(
            status_code=500,
            detail="SENSOR_API_KEY non configurée dans .env"
        )
    if x_api_key != SENSOR_API_KEY:
        logger.warning(f"Tentative accès /ingest avec clé invalide : {x_api_key}")
        raise HTTPException(
            status_code=403,
            detail="Clé API invalide — accès refusé"
        )
    return x_api_key


# ── Helpers ───────────────────────────────────────────────────
def safe_float(value) -> Optional[float]:
    """Convertit une valeur en float, retourne None si impossible"""
    if value is None:
        return None
    try:
        return float(value)
    except (ValueError, TypeError):
        return None


def safe_int(value) -> Optional[int]:
    """Convertit une valeur en int, retourne None si impossible"""
    if value is None:
        return None
    try:
        return int(float(value))
    except (ValueError, TypeError):
        return None


def safe_bool(value) -> Optional[bool]:
    """Convertit une valeur en bool"""
    if value is None:
        return None
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        return value.lower() in ('true', '1', 'yes', 'on')
    return bool(value)


def safe_json_array(value) -> Optional[list]:
    """Parse un array JSON string → list Python"""
    if value is None:
        return None
    if isinstance(value, list):
        return value
    if isinstance(value, str):
        try:
            return json.loads(value)
        except (ValueError, TypeError):
            return None
    return None


def parse_timestamp(ts_str: str) -> datetime:
    """
    Parse le timestamp Netafim
    Format : "2026/03/30 10:12:14"
    """
    try:
        return datetime.strptime(ts_str, "%Y/%m/%d %H:%M:%S")
    except ValueError:
        try:
            return datetime.strptime(ts_str, "%Y-%m-%d %H:%M:%S")
        except ValueError:
            raise ValueError(f"Format timestamp invalide : {ts_str}")


def get_or_create_device(db: Session, headers: dict) -> Device:
    """
    Récupère le device existant ou le crée automatiquement
    Clé unique : farm_name + house_number + room_number
    """
    farm_name    = headers.get("FarmName", "").strip()
    house_number = headers.get("HouseNumber", "0").strip()
    room_number  = headers.get("RoomNumber", "0").strip()

    # Chercher device existant
    device = db.query(Device).filter(
        Device.farm_name    == farm_name,
        Device.house_number == house_number,
        Device.room_number  == room_number,
    ).first()

    if device:
        return device

    # Créer nouveau device automatiquement
    device = Device(
        farm_name           = farm_name,
        house_number        = house_number,
        room_number         = room_number,
        controller_type     = headers.get("ControllerType"),
        controller_version  = headers.get("ControllerVersion"),
        device_id           = headers.get("DeviceId"),
        mtech_device_id     = headers.get("MTechDeviceId") or None,
        source              = headers.get("Source"),
        controller_type_id  = headers.get("ControllerTypeId"),
        export_data_version = headers.get("ExportDataVersion"),
        is_active           = True,
    )
    db.add(device)
    db.flush()  # Obtenir l'ID sans commit

    # Créer seuils par défaut pour ce nouveau device
    default_thresholds = [
        {"parameter": "ec_actual",  "min": 1.5,  "max": 3.5,  "severity": "CRITICAL"},
        {"parameter": "ph_actual",  "min": 5.5,  "max": 6.8,  "severity": "CRITICAL"},
        {"parameter": "avg_temp",   "min": 15.0, "max": 35.0, "severity": "WARNING"},
        {"parameter": "humidity",   "min": 50.0, "max": 90.0, "severity": "WARNING"},
        {"parameter": "flow",       "min": 0.0,  "max": None, "severity": "CRITICAL"},
    ]
    for t in default_thresholds:
        threshold = AlertThreshold(
            device_id     = device.id,
            parameter     = t["parameter"],
            threshold_min = t["min"],
            threshold_max = t["max"],
            severity      = t["severity"],
            is_active     = True,
        )
        db.add(threshold)

    logger.success(f"Nouveau device créé : {farm_name} / House {house_number}")
    return device

def check_and_create_alerts(
    db: Session,
    device: Device,
    timestamp: datetime,
    ts: "TempSensor data dict",
    sr: SensorReading
):
    """
    Vérifie les seuils et crée des alertes intelligentes.
    Règles :
    - EC/pH : alerte UNIQUEMENT si débit > 0 (irrigation active)
    - EC/pH = 0 avec débit > 0 → alerte critique (capteur défaillant)
    - Temp/Humidité : ignorer si valeur hors plage physiologique (hiver = pas alerte froide)
    - Débit nominal : alerte si débit << débit nominal pendant irrigation
    - Radiation : alerte si radiation anormalement élevée
    - VPD : alerte si VPD élevé (stress hydrique)
    - Doublon : pas d'alerte si alerte identique non résolue dans les 30 dernières minutes
    """
    from datetime import timedelta

    flow = sr.flow or 0.0
    is_irrigating = flow > 0

    thresholds = db.query(AlertThreshold).filter(
        AlertThreshold.device_id == device.id,
        AlertThreshold.is_active == True
    ).all()
    thresh_map = {t.parameter: t for t in thresholds}

    def already_alerted(alert_type: str) -> bool:
        """Vérifie si une alerte identique existe dans les 30 dernières minutes."""
        cutoff = timestamp - timedelta(minutes=30)
        return db.query(Alert).filter(
            Alert.device_id == device.id,
            Alert.alert_type == alert_type,
            Alert.resolved_at == None,
            Alert.timestamp >= cutoff,
        ).first() is not None

    def create_alert(alert_type, value, thresh_min, thresh_max, severity, message):
        if already_alerted(alert_type):
            return
        alert = Alert(
            device_id      = device.id,
            timestamp      = timestamp,
            alert_type     = alert_type,
            value_detected = value,
            threshold_min  = thresh_min,
            threshold_max  = thresh_max,
            severity       = severity,
            message        = message,
        )
        db.add(alert)
        logger.warning(f"⚠️ ALERTE {alert_type} : {message}")

    farm_info = f"{device.farm_name} Station {device.house_number}"

    # ── 1. EC Apport — seulement si irrigation active ─────────
    t_ec = thresh_map.get("ec_actual")
    if t_ec and sr.ec_actual is not None:
        if is_irrigating:
            # EC = 0 pendant irrigation → capteur défaillant
            if sr.ec_actual == 0:
                create_alert("EC_ACTUAL", 0, t_ec.threshold_min, t_ec.threshold_max, "CRITICAL",
                    f"EC = 0 mS/cm pendant irrigation (débit={flow} L/h) → capteur défaillant — {farm_info}")
            elif t_ec.threshold_min is not None and sr.ec_actual < t_ec.threshold_min:
                create_alert("EC_ACTUAL", sr.ec_actual, t_ec.threshold_min, t_ec.threshold_max, t_ec.severity,
                    f"EC trop bas : {sr.ec_actual} mS/cm < min {t_ec.threshold_min} — {farm_info}")
            elif t_ec.threshold_max is not None and sr.ec_actual > t_ec.threshold_max:
                create_alert("EC_ACTUAL", sr.ec_actual, t_ec.threshold_min, t_ec.threshold_max, t_ec.severity,
                    f"EC trop élevé : {sr.ec_actual} mS/cm > max {t_ec.threshold_max} — {farm_info}")
        # Si pas irrigation et EC != 0 → lecture parasite, ignorer

    # ── 2. pH Apport — seulement si irrigation active ─────────
    t_ph = thresh_map.get("ph_actual")
    if t_ph and sr.ph_actual is not None:
        if is_irrigating:
            if sr.ph_actual == 0:
                create_alert("PH_ACTUAL", 0, t_ph.threshold_min, t_ph.threshold_max, "CRITICAL",
                    f"pH = 0 pendant irrigation (débit={flow} L/h) → capteur défaillant — {farm_info}")
            elif t_ph.threshold_min is not None and sr.ph_actual < t_ph.threshold_min:
                create_alert("PH_ACTUAL", sr.ph_actual, t_ph.threshold_min, t_ph.threshold_max, t_ph.severity,
                    f"pH trop bas : {sr.ph_actual} < min {t_ph.threshold_min} — {farm_info}")
            elif t_ph.threshold_max is not None and sr.ph_actual > t_ph.threshold_max:
                create_alert("PH_ACTUAL", sr.ph_actual, t_ph.threshold_min, t_ph.threshold_max, t_ph.severity,
                    f"pH trop élevé : {sr.ph_actual} > max {t_ph.threshold_max} — {farm_info}")

    # ── 3. Température — ignorer si hiver (< 8°C dehors) ──────
    t_temp = thresh_map.get("avg_temp")
    if t_temp and sr.avg_temp is not None:
        outside = sr.outside_temp  # peut être None
        # Ignorer alerte froide si température extérieure < 8°C (hiver normal)
        cold_winter = outside is not None and outside < 8.0
        if t_temp.threshold_max is not None and sr.avg_temp > t_temp.threshold_max:
            create_alert("AVG_TEMP", sr.avg_temp, t_temp.threshold_min, t_temp.threshold_max, t_temp.severity,
                f"Température serre trop élevée : {sr.avg_temp}°C > max {t_temp.threshold_max}°C — {farm_info}")
        elif t_temp.threshold_min is not None and sr.avg_temp < t_temp.threshold_min and not cold_winter:
            create_alert("AVG_TEMP", sr.avg_temp, t_temp.threshold_min, t_temp.threshold_max, t_temp.severity,
                f"Température serre trop basse : {sr.avg_temp}°C < min {t_temp.threshold_min}°C — {farm_info}")

    # ── 4. Humidité — ignorer alerte basse en hiver froid ─────
    t_hum = thresh_map.get("humidity")
    if t_hum and sr.humidity is not None:
        outside = sr.outside_temp
        cold_winter = outside is not None and outside < 8.0
        if t_hum.threshold_max is not None and sr.humidity > t_hum.threshold_max:
            create_alert("HUMIDITY", sr.humidity, t_hum.threshold_min, t_hum.threshold_max, t_hum.severity,
                f"Humidité trop élevée : {sr.humidity}% > max {t_hum.threshold_max}% — {farm_info}")
        elif t_hum.threshold_min is not None and sr.humidity < t_hum.threshold_min and not cold_winter:
            create_alert("HUMIDITY", sr.humidity, t_hum.threshold_min, t_hum.threshold_max, t_hum.severity,
                f"Humidité trop basse : {sr.humidity}% < min {t_hum.threshold_min}% — {farm_info}")

    # ── 5. Débit anormal pendant irrigation ───────────────────
    t_flow = thresh_map.get("flow")
    if t_flow and sr.flow is not None:
        if is_irrigating and sr.flow_nominal and sr.flow_nominal > 0:
            ratio = sr.flow / sr.flow_nominal
            if ratio < 0.5:
                create_alert("FLOW", sr.flow, None, sr.flow_nominal, "WARNING",
                    f"Débit trop bas pendant irrigation : {sr.flow} L/h vs nominal {sr.flow_nominal} L/h ({ratio*100:.0f}%) — {farm_info}")
            elif ratio > 1.5:
                create_alert("FLOW", sr.flow, None, sr.flow_nominal, "WARNING",
                    f"Débit trop élevé : {sr.flow} L/h vs nominal {sr.flow_nominal} L/h ({ratio*100:.0f}%) — {farm_info}")

    # ── 6. VPD élevé → stress hydrique plante ─────────────────
    if sr.vpd is not None and sr.vpd > 3.0:
        create_alert("VPD", sr.vpd, None, 3.0, "WARNING",
            f"VPD critique : {sr.vpd} kPa > 3.0 (stress hydrique fort) — {farm_info}")

    # ── 7. Radiation excessive sous serre ─────────────────────
    if sr.radiation is not None and sr.radiation > 1800:
        create_alert("RADIATION", sr.radiation, None, 1800, "WARNING",
            f"Radiation excessive : {sr.radiation} W/m² > 1800 (risque brûlures) — {farm_info}")

    # ── 8. Alarme Netafim (code hardware) ─────────────────────
    if sr.alarm is not None and sr.alarm > 0:
        create_alert("ALARM", sr.alarm, None, None, "CRITICAL",
            f"Alarme Netafim code {sr.alarm} — {farm_info}")

# ── ENDPOINT PRINCIPAL ────────────────────────────────────────
@router.post("/ingest")
async def ingest_sensor_data(
    request: Request,
    db: Session = Depends(get_db),
    api_key: str = Depends(verify_api_key),
):
    request_body = await request.json(
)
    logger.info(f"TYPE recu : {type(request_body)}")
    if isinstance(request_body, list):
        request_body = request_body[0]
    if isinstance(request_body, list):
        request_body = request_body[0]
    logger.info(f"TYPE final : {type(request_body)}")
    """
    Reçoit le JSON complet Netafim depuis le Raspberry Pi
    Insère dans les 4 tables TimescaleDB
    Vérifie les alertes automatiquement
    """
    try:
        # ── 1. Extraire la structure XMLExport ────────────────
        xml = request_body.get("XMLExport", {})
        
        if isinstance(xml, list):
            xml = xml[0]
        if not xml:
            raise HTTPException(status_code=400, detail="Structure XMLExport manquante")

        headers_data = xml.get("Headers") or {}
        if isinstance(headers_data, list): headers_data = headers_data[0]
        
        general_data = xml.get("General") or {}
        if isinstance(general_data, list): general_data = general_data[0]
        
        sensor_data = xml.get("TempSensor") or {}
        if isinstance(sensor_data, list): sensor_data = sensor_data[0]
        
        digital_data = xml.get("DigitalOut") or {}
        if isinstance(digital_data, list): digital_data = digital_data[0]
        
        weather_data = xml.get("HK_WeatherStation") or {}
        if isinstance(weather_data, list): weather_data = weather_data[0]
        
        chart_data = xml.get("IrrigationChartArray") or {}
        if isinstance(chart_data, list): chart_data = chart_data[0]

        # ── 2. Parser le timestamp ────────────────────────────
        ts_str = headers_data.get("TimeStamp")
        if not ts_str:
            raise HTTPException(status_code=400, detail="TimeStamp manquant")

        timestamp = parse_timestamp(ts_str)

        # ── 3. Récupérer ou créer le device ───────────────────
        device = get_or_create_device(db, headers_data)

        # ── 4. Vérifier doublon ───────────────────────────────
        existing = db.query(SensorReading).filter(
            SensorReading.device_id == device.id,
            SensorReading.timestamp == timestamp,
        ).first()

        if existing:
            logger.info(
                f"Doublon ignoré : {device.farm_name} "
                f"House {device.house_number} @ {timestamp}"
            )
            return {
                "status"  : "duplicate",
                "message" : "Données déjà présentes en base",
                "device"  : device.to_dict(),
                "timestamp": str(timestamp),
            }

        # ── 4b. Vérifier enregistrement vide ─────────────────
        ec   = sensor_data.get("EcAct")
        ph   = sensor_data.get("PhAct")
        temp = sensor_data.get("AvgTemp")
        flow = sensor_data.get("Flow")

        if all(v is None for v in [ec, ph, temp, flow]):
            logger.warning(
                f"Enregistrement vide ignoré — "
                f"{device.farm_name} House {device.house_number} @ {timestamp}"
            )
            return {"status": "skipped", "reason": "empty_record"}

        # ── 5. Insérer sensor_readings ────────────────────────
        # Vérification flow : si flow = 0 ou None → EC/pH invalides
        flow_value = safe_float(sensor_data.get("Flow"))
        no_flow    = flow_value is None or flow_value == 0.0

        sensor_reading = SensorReading(
            device_id        = device.id,
            timestamp        = timestamp,

            # General
            alarm            = safe_int(general_data.get("Alarm")),
            time_local       = general_data.get("Time"),
            siren            = safe_bool(general_data.get("Siren")),
            house_connection = safe_int(general_data.get("HouseConnectionStatus")),

            # Environnement
            avg_temp         = safe_float(sensor_data.get("AvgTemp")),
            humidity         = safe_float(sensor_data.get("Humidity")),
            outside_temp     = safe_float(sensor_data.get("OutsideTemp")),
            outside_humidity = safe_float(weather_data.get("Outside_Humidity")),

            # Solution nutritive
            ec_actual        = 0.0 if no_flow else safe_float(sensor_data.get("EcAct")),
            ph_actual        = 0.0 if no_flow else safe_float(sensor_data.get("PhAct")),
            ec_prog          = safe_float(sensor_data.get("EcProg")),
            ph_prog          = safe_float(sensor_data.get("PhProg")),
            ec_pre_process   = safe_float(sensor_data.get("ECPreProcess")),
            ec_pre_target    = safe_float(sensor_data.get("EcPreTarget")),
            ec_pre_actual    = safe_float(sensor_data.get("EcPreActual")),
            ec_ph_status     = sensor_data.get("ECPHSTATUS"),

            # Débit
            flow             = flow_value,
            flow_nominal     = safe_float(sensor_data.get("Flownom")),

            # Météo
            radiation        = safe_float(weather_data.get("Radiation")),
            radiation_sum    = safe_float(weather_data.get("Radiation_Sum")),
            wind_speed       = safe_float(weather_data.get("Wind_Speed")),
            wind_dir         = safe_int(weather_data.get("Wind_Dir")),
            rain_status      = weather_data.get("Rain_Status"),
            rain_flow        = safe_float(weather_data.get("Rain_Flow")),
            daily_rain       = safe_float(weather_data.get("Daily_Rain")),
            vpd              = safe_float(weather_data.get("VPD")),
            vpd_sum          = safe_float(weather_data.get("VPD_Sum")),

            # Arrays JSONB
            ec_actual_array  = safe_json_array(chart_data.get("ECActualArray")),
            ph_actual_array  = safe_json_array(chart_data.get("PHActualArray")),
            ec_prg_array     = safe_json_array(chart_data.get("ECPrgArray")),
            ph_prg_array     = safe_json_array(chart_data.get("PHPrgArray")),
            flow_actual_array= safe_json_array(chart_data.get("FlowActualArray")),
            flow_prg_array   = safe_json_array(chart_data.get("FlowPrgArray")),
        )
        db.add(sensor_reading)

        # ── 6. Insérer irrigation_cycles ──────────────────────
        irrig_cycle = IrrigationCycle(
            device_id         = device.id,
            timestamp         = timestamp,

            # Séquence
            sequence          = safe_int(sensor_data.get("Sequence")),
            cycle_prog        = safe_int(sensor_data.get("CycleProg")),
            cycle_act         = safe_int(sensor_data.get("CycleAct")),
            next_sequence     = safe_int(sensor_data.get("NextSeq")),
            next_seq_time     = sensor_data.get("NextSeqTime"),
            remaining_time    = sensor_data.get("RemainingTime"),
            active_order      = safe_int(sensor_data.get("ActiveOrder")),
            dry_cont          = safe_int(sensor_data.get("DryCont")),

            # Pompes
            pump1             = safe_int(sensor_data.get("Pump1")),
            pump2             = safe_int(sensor_data.get("Pump2")),
            pump3             = safe_int(sensor_data.get("Pump3")),
            pump4             = safe_int(sensor_data.get("Pump4")),
            pump5             = safe_int(sensor_data.get("Pump5")),
            pump6             = safe_int(sensor_data.get("Pump6")),

            # Vannes principales
            main_valve1       = safe_int(sensor_data.get("MainValve1")),
            main_valve2       = safe_int(sensor_data.get("MainValve2")),
            main_valve3       = safe_int(sensor_data.get("MainValve3")),
            main_valve4       = safe_int(sensor_data.get("MainValve4")),
            main_valve5       = safe_int(sensor_data.get("MainValve5")),
            main_valve6       = safe_int(sensor_data.get("MainValve6")),

            # Vannes zones
            valve1            = safe_int(sensor_data.get("Valve1")),
            valve2            = safe_int(sensor_data.get("Valve2")),
            valve3            = safe_int(sensor_data.get("Valve3")),
            valve4            = safe_int(sensor_data.get("Valve4")),
            valves_in_irrig   = safe_int(sensor_data.get("ValvesInIrrigation")),

            # Etat système
            valve_prog        = safe_int(sensor_data.get("ValveProg")),
            fert_prog         = safe_int(sensor_data.get("FertProg")),
            manual_prog       = safe_int(sensor_data.get("ManualProg")),
            pause             = safe_int(sensor_data.get("Pause")),
            uncompressed_prog = safe_int(sensor_data.get("UncompProg")),

            # DigitalOut
            irrigation_active = str(digital_data.get("Irrigation", {}).get("Active", "0")),
            fert_active       = str(digital_data.get("Fert", {}).get("Active", "0")),
            booster_active    = str(digital_data.get("Booster", {}).get("Active", "0")),
            misting_active    = str(digital_data.get("Misting", {}).get("Active", "0")),
            cooling_active    = str(digital_data.get("Cooling_Status", {}).get("Active", "0")),
            flushing_status   = str(digital_data.get("Flushing_Status", {}).get("Active", "0")),
            flushing_active   = str(digital_data.get("Flushing_Active", {}).get("Active", "0")),

            # Eau
            water_mode        = safe_int(sensor_data.get("WaterMode")),
            water_prg_qty     = safe_int(sensor_data.get("WaterPrgQty")),
            water_prg_time    = sensor_data.get("WaterPrgTime"),
            water_act_qty     = safe_float(sensor_data.get("WaterActQty")),
            water_act_time    = sensor_data.get("WaterActTime"),
            water_left = calc_water_left(
                sensor_data.get("WaterPrgTime", ""),
                sensor_data.get("WaterActTime", ""),
            ),

            # Fertigation programme
            fertilizer_qty    = safe_int(sensor_data.get("FertilizerQuantity")),
            dosing_pump_type1 = sensor_data.get("DosingPumpType1"),
            dosing_pump_type2 = sensor_data.get("DosingPumpType2"),
            dosing_pump_type3 = sensor_data.get("DosingPumpType3"),
            dosing_pump_type4 = sensor_data.get("DosingPumpType4"),
            dosing_pump_type5 = sensor_data.get("DosingPumpType5"),
            dosing_pump_type6 = sensor_data.get("DosingPumpType6"),
            dosing_pump_type7 = sensor_data.get("DosingPumpType7"),
            dosing_pump_type8 = sensor_data.get("DosingPumpType8"),
        )
        db.add(irrig_cycle)

        # ── 7. Insérer fertigation_state ──────────────────────
        fert_state = FertigationState(
            device_id  = device.id,
            timestamp  = timestamp,

            # Canal 1
            fert_open1 = safe_float(sensor_data.get("FertOpen1")),
            fert_min1  = safe_float(sensor_data.get("FertMin1")),
            fert_act1  = safe_float(sensor_data.get("FertAct1")),
            fert_max1  = safe_float(sensor_data.get("FertMax1")),
            fert_flow1 = safe_float(sensor_data.get("FertFlow1")),

            # Canal 2
            fert_open2 = safe_float(sensor_data.get("FertOpen2")),
            fert_min2  = safe_float(sensor_data.get("FertMin2")),
            fert_act2  = safe_float(sensor_data.get("FertAct2")),
            fert_max2  = safe_float(sensor_data.get("FertMax2")),
            fert_flow2 = safe_float(sensor_data.get("FertFlow2")),

            # Canal 3
            fert_open3 = safe_float(sensor_data.get("FertOpen3")),
            fert_min3  = safe_float(sensor_data.get("FertMin3")),
            fert_act3  = safe_float(sensor_data.get("FertAct3")),
            fert_max3  = safe_float(sensor_data.get("FertMax3")),
            fert_flow3 = safe_float(sensor_data.get("FertFlow3")),

            # Canal 4
            fert_open4 = safe_float(sensor_data.get("FertOpen4")),
            fert_min4  = safe_float(sensor_data.get("FertMin4")),
            fert_act4  = safe_float(sensor_data.get("FertAct4")),
            fert_max4  = safe_float(sensor_data.get("FertMax4")),
            fert_flow4 = safe_float(sensor_data.get("FertFlow4")),

            # Canal 5
            fert_open5 = safe_float(sensor_data.get("FertOpen5")),
            fert_min5  = safe_float(sensor_data.get("FertMin5")),
            fert_act5  = safe_float(sensor_data.get("FertAct5")),
            fert_max5  = safe_float(sensor_data.get("FertMax5")),
            fert_flow5 = safe_float(sensor_data.get("FertFlow5")),

            # Canal 6
            fert_open6 = safe_float(sensor_data.get("FertOpen6")),
            fert_min6  = safe_float(sensor_data.get("FertMin6")),
            fert_act6  = safe_float(sensor_data.get("FertAct6")),
            fert_max6  = safe_float(sensor_data.get("FertMax6")),
            fert_flow6 = safe_float(sensor_data.get("FertFlow6")),

            # Canal 7
            fert_open7 = safe_float(sensor_data.get("FertOpen7")),
            fert_min7  = safe_float(sensor_data.get("FertMin7")),
            fert_act7  = safe_float(sensor_data.get("FertAct7")),
            fert_max7  = safe_float(sensor_data.get("FertMax7")),
            fert_flow7 = safe_float(sensor_data.get("FertFlow7")),

            # Canal 8
            fert_open8 = safe_float(sensor_data.get("FertOpen8")),
            fert_min8  = safe_float(sensor_data.get("FertMin8")),
            fert_act8  = safe_float(sensor_data.get("FertAct8")),
            fert_max8  = safe_float(sensor_data.get("FertMax8")),
            fert_flow8 = safe_float(sensor_data.get("FertFlow8")),
        )
        db.add(fert_state)

        # ── 8. Vérifier alertes ───────────────────────────────
        check_and_create_alerts(
            db, device, timestamp, sensor_data, sensor_reading
        )

        # ── 9. Commit tout en une transaction ─────────────────
        db.commit()

        logger.success(
            f"✅ Ingest OK : {device.farm_name} House {device.house_number} "
            f"@ {timestamp} | EC={sensor_reading.ec_actual} "
            f"pH={sensor_reading.ph_actual} T={sensor_reading.avg_temp}°C"
        )

        return {
            "status"      : "success",
            "message"     : "Données insérées avec succès",
            "device"      : device.to_dict(),
            "timestamp"   : str(timestamp),
            "ec_actual"   : sensor_reading.ec_actual,
            "ph_actual"   : sensor_reading.ph_actual,
            "avg_temp"    : sensor_reading.avg_temp,
        }

    except HTTPException:
        raise

    except IntegrityError:
        db.rollback()
        logger.info("Doublon détecté via IntegrityError")
        return {
            "status"    : "duplicate",
            "message"   : "Données déjà présentes en base",
            "device"    : device.to_dict(),   # device est déjà résolu avant le try
            "timestamp" : str(timestamp),
        }

    except ValueError as e:
        db.rollback()
        logger.error(f"Erreur format données : {e}")
        raise HTTPException(status_code=400, detail=str(e))

    except Exception as e:
        db.rollback()
        logger.error(f"Erreur ingest : {e}")
        raise HTTPException(status_code=500, detail=f"Erreur serveur : {str(e)}")

