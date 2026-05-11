# ============================================================
# backend/services/ai_service.py
# Service Agent IA Irrigation — Azura Group
# Adapté de 05_agent_ia.py + 06_agent_temps_reel.py
# Fonctionne SANS données drainage/poids (dégradé gracieux)
# ============================================================

import math
import os
import json
import requests
from datetime import date, datetime, timedelta
from typing import Optional
from loguru import logger

# ── Tentative de chargement du modèle ML ─────────────────────
# Si pas encore entraîné → fallback règles agronomiques
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

# ── Configuration par défaut (copie de config_agent.json) ────
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

# Essayer de charger depuis le fichier si présent
try:
    cfg_path = os.path.join(os.path.dirname(__file__), "..", "config_agent.json")
    with open(cfg_path) as f:
        CONFIG.update(json.load(f))
    logger.info("config_agent.json chargé ✅")
except Exception:
    pass

# ── KC Table par stade (INRA Maroc) ──────────────────────────
KC_TABLE = {
    "vegetatif"    : {"kc": 0.45, "ec_cible": 1.8,  "j_min": 0,   "j_max": 30},
    "developpement": {"kc": 0.80, "ec_cible": 2.2,  "j_min": 31,  "j_max": 60},
    "floraison"    : {"kc": 1.15, "ec_cible": 2.5,  "j_min": 61,  "j_max": 90},
    "grossissement": {"kc": 1.10, "ec_cible": 2.8,  "j_min": 91,  "j_max": 120},
    "recolte"      : {"kc": 0.85, "ec_cible": 3.2,  "j_min": 121, "j_max": 9999},
}

FEATURES_ML = [
    "radiation_jour", "mois", "num_tour", "ec_apport", "ph_apport",
    "v_apport", "ec_bassin", "temps_repos_min", "nbr_tours_total",
    "pct_ressuyage", "duree_min", "t_moy", "hr_moy", "vpd_kpa",
    "est_premier_tour",
]

# ── Méteo fallback Agadir sous serre ─────────────────────────
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

def get_periode(mois: int) -> str:
    if mois in [11, 12, 1, 2]: return "froid"
    if mois in [4, 5, 6, 7]:   return "chaud"
    return "transition"

def get_seuils(periode: str) -> dict:
    return {
        "froid":      {"drainage_max": 35.0, "drainage_cible": 20.0, "ressuyage_min": 10.0, "ressuyage_max": 12.0},
        "chaud":      {"drainage_max": 45.0, "drainage_cible": 25.0, "ressuyage_min":  8.0, "ressuyage_max":  9.0},
        "transition": {"drainage_max": 40.0, "drainage_cible": 22.0, "ressuyage_min":  9.0, "ressuyage_max": 10.5},
    }[periode]

def get_stade(j_plantation: int) -> str:
    for nom, v in KC_TABLE.items():
        if v["j_min"] <= j_plantation <= v["j_max"]:
            return nom
    return "recolte"

def calc_vpd(t: float, hr: float) -> float:
    if not t or not hr: return 1.0
    es = 0.6108 * math.exp(17.27 * t / (t + 237.3))
    return round(max(0.0, es * (1 - hr / 100)), 3)

