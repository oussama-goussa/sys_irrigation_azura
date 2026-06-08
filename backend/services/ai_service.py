# ============================================================
# backend/services/ai_service.py
# Service Agent IA Irrigation — Wrapper XGBoost
# Projet Azura Irrigation IA — GOUSSA Oussama
# ============================================================
#
# Responsabilités :
#   - Charger les modèles XGBoost au démarrage (singleton)
#   - Préparer les features depuis BDD + Open-Meteo fallback
#   - Générer recommandations matin pour 1 device ou TOUS les devices
#   - Générer décision tour/tour (si drainage dispo, sinon message indisponible)
#   - Comparer humain vs IA
# ============================================================

import os
import joblib
import requests
import pandas as pd
import numpy as np
from pathlib import Path
from datetime import date, datetime, timedelta
from loguru import logger
from sqlalchemy import func
from sqlalchemy.orm import Session

from core.database import SessionLocal
from models.sensor_model import Device, SensorReading
from models.ai_recommendation_model import (
    AIRecommandation, AIConfigDevice, AIDecisionTour
)
# predict_matin et predict_tour sont définis localement ci-dessous (copiés de decision_agent.py)

# ════════════════════════════════════════════════════════════════
# CONSTANTES
# ════════════════════════════════════════════════════════════════

MODELS_DIR = Path(__file__).resolve().parent.parent / "models_xgboost"

# Coordonnées Agadir (par défaut)
DEFAULT_LAT = 30.4202
DEFAULT_LON = -9.5981

# ════════════════════════════════════════════════════════════════
# SINGLETON — Modèles chargés en mémoire
# ════════════════════════════════════════════════════════════════

_modeles_matin = None
_enc_matin = None
_modeles_tour = None
_enc_tour = None


def charger_modeles():
    """
    Charge les 4 fichiers .pkl en mémoire (singleton).
    Appelé au startup du backend.
    """
    global _modeles_matin, _enc_matin, _modeles_tour, _enc_tour

    if _modeles_matin is not None:
        logger.info("Modèles IA déjà en mémoire — skip")
        return

    logger.info("Chargement des modèles XGBoost...")

    _modeles_matin = joblib.load(MODELS_DIR / "xgb_matin_modeles.pkl")
    _enc_matin     = joblib.load(MODELS_DIR / "xgb_matin_encoders.pkl")
    _modeles_tour  = joblib.load(MODELS_DIR / "xgb_tour_modeles.pkl")
    _enc_tour      = joblib.load(MODELS_DIR / "xgb_tour_encoders.pkl")

    logger.success(
        f"Modèles IA chargés ✅  "
        f"Matin={len(_modeles_matin)} modèles  "
        f"Tour={len(_modeles_tour)} modèles"
    )


def _get_modeles():
    """Retourne les modèles chargés (lance le chargement si nécessaire)."""
    if _modeles_matin is None:
        charger_modeles()
    return _modeles_matin, _enc_matin, _modeles_tour, _enc_tour


# ════════════════════════════════════════════════════════════════
# CONFIG DEVICE
# ════════════════════════════════════════════════════════════════

def get_or_create_config(db: Session, device_id: int) -> AIConfigDevice:
    """
    Récupère la config IA d'un device, ou la crée avec les valeurs par défaut.
    """
    cfg = db.query(AIConfigDevice).filter(
        AIConfigDevice.device_id == device_id
    ).first()

    if cfg is None:
        cfg = AIConfigDevice(
            device_id     = device_id,
            ec_eau_brute  = 0.8,
            methode_decision = "ml",
            drainage_dispo= False,
            actif         = True,
            latitude      = DEFAULT_LAT,
            longitude     = DEFAULT_LON,
        )
        db.add(cfg)
        db.commit()
        db.refresh(cfg)
        logger.info(f"Config IA créée pour device {device_id} (défaut)")

    return cfg


# ════════════════════════════════════════════════════════════════
# RÉCUPÉRATION MÉTÉO
# ════════════════════════════════════════════════════════════════

def recuperer_meteo_open_meteo(lat: float, lon: float, date_str: str) -> dict:
    """
    Appelle Open-Meteo API pour obtenir les données météo du jour.
    Retourne un dict avec les clés compatibles FEATURES_MATIN.
    """
    try:
        url = "https://api.open-meteo.com/v1/forecast"
        params = {
            "latitude"       : lat,
            "longitude"      : lon,
            "daily"          : [
                "temperature_2m_max",
                "temperature_2m_min",
                "temperature_2m_mean",
                "relative_humidity_2m_max",
                "relative_humidity_2m_min",
                "relative_humidity_2m_mean",
                "shortwave_radiation_sum",
                "precipitation_sum",
                "wind_speed_10m_max",
                "et0_fao_evapotranspiration",
                "vapor_pressure_deficit_max",
            ],
            "timezone"       : "Africa/Casablanca",
            "forecast_days"  : 1,
            "past_days"      : 1,
        }

        resp = requests.get(url, params=params, timeout=15)
        resp.raise_for_status()
        data = resp.json()

        daily = data.get("daily", {})
        # Prendre le dernier jour disponible (aujourd'hui ou le plus récent)
        idx = len(daily.get("time", [])) - 1
        if idx < 0:
            idx = 0

        def _safe(key, default=0.0):
            vals = daily.get(key, [])
            if idx < len(vals) and vals[idx] is not None:
                return float(vals[idx])
            return default

        meteo = {
            "meteo_T_max_C"                : _safe("temperature_2m_max"),
            "meteo_T_min_C"                : _safe("temperature_2m_min"),
            "meteo_T_mean_C"               : _safe("temperature_2m_mean"),
            "meteo_HR_max_pct"             : _safe("relative_humidity_2m_max"),
            "meteo_HR_min_pct"             : _safe("relative_humidity_2m_min"),
            "meteo_HR_mean_pct"            : _safe("relative_humidity_2m_mean"),
            "meteo_shortwave_radiation_sum": _safe("shortwave_radiation_sum"),
            "meteo_pluie_mm_jour"          : _safe("precipitation_sum"),
            "meteo_vent_max_kmh"           : _safe("wind_speed_10m_max"),
            "meteo_ET0_mm_jour"            : _safe("et0_fao_evapotranspiration"),
            "meteo_VPD_max_kPa"            : _safe("vapor_pressure_deficit_max"),
            "meteo_rs_wm2_max_jour"        : _safe("shortwave_radiation_sum") * 0.144,  # approx W/m²
        }

        logger.success(f"Météo Open-Meteo récupérée pour {date_str} ({lat}, {lon})")
        return meteo

    except Exception as e:
        logger.error(f"Erreur Open-Meteo : {e}")
        return {}


def _recuperer_meteo_capteurs(db: Session, device_id: int) -> dict:
    """
    Récupère les dernières données météo depuis sensor_readings.
    Retourne un dict avec les clés compatibles FEATURES_MATIN.
    """
    cutoff = datetime.utcnow() - timedelta(hours=24)

    readings = (
        db.query(SensorReading)
        .filter(
            SensorReading.device_id == device_id,
            SensorReading.timestamp >= cutoff,
        )
        .order_by(SensorReading.timestamp.desc())
        .limit(100)
        .all()
    )

    if not readings:
        return {}

    # Agréger : max/min/mean sur les dernières 24h
    temps     = [r.avg_temp for r in readings if r.avg_temp is not None]
    hums      = [r.humidity for r in readings if r.humidity is not None]
    radiations= [r.radiation for r in readings if r.radiation is not None]
    rad_sums  = [r.radiation_sum for r in readings if r.radiation_sum is not None]
    vpds      = [r.vpd for r in readings if r.vpd is not None]
    winds     = [r.wind_speed for r in readings if r.wind_speed is not None]
    rains     = [r.daily_rain for r in readings if r.daily_rain is not None]

    meteo = {}
    if temps:
        meteo["meteo_T_max_C"]  = max(temps)
        meteo["meteo_T_min_C"]  = min(temps)
        meteo["meteo_T_mean_C"] = sum(temps) / len(temps)
    if hums:
        meteo["meteo_HR_max_pct"]  = max(hums)
        meteo["meteo_HR_min_pct"]  = min(hums)
        meteo["meteo_HR_mean_pct"] = sum(hums) / len(hums)
    if radiations:
        meteo["meteo_rs_wm2_max_jour"] = max(radiations)
    if rad_sums:
        meteo["meteo_shortwave_radiation_sum"] = max(rad_sums)
    if vpds:
        meteo["meteo_VPD_max_kPa"] = max(vpds)
    if winds:
        meteo["meteo_vent_max_kmh"] = max(winds)
    if rains:
        meteo["meteo_pluie_mm_jour"] = max(rains)

    return meteo


# ════════════════════════════════════════════════════════════════
# CALCULS AGRONOMIQUES (simplifiés, sans dépendance agronomie.py)
# ════════════════════════════════════════════════════════════════

