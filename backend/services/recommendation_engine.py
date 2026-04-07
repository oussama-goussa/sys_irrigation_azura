# ============================================================
# backend/services/recommendation_engine.py
# Pipeline complet : Meteo → FAO-56 → EC/pH → Recommandation
# ============================================================

from datetime import datetime, date
from loguru import logger

from services.fao56 import (
    calculer_et0, calculer_volume_journee,
    calculer_nb_cycles, detecter_scenario_meteo,
    get_ec_cible_stade, get_kc_stade
)
from services.ec_ph import calculer_dose_engrais, corriger_ph
from services.meteo_service import get_meteo_journee


def get_stade_depuis_jours(jours_depuis_plantation: int) -> str:
    """Détermine le stade phénologique automatiquement."""
    if jours_depuis_plantation <= 30:
        return "vegetatif"
    elif jours_depuis_plantation <= 60:
        return "developpement"
    elif jours_depuis_plantation <= 90:
        return "floraison"
    elif jours_depuis_plantation <= 120:
        return "grossissement"
    else:
        return "recolte"


def calculer_heure_demarrage(meteo: dict, stade: str) -> dict:
    """
    Calcule l'heure de démarrage optimale basée sur le profil Rs horaire.
    Le démarrage se fait quand le Rs accumulé atteint le seuil RadS.
    """
    # Seuil RadS de démarrage selon stade (J/cm²)
    seuils = {
        "vegetatif"    : 50,
        "developpement": 80,
        "floraison"    : 100,
        "grossissement": 90,
        "recolte"      : 70,
    }

    # Cas Chergui → démarrer immédiatement à 07h00
    if meteo["t_max"] > 35 and meteo["vpd_max_kpa"] > 2.5:
        return {"heure": "07:00", "raison": "Chergui détecté — démarrage immédiat"}

    # Cas pluie → STOP
    if meteo["pluie_mm"] > 0.5:
        return {"heure": None, "raison": f"Pluie {meteo['pluie_mm']}mm — irrigation annulée"}

    # Cas brouillard → retarder
    if meteo["brouillard"]:
        return {"heure": "10:30", "raison": "Brouillard matinal — démarrage retardé"}

    # Calcul normal : accumuler Rs heure par heure
    seuil = seuils.get(stade, 80)
    rs_cumule = 0.0

    for item in meteo.get("rs_horaire", []):
        h  = item["heure"]
        rs = item["rs"]
        # Conversion W/m² → J/cm² pour 1h : rs * 3600 / 10000
        rs_cumule += rs * 0.36  # facteur simplifié
        if rs_cumule >= seuil and 6 <= h <= 16:
            return {
                "heure" : f"{h:02d}:00",
                "raison": f"RadS cumulé {rs_cumule:.1f} J/cm² ≥ seuil {seuil} J/cm²"
            }

    # Par défaut
    return {"heure": "09:00", "raison": "Heure par défaut (Rs insuffisant)"}


