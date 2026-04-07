# ============================================================
# services/fao56.py — Calculs FAO-56 Penman-Monteith
# Projet Azura Irrigation — GOUSSA Oussama
# ============================================================

import math
from loguru import logger


def calculer_et0(
    temperature: float,    # °C
    humidite: float,       # %
    rs_wm2: float,         # W/m²
    vent: float = 2.0,     # m/s (defaut si pas de donnee)
    pression: float = 100.8  # kPa (altitude Agadir fixe)
) -> dict:
    """
    Calcule ET0 selon Penman-Monteith FAO-56
    Parametres specifiques Agadir :
        - Pression atmospherique : 100.8 kPa
        - Latitude : 30.42° N
    """
    try:
        # ── Pression vapeur saturante es (kPa) ──
        es = 0.6108 * math.exp(17.27 * temperature / (temperature + 237.3))

        # ── Pression vapeur reelle ea (kPa) ──
        ea = es * humidite / 100.0

        # ── Deficit pression vapeur VPD (kPa) ──
        vpd = es - ea

        # ── Pente courbe pression vapeur Delta ──
        delta = 4098 * es / ((temperature + 237.3) ** 2)

        # ── Constante psychrometrique gamma ──
        gamma = 0.000665 * pression

        # ── Conversion Rs W/m2 → MJ/m2/jour ──
        rs_mj = rs_wm2 * 0.0864

        # ── Rayonnement net Rns (solaire) ──
        alpha = 0.23  # albedo gazon reference
        rns = (1 - alpha) * rs_mj

        # ── Rayonnement net longue onde Rnl ──
        sigma = 4.903e-9  # constante Stefan-Boltzmann MJ/m2/jour/K4
        t_kelvin = temperature + 273.16
        rnl = sigma * (t_kelvin ** 4) * (0.34 - 0.14 * math.sqrt(ea)) * (1.35 * rs_mj / max(rs_mj * 1.2, 0.1) - 0.35)

        # ── Rayonnement net total Rn ──
        rn = rns - rnl

        # ── ET0 Penman-Monteith finale (mm/jour) ──
        numerateur = (0.408 * delta * rn) + (gamma * (900 / (temperature + 273)) * vent * vpd)
        denominateur = delta + gamma * (1 + 0.34 * vent)
        et0 = numerateur / denominateur
        et0 = max(0.0, et0)  # ET0 ne peut pas etre negatif

        logger.info(f"ET0 calcule : {et0:.2f} mm/jour | T={temperature}°C | HR={humidite}% | Rs={rs_wm2} W/m²")

        return {
            "et0_mm_jour"   : round(et0, 2),
            "es_kpa"        : round(es, 3),
            "ea_kpa"        : round(ea, 3),
            "vpd_kpa"       : round(vpd, 3),
            "delta"         : round(delta, 4),
            "gamma"         : round(gamma, 4),
            "rn_mj"         : round(rn, 3),
            "rs_mj"         : round(rs_mj, 3)
        }

    except Exception as e:
        logger.error(f"Erreur calcul ET0 : {e}")
        return {"et0_mm_jour": 3.5, "erreur": str(e)}  # valeur defaut securisee


def get_kc_stade(stade: str) -> float:
    """
    Coefficients culturaux Kc par stade
    Source : INRA Maroc — Tomate cerise sous serre Agadir
    """
    kc_table = {
        "vegetatif"    : 0.45,
        "developpement": 0.80,
        "floraison"    : 1.15,
        "grossissement": 1.10,
        "recolte"      : 0.85
    }
    kc = kc_table.get(stade.lower(), 1.0)
    logger.debug(f"Kc stade '{stade}' = {kc}")
    return kc


def get_ec_cible_stade(stade: str) -> float:
    """
    EC drain cible (dS/m) par stade phenologique
    """
    ec_table = {
        "vegetatif"    : 2.0,
        "developpement": 2.3,
        "floraison"    : 2.5,
        "grossissement": 2.8,
        "recolte"      : 3.2
    }
    return ec_table.get(stade.lower(), 2.5)


