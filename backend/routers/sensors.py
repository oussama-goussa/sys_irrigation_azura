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

from pydantic import BaseModel
from typing import Any

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
        logger.warning(f"Tentative accès /ingest avec clé invalide (premiers chars: {str(x_api_key)[:4]}...)")
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
        {"parameter": "ec_actual",  "min": 2.5,  "max": 5.0,  "severity": "WARNING"},  # tomate cerise coco
        {"parameter": "ph_actual",  "min": 5.5,  "max": 6.3,  "severity": "WARNING"},  # max abaissé (carence Fe)
        {"parameter": "avg_temp",   "min": 14.0, "max": 30.0, "severity": "WARNING"},  # max 30°C pollinisation
        {"parameter": "humidity",   "min": 60.0, "max": 82.0, "severity": "WARNING"},  # botrytis tomate cerise
        {"parameter": "flow",       "min": 0.0,  "max": None, "severity": "WARNING"},
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
    sensor_data: dict,
    sr: SensorReading
):
    """
    Logique d'alertes graduée INFO / WARNING / CRITICAL.
    
    Règles de sévérité :
    ┌──────────┬────────────────────────────────────────────────────────┐
    │ CRITICAL │ Valeur hors plage de ±20% des seuils configurés       │
    │          │ EC/pH = 0 pendant irrigation                          │
    │          │ Débit < 40% ou > 200% du nominal                     │
    │          │ Station offline (géré séparément)                     │
    │          │ Alarme Netafim active                                 │
    ├──────────┼────────────────────────────────────────────────────────┤
    │ WARNING  │ Valeur entre seuil et ±20% (zone orange)              │
    │          │ Débit entre 40-60% ou 150-200% du nominal            │
    │          │ VPD entre 2.0 et 3.0 kPa                             │
    │          │ Radiation entre 1500 et 1800 W/m²                    │
    ├──────────┼────────────────────────────────────────────────────────┤
    │ INFO     │ Retour à la normale après alerte (log uniquement)     │
    │          │ Valeur OK mais proche du seuil (dans 10% du seuil)   │
    └──────────┴────────────────────────────────────────────────────────┘
    """
    from datetime import timedelta

    flow      = sr.flow or 0.0
    is_irrig  = flow > 0.0
    farm_info = f"{device.farm_name} Station {device.house_number}"

    thresholds = db.query(AlertThreshold).filter(
        AlertThreshold.device_id == device.id,
        AlertThreshold.is_active  == True
    ).all()
    thresh_map = {t.parameter: t for t in thresholds}

    # ── helpers ──────────────────────────────────────────────────

    def already_alerted(alert_type: str, window_min: int = 30) -> bool:
        cutoff = timestamp - timedelta(minutes=window_min)
        return db.query(Alert).filter(
            Alert.device_id  == device.id,
            Alert.alert_type == alert_type,
            Alert.resolved_at == None,
            Alert.timestamp  >= cutoff,
        ).first() is not None

    def create_alert(alert_type, value, thresh_min, thresh_max, severity, message, window_min=30):
        if already_alerted(alert_type, window_min):
            return
        db.add(Alert(
            device_id      = device.id,
            timestamp      = timestamp,
            alert_type     = alert_type,
            value_detected = value,
            threshold_min  = thresh_min,
            threshold_max  = thresh_max,
            severity       = severity,
            message        = message,
        ))
        logger.warning(f"⚠️ [{severity}] {alert_type} : {message}")

    def auto_resolve(alert_type: str):
        resolved = db.query(Alert).filter(
            Alert.device_id  == device.id,
            Alert.alert_type == alert_type,
            Alert.resolved_at == None,
        ).all()
        for a in resolved:
            a.resolved_at = timestamp
            a.resolved_by = "auto"
        if resolved:
            logger.info(f"✅ Auto-résolution {alert_type} — {farm_info} ({len(resolved)} alertes)")

    def severity_for_value(value, t_min, t_max) -> str:
        """
        Retourne CRITICAL / WARNING / INFO selon l'écart au seuil.
        Zone WARNING = entre le seuil et 15% au-delà (tampon).
        Zone CRITICAL = au-delà de 15% du seuil.
        """
        if t_max is not None and value > t_max:
            ratio = (value - t_max) / max(abs(t_max), 0.01)
            return "CRITICAL" if ratio > 0.15 else "WARNING"
        if t_min is not None and value < t_min:
            ratio = (t_min - value) / max(abs(t_min), 0.01)
            return "CRITICAL" if ratio > 0.15 else "WARNING"
        return "INFO"

    def near_threshold(value, t_min, t_max, pct=0.10) -> bool:
        """Vrai si la valeur est dans les 10% d'un seuil (pré-alerte)."""
        if t_max is not None and value <= t_max:
            if (t_max - value) / max(abs(t_max), 0.01) < pct:
                return True
        if t_min is not None and value >= t_min:
            if (value - t_min) / max(abs(t_min), 0.01) < pct:
                return True
        return False

    ALARM_CODES = {
        1:  "Court-circuit sonde température interne",
        2:  "Coupure câble sonde température interne",
        3:  "Défaillance sonde température interne",
        4:  "Court-circuit sonde température extérieure",
        5:  "Coupure câble sonde température extérieure",
        6:  "Défaillance sonde température extérieure",
        7:  "Défaillance carte relais",
        8:  "Défaillance entrée analogique",
        9:  "Défaillance entrée digitale",
        10: "Défaillance horloge interne",
        11: "Défaillance carte CPU",
        12: "Défaillance mémoire",
        13: "Défaillance capteur EC",
        14: "Défaillance capteur pH",
        15: "Débit trop élevé (High Flow)",
        16: "Débit trop faible (Low Flow)",
        17: "Fuite d'eau détectée",
        18: "Fuite canal de dosage",
        19: "Défaut canal de dosage",
        20: "Pause externe activée",          # état normal
        21: "Encrassement filtre — rinçage requis",
        22: "EC trop élevé (contrôleur)",
        23: "EC trop bas (contrôleur)",
        24: "pH trop élevé (contrôleur)",
        25: "pH trop bas (contrôleur)",
        26: "Absence de débit",
        27: "Alarme débit",
        28: "Court-circuit sortie",
        # Codes spécifiques Netafim 4G
        29: "Défaut communication 4G/réseau",
        30: "Batterie faible (autonomie réduite)",
        31: "Coupure secteur — fonctionnement sur batterie",
    }

    # Codes qui sont des états normaux → INFO seulement
    ALARM_INFO_ONLY = {20, 22, 23, 24, 25}  # pause + EC/pH redondants avec tes alertes

    current_month = timestamp.month
    is_winter     = current_month in (11, 12, 1, 2, 3)   # Nov→Mars Agadir
    outside_temp = sr.outside_temp

    # ══════════════════════════════════════════════════════════════
    # 0. HOUSE CONNECTION — serre déconnectée du contrôleur
    # ══════════════════════════════════════════════════════════════
    if sr.house_connection is not None:
        if sr.house_connection == 0:
            create_alert(
                "HOUSE_DISCONNECTED", 0, None, None, "CRITICAL",
                f"Serre physiquement déconnectée du contrôleur Netafim — {farm_info}",
            )
        else:
            auto_resolve("HOUSE_DISCONNECTED")

    # ══════════════════════════════════════════════════════════════
    # 1. EC APPORT — seulement pendant irrigation
    # ══════════════════════════════════════════════════════════════
    t_ec = thresh_map.get("ec_actual")
    if t_ec and sr.ec_actual is not None and is_irrig:
        ec = sr.ec_actual

        if ec == 0.0:
            # EC = 0 en irrigation → capteur défaillant → CRITICAL immédiat
            create_alert(
                "EC_ACTUAL", 0.0,
                t_ec.threshold_min, t_ec.threshold_max,
                "CRITICAL",
                f"EC = 0 mS/cm pendant irrigation (débit {flow:.0f} L/h) → capteur défaillant — {farm_info}",
            )
        elif (t_ec.threshold_min is not None and ec < t_ec.threshold_min) or \
             (t_ec.threshold_max is not None and ec > t_ec.threshold_max):
            sev = severity_for_value(ec, t_ec.threshold_min, t_ec.threshold_max)
            if ec < (t_ec.threshold_min or 0):
                msg = f"EC trop bas : {ec:.2f} mS/cm (seuil min {t_ec.threshold_min}) — {farm_info}"
            else:
                msg = f"EC trop élevé : {ec:.2f} mS/cm (seuil max {t_ec.threshold_max}) — {farm_info}"
            create_alert("EC_ACTUAL", ec, t_ec.threshold_min, t_ec.threshold_max, sev, msg)
        else:
            # Valeur OK
            auto_resolve("EC_ACTUAL")
            # Pré-alerte INFO si proche du seuil
            if near_threshold(ec, t_ec.threshold_min, t_ec.threshold_max):
                create_alert(
                    "EC_ACTUAL", ec,
                    t_ec.threshold_min, t_ec.threshold_max,
                    "INFO",
                    f"EC proche du seuil : {ec:.2f} mS/cm — {farm_info}",
                    window_min=60,   # pré-alerte toutes les 60 min max
                )
    elif t_ec and not is_irrig:
        auto_resolve("EC_ACTUAL")

    # ══════════════════════════════════════════════════════════════
    # 2. pH APPORT — seulement pendant irrigation
    # ══════════════════════════════════════════════════════════════
    t_ph = thresh_map.get("ph_actual")
    if t_ph and sr.ph_actual is not None and is_irrig:
        ph = sr.ph_actual

        if ph == 0.0:
            create_alert(
                "PH_ACTUAL", 0.0,
                t_ph.threshold_min, t_ph.threshold_max,
                "CRITICAL",
                f"pH = 0 pendant irrigation (débit {flow:.0f} L/h) → capteur défaillant — {farm_info}",
            )
        elif (t_ph.threshold_min is not None and ph < t_ph.threshold_min) or \
             (t_ph.threshold_max is not None and ph > t_ph.threshold_max):
            sev = severity_for_value(ph, t_ph.threshold_min, t_ph.threshold_max)
            if ph < (t_ph.threshold_min or 0):
                msg = f"pH trop bas : {ph:.2f} (seuil min {t_ph.threshold_min}) — {farm_info}"
            else:
                msg = f"pH trop élevé : {ph:.2f} (seuil max {t_ph.threshold_max}) — {farm_info}"
            create_alert("PH_ACTUAL", ph, t_ph.threshold_min, t_ph.threshold_max, sev, msg)
        else:
            auto_resolve("PH_ACTUAL")
            if near_threshold(ph, t_ph.threshold_min, t_ph.threshold_max):
                create_alert(
                    "PH_ACTUAL", ph,
                    t_ph.threshold_min, t_ph.threshold_max,
                    "INFO",
                    f"pH proche du seuil : {ph:.2f} — {farm_info}",
                    window_min=60,
                )
    elif t_ph and not is_irrig:
        auto_resolve("PH_ACTUAL")

    # ══════════════════════════════════════════════════════════════
    # 2b. ECPHSTATUS — signal direct du contrôleur Netafim
    # États connus : OK / Pause / Alarm / Wash / Manual / Flushing
    # ══════════════════════════════════════════════════════════════
    ec_ph_status = (sr.ec_ph_status or "").strip()
    if ec_ph_status == "Alarm":
        create_alert(
            "ECPH_STATUS", None, None, None, "CRITICAL",
            f"Contrôleur Netafim signale alarme EC/pH (ECPHSTATUS=Alarm) — {farm_info}",
        )
    elif ec_ph_status in ("Wash", "Flushing"):
        # Rinçage en cours = normal, résoudre alertes EC/pH actives
        auto_resolve("EC_ACTUAL")
        auto_resolve("PH_ACTUAL")
    elif ec_ph_status == "OK":
        auto_resolve("ECPH_STATUS")

    # ══════════════════════════════════════════════════════════════
    # 3. TEMPÉRATURE SERRE
    # Pas d'alerte froid en hiver (Nov→Mars Agadir) sauf >5°C d'écart
    # ══════════════════════════════════════════════════════════════
    t_temp = thresh_map.get("avg_temp")
    if t_temp and sr.avg_temp is not None:
        temp = sr.avg_temp
        cold_outside = (outside_temp is not None and outside_temp < 8.0) or is_winter

        too_hot  = t_temp.threshold_max is not None and temp > t_temp.threshold_max
        too_cold = (
            t_temp.threshold_min is not None and
            temp < t_temp.threshold_min and
            not (cold_outside and temp >= t_temp.threshold_min - 5.0)
            # En hiver, tolérer jusqu'à 5°C sous le seuil min avant d'alerter
        )

        if too_hot or too_cold:
            if too_hot:
                # Seuils agronomiques fixes tomate cerise : 30°C = pollinisation à risque, 32°C = CRITICAL
                if temp >= 32.0:
                    sev = "CRITICAL"
                    msg = f"Température critique : {temp:.1f}°C → noircissement fruit, pollinisation impossible — {farm_info}"
                else:
                    sev = "WARNING"
                    msg = f"Température élevée : {temp:.1f}°C → pollinisation dégradée (seuil {t_temp.threshold_max}°C) — {farm_info}"
            else:
                sev = severity_for_value(temp, t_temp.threshold_min, t_temp.threshold_max)
                msg = f"Température serre basse : {temp:.1f}°C (min {t_temp.threshold_min}°C) — {farm_info}"
            create_alert("AVG_TEMP", temp, t_temp.threshold_min, t_temp.threshold_max, sev, msg)
        else:
            auto_resolve("AVG_TEMP")
            if near_threshold(temp, t_temp.threshold_min, t_temp.threshold_max):
                create_alert(
                    "AVG_TEMP", temp,
                    t_temp.threshold_min, t_temp.threshold_max,
                    "INFO",
                    f"Température proche du seuil : {temp:.1f}°C — {farm_info}",
                    window_min=60,
                )

    # ══════════════════════════════════════════════════════════════
    # 4. HUMIDITÉ SERRE
    # ══════════════════════════════════════════════════════════════
    t_hum = thresh_map.get("humidity")
    if t_hum and sr.humidity is not None:
        hum = sr.humidity
        cold_outside = outside_temp is not None and outside_temp < 8.0

        too_high = t_hum.threshold_max is not None and hum > t_hum.threshold_max
        too_low  = (
            t_hum.threshold_min is not None and
            hum < t_hum.threshold_min and
            not cold_outside
        )

        if too_high or too_low:
            if too_high:
                # Tomate cerise très sensible au botrytis — CRITICAL dès 85%
                if hum >= 85.0:
                    sev = "CRITICAL"
                    msg = f"Humidité critique : {hum:.1f}% → botrytis imminent sur fruits — ventiler immédiatement — {farm_info}"
                else:
                    sev = "WARNING"
                    msg = f"Humidité élevée : {hum:.1f}% → risque botrytis/mildiou sur tomate cerise — {farm_info}"
            else:
                sev = severity_for_value(hum, t_hum.threshold_min, t_hum.threshold_max)
                msg = f"Humidité basse : {hum:.1f}% (min {t_hum.threshold_min}%) → VPD élevé, stress hydrique — {farm_info}"
            create_alert("HUMIDITY", hum, t_hum.threshold_min, t_hum.threshold_max, sev, msg)
        else:
            auto_resolve("HUMIDITY")
            if near_threshold(hum, t_hum.threshold_min, t_hum.threshold_max):
                create_alert(
                    "HUMIDITY", hum,
                    t_hum.threshold_min, t_hum.threshold_max,
                    "INFO",
                    f"Humidité proche du seuil : {hum:.1f}% — {farm_info}",
                    window_min=60,
                )

    # ══════════════════════════════════════════════════════════════
    # 5. DÉBIT — pendant irrigation uniquement
    # Seuils : <40% nominal = CRITICAL, 40-60% = WARNING
    #          >200% nominal = CRITICAL, 150-200% = WARNING
    # ══════════════════════════════════════════════════════════════
    if is_irrig and sr.flow_nominal and sr.flow_nominal > 0:
        ratio = flow / sr.flow_nominal

        if ratio < 0.40:
            create_alert(
                "FLOW", flow, None, sr.flow_nominal, "CRITICAL",
                f"Débit très faible : {flow:.0f} L/h ({ratio*100:.0f}% du nominal {sr.flow_nominal:.0f}) → vérifier pompe — {farm_info}",
            )
        elif ratio < 0.60:
            create_alert(
                "FLOW", flow, None, sr.flow_nominal, "WARNING",
                f"Débit bas : {flow:.0f} L/h ({ratio*100:.0f}% du nominal {sr.flow_nominal:.0f}) — {farm_info}",
            )
        elif ratio > 2.00:
            create_alert(
                "FLOW", flow, None, sr.flow_nominal, "CRITICAL",
                f"Débit excessif : {flow:.0f} L/h ({ratio*100:.0f}% du nominal) → risque fuite — {farm_info}",
            )
        elif ratio > 1.50:
            create_alert(
                "FLOW", flow, None, sr.flow_nominal, "WARNING",
                f"Débit élevé : {flow:.0f} L/h ({ratio*100:.0f}% du nominal) — {farm_info}",
            )
        else:
            auto_resolve("FLOW")
    elif not is_irrig:
        auto_resolve("FLOW")

    # ══════════════════════════════════════════════════════════════
    # 5b. INJECTEURS FERTIGATION — tous null pendant irrigation
    # ══════════════════════════════════════════════════════════════
    if is_irrig:
        fert_acts = [
            getattr(sr, f"fert_act{i}", None)
            for i in range(1, 9)
            # récupérer depuis FertigationState n'est pas dispo ici,
            # mais ECPreProcess est dans SensorReading
        ]
        if sr.ec_pre_process is not None and sr.ec_pre_process == 0.0 and flow > 0:
            create_alert(
                "FERT_SILENT", 0.0, None, None, "WARNING",
                f"ECPreProcess = 0 pendant irrigation (débit {flow:.0f} L/h) → injecteurs silencieux ? — {farm_info}",
                window_min=15,
            )
        else:
            auto_resolve("FERT_SILENT")

    # ══════════════════════════════════════════════════════════════
    # 6. VPD (stress hydrique)
    # >3.0 = CRITICAL, 2.0-3.0 = WARNING, 1.5-2.0 = INFO
    # ══════════════════════════════════════════════════════════════
    if sr.vpd is not None:
        vpd = sr.vpd
        if vpd > 3.0:
            create_alert(
                "VPD", vpd, None, 3.0, "CRITICAL",
                f"VPD critique : {vpd:.2f} kPa → stress hydrique sévère, irrigation urgente — {farm_info}",
            )
        elif vpd > 2.0:
            create_alert(
                "VPD", vpd, None, 2.0, "WARNING",
                f"VPD élevé : {vpd:.2f} kPa → stress hydrique modéré — {farm_info}",
            )
        elif vpd > 1.5:
            create_alert(
                "VPD", vpd, None, 1.5, "INFO",
                f"VPD en hausse : {vpd:.2f} kPa — surveiller — {farm_info}",
                window_min=120,
            )
        elif vpd < 0.4:
            create_alert(
                "VPD_LOW", vpd, 0.4, None, "WARNING",
                f"VPD trop bas : {vpd:.2f} kPa → risque mildiou, transpiration bloquée — {farm_info}",
                window_min=60,
            )
        else:
            auto_resolve("VPD")
            auto_resolve("VPD_LOW")

    # ══════════════════════════════════════════════════════════════
    # 7. RADIATION solaire — capteur extérieur HK_WeatherStation
    # Instantanée : max Agadir ~700-950 W/m² (extérieur)
    # Cumulée (radiation_sum) : ~1400 J/cm² à 14h, ~2500-3000 fin journée été
    # ══════════════════════════════════════════════════════════════

    # 7a. Radiation instantanée extérieure
    if sr.radiation is not None:
        rad = sr.radiation
        if rad > 900:
            create_alert(
                "RADIATION", rad, None, 900, "WARNING",
                f"Radiation extérieure élevée : {rad:.0f} W/m² → surveiller température serre — {farm_info}",
                window_min=60,
            )
        elif rad > 700:
            create_alert(
                "RADIATION", rad, None, 700, "INFO",
                f"Radiation extérieure forte : {rad:.0f} W/m² — vérifier ombrage serre — {farm_info}",
                window_min=120,
            )
        else:
            auto_resolve("RADIATION")

    # 7b. Radiation cumulée journalière (depuis minuit)
    if sr.radiation_sum is not None:
        rad_sum = sr.radiation_sum
        if rad_sum > 3000:
            create_alert(
                "RADIATION_SUM", rad_sum, None, 3000, "CRITICAL",
                f"Radiation cumulée très élevée : {rad_sum:.0f} J/cm² → tour irrigation supplémentaire requis — {farm_info}",
                window_min=120,
            )
        elif rad_sum > 2000:
            create_alert(
                "RADIATION_SUM", rad_sum, None, 2000, "WARNING",
                f"Radiation cumulée élevée : {rad_sum:.0f} J/cm² → vérifier plan irrigation — {farm_info}",
                window_min=120,
            )
        else:
            auto_resolve("RADIATION_SUM")

    # ══════════════════════════════════════════════════════════════
    # 8. ALARME NETAFIM
    # Toujours CRITICAL (code matériel)
    # ══════════════════════════════════════════════════════════════
    if sr.alarm is not None:
        alarm_code = int(sr.alarm) if sr.alarm else 0
        if alarm_code > 0:
            alarm_desc = ALARM_CODES.get(alarm_code, f"Alarme inconnue code {alarm_code}")
            if alarm_code in ALARM_INFO_ONLY:
                # Pause ou EC/pH signalé par le contrôleur = INFO seulement
                create_alert(
                    "ALARM", sr.alarm, None, None, "INFO",
                    f"{alarm_desc} — {farm_info}",
                    window_min=60,
                )
            elif alarm_code in (29, 30, 31):
                # Problèmes 4G/batterie/secteur = CRITICAL immédiat
                create_alert(
                    "ALARM", sr.alarm, None, None, "CRITICAL",
                    f"{alarm_desc} — {farm_info}",
                )
            else:
                create_alert(
                    "ALARM", sr.alarm, None, None, "CRITICAL",
                    f"{alarm_desc} — {farm_info}",
                )
        else:
            auto_resolve("ALARM")

# ── ENDPOINT PRINCIPAL ────────────────────────────────────────
class IngestPayload(BaseModel):
    XMLExport: Any  

@router.post("/ingest")
async def ingest_sensor_data(
    request: Request,
    db: Session = Depends(get_db),
    api_key: str = Depends(verify_api_key),
):
    try:
        request_body = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="JSON invalide")

    if not isinstance(request_body, (dict, list)):
        raise HTTPException(status_code=400, detail="Format JSON attendu")    

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
        if isinstance(weather_data, list): weather_data = next((item for item in weather_data if item is not None), {})
        
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
            outside_temp     = safe_float(sensor_data.get("OutsideTemp"))
                    or safe_float(weather_data.get("Outside_Temperature")),
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