def generer_recommandation_complete(
    # Paramètres agronomiques
    stade           : str   = None,
    date_plantation : str   = None,
    ec_eau_brute    : float = 0.8,
    # Paramètres manuels (si pas de meteo auto)
    temperature     : float = None,
    humidite        : float = None,
    rs_wm2          : float = None,
    vent            : float = None,
    pluie_mm        : float = None,
    vpd             : float = None,
    # Options
    forcer_meteo_manuelle: bool = False,
) -> dict:
    """
    Pipeline complet de génération de recommandation.

    Priorité données :
    1. Open-Meteo automatique (si disponible)
    2. Paramètres manuels fournis
    3. Fallback valeurs par défaut FAO-56
    """

    # ── Étape 1 : Déterminer le stade phénologique ────────────
    if not stade and date_plantation:
        try:
            dp = datetime.strptime(date_plantation, "%Y-%m-%d").date()
            jours = (date.today() - dp).days
            stade = get_stade_depuis_jours(jours)
            logger.info(f"Stade auto : {jours} jours → {stade}")
        except:
            stade = "floraison"
    stade = stade or "floraison"

    # ── Étape 2 : Collecte météo ──────────────────────────────
    if not forcer_meteo_manuelle:
        meteo = get_meteo_journee()
    else:
        # Paramètres manuels → simuler objet météo
        meteo = {
            "source"        : "manuel",
            "date"          : date.today().isoformat(),
            "rs_total_wm2"  : (rs_wm2 or 500) * 12,
            "pluie_mm"      : pluie_mm or 0.0,
            "t_max"         : temperature or 25.0,
            "t_min"         : (temperature or 25.0) - 8,
            "t_moy"         : temperature or 22.0,
            "hr_moy"        : humidite or 65.0,
            "vent_moy_ms"   : vent or 2.0,
            "vpd_max_kpa"   : vpd or 1.2,
            "rs_actuel_wm2" : rs_wm2 or 500.0,
            "t_actuelle"    : temperature or 22.0,
            "hr_actuelle"   : humidite or 65.0,
            "vpd_actuel"    : vpd or 1.2,
            "brouillard"    : (humidite or 65) > 90,
            "rs_horaire"    : [{"heure": i, "rs": (rs_wm2 or 500)} for i in range(6, 18)],
        }

    # ── Étape 3 : Détecter scénario météo ────────────────────
    scenario = detecter_scenario_meteo(
        rs_wm2      = meteo["rs_total_wm2"] / 12,  # Rs moyen horaire
        temperature = meteo["t_moy"],
        humidite    = meteo["hr_moy"],
        pluie_mm    = meteo["pluie_mm"],
        vpd         = meteo["vpd_max_kpa"]
    )

    # ── Arrêt si pluie ────────────────────────────────────────
    if scenario["action"] == "STOP":
        return {
            "statut"  : "STOP",
            "scenario": scenario["scenario"],
            "message" : scenario["message"],
            "meteo"   : meteo,
            "stade"   : stade,
        }

    # ── Étape 4 : Calcul ET0 Penman-Monteith ─────────────────
    et0_result = calculer_et0(
        temperature = meteo["t_moy"],
        humidite    = meteo["hr_moy"],
        rs_wm2      = meteo["rs_total_wm2"] / 12,
        vent        = meteo["vent_moy_ms"],
    )
    et0 = et0_result["et0_mm_jour"]

    # ── Étape 5 : Volume eau journée (FAO-56) ─────────────────
    volume_data = calculer_volume_journee(et0, stade, ec_eau_brute)

    # ── Étape 6 : Nombre de cycles (basé sur Rs total) ───────
    nb_cycles = calculer_nb_cycles(
        rs_wm2      = meteo["rs_total_wm2"] / 12,
        vpd         = meteo["vpd_max_kpa"],
        t_max       = meteo["t_max"]
    )

    # Ajustement Chergui
    if meteo["t_max"] > 35 and meteo["vpd_max_kpa"] > 2.5:
        nb_cycles = min(nb_cycles + 2, 16)

    # ── Étape 7 : Volume par cycle ────────────────────────────
    volume_par_cycle = round(volume_data["volume_total_l_ha"] / nb_cycles, 1)

    # ── Étape 8 : Heure de démarrage ─────────────────────────
    heure_info = calculer_heure_demarrage(meteo, stade)

    # ── Étape 9 : Calcul NPK ─────────────────────────────────
    ec_cible = get_ec_cible_stade(stade)
    engrais  = calculer_dose_engrais(ec_cible, ec_eau_brute, volume_par_cycle, stade)

    # ── Étape 10 : Correction pH ─────────────────────────────
    ph_corr = corriger_ph(ph_mesure=6.8, volume_cycle_l=volume_par_cycle)

    # ── Étape 11 : Calcul RadS seuil par cycle ────────────────
    rs_total_jcm2  = meteo["rs_total_wm2"] * 0.036
    rads_seuil     = round(rs_total_jcm2 / nb_cycles, 1)

    # ── Résultat final ────────────────────────────────────────
    logger.success(
        f"Recommandation generee | Stade={stade} | "
        f"Cycles={nb_cycles} | Vol={volume_data['volume_total_l_ha']} L/ha | "
        f"Demarrage={heure_info['heure']}"
    )

    return {
        "statut"           : "OK",
        "date"             : date.today().isoformat(),
        "genere_a"         : datetime.now().strftime("%H:%M:%S"),

        # Scénario
        "scenario"         : scenario["scenario"],
        "scenario_message" : scenario["message"],

        # Heure démarrage
        "heure_demarrage"  : heure_info["heure"],
        "heure_raison"     : heure_info["raison"],

        # Cycles
        "nb_cycles"        : nb_cycles,
        "duree_cycle_min"  : round(volume_par_cycle / 2.5, 1),
        "pause_min"        : 40,
        "rads_seuil_jcm2"  : rads_seuil,

        # Volumes
        "volume_total_l_ha": volume_data["volume_total_l_ha"],
        "volume_par_cycle_l": volume_par_cycle,

        # Calculs agronomiques
        "stade"            : stade,
        "kc"               : get_kc_stade(stade),
        "et0_mm"           : et0,
        "etc_mm"           : volume_data["etc_mm"],
        "fl"               : volume_data["fl"],
        "ec_eau_brute"     : ec_eau_brute,

        # Fertigation
        "ec_cible"         : ec_cible,
        "engrais"          : engrais,
        "correction_ph"    : ph_corr,

        # Météo utilisée
        "meteo"            : {
            "source"       : meteo["source"],
            "date"         : meteo["date"],
            "rs_total_wm2" : meteo["rs_total_wm2"],
            "t_max"        : meteo["t_max"],
            "t_moy"        : meteo["t_moy"],
            "hr_moy"       : meteo["hr_moy"],
            "pluie_mm"     : meteo["pluie_mm"],
            "vpd_max_kpa"  : meteo["vpd_max_kpa"],
            "brouillard"   : meteo["brouillard"],
        },

        # Détails FAO-56
        "fao56_details"    : et0_result,
    }