def _calculer_stade_et_kc(jours_depuis_plantation: int) -> tuple:
    """
    Détermine le stade phénologique et le Kc tomate cerise Agadir.
    Retourne (stade_str, Kc)
    """
    if jours_depuis_plantation <= 30:
        return "Vegetatif", 0.7
    elif jours_depuis_plantation <= 60:
        return "Developpement", 0.95
    elif jours_depuis_plantation <= 90:
        return "Floraison", 1.15
    elif jours_depuis_plantation <= 120:
        return "Grossissement", 1.05
    else:
        return "Maturation", 0.90


def _calculer_et0_penman_monteith(meteo: dict) -> float:
    """
    Estimation simplifiée ET0 (mm/jour) via formule Hargreaves.
    Utilisé comme fallback si Open-Meteo ne fournit pas ET0.
    """
    tmean  = meteo.get("meteo_T_mean_C", 22.0)
    tmax   = meteo.get("meteo_T_max_C", 28.0)
    tmin   = meteo.get("meteo_T_min_C", 16.0)
    ra     = meteo.get("meteo_shortwave_radiation_sum", 18.0) * 0.408  # MJ/m² → mm

    # Hargreaves : ET0 = 0.0023 × (Tmean + 17.8) × (Tmax - Tmin)^0.5 × Ra
    et0 = 0.0023 * (tmean + 17.8) * max(0, tmax - tmin) ** 0.5 * ra
    return max(1.0, min(10.0, et0))


def _calculer_FL(ec_bassin: float) -> float:
    """
    Facteur de lessivage (FL) — valeur par défaut 0.20 pour coco.
    """
    if ec_bassin <= 0.5:
        return 0.15
    elif ec_bassin <= 1.0:
        return 0.20
    elif ec_bassin <= 1.5:
        return 0.25
    else:
        return 0.30


def _calculer_alertes(meteo: dict) -> dict:
    """
    Calcule les 4 indicateurs d'alerte binaires.
    """
    t_max    = meteo.get("meteo_T_max_C", 0)
    rain     = meteo.get("meteo_pluie_mm_jour", 0)
    hr_mean  = meteo.get("meteo_HR_mean_pct", 0)
    vpd_max  = meteo.get("meteo_VPD_max_kPa", 0)

    return {
        "alerte_chergui"   : 1 if t_max > 35 else 0,
        "alerte_pluie"     : 1 if rain > 0.5 else 0,
        "alerte_brouillard": 1 if hr_mean > 85 else 0,
        "alerte_vpd_stress": 1 if vpd_max > 2.5 else 0,
    }


# ════════════════════════════════════════════════════════════════
# SYSTÈME PRT (Poids-Readings Tour) — Calcul heure début via poids
# ════════════════════════════════════════════════════════════════
#
# Principe :
#   Le poids arrive toutes les 5 min (capteurs weight_readings).
#   Le système surveille le poids en continu pendant la matinée.
#
#   1. poids_soir  = poids mesuré ~20 min après le dernier tour
#                    de la veille (fenêtre 13h30-16h00, pic ~14h-15h)
#   2. À chaque poids arrivant le matin :
#        PRT_pct = (poids_soir - poids_actuel) / poids_soir × 100
#   3. Le scénario_météo (13 scénarios) détermine les seuils
#      (seuil_bas, seuil_haut) :
#        - PRT_pct < seuil_bas   → ATTENDRE (pas assez de ressuyage)
#        - seuil_bas ≤ PRT < seuil_haut → DECLENCHER (zone acceptable)
#        - PRT_pct ≥ seuil_haut  → STRESS_HYDRIQUE (trop de ressuyage)
#   4. Quand DECLENCHER → heure_matin = heure de ce poids
#   5. heure_debut_tour1 = heure_matin + 10 min (gap fixe 99.3%)
#
#   Si aucune lecture de poids n'est disponible → on garde
#   l'heure_debut_ml prédite par le ML XGBoost.
# ════════════════════════════════════════════════════════════════

# ════════════════════════════════════════════════════════════════
# SEUILS PRT par scénario météo (13 scénarios)
# ════════════════════════════════════════════════════════════════
# Format: (seuil_bas, seuil_haut)
#   - PRT_pct < seuil_bas          → ATTENDRE
#   - seuil_bas ≤ PRT_pct < seuil_haut → DECLENCHER
#   - PRT_pct ≥ seuil_haut         → STRESS_HYDRIQUE
#
# Source : analyse de 17 214 données terrain (patterns opérateur)
# ════════════════════════════════════════════════════════════════
PRT_SEUILS = {
    # ── Zone STANDARD (ensoleillé) ──
    "1_TRES_ENSOLEILLE":  (9.0, 11.0),
    "2_ENSOLEILLE":       (9.0, 11.0),
    "7b_PLUIE_LEGERE":    (9.0, 10.0),

    # ── Zone BROUILLARD_NUAGEUX ──
    "3_NUAGEUX":          (9.0, 11.0),
    "4_TRES_NUAGEUX":     (10.0, 12.0),
    "5_BROUILLARD_MATIN": (10.0, 12.0),
    "5c_FOG_CHAUD_RS":    (9.0, 11.0),
    "5d_FOG_RADIATION":   (9.0, 10.5),
    "5e_FOG_FROID":       (10.0, 13.0),

    # ── Zone CHERGUI (vent chaud) ──
    "5b_FOG_CHAUD_VPD":   (8.5, 10.0),
    "6_CHERGUI_URGENT":   (8.0, 9.0),
    "8_NUAGEUX_CHAUD":    (8.5, 10.0),

    # ── Zone NUIT_FROIDE ──
    "9_NUIT_FROIDE_SOL":  (10.0, 12.0),

    # ── Pluie = arrêt ──
    "7_PLUIE_STOP":       (0.0, 0.0),   # cas spécial : pas d'irrigation

    # ── Fallback ──
    "default":            (9.0, 11.0),
}

# Heures de démarrage recommandées par scénario (moyenne opérateur)
# Utilisé comme fallback si poids non disponible
HEURE_DEBUT_RECOMMANDEE = {
    "1_TRES_ENSOLEILLE":  "08:29",
    "2_ENSOLEILLE":       "09:54",
    "3_NUAGEUX":          "10:00",
    "4_TRES_NUAGEUX":     "10:00",
    "5_BROUILLARD_MATIN": "09:31",
    "5b_FOG_CHAUD_VPD":   "08:42",
    "5c_FOG_CHAUD_RS":    "08:48",
    "5d_FOG_RADIATION":   "08:38",
    "5e_FOG_FROID":       "09:26",
    "6_CHERGUI_URGENT":   "08:38",
    "7_PLUIE_STOP":       None,       # pas d'irrigation
    "7b_PLUIE_LEGERE":    "09:06",
    "8_NUAGEUX_CHAUD":    "09:47",
    "9_NUIT_FROIDE_SOL":  "09:58",
    "default":            "09:14",    # moyenne globale
}

# Gap fixe entre heure_matin (détection seuil PRT) et début tour 1
# Source : 99.3% des cas = 10 min exactement
GAP_HEURE_MATIN_TO_TOUR1_MIN = 10

# Fenêtre de recherche du poids_soir (20 min après dernier tour)
# Le dernier tour se termine typiquement entre 13h et 15h30
# → poids_soir entre 13h20 et 16h00
POIDS_SOIR_HEURE_DEBUT = 13   # 13h00
POIDS_SOIR_HEURE_FIN   = 16   # 16h00

# Fenêtre de surveillance matinale (poids arrivant toutes les 5 min)
# Le ressuyage est détecté entre 7h et 11h (99.8% des cas)
POIDS_MATIN_HEURE_DEBUT = 6   # 06h00
POIDS_MATIN_HEURE_FIN   = 11  # 11h00


