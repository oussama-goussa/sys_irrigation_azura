# ============================================================
# services/ec_ph.py — Regulation EC et pH
# Projet Azura Irrigation — GOUSSA Oussama
# ============================================================

from loguru import logger


def calculer_dose_engrais(
    ec_cible: float,       # dS/m EC voulu
    ec_eau_brute: float,   # dS/m EC eau Azura avant engrais
    volume_cycle_l: float, # L volume du cycle
    stade: str             # stade phenologique
) -> dict:
    """
    Calcule la dose d'engrais pour chaque canal Netafim
    Basé sur : EC_a_ajouter = EC_cible - EC_eau_brute
               1 g/L ≈ 0.1 dS/m
    """

    # EC a ajouter par les engrais
    ec_a_ajouter = max(0, ec_cible - ec_eau_brute)

    # Concentration engrais necessaire (g/L)
    concentration_g_l = ec_a_ajouter / 0.1

    # Dose totale engrais (g)
    dose_totale_g = concentration_g_l * volume_cycle_l

    # Ratios canaux Netafim selon stade
    ratios = {
        "vegetatif"    : {"KNO3": 0.45, "Ca_NO3": 0.30, "MgSO4": 0.15, "K2SO4": 0.10},
        "developpement": {"KNO3": 0.43, "Ca_NO3": 0.32, "MgSO4": 0.15, "K2SO4": 0.10},
        "floraison"    : {"KNO3": 0.42, "Ca_NO3": 0.33, "MgSO4": 0.15, "K2SO4": 0.10},
        "grossissement": {"KNO3": 0.38, "Ca_NO3": 0.32, "MgSO4": 0.15, "K2SO4": 0.15},
        "recolte"      : {"KNO3": 0.35, "Ca_NO3": 0.28, "MgSO4": 0.17, "K2SO4": 0.20}
    }

    r = ratios.get(stade.lower(), ratios["floraison"])

    doses_canaux = {
        "canal_A_KNO3_g"   : round(dose_totale_g * r["KNO3"], 1),
        "canal_B_Ca_NO3_g" : round(dose_totale_g * r["Ca_NO3"], 1),
        "canal_C_MgSO4_g"  : round(dose_totale_g * r["MgSO4"], 1),
        "canal_D_K2SO4_g"  : round(dose_totale_g * r["K2SO4"], 1)
    }

    logger.info(
        f"Dose engrais : total={dose_totale_g:.0f}g | "
        f"EC_ajout={ec_a_ajouter:.1f} dS/m | Volume={volume_cycle_l}L"
    )

    return {
        "ec_cible"            : ec_cible,
        "ec_eau_brute"        : ec_eau_brute,
        "ec_a_ajouter"        : round(ec_a_ajouter, 2),
        "concentration_g_l"   : round(concentration_g_l, 1),
        "dose_totale_g"       : round(dose_totale_g, 0),
        "doses_canaux"        : doses_canaux,
        "stade"               : stade
    }


def corriger_ph(
    ph_mesure: float,      # pH mesure actuel
    volume_cycle_l: float  # L volume du cycle
) -> dict:
    """
    Calcule la dose de correction pH
    Plage optimale tomate cerise : 5.8 - 6.2
    """
    pH_cible = 6.0
    volume_m3 = volume_cycle_l / 1000

    if ph_mesure > 6.5:
        # Trop basique → acide HNO3 ou H3PO4
        delta = ph_mesure - pH_cible
        dose_ml = round(delta * 15 * volume_m3, 1)
        return {
            "action"    : "AJOUTER_ACIDE",
            "produit"   : "HNO3 ou H3PO4",
            "dose_ml"   : dose_ml,
            "ph_mesure" : ph_mesure,
            "ph_cible"  : pH_cible,
            "message"   : f"pH {ph_mesure} trop basique → {dose_ml}ml acide"
        }

    elif ph_mesure < 5.5:
        # Trop acide → base KOH
        delta = pH_cible - ph_mesure
        dose_ml = round(delta * 10 * volume_m3, 1)
        return {
            "action"    : "AJOUTER_BASE",
            "produit"   : "KOH",
            "dose_ml"   : dose_ml,
            "ph_mesure" : ph_mesure,
            "ph_cible"  : pH_cible,
            "message"   : f"pH {ph_mesure} trop acide → {dose_ml}ml base KOH"
        }

    else:
        return {
            "action"    : "AUCUNE_CORRECTION",
            "produit"   : None,
            "dose_ml"   : 0,
            "ph_mesure" : ph_mesure,
            "ph_cible"  : pH_cible,
            "message"   : f"pH {ph_mesure} optimal ✓"
        }


def ajuster_cycle_suivant(
    ec_drain_reel: float,    # EC drain mesure apres cycle
    pct_drainage_reel: float,# % drainage mesure apres cycle
    volume_actuel_l: float,  # volume donne ce cycle
    ec_drain_cible: float    # EC drain cible selon stade
) -> dict:
    """
    Boucle adaptative : ajuste le cycle suivant
    selon les mesures reelles du cycle precedent
    """
    ajustements = []

    # ── Ajustement selon EC drain ──
    ratio_ec = ec_drain_reel / ec_drain_cible if ec_drain_cible > 0 else 1.0

    if ratio_ec > 1.3:
        facteur_npk = 0.80
        ajustements.append(f"EC drain {ec_drain_reel} > seuil x1.3 → NPK -20%")
    elif ratio_ec > 1.1:
        facteur_npk = 0.90
        ajustements.append(f"EC drain {ec_drain_reel} > seuil x1.1 → NPK -10%")
    elif ratio_ec < 0.7:
        facteur_npk = 1.20
        ajustements.append(f"EC drain {ec_drain_reel} < seuil x0.7 → NPK +20%")
    elif ratio_ec < 0.9:
        facteur_npk = 1.10
        ajustements.append(f"EC drain {ec_drain_reel} < seuil x0.9 → NPK +10%")
    else:
        facteur_npk = 1.00
        ajustements.append(f"EC drain {ec_drain_reel} optimal ✓")

    # ── Ajustement selon drainage ──
    if pct_drainage_reel < 10:
        facteur_volume = 1.20
        continuer = True
        ajustements.append(f"Drainage {pct_drainage_reel}% < 10% → Volume +20%")
    elif pct_drainage_reel < 20:
        facteur_volume = 1.10
        continuer = True
        ajustements.append(f"Drainage {pct_drainage_reel}% < 20% → Volume +10%")
    elif pct_drainage_reel <= 30:
        facteur_volume = 1.00
        continuer = True
        ajustements.append(f"Drainage {pct_drainage_reel}% optimal ✓")
    elif pct_drainage_reel <= 40:
        facteur_volume = 0.90
        continuer = True
        ajustements.append(f"Drainage {pct_drainage_reel}% > 30% → Volume -10%")
    else:
        facteur_volume = 0.80
        continuer = False
        ajustements.append(f"Drainage {pct_drainage_reel}% > 40% → Volume -20%")

    nouveau_volume = round(volume_actuel_l * facteur_volume, 1)

    logger.info(f"Ajustement cycle suivant : {ajustements}")

    return {
        "continuer"       : continuer,
        "facteur_volume"  : facteur_volume,
        "facteur_npk"     : facteur_npk,
        "nouveau_volume_l": nouveau_volume,
        "ajustements"     : ajustements,
        "ec_drain_reel"   : ec_drain_reel,
        "pct_drainage_reel": pct_drainage_reel
    }
