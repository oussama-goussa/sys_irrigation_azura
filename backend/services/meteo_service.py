# ============================================================
# backend/services/meteo_service.py — Open-Meteo Agadir
# ============================================================

import os
import requests
from datetime import datetime, date
from loguru import logger
from tenacity import retry, stop_after_attempt, wait_fixed


LAT      = float(os.getenv("OPEN_METEO_LAT", "30.4202"))
LON      = float(os.getenv("OPEN_METEO_LON", "-9.5981"))
TIMEZONE = os.getenv("OPEN_METEO_TIMEZONE", "Africa/Casablanca")
BASE_URL = "https://api.open-meteo.com/v1/forecast"

# Cache simple en mémoire (TTL 1h)
_cache = {"data": None, "fetched_at": None}


@retry(stop=stop_after_attempt(3), wait=wait_fixed(2))
def _fetch_open_meteo() -> dict:
    """Appel HTTP vers Open-Meteo avec retry automatique."""
    params = {
        "latitude"   : LAT,
        "longitude"  : LON,
        "timezone"   : TIMEZONE,
        "forecast_days": 1,
        "hourly": [
            "temperature_2m",
            "relative_humidity_2m",
            "shortwave_radiation",
            "precipitation",
            "wind_speed_10m",
            "vapour_pressure_deficit",
        ],
        "daily": [
            "sunrise",
            "sunset",
            "shortwave_radiation_sum",
            "precipitation_sum",
            "temperature_2m_max",
            "temperature_2m_min",
        ],
    }
    resp = requests.get(BASE_URL, params=params, timeout=10)
    resp.raise_for_status()
    return resp.json()


def get_meteo_journee(force_refresh: bool = False) -> dict:
    """
    Retourne les données météo de la journée.
    Cache de 1h — si indisponible → fallback données par défaut.
    """
    now = datetime.now()

    # Vérifier le cache (TTL 1h)
    if (
        not force_refresh
        and _cache["data"] is not None
        and _cache["fetched_at"] is not None
        and (now - _cache["fetched_at"]).seconds < 3600
    ):
        logger.debug("Meteo depuis cache")
        return _cache["data"]

    try:
        raw = _fetch_open_meteo()
        data = _parse_meteo(raw)
        _cache["data"] = data
        _cache["fetched_at"] = now
        logger.success(f"Meteo Open-Meteo collectee : Rs_total={data['rs_total_wm2']:.0f} W/m²")
        return data

    except Exception as e:
        logger.warning(f"Open-Meteo indisponible ({e}) → fallback")
        if _cache["data"]:
            logger.info("Utilisation donnees cache precedentes")
            return {**_cache["data"], "source": "cache_fallback"}
        return _get_fallback_data()


def _parse_meteo(raw: dict) -> dict:
    """Extraire et calculer les métriques clés depuis la réponse Open-Meteo."""
    h = raw.get("hourly", {})
    d = raw.get("daily", {})

    times  = h.get("time", [])
    rs_h   = h.get("shortwave_radiation", [0] * 24)
    t_h    = h.get("temperature_2m", [20] * 24)
    hr_h   = h.get("relative_humidity_2m", [65] * 24)
    pluie_h= h.get("precipitation", [0] * 24)
    vent_h = h.get("wind_speed_10m", [2] * 24)
    vpd_h  = h.get("vapour_pressure_deficit", [1.0] * 24)

    # Métriques journalières
    rs_total   = sum(rs_h)
    pluie_total= sum(pluie_h)
    t_max      = max(t_h) if t_h else 25
    t_min      = min(t_h) if t_h else 15
    t_moy      = sum(t_h) / len(t_h) if t_h else 20
    hr_moy     = sum(hr_h) / len(hr_h) if hr_h else 65
    vent_moy   = sum(vent_h) / len(vent_h) if vent_h else 2
    vpd_max    = max(vpd_h) if vpd_h else 1.0

    # Heure actuelle (index dans le tableau horaire)
    heure_actuelle = datetime.now().hour
    rs_actuel      = rs_h[heure_actuelle] if heure_actuelle < len(rs_h) else 0
    t_actuelle     = t_h[heure_actuelle] if heure_actuelle < len(t_h) else t_moy
    hr_actuelle    = hr_h[heure_actuelle] if heure_actuelle < len(hr_h) else hr_moy
    vpd_actuel     = vpd_h[heure_actuelle] if heure_actuelle < len(vpd_h) else vpd_max

    # Détection brouillard (HR > 90% ET Rs < 50 W/m² le matin)
    brouillard = hr_h[6] > 90 and rs_h[6] < 50 if len(hr_h) > 6 else False

    # Profil horaire Rs (pour calcul heure démarrage)
    rs_horaire = [{"heure": i, "rs": v} for i, v in enumerate(rs_h)]

    return {
        "source"        : "open_meteo",
        "date"          : date.today().isoformat(),
        "lat"           : LAT,
        "lon"           : LON,
        # Journalier
        "rs_total_wm2"  : rs_total,
        "pluie_mm"      : pluie_total,
        "t_max"         : round(t_max, 1),
        "t_min"         : round(t_min, 1),
        "t_moy"         : round(t_moy, 1),
        "hr_moy"        : round(hr_moy, 1),
        "vent_moy_ms"   : round(vent_moy, 1),
        "vpd_max_kpa"   : round(vpd_max, 3),
        # Temps réel
        "rs_actuel_wm2" : round(rs_actuel, 1),
        "t_actuelle"    : round(t_actuelle, 1),
        "hr_actuelle"   : round(hr_actuelle, 1),
        "vpd_actuel"    : round(vpd_actuel, 3),
        # Flags
        "brouillard"    : brouillard,
        # Profil horaire
        "rs_horaire"    : rs_horaire,
        # Sunrise/sunset
        "sunrise"       : d.get("sunrise", [""])[0],
        "sunset"        : d.get("sunset", [""])[0],
    }


def _get_fallback_data() -> dict:
    """Données météo par défaut si Open-Meteo inaccessible."""
    logger.warning("Utilisation donnees FAO-56 par defaut (mode degrade)")
    return {
        "source"        : "fallback_default",
        "date"          : date.today().isoformat(),
        "rs_total_wm2"  : 3600,
        "pluie_mm"      : 0.0,
        "t_max"         : 26.0,
        "t_min"         : 16.0,
        "t_moy"         : 21.0,
        "hr_moy"        : 65.0,
        "vent_moy_ms"   : 2.0,
        "vpd_max_kpa"   : 1.2,
        "rs_actuel_wm2" : 400.0,
        "t_actuelle"    : 22.0,
        "hr_actuelle"   : 65.0,
        "vpd_actuel"    : 1.2,
        "brouillard"    : False,
        "rs_horaire"    : [{"heure": i, "rs": 0} for i in range(24)],
        "sunrise"       : "",
        "sunset"        : "",
    }