def _recuperer_poids_soir(
    db: Session,
    device_id: int,
    date_str: str,
) -> dict:
    """
    Récupère le poids_soir = poids mesuré ~20 min après la fin du
    dernier tour d'irrigation de la veille (jour - 1).

    Logique (identique au endpoint /poids-soir existant) :
      1. Trouver le dernier tour complété hier (IrrigationTour.fin)
      2. Chercher le poids 20 min après cette fin de tour
      3. Fallback : dernier poids entre 17h et 23h hier
      4. Si toujours rien → poids_soir = None (pas de PRT possible)

    Le poids_soir est cherché UNIQUEMENT dans jour - 1.
    Si pas de données hier → pas de PRT, on fallback sur recommandation.

    Retourne
    --------
    dict avec clés :
      poids_soir_kg  (float or None)
      heure_soir     (str "HH:MM" or None)
      fin_tour_soir  (str "HH:MM" or None) — heure fin du dernier tour
    """
    from models.weight_model import WeightReading as WR
    from models.sensor_model import IrrigationTour

    import datetime as _dt

    device = db.query(Device).filter(Device.id == device_id).first()
    if device is None:
        return {"poids_soir_kg": None, "heure_soir": None, "fin_tour_soir": None}

    date_cible = _dt.datetime.strptime(date_str, "%Y-%m-%d").date()
    date_veille = date_cible - _dt.timedelta(days=1)

    # ── 1. Trouver le dernier tour complété hier ──
    last_tour = (
        db.query(IrrigationTour)
        .filter(
            IrrigationTour.device_id == device_id,
            IrrigationTour.date      == date_veille,
            IrrigationTour.fin.isnot(None),
        )
        .order_by(IrrigationTour.tour_num.desc())
        .first()
    )

    fin_tour_str = None

    if last_tour and last_tour.fin:
        fin_tour_str = last_tour.fin.strftime("%H:%M")

        # ── 2. Poids 20 min après fin du dernier tour ──
        evening_time = last_tour.fin + _dt.timedelta(minutes=20)

        poids = (
            db.query(WR)
            .filter(
                WR.timestamp >= evening_time,
                WR.timestamp <= _dt.datetime.combine(date_veille, _dt.time(22, 59)),
                WR.poids_kg != None,
                WR.poids_kg > 0,
            )
            .order_by(WR.timestamp.asc())   # premier poids après +20min
            .first()
        )

        if poids:
            logger.info(
                f"Poids soir trouve : {poids.poids_kg} kg a "
                f"{poids.timestamp.strftime('%H:%M')} "
                f"(tour {last_tour.tour_num}, fin {fin_tour_str})"
            )
            return {
                "poids_soir_kg": poids.poids_kg,
                "heure_soir"   : poids.timestamp.strftime("%H:%M"),
                "fin_tour_soir": fin_tour_str,
            }

    # ── 3. Fallback : dernier poids entre 17h et 23h hier ──
    poids_fallback = (
        db.query(WR)
        .filter(
            WR.timestamp >= _dt.datetime.combine(date_veille, _dt.time(17, 0)),
            WR.timestamp <= _dt.datetime.combine(date_veille, _dt.time(22, 59)),
            WR.poids_kg != None,
            WR.poids_kg > 0,
        )
        .order_by(WR.timestamp.desc())   # le plus récent
        .first()
    )

    if poids_fallback:
        logger.info(
            f"Poids soir (fallback 17h-23h) : {poids_fallback.poids_kg} kg a "
            f"{poids_fallback.timestamp.strftime('%H:%M')}"
        )
        return {
            "poids_soir_kg": poids_fallback.poids_kg,
            "heure_soir"   : poids_fallback.timestamp.strftime("%H:%M"),
            "fin_tour_soir": fin_tour_str,
        }

    # ── 4. Aucun poids hier → pas de PRT possible ──
    logger.info(
        f"Pas de poids soir pour device {device_id} le {date_veille.isoformat()} "
        f"→ fallback recommandation"
    )
    return {"poids_soir_kg": None, "heure_soir": None, "fin_tour_soir": fin_tour_str}


def _recuperer_poids_matins(
    db: Session,
    device_id: int,
    date_str: str,
) -> list:
    """
    Récupère TOUTES les lectures de poids du matin (06h-11h)
    triées par heure croissante.

    Ces lectures sont utilisées pour simuler le calcul PRT
    en continu (toutes les 5 min) et détecter le moment
    où le seuil est atteint.

    Retourne
    --------
    list de dicts [{"poids_kg": float, "heure": "HH:MM", "timestamp": datetime}, ...]
    """
    from models.weight_model import WeightReading as WR

    device = db.query(Device).filter(Device.id == device_id).first()
    if device is None:
        return []

    farm_name = device.farm_name

    from datetime import datetime

    date_cible = datetime.strptime(date_str, "%Y-%m-%d").date()
    matin_debut = datetime.combine(date_cible, datetime.min.time().replace(hour=POIDS_MATIN_HEURE_DEBUT))
    matin_fin   = datetime.combine(date_cible, datetime.min.time().replace(hour=POIDS_MATIN_HEURE_FIN))

    lectures = (
        db.query(WR)
        .filter(
            WR.farm_name == farm_name,
            WR.timestamp >= matin_debut,
            WR.timestamp <= matin_fin,
            WR.poids_kg  != None,
            WR.poids_kg  > 0,
        )
        .order_by(WR.timestamp.asc())
        .all()
    )

    return [
        {
            "poids_kg"  : l.poids_kg,
            "heure"     : l.timestamp.strftime("%H:%M"),
            "timestamp" : l.timestamp,
        }
        for l in lectures
    ]


def calculer_prt_decision(
    poids_soir_kg: float,
    poids_actuel_kg: float,
    scenario_meteo: str,
) -> dict:
    """
    Calcule le PRT_pct et la décision (ATTENDRE / DECLENCHER / STRESS_HYDRIQUE).

    Formule :
      PRT_pct = (poids_soir - poids_actuel) / poids_soir × 100

    Seuils par scénario météo (13 scénarios) :
      - PRT_pct < seuil_bas          → ATTENDRE (pas assez de ressuyage)
      - seuil_bas ≤ PRT_pct < seuil_haut → DECLENCHER (zone acceptable)
      - PRT_pct ≥ seuil_haut         → STRESS_HYDRIQUE (trop de ressuyage)

    Cas spécial :
      - 7_PLUIE_STOP → PLUIE_STOP (pas d'irrigation)

    Retourne
    --------
    dict avec :
      prt_pct    (float, 2 décimales)
      decision   (str: ATTENDRE / DECLENCHER / STRESS_HYDRIQUE / PLUIE_STOP)
      seuil_bas  (float)
      seuil_haut (float)
    """
    if not poids_soir_kg or not poids_actuel_kg or poids_soir_kg <= 0:
        return {"prt_pct": None, "decision": "SANS_MESURE", "seuil_bas": None, "seuil_haut": None}

    prt_pct = round((poids_soir_kg - poids_actuel_kg) / poids_soir_kg * 100, 2)

    seuils = PRT_SEUILS.get(scenario_meteo, PRT_SEUILS["default"])
    seuil_bas, seuil_haut = seuils

    # Cas spécial : pluie = arrêt
    if seuil_bas == 0.0 and seuil_haut == 0.0:
        return {"prt_pct": prt_pct, "decision": "PLUIE_STOP", "seuil_bas": 0.0, "seuil_haut": 0.0}

    if prt_pct < seuil_bas:
        decision = "ATTENDRE"
    elif prt_pct < seuil_haut:
        decision = "DECLENCHER"
    else:
        decision = "STRESS_HYDRIQUE"

    return {
        "prt_pct"   : prt_pct,
        "decision"  : decision,
        "seuil_bas" : seuil_bas,
        "seuil_haut": seuil_haut,
    }


