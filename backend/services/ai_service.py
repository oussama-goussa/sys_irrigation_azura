# ============================================================
# backend/services/ai_service.py
# Service Agent IA Irrigation — Azura Group
# Adapté pour station AZ106 avec calcul PRT Ressuyage
# ============================================================

import math
import os
import json
import requests
import datetime as _dt
from datetime import date, timedelta
_datetime = _dt.datetime
from typing import Optional
from loguru import logger
from sqlalchemy.orm import Session
from sqlalchemy import desc, and_
from models.sensor_model import Device, IrrigationTour
from models.weight_model import WeightReading
from services.ec_ph import calculer_dose_engrais, corriger_ph

# ── Tentative de chargement du modèle ML ─────────────────────
_rf_model  = None
_rf_scaler = None
_rf_r2     = 0.0

def _charger_modele():
    global _rf_model, _rf_scaler, _rf_r2
    try:
        import joblib
        import numpy as np
        model_path  = os.path.join(os.path.dirname(__file__), "..", "models", "rf_model_v2.joblib")
        scaler_path = os.path.join(os.path.dirname(__file__), "..", "models", "scaler_v2.joblib")
        rapport_path = os.path.join(os.path.dirname(__file__), "..", "rapport_ml_v2.json")
        _rf_model  = joblib.load(model_path)
        _rf_scaler = joblib.load(scaler_path)
        with open(rapport_path) as f:
            _rf_r2 = json.load(f).get("r2_global", 0)
        if _rf_r2 < 0.70:
            _rf_model = _rf_scaler = None
            logger.warning(f"Modèle RF R²={_rf_r2:.3f} < 0.70 → désactivé")
        else:
            logger.success(f"Modèle RF chargé (R²={_rf_r2:.3f}) ✅")
    except Exception as e:
        logger.warning(f"Modèle RF non disponible → fallback règles : {e}")

_charger_modele()

# ── Configuration par défaut ────────────────────────────────
CONFIG = {
    "seuils": {
        "debut_prudence"  : 0.65,
        "arret_urgence"   : 0.90,
        "prolongation_max": 0.40,
    },
    "repos": {
        "coeff_prudence"     : 1.5,
        "coeff_arret_repos"  : 1.8,
        "coeff_prolongation" : 0.8,
        "max_repos"          : 45,
    },
    "duree": {
        "coeff_prudence"     : 0.8,
        "coeff_arret_duree"  : 0.7,
        "duree_min_absolue"  : 5,
    },
    "tours": {
        "max_securite"       : 30,
        "prolongation_allow" : True,
    },
}

# ── KC Table par stade (INRA Maroc) ──────────────────────────
KC_TABLE = {
    "vegetatif"    : {"kc": 0.45, "ec_cible": 1.8,  "j_min": 0,   "j_max": 30},
    "developpement": {"kc": 0.80, "ec_cible": 2.2,  "j_min": 31,  "j_max": 60},
    "floraison"    : {"kc": 1.15, "ec_cible": 2.5,  "j_min": 61,  "j_max": 90},
    "grossissement": {"kc": 1.10, "ec_cible": 2.8,  "j_min": 91,  "j_max": 120},
    "recolte"      : {"kc": 0.85, "ec_cible": 3.2,  "j_min": 121, "j_max": 9999},
}

SEUIL_RADIATION_DEBUT = {
    "vegetatif"    : 5.0,
    "developpement": 7.0,
    "floraison"    : 8.0,
    "grossissement": 10.0,
    "recolte"      : 8.0,
}

FEATURES_ML = [
    "rad_cumul_tour_Jcm2", "radiation_tour", "mois", "num_tour", "ec_apport",
    "nbr_tours_total", "pct_ressuyage", "stress_index",
    "t_moy", "hr_moy", "vpd_kpa", "drain_prev",
]  # 12 features — alignées sur rf_model_v2 / scaler_v2