def calculer_et0(t_max: float, t_min: float, hr_moy: float, rs_jcm2: float, u2: float = 1.0) -> Optional[float]:
    """Penman-Monteith simplifié FAO-56."""
    try:
        t_moy  = (t_max + t_min) / 2
        es     = 0.6108 * math.exp(17.27 * t_moy / (t_moy + 237.3))
        ea     = es * hr_moy / 100
        delta  = 4098 * es / (t_moy + 237.3) ** 2
        gamma  = 0.000665 * 100.8
        rs_mj  = rs_jcm2 / 10000 * 1000 * 0.0036  # J/cm² → MJ/m²
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
    """Récupère la météo Open-Meteo ; fallback sur valeurs historiques Agadir."""
    try:
        r = requests.get(
            "https://api.open-meteo.com/v1/forecast",
            params={
                "latitude": 30.4202, "longitude": -9.5982,
                "daily": [
                    "temperature_2m_max", "temperature_2m_min",
                    "relative_humidity_2m_mean", "wind_speed_10m_max",
                    "precipitation_sum", "shortwave_radiation_sum",
                ],
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
        # Serre = 27% de la radiation extérieure (facteur Azura)
        rs_jcm2 = float(rs_kwh) * 360 * 0.27 if rs_kwh is not None else METEO_FALLBACK[mois]["rs_jcm2"]
        return {
            "t_max": tmax, "t_min": tmin,
            "t_moy": round((tmax + tmin) / 2, 1),
            "hr_moy": d["relative_humidity_2m_mean"][0],
            "vent_max": d["wind_speed_10m_max"][0],
            "pluie_mm": d["precipitation_sum"][0] or 0.0,
            "rs_jcm2": rs_jcm2,
            "source": "open_meteo_live",
        }
    except Exception as e:
        logger.warning(f"Open-Meteo inaccessible → fallback : {e}")
        fb = METEO_FALLBACK[mois]
        return {**fb, "source": f"fallback_mois{mois}"}

# ─────────────────────────────────────────────────────────────
# LOGIQUE DE DÉCISION (identique à 05_agent_ia.py)
# ─────────────────────────────────────────────────────────────

def detecter_scenario(radiation, pct_ressuyage, seuils_ressuyage, t_max, hr, vpd, pluie) -> dict:
    if pluie and pluie > 0.5:
        return {"scenario": "pluie", "action": "STOP", "heure_debut": None, "ec_cible": None,
                "message": f"Pluie {pluie}mm → arrêt"}
    if pct_ressuyage is not None and pct_ressuyage < seuils_ressuyage["min"] * 0.9:
        return {"scenario": "ressuyage_trop_faible", "action": "RETARD", "heure_debut": "11:00",
                "ec_cible": 3.2, "message": f"Ressuyage {pct_ressuyage}% faible → retard"}
    if pct_ressuyage is not None and pct_ressuyage > seuils_ressuyage["max"] * 1.1:
        return {"scenario": "ressuyage_eleve", "action": "AVANCER", "heure_debut": "07:00",
                "ec_cible": 2.2, "message": "Ressuyage élevé → avancer début"}
    if hr and hr > 90 and radiation < 30:
        return {"scenario": "brouillard", "action": "RETARD", "heure_debut": "10:30",
                "ec_cible": 3.2, "message": "Brouillard → démarrage 10h30"}
    if t_max and t_max > 35 and vpd > 2.5:
        return {"scenario": "chergui", "action": "URGENT", "heure_debut": "07:00",
                "ec_cible": 2.0, "message": f"Chergui T={t_max}°C VPD={vpd} → urgence"}
    if radiation and radiation >= 80:
        return {"scenario": "ensoleille", "action": "NORMAL", "heure_debut": "07:30",
                "ec_cible": 2.2, "message": f"Ensoleillé Rad={radiation} J/cm²"}
    if radiation and radiation >= 50:
        return {"scenario": "nuageux", "action": "NORMAL", "heure_debut": "08:30",
                "ec_cible": 2.8, "message": f"Nuageux Rad={radiation}"}
    if t_max and t_max < 18:
        return {"scenario": "hiver_clair", "action": "REDUIT", "heure_debut": "09:30",
                "ec_cible": 3.0, "message": f"Hiver clair T={t_max}°C"}
    return {"scenario": "hiver_nuageux", "action": "MINIMAL", "heure_debut": "10:00",
            "ec_cible": 3.3, "message": "Hiver nuageux"}

def _plan_couche1(radiation, mois, pct_ressuyage, periode, seuils, scenario, j_plantation) -> dict:
    if scenario["action"] == "STOP":
        return {"nb_tours": 0, "duree_t12": 0, "duree_t3p": 0, "repos": 0}

    # Nb tours selon radiation J/cm²
    if not radiation or radiation < 20:    nb = 2
    elif radiation < 40:  nb = 4
    elif radiation < 60:  nb = 6
    elif radiation < 80:  nb = 8
    elif radiation < 100: nb = 10
    else:                 nb = 12

    if periode == "froid":           nb = max(2, nb - 2)
    if scenario["action"] == "URGENT":   nb = min(14, nb + 3)
    if scenario["action"] == "MINIMAL":  nb = min(4, nb)

    # Durées T1-T2
    if j_plantation <= 30:   d12 = 8
    elif j_plantation <= 60: d12 = 10
    elif j_plantation <= 90: d12 = 15
    else:                    d12 = 12

    # Durées T3+
    if scenario["action"] == "URGENT":                d3p = 10
    elif scenario["action"] in ["MINIMAL", "REDUIT"]: d3p = 6
    elif radiation and radiation >= 90:               d3p = 10
    else:                                              d3p = 8

    repos = 5 if periode == "chaud" else 8

    return {
        "nb_tours": nb,
        "duree_t12": d12,
        "duree_t3p": d3p,
        "repos": repos,
        "heure_debut": scenario["heure_debut"],
        "ec_cible": scenario["ec_cible"],
    }

def _correction_ml(features_dict: dict) -> Optional[float]:
    """Applique le modèle RF si disponible. Retourne drainage prévu ou None."""
    if _rf_model is None:
        return None
    try:
        import numpy as np
        X = [[features_dict.get(f, 0) for f in FEATURES_ML]]
        X_sc = _rf_scaler.transform(X)
        drainage = float(_rf_model.predict(X_sc)[0])
        return max(0.0, min(100.0, drainage))
    except Exception as e:
        logger.warning(f"Erreur ML prédiction : {e}")
        return None

def calculer_doses_npk(ec_cible: float, ec_bassin: float, volume_L: float, stade: str) -> dict:
    """Calcul simplifié doses engrais par canal (g)."""
    ec_ajouter = max(0.0, ec_cible - ec_bassin)
    concentration = ec_ajouter / 0.1    # g/L
    dose_totale = concentration * volume_L

    ratios = {
        "vegetatif":     {"A": 0.45, "B": 0.30, "C": 0.15, "D": 0.10},
        "developpement": {"A": 0.44, "B": 0.31, "C": 0.15, "D": 0.10},
        "floraison":     {"A": 0.42, "B": 0.33, "C": 0.15, "D": 0.10},
        "grossissement": {"A": 0.40, "B": 0.31, "C": 0.14, "D": 0.15},
        "recolte":       {"A": 0.35, "B": 0.28, "C": 0.17, "D": 0.20},
    }
    r = ratios.get(stade, ratios["floraison"])
    return {
        "canal_A_g": round(dose_totale * r["A"], 1),
        "canal_B_g": round(dose_totale * r["B"], 1),
        "canal_C_g": round(dose_totale * r["C"], 1),
        "canal_D_g": round(dose_totale * r["D"], 1),
        "ec_ajouter": round(ec_ajouter, 2),
        "concentration_g_L": round(concentration, 2),
        "dose_totale_g": round(dose_totale, 1),
    }

def correction_ph_acide(ph_mesure: float, volume_L: float) -> dict:
    """Correction pH : calcul dose acide/base."""
    if 5.8 <= ph_mesure <= 6.2:
        return {"action": "OK", "dose_ml": 0, "produit": None}
    if ph_mesure > 6.2:
        dose = (ph_mesure - 6.0) * 15 * volume_L / 1000
        return {"action": "ajouter_acide", "dose_ml": round(dose, 1), "produit": "HNO3"}
    else:
        dose = (6.0 - ph_mesure) * 10 * volume_L / 1000
        return {"action": "ajouter_base", "dose_ml": round(dose, 1), "produit": "KOH"}

# ─────────────────────────────────────────────────────────────
# POINT D'ENTRÉE PRINCIPAL — Recommandation du matin
# ─────────────────────────────────────────────────────────────

def generer_recommandation_matin(
    device_id: int,
    date_str: str,
    ec_bassin: float = 0.8,
    date_plantation: Optional[str] = None,
    pct_ressuyage: Optional[float] = None,   # None si capteur absent
    methode: str = "hybride",
    meteo_override: Optional[dict] = None,   # pour les tests
) -> dict:
    """
    Génère la recommandation initiale du matin pour un device.
    Fonctionne même sans pct_ressuyage ni drainage (dégradé gracieux).
    """
    target_date = datetime.strptime(date_str, "%Y-%m-%d").date()
    mois = target_date.month
    periode = get_periode(mois)
    seuils = get_seuils(periode)

    # Jours depuis la plantation
    j_plantation = 60  # défaut si absent
    if date_plantation:
        try:
            dp = datetime.strptime(date_plantation, "%Y-%m-%d").date()
            j_plantation = max(0, (target_date - dp).days)
        except Exception:
            pass

    stade = get_stade(j_plantation)
    ec_cible_stade = KC_TABLE[stade]["ec_cible"]

    # Météo
    try:
        meteo = meteo_override or get_meteo_open_meteo(mois)
    except Exception:
        meteo = {**METEO_FALLBACK[mois], "source": f"fallback_mois{mois}"}
    radiation = meteo.get("rs_jcm2") or METEO_FALLBACK[mois]["rs_jcm2"]
    t_max = meteo.get("t_max")
    t_min = meteo.get("t_min")
    t_moy = meteo.get("t_moy")
    hr_moy = meteo.get("hr_moy")
    pluie = meteo.get("pluie_mm", 0.0)
    vpd = calc_vpd(t_moy, hr_moy)

    # Ressuyage : si absent → utiliser la médiane de la période
    if pct_ressuyage is None:
        pct_ressuyage_eff = (seuils["ressuyage_min"] + seuils["ressuyage_max"]) / 2
        ressuyage_disponible = False
    else:
        pct_ressuyage_eff = pct_ressuyage
        ressuyage_disponible = True

    # Scénario météo
    scenario = detecter_scenario(
        radiation, pct_ressuyage_eff,
        {"min": seuils["ressuyage_min"], "max": seuils["ressuyage_max"]},
        t_max, hr_moy, vpd, pluie,
    )

    # Plan couche 1
    plan = _plan_couche1(radiation, mois, pct_ressuyage_eff, periode, seuils, scenario, j_plantation)

    # FAO-56
    et0 = None
    etc = None
    fl = 0.20
    volume_total = None
    if t_max and t_min:
        et0 = calculer_et0(t_max, t_min, hr_moy, radiation)
        if et0:
            kc = KC_TABLE[stade]["kc"]
            etc = round(et0 * kc * 0.70 / 0.90, 3)
            if ec_bassin >= 2.0:  fl = 0.25
            elif ec_bassin < 0.5: fl = 0.15
            apport = etc / (1 - fl) if fl < 1 else etc
            volume_total = round(apport * 10000, 0)

    # Correction ML (si disponible et pas STOP)
    if methode in ("hybride", "ml_seul") and plan["nb_tours"] > 0 and _rf_model is not None:
        features = {
            "radiation_jour": radiation, "mois": mois,
            "num_tour": max(3, plan["nb_tours"] // 2),
            "ec_apport": ec_cible_stade, "ph_apport": 6.0,
            "v_apport": plan["duree_t3p"] * (1000 / 60),
            "ec_bassin": ec_bassin, "temps_repos_min": plan["repos"],
            "nbr_tours_total": plan["nb_tours"],
            "pct_ressuyage": pct_ressuyage_eff,
            "duree_min": plan["duree_t3p"],
            "t_moy": t_moy or 22, "hr_moy": hr_moy or 65,
            "vpd_kpa": vpd, "est_premier_tour": 0,
        }
        drainage_ml = _correction_ml(features)
        if drainage_ml and methode == "hybride":
            cible = seuils["drainage_cible"]
            if drainage_ml > cible * 1.3:
                plan["nb_tours"] = max(2, plan["nb_tours"] - 1)
                plan["duree_t3p"] = max(5, plan["duree_t3p"] - 2)
            elif drainage_ml < cible * 0.7:
                plan["nb_tours"] = min(14, plan["nb_tours"] + 1)

    # NPK + pH
    volume_cycle_L = (volume_total / plan["nb_tours"]) / 1000 if (volume_total and plan["nb_tours"] > 0) else 166.0
    doses_npk = calculer_doses_npk(ec_cible_stade, ec_bassin, volume_cycle_L, stade)
    corr_ph = correction_ph_acide(6.0, volume_cycle_L)

    return {
        "device_id"          : device_id,
        "date"               : date_str,
        "periode"            : periode,
        "stade"              : stade,
        "j_plantation"       : j_plantation,
        "scenario_meteo"     : scenario["scenario"],
        "scenario_message"   : scenario["message"],
        "ressuyage_disponible": ressuyage_disponible,
        "pct_ressuyage"      : pct_ressuyage if ressuyage_disponible else None,
        "meteo"              : meteo,
        "radiation_jcm2"     : radiation,
        "t_max"              : t_max, "t_min": t_min, "t_moy": t_moy,
        "hr_moy"             : hr_moy, "vpd_kpa": vpd, "pluie_mm": pluie,
        "et0_mm"             : et0, "etc_mm": etc,
        "fraction_lessivage" : fl, "volume_total_l_ha": volume_total,
        "ec_cible_dSm"      : ec_cible_stade,
        "nb_tours_prevu"     : plan["nb_tours"],
        "heure_debut"        : plan.get("heure_debut") or "07:30",
        "duree_t12_min"      : plan["duree_t12"],
        "duree_t3p_min"      : plan["duree_t3p"],
        "repos_initial_min"  : plan["repos"],
        "seuil_drainage_pct" : seuils["drainage_max"],
        "doses_npk"          : doses_npk,
        "correction_ph"      : corr_ph,
        "methode_decision"   : methode,
        # État interne pour les ajustements tour par tour
        "_etat"              : {
            "repos_courant_min"  : plan["repos"],
            "duree_t3p_courant"  : plan["duree_t3p"],
            "surveillance"       : False,
            "depassement_reel"   : False,
            "dernier_drainage"   : 0.0,
        },
    }

# ─────────────────────────────────────────────────────────────
# AJUSTEMENT APRÈS CHAQUE TOUR
# ─────────────────────────────────────────────────────────────

def ajuster_apres_tour(
    recommandation: dict,
    drainage_reel: Optional[float],   # None si pas encore de capteur drain
    num_tour: int,
    tours_restants: int,
) -> dict:
    """
    Calcule l'ajustement pour le prochain tour.
    Si drainage_reel=None → utilise radiation cumulée + règles simples.
    Retourne un dict d'ajustement à sauvegarder dans la table.
    """
    seuil = recommandation["seuil_drainage_pct"]
    etat = recommandation.get("_etat", {})
    repos_courant = etat.get("repos_courant_min", recommandation.get("repos_initial_min", 8))
    duree_t3p = etat.get("duree_t3p_courant", recommandation.get("duree_t3p_min", 8))
    surveillance = etat.get("surveillance", False)
    depassement_reel = etat.get("depassement_reel", False)
    dernier_drain = etat.get("dernier_drainage", 0.0)

    # Repos progressif théorique (augmente naturellement au fil des tours)
    if num_tour <= 2:
        repos_progressif = repos_courant
    else:
        repos_progressif = min(35, repos_courant + (num_tour - 2) * 1.5)

    # Durée réduite en fin de journée
    if num_tour >= 6:
        duree_t3p = max(6, duree_t3p - (num_tour - 5) * 0.5)
    duree_t3p = int(duree_t3p)

    # ── CAS 1 : Pas de drainage disponible (mode dégradé) ─────
    if drainage_reel is None:
        # Basé uniquement sur progression temporelle → CONTINUER en augmentant repos progressivement
        repos_prochain = int(repos_progressif)
        nouvel_etat = {**etat, "repos_courant_min": repos_prochain, "duree_t3p_courant": duree_t3p}
        return {
            "tour"              : num_tour,
            "drainage_reel"     : None,
            "action"            : "CONTINUER",
            "raison"            : f"Pas de capteur drainage → repos progressif {repos_prochain} min",
            "repos_suivant_min" : repos_prochain,
            "duree_suivant_min" : duree_t3p,
            "stop"              : False,
            "nouveau_etat"      : nouvel_etat,
        }

    # ── CAS 2 : Drainage disponible → logique complète ────────
    ratio = drainage_reel / seuil if seuil > 0 else 0

    if ratio >= 1.0:
        if not surveillance:
            new_repos = min(CONFIG["repos"]["max_repos"],
                            int(repos_progressif * CONFIG["repos"]["coeff_arret_repos"]))
            new_duree = max(CONFIG["duree"]["duree_min_absolue"],
                            int(duree_t3p * CONFIG["duree"]["coeff_arret_duree"]))
            nouvel_etat = {**etat, "repos_courant_min": new_repos, "duree_t3p_courant": new_duree,
                           "surveillance": True, "depassement_reel": True, "dernier_drainage": drainage_reel}
            return {
                "tour"              : num_tour,
                "drainage_reel"     : drainage_reel,
                "action"            : "AUGMENTATION_REPOS",
                "raison"            : f"Drainage {drainage_reel:.1f}% ≥ seuil {seuil:.1f}% → repos augmenté à {new_repos} min",
                "repos_suivant_min" : new_repos,
                "duree_suivant_min" : new_duree,
                "stop"              : False,
                "nouveau_etat"      : nouvel_etat,
            }
        else:
            nouvel_etat = {**etat, "surveillance": True, "depassement_reel": True}
            return {
                "tour"              : num_tour,
                "drainage_reel"     : drainage_reel,
                "action"            : "ARRET_URGENT",
                "raison"            : f"Drainage {drainage_reel:.1f}% ≥ seuil malgré augmentation → arrêt",
                "repos_suivant_min" : 0,
                "duree_suivant_min" : 0,
                "stop"              : True,
                "nouveau_etat"      : nouvel_etat,
            }

    # Drainage < seuil
    if surveillance and depassement_reel and drainage_reel > dernier_drain:
        nouvel_etat = {**etat, "dernier_drainage": drainage_reel}
        return {
            "tour"              : num_tour,
            "drainage_reel"     : drainage_reel,
            "action"            : "ARRET_URGENT",
            "raison"            : f"Drainage remonte {dernier_drain:.1f}%→{drainage_reel:.1f}% après dépassement → arrêt",
            "repos_suivant_min" : 0,
            "duree_suivant_min" : 0,
            "stop"              : True,
            "nouveau_etat"      : nouvel_etat,
        }

    if ratio >= CONFIG["seuils"]["debut_prudence"]:
        new_repos = min(CONFIG["repos"]["max_repos"],
                        int(repos_progressif * CONFIG["repos"]["coeff_prudence"]))
        new_duree = max(CONFIG["duree"]["duree_min_absolue"],
                        int(duree_t3p * CONFIG["duree"]["coeff_prudence"]))
        nouvel_etat = {**etat, "repos_courant_min": new_repos, "duree_t3p_courant": new_duree,
                       "dernier_drainage": drainage_reel}
        return {
            "tour"              : num_tour,
            "drainage_reel"     : drainage_reel,
            "action"            : "PRUDENCE",
            "raison"            : f"Drainage {drainage_reel:.1f}% proche seuil → repos augmenté",
            "repos_suivant_min" : new_repos,
            "duree_suivant_min" : new_duree,
            "stop"              : False,
            "nouveau_etat"      : nouvel_etat,
        }

    if (CONFIG["tours"]["prolongation_allow"] and
            ratio <= CONFIG["seuils"]["prolongation_max"] and
            tours_restants <= 1 and num_tour >= 3):
        nouvel_etat = {**etat, "dernier_drainage": drainage_reel}
        return {
            "tour"              : num_tour,
            "drainage_reel"     : drainage_reel,
            "action"            : "PROLONGER",
            "raison"            : "Drainage très faible → ajout d'un tour",
            "repos_suivant_min" : int(repos_progressif * CONFIG["repos"]["coeff_prolongation"]),
            "duree_suivant_min" : duree_t3p,
            "stop"              : False,
            "nouveau_etat"      : nouvel_etat,
        }

    # CONTINUER normal
    nouvel_etat = {**etat, "repos_courant_min": int(repos_progressif),
                   "duree_t3p_courant": duree_t3p, "dernier_drainage": drainage_reel}
    return {
        "tour"              : num_tour,
        "drainage_reel"     : drainage_reel,
        "action"            : "CONTINUER",
        "raison"            : f"Drainage {drainage_reel:.1f}% acceptable",
        "repos_suivant_min" : int(repos_progressif),
        "duree_suivant_min" : duree_t3p,
        "stop"              : False,
        "nouveau_etat"      : nouvel_etat,
    }