def detecter_heure_matin_et_debut_tour(
    db: Session,
    device_id: int,
    date_str: str,
    scenario_meteo: str,
) -> dict:
    """
    Logique principale PRT : simule le calcul en continu.

    1. Récupère poids_soir (veille 13h-16h)
    2. Récupère tous les poids du matin (06h-11h) par ordre croissant
    3. Pour chaque poids, calcule PRT_pct et la décision
    4. Détecte le PREMIER poids où décision = DECLENCHER
    5. heure_matin = heure de ce poids
    6. heure_debut_tour1 = heure_matin + 10 min

    Si aucun poids ne déclenche DECLENCHER :
      - Si STRESS_HYDRIQUE atteint → déclencher quand même (urgence)
      - Sinon → fallback sur heure recommandée par scénario

    Retourne
    --------
    dict avec :
      heure_debut_tour1  (str "HH:MM" or None)
      heure_matin        (str "HH:MM" or None)
      prt_pct            (float or None)
      decision           (str)
      poids_soir_kg      (float or None)
      poids_matin_kg     (float or None)
      fin_tour_soir      (str "HH:MM" or None) — heure fin du dernier tour hier
      source             (str: PRT_DECLENCHER / PRT_STRESS / RECOMMANDATION / ML)
    """
    # 1. Poids soir (basé sur fin du dernier tour hier)
    poids_soir_data = _recuperer_poids_soir(db, device_id, date_str)
    ps = poids_soir_data["poids_soir_kg"]
    fin_tour = poids_soir_data.get("fin_tour_soir")

    if ps is None:
        # Pas de poids soir → fallback sur heure recommandée
        heure_rec = HEURE_DEBUT_RECOMMANDEE.get(scenario_meteo, HEURE_DEBUT_RECOMMANDEE["default"])
        return {
            "heure_debut_tour1": heure_rec,
            "heure_matin"      : None,
            "prt_pct"          : None,
            "decision"         : "FALLBACK_RECOMMANDATION",
            "poids_soir_kg"    : None,
            "poids_matin_kg"   : None,
            "fin_tour_soir"    : fin_tour,
            "source"           : "recommandation",
        }

    # 2. Poids matins (tous, par ordre croissante)
    poids_matins = _recuperer_poids_matins(db, device_id, date_str)

    if not poids_matins:
        heure_rec = HEURE_DEBUT_RECOMMANDEE.get(scenario_meteo, HEURE_DEBUT_RECOMMANDEE["default"])
        return {
            "heure_debut_tour1": heure_rec,
            "heure_matin"      : None,
            "prt_pct"          : None,
            "decision"         : "FALLBACK_RECOMMANDATION",
            "poids_soir_kg"    : ps,
            "poids_matin_kg"   : None,
            "fin_tour_soir"    : fin_tour,
            "source"           : "recommandation",
        }

    # 3. Simuler le calcul en continu : parcourir les poids un par un
    heure_matin = None
    prt_at_declenchement = None
    poids_at_declenchement = None
    decision_finale = "ATTENDRE"

    for lecture in poids_matins:
        result = calculer_prt_decision(ps, lecture["poids_kg"], scenario_meteo)

        if result["decision"] == "DECLENCHER":
            heure_matin = lecture["heure"]
            prt_at_declenchement = result["prt_pct"]
            poids_at_declenchement = lecture["poids_kg"]
            decision_finale = "DECLENCHER"
            break
        elif result["decision"] == "STRESS_HYDRIQUE":
            # On retient le premier STRESS_HYDRIQUE au cas où
            # on ne trouve jamais de DECLENCHER
            if heure_matin is None:
                heure_matin = lecture["heure"]
                prt_at_declenchement = result["prt_pct"]
                poids_at_declenchement = lecture["poids_kg"]
                decision_finale = "STRESS_HYDRIQUE"

    # 4. Calculer heure_debut_tour1
    if heure_matin is not None:
        try:
            parts = heure_matin.split(":")
            h, m = int(parts[0]), int(parts[1])
            total_min = h * 60 + m + GAP_HEURE_MATIN_TO_TOUR1_MIN
            h2 = total_min // 60
            m2 = total_min % 60
            heure_debut = f"{h2:02d}:{m2:02d}"
        except (ValueError, IndexError):
            heure_debut = None

        source = "PRT_DECLENCHER" if decision_finale == "DECLENCHER" else "PRT_STRESS"

        logger.info(
            f"PRT détecté : scenario={scenario_meteo} | "
            f"PS={ps}kg → PM={poids_at_declenchement}kg | "
            f"PRT={prt_at_declenchement}% | décision={decision_finale} | "
            f"heure_matin={heure_matin} → début_tour1={heure_debut}"
        )

        return {
            "heure_debut_tour1": heure_debut,
            "heure_matin"      : heure_matin,
            "prt_pct"          : prt_at_declenchement,
            "decision"         : decision_finale,
            "poids_soir_kg"    : ps,
            "poids_matin_kg"   : poids_at_declenchement,
            "fin_tour_soir"    : fin_tour,
            "source"           : source,
        }

    # 5. Aucun seuil atteint → fallback (poids_soir existe mais pas de déclenchement)
    heure_rec = HEURE_DEBUT_RECOMMANDEE.get(scenario_meteo, HEURE_DEBUT_RECOMMANDEE["default"])
    return {
        "heure_debut_tour1": heure_rec,
        "heure_matin"      : None,
        "prt_pct"          : None,
        "decision"         : "FALLBACK_RECOMMANDATION",
        "poids_soir_kg"    : ps,
        "poids_matin_kg"   : None,
        "fin_tour_soir"    : fin_tour,
        "source"           : "recommandation",
    }


# ════════════════════════════════════════════════════════════════
# PRÉPARATION DES FEATURES MATIN
# ════════════════════════════════════════════════════════════════

def preparer_features_matin(
    db: Session,
    device_id: int,
    date_str: str,
    ec_bassin: float = 0.8,
    date_plantation: str = None,
    lat: float = DEFAULT_LAT,
    lon: float = DEFAULT_LON,
) -> dict:
    """
    Prépare le dict de 21 features pour le modèle Matin.
    Stratégie :
      1. Récupérer météo capteurs (dernières 24h)
      2. Fallback Open-Meteo si données manquantes
      3. Calculer features agronomiques (Kc, FL, alertes)
    """
    # 1. Météo capteurs
    meteo = _recuperer_meteo_capteurs(db, device_id)

    # 2. Fallback Open-Meteo pour les features manquants
    champs_meteo_requis = [
        "meteo_T_max_C", "meteo_T_min_C", "meteo_T_mean_C",
        "meteo_HR_max_pct", "meteo_HR_min_pct", "meteo_HR_mean_pct",
        "meteo_VPD_max_kPa", "meteo_ET0_mm_jour",
        "meteo_shortwave_radiation_sum", "meteo_pluie_mm_jour",
        "meteo_vent_max_kmh", "meteo_rs_wm2_max_jour",
    ]

    manquants = [c for c in champs_meteo_requis if c not in meteo]
    if manquants:
        logger.info(f"Météo capteurs incomplète ({len(manquants)} champs manquants) → Open-Meteo fallback")
        meteo_om = recuperer_meteo_open_meteo(lat, lon, date_str)
        for champ in manquants:
            if champ in meteo_om:
                meteo[champ] = meteo_om[champ]

    # 3. Calcul ET0 si toujours manquant
    if "meteo_ET0_mm_jour" not in meteo or meteo["meteo_ET0_mm_jour"] == 0:
        meteo["meteo_ET0_mm_jour"] = _calculer_et0_penman_monteith(meteo)

    # 4. Stade phénologique et Kc
    if date_plantation:
        try:
            dp = datetime.strptime(date_plantation, "%Y-%m-%d").date()
            jours = (datetime.strptime(date_str, "%Y-%m-%d").date() - dp).days
        except (ValueError, TypeError):
            jours = 75  # défaut : floraison
    else:
        jours = 75  # défaut : floraison

    stade, kc = _calculer_stade_et_kc(jours)

    # 5. FL (facteur lessivage)
    fl = _calculer_FL(ec_bassin)

    # 6. Alertes
    alertes = _calculer_alertes(meteo)

    # 7. Assemblage des 21 features
    features = {
        **meteo,
        "opt_Kc"                      : kc,
        "opt_jours_depuis_plantation" : jours,
        "opt_FL"                      : fl,
        "ec_bassin"                   : ec_bassin,
        "moy_pct_drainage"            : 20.0,    # défaut (pas de capteur)
        "ec_cumul_drainage"           : 2.5,     # défaut (pas de capteur)
        **alertes,
    }

    return features


# ════════════════════════════════════════════════════════════════
# PRÉDICTION MATIN — 1 DEVICE
# ════════════════════════════════════════════════════════════════

def generer_recommandation_matin(
    device_id: int,
    date_str: str = None,
    ec_bassin: float = 0.8,
    date_plantation: str = None,
    methode: str = "ml",
    lat: float = DEFAULT_LAT,
    lon: float = DEFAULT_LON,
) -> dict:
    """
    Génère la recommandation du matin pour UN device.
    Retourne un dict avec les 8 consignes + métadonnées.
    """
    if date_str is None:
        date_str = date.today().isoformat()

    db = SessionLocal()
    try:
        # Récupérer le device
        device = db.query(Device).filter(Device.id == device_id).first()
        if device is None:
            return {"erreur": f"Device {device_id} introuvable"}

        # Charger config
        cfg = get_or_create_config(db, device_id)
        ec_bassin = ec_bassin or cfg.ec_eau_brute or 0.8
        if date_plantation is None and cfg.date_plantation:
            date_plantation = str(cfg.date_plantation)
        lat = lat or cfg.latitude or DEFAULT_LAT
        lon = lon or cfg.longitude or DEFAULT_LON

        # Préparer les features
        features = preparer_features_matin(
            db, device_id, date_str, ec_bassin, date_plantation, lat, lon
        )

        # Charger les modèles
        modeles_matin, enc_matin, _, _ = _get_modeles()

        # Construire le DataFrame d'entrée
        df_pred = pd.DataFrame([features])
        for col in FEATURES_MATIN:
            if col not in df_pred.columns:
                df_pred[col] = 0.0

        # Prédire
        consignes = predict_matin(
            donnees       = features,
            modeles_matin = modeles_matin,
            enc_matin     = enc_matin,
            ec_bassin     = ec_bassin,
        )

        # ── SYSTÈME PRT : Détection heure_matin + début tour 1 ──
        scenario = consignes.get("scenario_meteo", "default")
        prt_result = detecter_heure_matin_et_debut_tour(
            db, device_id, date_str, scenario
        )

        # Heure ML originale (jamais écrasée)
        heure_ml = consignes.get("heure_debut_ml", "N/A")

        # Heure PRT détectée (ou None si pas de poids)
        heure_prt = prt_result.get("heure_debut_tour1")

        # Source : PRT si dispo, sinon ML
        if heure_prt is not None:
            heure_debut_source = prt_result.get("source", "PRT_DECLENCHER")
            logger.info(
                f"PRT override : ML={heure_ml} → PRT={heure_prt} "
                f"(src={heure_debut_source}, PRT={prt_result['prt_pct']}%, "
                f"décision={prt_result['decision']})"
            )
        else:
            heure_debut_source = "ml"

        # Stocker ML + PRT + source dans consignes
        consignes["heure_debut_ml"]     = heure_ml
        consignes["heure_debut_prt"]    = heure_prt
        consignes["heure_debut_source"] = heure_debut_source

        # Stocker TOUTES les données PRT dans features pour traçabilité et API
        features["heure_debut_ml"]     = heure_ml
        features["heure_debut_prt"]    = heure_prt
        features["heure_debut_source"] = heure_debut_source
        features["heure_matin"]        = prt_result.get("heure_matin")
        features["fin_tour_soir"]      = prt_result.get("fin_tour_soir")
        features["poids_soir_kg"]      = prt_result.get("poids_soir_kg")
        features["poids_matin_kg"]     = prt_result.get("poids_matin_kg")
        features["ptr_pct"]            = prt_result.get("prt_pct")
        features["ptr_decision"]       = prt_result.get("decision")
        features["ptr_source"]         = heure_debut_source
        features["ptr_seuil_bas"]      = PRT_SEUILS.get(scenario, PRT_SEUILS["default"])[0]
        features["ptr_seuil_haut"]     = PRT_SEUILS.get(scenario, PRT_SEUILS["default"])[1]

        # Enrichir avec métadonnées
        resultat = {
            "device_id"    : device_id,
            "farm_name"    : device.farm_name,
            "house_number" : device.house_number,
            "date"         : date_str,
            "consignes"    : consignes,
            "features_utilises": features,
            "statut"       : "pending",
        }

        source_heure = prt_result.get("source", "ml")
        logger.success(
            f"Recommandation matin générée : {device.farm_name} H{device.house_number} "
            f"→ EC={consignes['ec_cible_dSm']} pH={consignes['ph_cible']} "
            f"Tours={consignes['nbr_tour']} ML={heure_ml} PRT={heure_prt} "
            f"[src={source_heure}]"
        )

        return resultat

    except Exception as e:
        logger.error(f"Erreur génération recommandation device {device_id} : {e}")
        return {"erreur": str(e), "device_id": device_id}
    finally:
        db.close()