def calculer_volume_journee(
    et0: float,        # mm/jour
    stade: str,        # stade phenologique
    ec_eau_brute: float = 0.8   # dS/m eau Azura
) -> dict:
    """
    Calcule le volume total d'eau necessaire pour la journee
    """
    # Coefficients
    kc  = get_kc_stade(stade)
    tau = 0.70    # facteur serre plastique Azura
    ie  = 0.90    # efficience goutte a goutte

    # ETc = besoins reels tomate
    etc = et0 * kc * tau / ie

    # Fraction de lessivage selon EC eau brute
    if ec_eau_brute < 0.5:
        fl = 0.15
        type_eau = "dessalee"
    elif ec_eau_brute < 2.0:
        fl = 0.20
        type_eau = "melangee"
    else:
        fl = 0.25
        type_eau = "saumâtre"

    # Volume total avec lessivage
    apport_total_mm = etc / (1 - fl)
    volume_total_l_ha = apport_total_mm * 10000

    logger.info(
        f"Volume journee : {volume_total_l_ha:.0f} L/ha | "
        f"ET0={et0} ETc={etc:.2f} FL={fl} Kc={kc} Stade={stade}"
    )

    return {
        "et0_mm"             : round(et0, 2),
        "kc"                 : kc,
        "etc_mm"             : round(etc, 2),
        "fl"                 : fl,
        "type_eau"           : type_eau,
        "apport_total_mm"    : round(apport_total_mm, 2),
        "volume_total_l_ha"  : round(volume_total_l_ha, 0),
        "stade"              : stade
    }


def calculer_nb_cycles(rs_wm2: float, vpd: float = 1.0, t_max: float = 25.0) -> int:
    """
    Determine le nombre de cycles d'irrigation selon
    les conditions meteorologiques de la journee
    """
    # Detection Chergui (urgence)
    if t_max > 35 and vpd > 2.5:
        nb = 14
        logger.warning(f"CHERGUI detecte ! T={t_max}°C VPD={vpd} → {nb} cycles")
        return nb

    # Nombre cycles selon Rs total
    if rs_wm2 > 6000:
        nb = 14
    elif rs_wm2 > 4500:
        nb = 10
    elif rs_wm2 > 3000:
        nb = 7
    elif rs_wm2 > 1500:
        nb = 4
    else:
        nb = 2

    logger.info(f"Nb cycles : {nb} | Rs={rs_wm2} W/m²")
    return nb


def detecter_scenario_meteo(
    rs_wm2: float,
    temperature: float,
    humidite: float,
    pluie_mm: float,
    vpd: float
) -> dict:
    """
    Detecte le scenario meteorologique de la journee
    7 scenarios possibles selon CDC Azura
    """
    if pluie_mm > 0.5:
        return {
            "scenario"      : "pluie",
            "action"        : "STOP",
            "heure_debut"   : None,
            "message"       : f"Pluie {pluie_mm}mm → Irrigation annulee"
        }

    if humidite > 90 and rs_wm2 < 50:
        return {
            "scenario"      : "brouillard",
            "action"        : "RETARD",
            "heure_debut"   : "10:30",
            "message"       : f"Brouillard HR={humidite}% → Demarrage retarde"
        }

    if temperature > 35 and vpd > 2.5:
        return {
            "scenario"      : "chergui",
            "action"        : "URGENT",
            "heure_debut"   : "07:00",
            "message"       : f"Chergui T={temperature}°C VPD={vpd} → Demarrage immediat"
        }

    if rs_wm2 > 4500:
        return {
            "scenario"      : "ensoleille",
            "action"        : "NORMAL",
            "heure_debut"   : "08:00",
            "message"       : f"Journee ensoleilee Rs={rs_wm2} W/m²"
        }

    if rs_wm2 > 1500:
        return {
            "scenario"      : "nuageux",
            "action"        : "NORMAL",
            "heure_debut"   : "09:00",
            "message"       : f"Journee nuageuse Rs={rs_wm2} W/m²"
        }

    return {
        "scenario"      : "hiver_nuageux",
        "action"        : "REDUIT",
        "heure_debut"   : "10:00",
        "message"       : f"Hiver nuageux Rs={rs_wm2} W/m²"
    }