METEO_FALLBACK = {
    1:  {"t_max":18,"t_min":10,"t_moy":14,"hr_moy":72,"vent_max":2,"pluie_mm":0,"rs_jcm2":43},
    2:  {"t_max":20,"t_min":11,"t_moy":15,"hr_moy":68,"vent_max":2,"pluie_mm":0,"rs_jcm2":56},
    3:  {"t_max":22,"t_min":13,"t_moy":17,"hr_moy":70,"vent_max":2,"pluie_mm":0,"rs_jcm2":74},
    4:  {"t_max":24,"t_min":15,"t_moy":19,"hr_moy":74,"vent_max":2,"pluie_mm":0,"rs_jcm2":86},
    5:  {"t_max":26,"t_min":17,"t_moy":21,"hr_moy":76,"vent_max":2,"pluie_mm":0,"rs_jcm2":97},
    6:  {"t_max":28,"t_min":20,"t_moy":24,"hr_moy":76,"vent_max":2,"pluie_mm":0,"rs_jcm2":101},
    7:  {"t_max":32,"t_min":22,"t_moy":27,"hr_moy":72,"vent_max":2,"pluie_mm":0,"rs_jcm2":98},
    8:  {"t_max":33,"t_min":23,"t_moy":28,"hr_moy":70,"vent_max":2,"pluie_mm":0,"rs_jcm2":91},
    9:  {"t_max":30,"t_min":21,"t_moy":25,"hr_moy":70,"vent_max":2,"pluie_mm":0,"rs_jcm2":76},
    10: {"t_max":26,"t_min":18,"t_moy":22,"hr_moy":72,"vent_max":2,"pluie_mm":0,"rs_jcm2":59},
    11: {"t_max":22,"t_min":14,"t_moy":18,"hr_moy":70,"vent_max":2,"pluie_mm":0,"rs_jcm2":44},
    12: {"t_max":19,"t_min":11,"t_moy":15,"hr_moy":72,"vent_max":2,"pluie_mm":0,"rs_jcm2":38},
}

# ─────────────────────────────────────────────────────────────
# HELPERS
# ─────────────────────────────────────────────────────────────

def get_stade(j_plantation: int) -> str:
    for nom, v in KC_TABLE.items():
        if v["j_min"] <= j_plantation <= v["j_max"]:
            return nom
    return "recolte"

def get_periode(mois: int) -> str:
    if mois in [10, 11, 12, 1, 2]: return "chaud" # Correspond au CDC Azura pour PRT 10-12%
    if mois in [4, 5, 6, 7]: return "froid"       # Correspond au CDC Azura pour PRT 8-9%
    return "transition"

def get_seuils_ressuyage_az106(mois: int) -> dict:
    """Retourne les seuils de ressuyage spécifiques demandés."""
    if mois in [10, 11, 12, 1, 2]:
        return {"min": 10.0, "max": 12.0}
    if mois in [4, 5, 6, 7]:
        return {"min": 8.0, "max": 9.0}
    return {"min": 9.0, "max": 10.5} # Transition par défaut

def get_seuils(periode: str) -> dict:
    return {
        "chaud":      {"drainage_max": 35.0, "drainage_cible": 20.0, "ressuyage_min": 10.0, "ressuyage_max": 12.0},
        "froid":      {"drainage_max": 45.0, "drainage_cible": 25.0, "ressuyage_min":  8.0, "ressuyage_max":  9.0},
        "transition": {"drainage_max": 40.0, "drainage_cible": 22.0, "ressuyage_min":  9.0, "ressuyage_max": 10.5},
    }[periode]