# ════════════════════════════════════════════════════════════════
# PRÉDICTION MATIN — TOUS LES DEVICES (AUTO-DISCOVERY)
# ════════════════════════════════════════════════════════════════

def generer_recommandation_tous_devices(date_str: str = None) -> dict:
    """
    Boucle sur TOUS les devices actifs et génère les recommandations.
    C'est la fonction appelée par Celery à 06h00.
    Retourne {total, generated, errors, recommandations: [...]}
    """
    if date_str is None:
        date_str = date.today().isoformat()

    db = SessionLocal()
    try:
        devices = db.query(Device).filter(Device.is_active == True).all()
        logger.info(f"Génération recommandations matin : {len(devices)} devices actifs")

        # Charger configs en batch
        configs = {
            c.device_id: c
            for c in db.query(AIConfigDevice).filter(AIConfigDevice.actif == True).all()
        }

        recommandations = []
        errors = 0

        for device in devices:
            try:
                cfg = configs.get(device.id)
                if cfg is None:
                    cfg = get_or_create_config(db, device.id)
                    configs[device.id] = cfg

                resultat = generer_recommandation_matin(
                    device_id       = device.id,
                    date_str        = date_str,
                    ec_bassin       = cfg.ec_eau_brute or 0.8,
                    date_plantation = str(cfg.date_plantation) if cfg.date_plantation else None,
                    lat             = cfg.latitude or DEFAULT_LAT,
                    lon             = cfg.longitude or DEFAULT_LON,
                )

                if "erreur" in resultat:
                    errors += 1
                    logger.error(f"Erreur device {device.id} : {resultat['erreur']}")
                else:
                    recommandations.append(resultat)

            except Exception as e:
                errors += 1
                logger.error(f"Erreur device {device.id} : {e}")

        logger.success(
            f"Recommandations générées : {len(recommandations)}/{len(devices)} "
            f"({errors} erreurs)"
        )

        return {
            "date"            : date_str,
            "total_devices"   : len(devices),
            "generated"       : len(recommandations),
            "errors"          : errors,
            "recommandations" : recommandations,
        }

    except Exception as e:
        logger.error(f"Erreur génération globale : {e}")
        return {"erreur": str(e), "total_devices": 0, "generated": 0, "errors": 1}
    finally:
        db.close()


# ════════════════════════════════════════════════════════════════
# BACKFILL HISTORIQUE — Générer les recommandations des jours passés
# ════════════════════════════════════════════════════════════════

def recuperer_meteo_open_meteo_historique(lat: float, lon: float, date_debut: str, date_fin: str) -> dict:
    """
    Récupère les données météo historiques depuis Open-Meteo Archive API.
    Retourne un dict {date_str: {meteo_dict}} pour chaque jour.
    """
    try:
        url = "https://archive-api.open-meteo.com/v1/archive"
        params = {
            "latitude"       : lat,
            "longitude"      : lon,
            "start_date"     : date_debut,
            "end_date"       : date_fin,
            "daily"          : [
                "temperature_2m_max",
                "temperature_2m_min",
                "temperature_2m_mean",
                "relative_humidity_2m_max",
                "relative_humidity_2m_min",
                "relative_humidity_2m_mean",
                "shortwave_radiation_sum",
                "precipitation_sum",
                "wind_speed_10m_max",
                "et0_fao_evapotranspiration",
                "vapor_pressure_deficit_max",
            ],
            "timezone"       : "Africa/Casablanca",
        }

        resp = requests.get(url, params=params, timeout=30)
        resp.raise_for_status()
        data = resp.json()
        daily = data.get("daily", {})
        times = daily.get("time", [])

        def _safe(key, idx, default=0.0):
            vals = daily.get(key, [])
            if idx < len(vals) and vals[idx] is not None:
                return float(vals[idx])
            return default

        result = {}
        for i, date_str in enumerate(times):
            result[date_str] = {
                "meteo_T_max_C"                : _safe("temperature_2m_max", i),
                "meteo_T_min_C"                : _safe("temperature_2m_min", i),
                "meteo_T_mean_C"               : _safe("temperature_2m_mean", i),
                "meteo_HR_max_pct"             : _safe("relative_humidity_2m_max", i),
                "meteo_HR_min_pct"             : _safe("relative_humidity_2m_min", i),
                "meteo_HR_mean_pct"            : _safe("relative_humidity_2m_mean", i),
                "meteo_shortwave_radiation_sum": _safe("shortwave_radiation_sum", i),
                "meteo_pluie_mm_jour"          : _safe("precipitation_sum", i),
                "meteo_vent_max_kmh"           : _safe("wind_speed_10m_max", i),
                "meteo_ET0_mm_jour"            : _safe("et0_fao_evapotranspiration", i),
                "meteo_VPD_max_kPa"            : _safe("vapor_pressure_deficit_max", i),
                "meteo_rs_wm2_max_jour"        : _safe("shortwave_radiation_sum", i) * 0.144,
            }

        logger.success(f"Météo historique Open-Meteo : {len(result)} jours ({date_debut} → {date_fin})")
        return result

    except Exception as e:
        logger.error(f"Erreur Open-Meteo Archive : {e}")
        return {}


def generer_recommandation_historique_device(
    device_id: int,
    date_debut: str,
    date_fin: str,
) -> dict:
    """
    Génère les recommandations pour un device sur un intervalle de dates historique.
    Skip les jours où une recommandation existe déjà.
    """
    from datetime import datetime, timedelta

    db = SessionLocal()
    try:
        device = db.query(Device).filter(Device.id == device_id).first()
        if device is None:
            return {"erreur": f"Device {device_id} introuvable", "generated": 0}

        cfg = get_or_create_config(db, device_id)
        ec_bassin    = cfg.ec_eau_brute or 0.8
        date_plantation = str(cfg.date_plantation) if cfg.date_plantation else None
        lat = cfg.latitude or DEFAULT_LAT
        lon = cfg.longitude or DEFAULT_LON

        # Charger d'abord le cache météo historique en batch (1 appel API pour tout l'intervalle)
        meteo_cache = recuperer_meteo_open_meteo_historique(lat, lon, date_debut, date_fin)

        # Parser les dates
        dt_debut = datetime.strptime(date_debut, "%Y-%m-%d").date()
        dt_fin   = datetime.strptime(date_fin, "%Y-%m-%d").date()

        total_jours  = (dt_fin - dt_debut).days + 1
        generated    = 0
        skipped      = 0
        errors       = 0

        logger.info(
            f"Backfill device {device_id} ({device.farm_name} H{device.house_number}) : "
            f"{date_debut} → {date_fin} ({total_jours} jours)"
        )

        current = dt_debut
        while current <= dt_fin:
            date_str = current.isoformat()

            # Vérifier si déjà en BDD
            exists = db.query(AIRecommandation).filter(
                AIRecommandation.device_id == device_id,
                AIRecommandation.date      == date_str,
            ).first()

            if exists:
                skipped += 1
                current += timedelta(days=1)
                continue

            try:
                # Utiliser le cache météo historique
                meteo = meteo_cache.get(date_str, {})

                # Compléter avec les capteurs BDD si disponibles
                meteo_capteurs = _recuperer_meteo_capteurs_date(db, device_id, current)
                if meteo_capteurs:
                    for k, v in meteo_capteurs.items():
                        if k not in meteo or meteo[k] == 0:
                            meteo[k] = v

                # Compléter les champs manquants avec Open-Meteo forecast (fallback)
                champs_meteo_requis = [
                    "meteo_T_max_C", "meteo_T_min_C", "meteo_T_mean_C",
                    "meteo_HR_max_pct", "meteo_HR_min_pct", "meteo_HR_mean_pct",
                    "meteo_VPD_max_kPa", "meteo_ET0_mm_jour",
                    "meteo_shortwave_radiation_sum", "meteo_pluie_mm_jour",
                    "meteo_vent_max_kmh", "meteo_rs_wm2_max_jour",
                ]
                manquants = [c for c in champs_meteo_requis if c not in meteo or meteo[c] == 0]
                if manquants:
                    meteo_om = recuperer_meteo_open_meteo(lat, lon, date_str)
                    for champ in manquants:
                        if champ in meteo_om:
                            meteo[champ] = meteo_om[champ]

                # Calcul ET0 si toujours manquant
                if "meteo_ET0_mm_jour" not in meteo or meteo.get("meteo_ET0_mm_jour", 0) == 0:
                    meteo["meteo_ET0_mm_jour"] = _calculer_et0_penman_monteith(meteo)

                # Calculs agronomiques
                if date_plantation:
                    try:
                        dp = datetime.strptime(date_plantation, "%Y-%m-%d").date()
                        jours = (current - dp).days
                    except (ValueError, TypeError):
                        jours = 75
                else:
                    jours = 75

                stade, kc = _calculer_stade_et_kc(jours)
                fl = _calculer_FL(ec_bassin)
                alertes = _calculer_alertes(meteo)

                features = {
                    **meteo,
                    "opt_Kc"                      : kc,
                    "opt_jours_depuis_plantation" : jours,
                    "opt_FL"                      : fl,
                    "ec_bassin"                   : ec_bassin,
                    "moy_pct_drainage"            : 20.0,
                    "ec_cumul_drainage"           : 2.5,
                    **alertes,
                }

                # Prédire
                modeles_matin, enc_matin, _, _ = _get_modeles()
                consignes = predict_matin(
                    donnees       = features,
                    modeles_matin = modeles_matin,
                    enc_matin     = enc_matin,
                    ec_bassin     = ec_bassin,
                )

                # ── PRT override pour backfill historique ──
                scenario = consignes.get("scenario_meteo", "default")
                prt_result = detecter_heure_matin_et_debut_tour(
                    db, device_id, date_str, scenario
                )

                # Heure ML originale (jamais écrasée)
                heure_ml = consignes.get("heure_debut_ml", "N/A")
                heure_prt = prt_result.get("heure_debut_tour1")

                # Source : PRT si dispo, sinon ML
                if heure_prt is not None:
                    heure_debut_source = prt_result.get("source", "PRT_DECLENCHER")
                else:
                    heure_debut_source = "ml"

                # Stocker ML + PRT + source dans consignes
                consignes["heure_debut_ml"]       = heure_ml
                consignes["heure_debut_prt"]      = heure_prt
                consignes["heure_debut_source"]   = heure_debut_source
                consignes["prt_decision"]         = prt_result.get("decision")

                features["heure_debut_ml"]     = heure_ml
                features["heure_debut_prt"]    = heure_prt
                features["heure_debut_source"] = heure_debut_source
                features["heure_matin"]        = prt_result.get("heure_matin")
                features["fin_tour_soir"]      = prt_result.get("fin_tour_soir")
                features["poids_soir_kg"]      = prt_result.get("poids_soir_kg")
                features["poids_matin_kg"]     = prt_result.get("poids_matin_kg")
                features["ptr_pct"]            = prt_result.get("prt_pct")
                features["ptr_decision"]       = prt_result.get("decision")
                features["ptr_source"]         = heure_debut_source
                features["ptr_seuil_bas"]      = PRT_SEUILS.get(scenario, PRT_SEUILS["default"])[0]
                features["ptr_seuil_haut"]     = PRT_SEUILS.get(scenario, PRT_SEUILS["default"])[1]

                # Sauvegarder
                resultat = {
                    "device_id"    : device_id,
                    "farm_name"    : device.farm_name,
                    "house_number" : device.house_number,
                    "date"         : date_str,
                    "consignes"    : consignes,
                    "features_utilises": features,
                    "statut"       : "pending",
                }
                sauvegarder_recommandation(db, resultat)
                db.commit()
                generated += 1

            except Exception as e:
                errors += 1
                logger.error(f"Erreur backfill device {device_id} date {date_str} : {e}")

            current += timedelta(days=1)

        logger.success(
            f"Backfill device {device_id} terminé : "
            f"{generated} générés, {skipped} déjà existants, {errors} erreurs"
        )

        return {
            "device_id"   : device_id,
            "farm_name"   : device.farm_name,
            "house_number": device.house_number,
            "date_debut"  : date_debut,
            "date_fin"    : date_fin,
            "total_jours" : total_jours,
            "generated"   : generated,
            "skipped"     : skipped,
            "errors"      : errors,
        }

    except Exception as e:
        logger.error(f"Erreur backfill historical device {device_id} : {e}")
        return {"erreur": str(e), "device_id": device_id, "generated": 0}
    finally:
        db.close()


def _recuperer_meteo_capteurs_date(db: Session, device_id: int, target_date: date) -> dict:
    """
    Récupère les données météo des capteurs pour une date spécifique.
    """
    from datetime import datetime, timedelta

    day_start = datetime.combine(target_date, datetime.min.time())
    day_end   = day_start + timedelta(days=1)

    readings = (
        db.query(SensorReading)
        .filter(
            SensorReading.device_id == device_id,
            SensorReading.timestamp >= day_start,
            SensorReading.timestamp < day_end,
        )
        .all()
    )

    if not readings:
        return {}

    temps      = [r.avg_temp for r in readings if r.avg_temp is not None]
    hums       = [r.humidity for r in readings if r.humidity is not None]
    radiations = [r.radiation for r in readings if r.radiation is not None]
    rad_sums   = [r.radiation_sum for r in readings if r.radiation_sum is not None]
    vpds       = [r.vpd for r in readings if r.vpd is not None]
    winds      = [r.wind_speed for r in readings if r.wind_speed is not None]
    rains      = [r.daily_rain for r in readings if r.daily_rain is not None]

    meteo = {}
    if temps:
        meteo["meteo_T_max_C"]  = max(temps)
        meteo["meteo_T_min_C"]  = min(temps)
        meteo["meteo_T_mean_C"] = sum(temps) / len(temps)
    if hums:
        meteo["meteo_HR_max_pct"]  = max(hums)
        meteo["meteo_HR_min_pct"]  = min(hums)
        meteo["meteo_HR_mean_pct"] = sum(hums) / len(hums)
    if radiations:
        meteo["meteo_rs_wm2_max_jour"] = max(radiations)
    if rad_sums:
        meteo["meteo_shortwave_radiation_sum"] = max(rad_sums)
    if vpds:
        meteo["meteo_VPD_max_kPa"] = max(vpds)
    if winds:
        meteo["meteo_vent_max_kmh"] = max(winds)
    if rains:
        meteo["meteo_pluie_mm_jour"] = max(rains)

    return meteo


def generer_recommandation_historique_tous_devices() -> dict:
    """
    Backfill historique pour TOUS les devices actifs.
    Pour chaque device : génère depuis created_at.date() jusqu'à aujourd'hui.
    """
    from datetime import datetime

    db = SessionLocal()
    try:
        devices = db.query(Device).filter(Device.is_active == True).all()
        today = date.today().isoformat()

        logger.info(f"Backfill historique : {len(devices)} devices")

        resultats = []
        total_generated = 0
        total_skipped   = 0
        total_errors    = 0

        for device in devices:
            date_debut = device.created_at.date().isoformat() if device.created_at else today
            date_fin   = today

            # Vérifier si on a déjà beaucoup de recommandations pour ce device
            existing_count = (
                db.query(AIRecommandation)
                .filter(
                    AIRecommandation.device_id == device.id,
                    AIRecommandation.date >= date_debut,
                    AIRecommandation.date <= date_fin,
                )
                .count()
            )

            total_jours = (datetime.strptime(date_fin, "%Y-%m-%d").date() -
                           datetime.strptime(date_debut, "%Y-%m-%d").date()).days + 1

            if existing_count >= total_jours * 0.9:  # 90% déjà couvert
                logger.info(
                    f"Skip {device.farm_name} H{device.house_number} : "
                    f"déjà {existing_count}/{total_jours} jours"
                )
                continue

            resultat = generer_recommandation_historique_device(
                device_id  = device.id,
                date_debut = date_debut,
                date_fin   = date_fin,
            )

            if "erreur" not in resultat:
                total_generated += resultat.get("generated", 0)
                total_skipped   += resultat.get("skipped", 0)
                total_errors    += resultat.get("errors", 0)

            resultats.append(resultat)

        logger.success(
            f"Backfill historique terminé : "
            f"{total_generated} générés, {total_skipped} déjà existants, {total_errors} erreurs"
        )

        return {
            "total_devices" : len(devices),
            "total_generated": total_generated,
            "total_skipped" : total_skipped,
            "total_errors"  : total_errors,
            "devices"       : resultats,
        }

    except Exception as e:
        logger.error(f"Erreur backfill historique global : {e}")
        return {"erreur": str(e)}
    finally:
        db.close()