def calculer_prt_ressuyage_az106(db: Session, device_id: int, target_date: date) -> Optional[float]:
    """
    PRT = ((Poids soir - Poids matin) / Poids soir) * 100
    Poids soir  : première lecture 20 min après fin du dernier tour complet de la veille
    Poids matin : première lecture après 07:00 UTC aujourd'hui
    Même logique que GET /api/ai/poids-soir/{device_id}
    """
    # Récupérer farm_name du device pour filtrer le bon capteur
    device = db.query(Device).filter(Device.id == device_id).first()
    if not device:
        return None

    today_utc   = _dt.datetime.utcnow().date()
    date_veille = today_utc - timedelta(days=1)

    # ── 1. Poids soir : 20 min après fin dernier tour complet de la veille ──
    last_tour = (
        db.query(IrrigationTour)
        .filter(
            IrrigationTour.device_id   == device_id,
            IrrigationTour.date        == date_veille,
            IrrigationTour.is_complete == True,
        )
        .order_by(desc(IrrigationTour.tour_num))
        .first()
    )

    poids_soir_reading = None
    if last_tour and last_tour.fin:
        evening_time = last_tour.fin + timedelta(minutes=20)
        poids_soir_reading = (
            db.query(WeightReading)
            .filter(
                WeightReading.farm_name  == device.farm_name,
                WeightReading.timestamp  >= evening_time,
                WeightReading.timestamp  <= _dt.datetime.combine(date_veille, _dt.time(22, 59)),
            )
            .order_by(WeightReading.timestamp)
            .first()
        )

    # Fallback : dernier poids après 17h UTC hier
    if not poids_soir_reading:
        poids_soir_reading = (
            db.query(WeightReading)
            .filter(
                WeightReading.farm_name  == device.farm_name,
                WeightReading.timestamp  >= _dt.datetime.combine(date_veille, _dt.time(17, 0)),
                WeightReading.timestamp  <= _dt.datetime.combine(date_veille, _dt.time(22, 59)),
            )
            .order_by(desc(WeightReading.timestamp))
            .first()
        )

    if not poids_soir_reading:
        logger.warning(f"PRT AZ106 : pas de poids soir pour {date_veille}")
        return None

    # ── 2. Poids matin : première lecture après 07:00 UTC aujourd'hui ──
    matin_start = _dt.datetime.combine(today_utc, _dt.time(7, 00))
    poids_matin_reading = (
        db.query(WeightReading)
        .filter(
            WeightReading.farm_name  == device.farm_name,
            WeightReading.timestamp  >= matin_start,
        )
        .order_by(WeightReading.timestamp)
        .first()
    )

    if not poids_matin_reading:
        logger.warning(f"PRT AZ106 : pas de poids matin pour {today_utc}")
        return None

    poids_soir  = poids_soir_reading.poids_kg
    poids_matin = poids_matin_reading.poids_kg

    if not poids_soir or poids_soir <= 0:
        return None

    prt = ((poids_soir - poids_matin) / poids_soir) * 100
    logger.info(
        f"PRT AZ106 : soir={poids_soir}kg ({poids_soir_reading.timestamp}) "
        f"matin={poids_matin}kg ({poids_matin_reading.timestamp}) "
        f"→ {prt:.2f}%"
    )
    return round(prt, 2)

def get_radiation_sum_actuel(db: Session, device_id: int, heure_debut_str: Optional[str] = None) -> Optional[float]:
    """
    Radiation_Sum depuis capteur.
    Si heure_debut fournie → dernière lecture AVANT ou À cette heure.
    Sinon → dernière lecture disponible.
    """
    from models.sensor_model import SensorReading
    import datetime as _dt

    q = db.query(SensorReading).filter(SensorReading.device_id == device_id)

    if heure_debut_str:
        try:
            today_utc = _dt.datetime.utcnow().date()
            h, m = map(int, heure_debut_str.split(":"))
            # Prendre jusqu'à heure_debut + 5min (marge pour le délai capteur)
            heure_limite = _dt.datetime.combine(today_utc, _dt.time(h, m)) + _dt.timedelta(minutes=5)
            q = q.filter(SensorReading.timestamp <= heure_limite)
        except Exception:
            pass  # fallback dernière lecture

    last = q.order_by(desc(SensorReading.timestamp)).first()

    if not last:
        return None

    # radiation_sum peut être 0.0 tôt le matin — retourner None si 0
    if last.radiation_sum is not None and last.radiation_sum > 0:
        return last.radiation_sum

    # Chercher la dernière valeur non nulle
    last_nonzero = (
        db.query(SensorReading)
        .filter(
            SensorReading.device_id   == device_id,
            SensorReading.radiation_sum > 0,
        )
        .order_by(desc(SensorReading.timestamp))
        .first()
    )
    return last_nonzero.radiation_sum if last_nonzero else None

def get_heure_debut_depuis_capteur(
    db: Session,
    device_id: int,
    stade: str,
    delai_apres_seuil_min: int = 10,   # ← délai configurable
) -> Optional[str]:
    from models.sensor_model import SensorReading
    seuil = SEUIL_RADIATION_DEBUT.get(stade, 8.0)
    today_start = _dt.datetime.combine(_dt.datetime.utcnow().date(), _dt.time(7, 0))

    lecture = (
        db.query(SensorReading)
        .filter(
            SensorReading.device_id     == device_id,
            SensorReading.timestamp     >= today_start,
            SensorReading.radiation_sum >= seuil,
        )
        .order_by(SensorReading.timestamp)
        .first()
    )

    if lecture:
        heure_debut = lecture.timestamp + _dt.timedelta(minutes=delai_apres_seuil_min)
        logger.info(
            f"Seuil atteint à {lecture.timestamp.strftime('%H:%M')} UTC "
            f"(radiation_sum={lecture.radiation_sum:.1f} >= {seuil}) "
            f"→ heure_debut = {heure_debut.strftime('%H:%M')} UTC (+{delai_apres_seuil_min}min)"
        )
        return heure_debut.strftime("%H:%M")

    return None