# ════════════════════════════════════════════════════════════════
# SAUVEGARDE EN BDD
# ════════════════════════════════════════════════════════════════

def sauvegarder_recommandation(db: Session, resultat: dict) -> AIRecommandation:
    """
    Sauvegarde une recommandation en BDD.
    """
    consignes = resultat.get("consignes", {})
    features  = resultat.get("features_utilises", {})

    rec = AIRecommandation(
        device_id             = resultat["device_id"],
        date                  = datetime.strptime(resultat["date"], "%Y-%m-%d").date(),

        # Consignes ML
        ec_cible              = consignes.get("ec_cible_dSm"),
        ph_cible              = consignes.get("ph_cible"),
        nb_tours              = consignes.get("nbr_tour"),
        heure_debut_ml        = consignes.get("heure_debut_ml"),        # Heure ML originale (jamais modifiée)
        heure_debut_prt       = consignes.get("heure_debut_prt"),       # Heure PRT (ou None si pas de poids)
        scenario_meteo        = consignes.get("scenario_meteo"),
        alerte                = consignes.get("alerte"),
        quantite_eau_mm       = consignes.get("quantite_eau_mm"),
        volume_cc_goutteur    = consignes.get("volume_cc_goutteur"),
        duree_min             = consignes.get("duree_min"),

        # Données PRT
        poids_soir_kg         = features.get("poids_soir_kg"),
        poids_matin_kg        = features.get("poids_matin_kg"),
        heure_soir            = features.get("heure_soir"),
        heure_matin           = features.get("heure_matin"),
        fin_tour_soir         = features.get("fin_tour_soir"),
        ptr_pct               = features.get("ptr_pct"),
        ptr_decision          = features.get("ptr_decision"),
        ptr_seuil_bas         = features.get("ptr_seuil_bas"),
        ptr_seuil_haut        = features.get("ptr_seuil_haut"),

        # Métadonnées
        statut                = "pending",
        features_utilises     = features,
    )
    db.add(rec)
    db.commit()
    db.refresh(rec)
    return rec


# ════════════════════════════════════════════════════════════════
# DÉCISION TOUR/TOUR
# ════════════════════════════════════════════════════════════════

def generer_decision_tour(
    device_id: int,
    donnees_tour: dict,
) -> dict:
    """
    Génère la décision tour/tour.
    Si drainage_dispo=False → retourne message indisponible.
    """
    db = SessionLocal()
    try:
        device = db.query(Device).filter(Device.id == device_id).first()
        if device is None:
            return {"erreur": f"Device {device_id} introuvable"}

        cfg = get_or_create_config(db, device_id)

        if not cfg.drainage_dispo:
            return {
                "disponible": False,
                "message": "Données drainage non disponibles — capteurs de drainage non installés",
                "device_id": device_id,
                "farm_name": device.farm_name,
                "house_number": device.house_number,
            }

        # Si drainage dispo → prédire
        _, _, modeles_tour, enc_tour = _get_modeles()
        decision = predict_tour(donnees_tour, modeles_tour, enc_tour)

        # Sauvegarder
        rec = AIDecisionTour(
            device_id     = device_id,
            date          = date.today(),
            num_tour      = donnees_tour.get("num_tour", 0),
            decision      = decision.get("decision"),
            raison        = decision.get("raison"),
            duree_suivant = decision.get("duree_tour_suivant_min"),
            donnees_entree= donnees_tour,
            disponible    = True,
        )
        db.add(rec)
        db.commit()

        return {
            "disponible": True,
            "device_id": device_id,
            "farm_name": device.farm_name,
            "house_number": device.house_number,
            "decision": decision,
        }

    except Exception as e:
        logger.error(f"Erreur décision tour device {device_id} : {e}")
        return {"erreur": str(e), "device_id": device_id}
    finally:
        db.close()


# ════════════════════════════════════════════════════════════════
# COMPARAISON HUMAIN VS IA
# ════════════════════════════════════════════════════════════════

def comparer_humain_vs_ia(device_id: int, date_str: str = None) -> dict:
    """
    Compare la saisie opérateur (saisie_journaliere) vs recommandation IA.
    """
    if date_str is None:
        date_str = date.today().isoformat()

    db = SessionLocal()
    try:
        from models.saisie_model import SaisieJournaliere

        # Recommandation IA
        rec_ia = db.query(AIRecommandation).filter(
            AIRecommandation.device_id == device_id,
            AIRecommandation.date == date_str,
        ).first()

        # Saisie opérateur
        saisie = db.query(SaisieJournaliere).filter(
            SaisieJournaliere.device_id == device_id,
            SaisieJournaliere.date == date_str,
        ).first()

        device = db.query(Device).filter(Device.id == device_id).first()

        comparaison = {
            "device_id"    : device_id,
            "farm_name"    : device.farm_name if device else None,
            "house_number" : device.house_number if device else None,
            "date"         : date_str,
            "ia"           : rec_ia.to_dict() if rec_ia else None,
            "operateur"    : {
                "ec_cible"   : saisie.ec_cible if saisie else None,
                "ph_cible"   : saisie.ph_cible if saisie else None,
                "nb_tours"   : saisie.nb_tours if saisie else None,
                "heure_debut": saisie.heure_debut if saisie else None,
                "volume_eau_mm": saisie.volume_eau_mm if saisie else None,
            } if saisie else None,
        }

        # Calculer écarts
        if rec_ia and saisie:
            comparaison["ecarts"] = {
                "ec_delta"   : round((saisie.ec_cible or 0) - (rec_ia.ec_cible or 0), 2),
                "ph_delta"   : round((saisie.ph_cible or 0) - (rec_ia.ph_cible or 0), 2),
                "tours_delta": (saisie.nb_tours or 0) - (rec_ia.nb_tours or 0),
            }

        return comparaison

    except Exception as e:
        logger.error(f"Erreur comparaison device {device_id} : {e}")
        return {"erreur": str(e)}
    finally:
        db.close()


# ════════════════════════════════════════════════════════════════
# AJUSTEMENT INTER-TOURS (mode dégradé sans drainage)
# ════════════════════════════════════════════════════════════════

def ajuster_apres_tour(
    recommandation: dict,
    drainage_reel: float = None,
    num_tour: int = 0,
    tours_restants: int = 1,
) -> dict:
    """
    Ajuste les paramètres après chaque tour terminé.
    Mode dégradé : sans données drainage, utilise des règles simples.
    """
    try:
        etat = recommandation.get("_etat", {})
        duree_courante = etat.get("duree_t3p_courant", 8)
        repos_courant  = etat.get("repos_courant_min", 8)

        # Règle simple : réduire légèrement la durée à chaque tour
        # (décroissance naturelle, comme le modèle le ferait)
        if num_tour >= 8:
            nouvelle_duree = max(4, duree_courante - 1)
        else:
            nouvelle_duree = duree_courante

        # Décider si on continue
        stop = num_tour >= 14  # sécurité : max 14 tours

        ajustement = {
            "tour"         : num_tour,
            "action"       : "STOP" if stop else "CONTINUER",
            "stop"         : stop,
            "duree_suivant": nouvelle_duree,
            "repos_suivant": repos_courant,
            "raison"       : "MAX_TOURS" if stop else "CONTINUER",
            "drainage_utilise": drainage_reel is not None,
            "nouveau_etat" : {
                "repos_courant_min": repos_courant,
                "duree_t3p_courant": nouvelle_duree,
                "surveillance"     : False,
                "depassement_reel" : False,
                "dernier_drainage" : drainage_reel or 0.0,
            },
        }

        return ajustement

    except Exception as e:
        logger.error(f"Erreur ajustement tour {num_tour} : {e}")
        return {
            "tour"    : num_tour,
            "action"  : "CONTINUER",
            "stop"    : False,
            "erreur"  : str(e),
        }


# ════════════════════════════════════════════════════════════════
# PRÉDICTIONS ML — Copié de decision_agent.py
# (pour éliminer la dépendance à decision_agent.py en production)
# ════════════════════════════════════════════════════════════════

def _preparer_features(df, features_list, encoders=None, fit=True):
    """Sélectionne, encode et remplit les features."""
    from sklearn.preprocessing import LabelEncoder
    cols_dispo = [c for c in features_list if c in df.columns]
    X = df[cols_dispo].copy()
    if encoders is None:
        encoders = {}
    for col in X.select_dtypes(include=["object"]).columns:
        if fit:
            le = LabelEncoder()
            X[col] = le.fit_transform(X[col].fillna("INCONNU").astype(str))
            encoders[col] = le
        else:
            le = encoders.get(col)
            if le:
                def safe_transform(val, _le=le):
                    val = str(val) if not pd.isna(val) else "INCONNU"
                    return _le.transform([val])[0] if val in _le.classes_ else -1
                X[col] = X[col].fillna("INCONNU").apply(safe_transform)
            else:
                X[col] = 0
    for col in features_list:
        if col not in X.columns:
            X[col] = 0.0
    X = X[features_list] if all(c in X.columns for c in features_list) else X
    X = X.fillna(X.median(numeric_only=True))
    return X, encoders, cols_dispo


def predict_matin(donnees, modeles_matin, enc_matin, ec_bassin=0.9,
                  volume_cycle_L=1.33, stade="Floraison",
                  ph_bassin=7.2, volume_m3=0.133):
    """Génère les consignes opérationnelles du matin."""
    FEATURES = [
        "meteo_T_max_C", "meteo_T_min_C", "meteo_T_mean_C",
        "meteo_HR_max_pct", "meteo_HR_min_pct", "meteo_HR_mean_pct",
        "meteo_VPD_max_kPa", "meteo_ET0_mm_jour",
        "meteo_shortwave_radiation_sum", "meteo_pluie_mm_jour",
        "meteo_vent_max_kmh", "meteo_rs_wm2_max_jour",
        "opt_Kc", "opt_jours_depuis_plantation", "opt_FL",
        "ec_bassin", "moy_pct_drainage", "ec_cumul_drainage",
        "alerte_chergui", "alerte_pluie", "alerte_brouillard", "alerte_vpd_stress",
    ]
    TARGETS_REG = ["opt_nb_cycles", "opt_apport_total_mm", "opt_EC_cible_dSm",
                   "opt_pH_cible", "opt_duree_min"]
    TARGETS_CLF = ["opt_heure_demarrage", "scenario_meteo",
                   "opt_alerte_chergui", "opt_alerte_pluie", "opt_alerte_brouillard"]

    df_pred = pd.DataFrame([donnees])
    for col in FEATURES:
        if col not in df_pred.columns:
            df_pred[col] = 0.0

    X, _, _ = _preparer_features(df_pred, FEATURES,
                                  encoders=enc_matin.get("features", {}), fit=False)

    resultats = {}
    for target in TARGETS_REG:
        key = f"reg_{target}"
        if key in modeles_matin:
            resultats[target] = float(modeles_matin[key].predict(X)[0])

    enc_cibles = enc_matin.get("cibles", {})
    for target in TARGETS_CLF:
        key = f"clf_{target}"
        if key in modeles_matin and target in enc_cibles:
            idx = int(modeles_matin[key].predict(X)[0])
            resultats[target] = enc_cibles[target].classes_[idx]

    duree_float = resultats.get("opt_duree_min", 10.0)
    duree_int = int(round(max(4.0, min(14.0, duree_float))))
    scenario = resultats.get("scenario_meteo", "2_ENSOLEILLE")

    ac = resultats.get("opt_alerte_chergui", 0)
    ap = resultats.get("opt_alerte_pluie", 0)
    ab = resultats.get("opt_alerte_brouillard", 0)
    if ac in (1, "1"): alerte = "CHERGUI"
    elif ap in (1, "1"): alerte = "PLUIE_STOP"
    elif ab in (1, "1"): alerte = "BROUILLARD"
    else: alerte = "NORMAL"

    apport_mm = round(resultats.get("opt_apport_total_mm", 3.5), 1)
    duree_ml = int(round(max(4.0, min(14.0, resultats.get("opt_duree_min", 10.0)))))
    volume_cc_goutteur = round(apport_mm * 150.0)

    return {
        "ec_cible_dSm":       round(resultats.get("opt_EC_cible_dSm", 2.3), 1),
        "ph_cible":           round(float(resultats.get("opt_pH_cible", 6.0)), 1),
        "nbr_tour":           max(1, int(round(resultats.get("opt_nb_cycles", 5)))),
        "heure_debut_ml":     resultats.get("opt_heure_demarrage", "08:00"),
        "scenario_meteo":     scenario,
        "alerte":             alerte,
        "quantite_eau_mm":    apport_mm,
        "volume_total_Lha":   round(apport_mm * 10_000, 0),
        "volume_cc_goutteur": volume_cc_goutteur,
        "duree_min":          duree_ml,
    }


def _repos_pattern_fallback():
    """Fallback si le CSV irrigation_meteo_optimise.csv n'existe pas."""
    return {
        'by_drain_and_tour': {},
        'by_drain':   {'<10': 20, '10-20': 17, '20-30': 15, '30-50': 12, '>50': 10},
        'by_tour':    {},
        'global_median': 15,
    }


def predict_tour(donnees, modeles_tour, enc_tour):
    """Après chaque cycle d'irrigation : continuer ou stopper ?"""
    if 'opt_vol_cumule_L' in donnees and 'opt_vol_jour_cible_L' in donnees:
        vc = donnees['opt_vol_cumule_L']
        vj = donnees['opt_vol_jour_cible_L']
        if vj > 0:
            vol_cycle = donnees.get('opt_volume_cycle_corrige_L', donnees.get('opt_volume_cycle_L', 0.0)) or 0.0
            vol_avant = max(0.0, vc - vol_cycle)
            donnees['opt_vol_ratio'] = vol_avant / vj
            donnees['opt_vol_restant_L'] = max(0.0, vj - vol_avant)
        else:
            donnees['opt_vol_ratio'] = 0.0
            donnees['opt_vol_restant_L'] = 0.0

    if "drain_zone" not in donnees:
        dp = float(donnees.get("_pct_drain_prev", donnees.get("pct_drainage_lag1", 0.0)) or 0.0)
        if dp <= 0: donnees["drain_zone"] = 2.0
        elif dp <= 25.0: donnees["drain_zone"] = 1.0
        else: donnees["drain_zone"] = 0.0

    for _col in ["heure_debut", "heure_soir", "heure_matin"]:
        _min_col = f"{_col}_min"
        if _col in donnees and _min_col not in donnees:
            try:
                parts = str(donnees[_col]).split(":")
                donnees[_min_col] = int(parts[0]) * 60 + int(parts[1])
            except (ValueError, IndexError):
                donnees[_min_col] = 0

    FEATURES_TOUR = [
        "pct_drainage", "ec_drainage", "ph_drainage", "num_tour", "v_apport",
        "_pct_drain_prev", "pct_drainage_lag1", "pct_drainage_lag2", "pct_drainage_lag3",
        "ec_drainage_lag1", "ec_drainage_lag2",
        "opt_vol_cumule_L", "opt_vol_jour_cible_L", "opt_vol_ratio", "opt_vol_restant_L",
        "opt_EC_drain_cible_dSm", "opt_nb_cycles", "opt_max_cycles_stade",
        "meteo_T_max_C", "meteo_VPD_max_kPa", "meteo_ET0_mm_jour",
        "alerte_chergui", "alerte_pluie", "alerte_brouillard",
        "ec_bassin", "ec_apport", "ph_apport", "drain_zone", "scenario_meteo",
    ]

    df_pred = pd.DataFrame([donnees])
    for col in FEATURES_TOUR:
        if col not in df_pred.columns:
            df_pred[col] = 0.0

    X, _, _ = _preparer_features(df_pred, FEATURES_TOUR,
                                  encoders=enc_tour.get("features", {}), fit=False)

    continuer = int(modeles_tour["clf_opt_continuer"].predict(X)[0])

    le_seq = enc_tour.get("opt_label_sequentiel")
    idx_seq = int(modeles_tour["clf_opt_label_sequentiel"].predict(X)[0])
    raison = le_seq.classes_[idx_seq] if le_seq else "INCONNU"

    duree_float = float(modeles_tour["reg_opt_duree_min"].predict(X)[0])
    duree_int = int(round(max(4.0, min(14.0, duree_float))))
    duree_prec = int(donnees.get("duree_tour_precedent_min", 0) or 0)
    if duree_prec > 0 and duree_int > duree_prec:
        duree_int = duree_prec

    return {
        "decision":               "CONTINUER" if continuer == 1 else "STOP",
        "continuer":              continuer,
        "raison":                 raison,
        "duree_tour_suivant_min": duree_int,
    }