def calc_vpd(t: float, hr: float) -> float:
    if not t or not hr: return 1.0
    es = 0.6108 * math.exp(17.27 * t / (t + 237.3))
    return round(max(0.0, es * (1 - hr / 100)), 3)

def calculer_et0(t_max: float, t_min: float, hr_moy: float, rs_jcm2: float, u2: float = 1.0) -> Optional[float]:
    try:
        t_moy  = (t_max + t_min) / 2
        es     = 0.6108 * math.exp(17.27 * t_moy / (t_moy + 237.3))
        ea     = es * hr_moy / 100
        delta  = 4098 * es / (t_moy + 237.3) ** 2
        gamma  = 0.000665 * 100.8
        rs_mj  = rs_jcm2 / 10000 * 1000 * 0.0036
        rns    = (1 - 0.23) * rs_mj
        rnl    = 4.903e-9 * ((t_max + 273.16)**4 + (t_min + 273.16)**4) / 2 * \
                 (0.34 - 0.14 * math.sqrt(max(0, ea))) * (1.35 * rs_mj / max(0.1, rs_mj * 1.2) - 0.35)
        rn = max(0.0, rns - rnl)
        num = 0.408 * delta * rn + gamma * (900 / (t_moy + 273)) * u2 * (es - ea)
        den = delta + gamma * (1 + 0.34 * u2)
        return round(num / den, 3)
    except Exception:
        return None

def get_meteo_open_meteo(mois: int) -> dict:
    try:
        r = requests.get(
            "https://api.open-meteo.com/v1/forecast",
            params={
                "latitude": 30.4202, "longitude": -9.5982,
                "daily": ["temperature_2m_max", "temperature_2m_min", "relative_humidity_2m_mean", "wind_speed_10m_max", "precipitation_sum", "shortwave_radiation_sum"],
                "timezone": "Africa/Casablanca",
                "forecast_days": 1,
            },
            timeout=8,
        )
        r.raise_for_status()
        d = r.json()["daily"]
        tmax = d["temperature_2m_max"][0]
        tmin = d["temperature_2m_min"][0]
        rs_kwh = d["shortwave_radiation_sum"][0]
        rs_jcm2 = float(rs_kwh) * 360 * 0.27 if rs_kwh is not None else METEO_FALLBACK[mois]["rs_jcm2"]
        return {
            "t_max": tmax, "t_min": tmin, "t_moy": round((tmax + tmin) / 2, 1),
            "hr_moy": d["relative_humidity_2m_mean"][0],
            "vent_max": d["wind_speed_10m_max"][0], "pluie_mm": d["precipitation_sum"][0] or 0.0,
            "rs_jcm2": rs_jcm2, "source": "open_meteo_live",
        }
    except Exception:
        fb = METEO_FALLBACK[mois]
        return {**fb, "source": f"fallback_mois{mois}"}

# ─────────────────────────────────────────────────────────────
# LOGIQUE DE DÉCISION
# ─────────────────────────────────────────────────────────────

def generer_recommandation_matin(
    device_id: int,
    date_str: str,
    db: Session,  # AJOUT SESSION DB
    ec_bassin: float = 0.75, # Valeur demandée 0.7-0.8
    date_plantation: Optional[str] = None,
    pct_ressuyage: Optional[float] = None,
    methode: str = "hybride",
    meteo_override: Optional[dict] = None,
) -> dict:
    target_date = _dt.datetime.utcnow().date()
    mois = target_date.month
    periode = get_periode(mois)
    seuils_generaux = get_seuils(periode)
    seuils_ressuyage = get_seuils_ressuyage_az106(mois)

    # Calcul PRT Ressuyage Automatique pour AZ106
    prt_calcule = calculer_prt_ressuyage_az106(db, device_id, target_date)
    if prt_calcule is not None:
        pct_ressuyage = prt_calcule

    # Jours depuis la plantation
    j_plantation = 60
    if date_plantation:
        try:
            dp = _datetime.strptime(date_plantation, "%Y-%m-%d").date()
            j_plantation = max(0, (target_date - dp).days)
        except Exception: pass

    stade = get_stade(j_plantation)
    ec_cible_stade = KC_TABLE[stade]["ec_cible"]

    # Météo
    try: meteo = meteo_override or get_meteo_open_meteo(mois)
    except Exception: meteo = {**METEO_FALLBACK[mois], "source": f"fallback_mois{mois}"}
    
    radiation = meteo.get("rs_jcm2") or METEO_FALLBACK[mois]["rs_jcm2"]
    t_max = meteo.get("t_max")
    t_min = meteo.get("t_min")
    t_moy = meteo.get("t_moy")
    hr_moy = meteo.get("hr_moy")
    pluie = meteo.get("pluie_mm", 0.0)
    vpd = calc_vpd(t_moy, hr_moy)

    # ── Vérification PRT ─────────────────────────────────────
    # PRT absent → retour immédiat sans recommandation
    if pct_ressuyage is None:
        return {
            "device_id"     : device_id,
            "date"          : date_str,
            "statut"        : "en_attente_prt",
            "message"       : "En attente du calcul PRT (poids soir/matin manquant)",
            "pct_ressuyage" : None,
            "nb_tours_prevu": 0,
            "heure_debut"   : None,
        }

    if pct_ressuyage < seuils_ressuyage["min"]:
        return {
            "device_id"     : device_id,
            "date"          : date_str,
            "statut"        : "en_attente_prt",
            "message"       : f"En attente: PRT {pct_ressuyage:.1f}% < seuil min {seuils_ressuyage['min']}%",
            "pct_ressuyage" : pct_ressuyage,
            "nb_tours_prevu": 0,
            "heure_debut"   : None,
        }

    if pct_ressuyage > seuils_ressuyage["max"]:
        message_ressuyage = f"PRT {pct_ressuyage:.1f}% > seuil max {seuils_ressuyage['max']}% → début avancé"
    else:
        message_ressuyage = f"PRT {pct_ressuyage:.1f}% ✓ seuil atteint"

    # ── Plan — nb_tours basé sur Radiation_Sum J/cm² ─────────
    if radiation < 10:    nb_tours = 2
    elif radiation < 20:  nb_tours = 4
    elif radiation < 35:  nb_tours = 6
    elif radiation < 50:  nb_tours = 8
    elif radiation < 65:  nb_tours = 10
    else:                 nb_tours = 12
    if periode == "froid": nb_tours = max(2, nb_tours - 2)

    heure_debut = get_heure_debut_depuis_capteur(db, device_id, stade)
    radiation_sum_actuel = get_radiation_sum_actuel(db, device_id, heure_debut) if heure_debut else None

    if heure_debut is None:
        return {
            "device_id"     : device_id,
            "date"          : date_str,
            "statut"        : "en_attente_radiation",
            "message"       : f"En attente radiation_sum >= {SEUIL_RADIATION_DEBUT.get(stade, 8.0)} J/cm² (stade: {stade})",
            "pct_ressuyage" : pct_ressuyage,
            "nb_tours_prevu": nb_tours,
            "heure_debut"   : None,
            "stade"         : stade,
            "j_plantation"  : j_plantation,
        }

    # FAO-56
    et0 = calculer_et0(t_max, t_min, hr_moy, radiation)
    etc = round(et0 * KC_TABLE[stade]["kc"] * 0.70 / 0.90, 3) if et0 else None
    fl = 0.20
    volume_total = round(etc / (1 - fl) * 10000, 0) if etc else None

    # ── Couche ML : affiner duree_t3p et repos ───────────────
    duree_t3p = 10 if radiation > 90 else 8
    duree_t12 = 12 if j_plantation > 30 else 11
    repos_init = 4

    # ── Fertigation : Calculer doses NPK ─────────────────────
    doses_npk = None
    correction_ph = None
    if volume_total and nb_tours > 0:
        volume_par_cycle = volume_total / nb_tours
        try:
            doses_npk = calculer_dose_engrais(
                ec_cible       = ec_cible_stade,
                ec_eau_brute   = ec_bassin,
                volume_cycle_l = volume_par_cycle,
                stade          = stade
            )
            correction_ph = corriger_ph(ph_mesure=6.8, volume_cycle_l=volume_par_cycle)
        except Exception as e:
            logger.warning(f"Erreur calcul NPK : {e}")

    if _rf_model is not None and _rf_r2 >= 0.70:
        try:
            import numpy as np
            # Pour la recommandation du MATIN :
            # - num_tour = tour median (pour duree_t3p), pas le premier tour
            # - rad_cumul = estimation milieu de journée (radiation/2)
            # - drain_prev = 0 (début de journée, substrat non saturé)
            # - Le ML prédit la duree_t3p et le repos inter-tour (tours 3+)
            #   Le repos_init (T1-T2) reste fixé par les règles agronomiques
            num_tour_median = max(3, nb_tours // 2)
            rad_cumul_estime = radiation / 2
            vpd = vpd or 1.0
            stress_index = vpd * radiation / 1000
            drain_prev_matin = 0.0  # début de journée : pas de drainage précédent

            X = np.array([[
                rad_cumul_estime,      # rad_cumul_tour_Jcm2
                radiation / nb_tours,  # radiation_tour
                mois,                  # mois
                num_tour_median,       # num_tour
                ec_cible_stade,        # ec_apport
                nb_tours,              # nbr_tours_total
                pct_ressuyage,         # pct_ressuyage
                stress_index,          # stress_index
                t_moy or 22.0,         # t_moy
                hr_moy or 65.0,        # hr_moy
                vpd or 1.0,            # vpd_kpa
                drain_prev_matin,      # drain_prev = 0 au matin
            ]])
            
            preds = _rf_model.predict(_rf_scaler.transform(X))[0]
            duree_t3p = max(5, min(15, int(round(float(preds[0])))))
            
            # Le repos ML concerne les tours 3+ uniquement.
            # Le repos initial T1-T2 reste agronomique (8 min chaud / 5 min froid).
            # On plafonne à 20 min car le repos inter-tour max observé en début
            # de journée est ~15-20 min (données Azura).
            repos_ml = max(5, min(20, int(round(float(preds[1])))))
            # repos_init (T1-T2) reste inchangé — on stocke repos_ml séparément
            repos_t3p_ml = repos_ml
            
            logger.success(f"✅ ML ACTIF → duree_t3p={duree_t3p}min repos_t3p={repos_t3p_ml}min R²={_rf_r2:.3f}")
        except Exception as e:
            logger.warning(f"⚠️ ML IGNORÉ → fallback règles : {e}")
            repos_t3p_ml = repos_init
    else:
        logger.warning(f"⚠️ ML NON DISPONIBLE → règles agronomiques seules (R²={_rf_r2:.3f})")
        repos_t3p_ml = repos_init

    return {
        "device_id"          : device_id,
        "date"               : date_str,
        "statut"             : "en_cours",
        "message"            : message_ressuyage,
        "radiation_sum_debut": radiation_sum_debut,
        "repos_t1_t2_min"    : 8,
        "message"            : message_ressuyage,
        "stade"              : stade,
        "j_plantation"       : j_plantation,
        "pct_ressuyage"      : pct_ressuyage,
        "radiation_jcm2"     : radiation,
        "ec_cible_dSm"       : ec_cible_stade,
        "nb_tours_prevu"     : nb_tours,
        "heure_debut"        : heure_debut,
        "duree_t12_min"     : duree_t12,
        "duree_t3p_min"     : duree_t3p,
        "repos_initial_min" : repos_init,   # T1-T2 : agronomique (8 min)
        "repos_t3p_min"      : repos_t3p_ml,    # T3+  : affiné par ML
        "ml_utilise"        : _rf_model is not None and _rf_r2 >= 0.70,
        "seuil_drainage_pct" : seuils_generaux["drainage_max"],
        "et0_mm"             : et0,
        "etc_mm"             : etc,
        "volume_total_l_ha"  : volume_total,
        "methode_decision"   : methode,
        "doses_npk"          : doses_npk,
        "correction_ph"      : correction_ph,
    }

def ajuster_apres_tour(recommandation: dict, drainage_reel: Optional[float], num_tour: int, tours_restants: int) -> dict:
    seuil = recommandation["seuil_drainage_pct"]
    repos = 8 + (num_tour - 1) * 2
    duree = recommandation["duree_t3p_min"]
    
    if drainage_reel and drainage_reel >= seuil:
        return {"tour": num_tour, "action": "ARRET_URGENT", "stop": True, "repos_suivant_min": 0}
    
    return {
        "tour": num_tour, "action": "CONTINUER", "stop": False, 
        "repos_suivant_min": repos, "duree_suivant_min": duree,
        "raison": f"Drainage {drainage_reel}% acceptable" if drainage_reel else "Mode sans capteur"
    }