"""
╔══════════════════════════════════════════════════════════════════════════════╗
║   MOTEUR D'OPTIMISATION AGRONOMIQUE — TOMATE CERISE / AGADIR  v6.2          ║
║   Groupe Azura — Serre plastique hors-sol — Souss-Massa, Maroc              ║
║   MODÈLE ADAPTATIF — Stratégie drainage 3 phases basée sur données terrain ║
╠══════════════════════════════════════════════════════════════════════════════╣
║  DOUBLE MODÈLE ML :                                                          ║
║                                                                              ║
║  1. RECOMMANDATION MATIN (avant 07h00)                                      ║
║     → Prédire EC, pH, nb_cycles_estimé, heure départ                        ║
║     → Features : météo du jour, stade, EC bassin, drainage J-1              ║
║     → Label : opt_* calculés par agronomie FAO-56 / INRA                    ║
║                                                                              ║
║  2. DÉCISION TOUR PAR TOUR — "continuer après ce tour ?"                    ║
║     → Prédire CONTINUER / STOP_OPTIMAL / STOP_URGENCE_* à chaque tour      ║
║     → Features : état substrat en temps réel après chaque tour              ║
║     → Label : opt_label_sequentiel — règles agronomiques §6 rapport Azura   ║
║                                                                              ║
║  PRINCIPE : Labels générés par physique agronomique pure                    ║
║             ≠ apprentissage sur décisions humaines potentiellement erronées ║
║                                                                              ║
║  ARCHITECTURE 3 PASSES (v4.0) :                                             ║
║   Pass 1 (léger)   : ET0 → ETc → nb_cycles → duree_base  (par ligne)       ║
║   Redistribution   : budget_total → _duree_cycle_cible    (par groupe)      ║
║   Pass 2 (complet) : optimiser_ligne avec _duree_cycle_cible                ║
║   → Garantit Σ(opt_duree_min) ≈ budget_total (fermeture boucle volume)     ║
║                                                                              ║
║  SOURCES SCIENTIFIQUES :                                                     ║
║   • FAO-56 Penman-Monteith (Allen et al. 1998) — ET0                        ║
║   • INRA Maroc / Wifaya et al. 2019 — Kc tomate cerise Agadir               ║
║   • Netafim NetaJet 4G — Programmation EC et pH (NPK auto par NetaJet)      ║
║   • Gieling (2001) — Contrôle feedforward+feedback substrat hors-sol       ║
║   • Van Vosselen et al. (2005) — Water content tomate hors-sol             ║
║   • Rapport Azura §4.2 — 7 scénarios météo | §6.1-6.2 boucle adaptative    ║
╠══════════════════════════════════════════════════════════════════════════════╣
║  COLONNES GÉNÉRÉES (préfixe opt_) :                                         ║
║   Stade phénologique, Kc, ET0, ETc, FL, Volume/cycle,                       ║
║   EC cible, pH cible, RadS seuil,                                           ║
║   opt_duree_min      — durée optimale float (ML + redistribution interne)   ║
║   opt_duree_min_int  — durée entière À PROGRAMMER sur NetaJet 4G ← NOUVEAU ║
║   opt_duree_base_min — durée base (redistribution ou FAO-56)                ║
║   opt_duree_redistrib_cible — cible avant feedback Gieling   ← NOUVEAU     ║
║   opt_duree_facteur  — facteur correction feedback (Gieling 2001)           ║
║   opt_duree_mode     — FEEDBACK_REDISTRIB / REDISTRIB / BASE_FAO / BORNE_* ║
║   opt_PRT_pct        — % réssuyage dry-back calculé [MODULE 14]             ║
║   opt_PRT_decision   — DECLENCHER/ATTENDRE/STRESS_HYDRIQUE/ERREUR           ║
║   opt_PRT_zone       — STANDARD/BROUILLARD_NUAGEUX/CHERGUI/PLUIE            ║
║   opt_PRT_seuil_bas  — seuil bas scénario (%) — doc PDF Azura               ║
║   opt_PRT_seuil_haut — seuil haut scénario (%) — doc PDF Azura              ║
║   opt_PRT_retard_min — minutes d'attente estimées si ATTENDRE (Gieling)     ║
║   opt_PRT_confiance  — HIGH/MEDIUM/LOW selon source de la mesure            ║
║   opt_label_matin    — label modèle 1 (recommandation matin)                ║
║   opt_label_sequentiel — label modèle 2 (décision tour par tour)            ║
║   opt_label_qualite  — compatibilité v1 (conservé)                          ║
╠══════════════════════════════════════════════════════════════════════════════╣
║  Usage :                                                                     ║
║    pip install pandas numpy tqdm                                             ║
║    python optimisation_irrigation_agadir_v4.py                              ║
║  Entrée  : irrigation_meteo_complet.csv                                      ║
║  Sortie  : irrigation_meteo_optimise.csv  (prêt pour entraînement ML)       ║
╚══════════════════════════════════════════════════════════════════════════════╝
"""

import pandas as pd
import numpy as np
from pathlib import Path
from tqdm import tqdm
import math as _math

# ════════════════════════════════════════════════════════════════
# CONFIGURATION
# ════════════════════════════════════════════════════════════════

INPUT_FILE  = "irrigation_meteo_complet.csv"
OUTPUT_FILE = "irrigation_meteo_optimise.csv"

# ════════════════════════════════════════════════════════════════
# CHANGELOG v5.1 — CORRECTIONS SANTÉ PLANTE COCO + ALIGNEMENT HUMAIN
# ════════════════════════════════════════════════════════════════
# Analyse croisée code vs patterns humains CSV 4 saisons (21 971 lignes) :
#
# [BUG 1] EC drain maturation : 4.50 → 3.80 dS/m
#     Risque : stress salin sévère, blossom end rot en coco
#     Justification : coco CEC + EC élevée = accumulation sels dans bloc
#
# [BUG 2] EC nuit froide : +20% → -15% (0.85×)
#     Risque : brûlure racinaire, Pythium (racines froides = absorber MOINS)
#     Inversion complète : il faut diluer, pas concentrer
#
# [BUG 3] EC nuageux chaud : +15% → +8% (1.08×)
#     Risque : accumulation sels progressive (transpiration modérée)
#
# [BUG 4] FL (lessivage) : 0.30 → 0.20 en coco
#     Risque : carence Ca/Mg induite (coco retient nutriments par CEC)
#
# [PATTERN 1] Facteur saisonnier EC (nouveau)
#     Hiver +15%, Printemps -10%, Été -5%, Automne +5%
#     Source : corrélation saison/EC dans CSV 2021-2025
#
# [PATTERN 2] Corrélation EC ↔ nb_cycles (nouveau)
#     Plus de tours → EC réduite, moins de tours → EC augmentée
#     r = -0.57 dans données terrain
#
# [PATTERN 3] Chergui cycles : 10→12 (végétatif), 12→14 (autres)
#     Aligné sur médiane humaine (15 tours Chergui)
#
# [BUG 5] Durée max absolue : 20→14 min (v5.1)
#     Risque : saturation coco, asphyxie racinaire, drainage excessif
#     Justification : coco 10L, capacité champ 85%, drainage 20-30%
#     Durée max humaine observée ≈ 15 min (tour 1)
#
# [PATTERN 4] Calibration budget : facteur 0.67 (v5.1)
#     Ratio humain/théorique = 90/135 ≈ 0.67
#     Causes : pertes de charge, effet bord serre, sous-estimation ET0
#     Appliqué au budget total AVANT redistribution
#
# [PATTERN 5] Profil durée recalibré (v5.1)
#     Base cible ≈ 10 min (après calibration)
#     Facteurs recalibrés pour médianes humaines absolues
#
# [v5.1b] DUREE_MIN_ABS : 6→4 min (humain descend à 4 min en fin de journée)
# [v5.1c] Redistribution uniforme (sans cumul humain) — évite la boucle perverse
# [v5.1d] Budget ref = médiane du groupe (pas tour 1 atypique v_apport=250cc)
# [v5.1e] BUDGET_CALIBRATION = 1.2 — aligne budget médian sur ~96 min (vs 90 min humain)
# [v5.1f] Seuil feedback Gieling : 0.2% → 5% — évite facteurs extrêmes début journée
#
# [v5.2c] Facteur coco ADAPTATIF (remplace le 1.40× fixe) :
#     Jour normal/frais (Tmax ≤ 30°C) : 1.10× FAO → rec ≈ 3.2 mm/jour (économie 21%)
#     Jour chaud (Tmax > 30°C ou scénario chaud) : 1.25× FAO → rec ≈ 4.5 mm/jour
#     Scénarios chauds : 1_TRES_ENSOLEILLE, 5b_FOG_CHAUD_VPD, 5c_FOG_CHAUD_RS,
#                        6_CHERGUI_URGENT, 8_NUAGEUX_CHAUD
#     Justification : Carmassi 2007, Raviv 2008 — coco rétention 15-20% vs sol 40-60%
#     Fonction facteur_coco_adaptatif(scenario, T_max_C) → 1.10 ou 1.25
# ════════════════════════════════════════════════════════════════

# Paramètres station Agadir — Belfaa
LAT           = 30.105        # degrés Nord
ALTITUDE      = 50            # mètres
PRESSION_KPA  = 100.8         # kPa (altitude Agadir, constante)
GAMMA         = 0.000665 * PRESSION_KPA  # constante psychrométrique kPa/°C ≈ 0.0671

# Paramètres serre plastique monochappe Azura
TAU_SERRE     = 0.82          # (serre plastique monochappe ventilée Agadir — Wifaya et al. 2019)
IE_GOUTTE     = 0.92          # efficience goutte-à-goutte NetaJet 4G

# Densité plantation
DENSITE_PLANTES_M2 = 3.0      # plantes/m²

# ════════════════════════════════════════════════════════════════
# MODULE 1 — STADE PHÉNOLOGIQUE
# Déduction du stade à partir des jours depuis plantation
# Plantation typique : 1er septembre de chaque saison
# ════════════════════════════════════════════════════════════════

# Date de plantation par saison (format AAAA_AAAA)
DATES_PLANTATION = {
    "2021_2022": pd.Timestamp("2021-09-20"),
    "2022_2023": pd.Timestamp("2022-09-18"),
    "2023_2024": pd.Timestamp("2023-09-19"),
    "2024_2025": pd.Timestamp("2024-09-24"),
}

# Stades phénologiques — Tableau 7 rapport Azura / INRA Maroc
# Structure : (seuil_jours, nom, Kc_mid, EC_cible_dSm)
# Note : L'opérateur programme EC et pH sur le NetaJet 4G.
#        Le NetaJet gère automatiquement l'injection NPK et la correction pH.
#        Pas de calcul de canaux/ratios/solutions nutritives ici.
STADES = [
    {
        "nom":         "Végétatif",
        "j_debut":     0,
        "j_fin":       30,
        "Kc":          0.475,        # milieu 0.45-0.50
        "EC_cible":    1.80,         # dS/m — Tableau 12
        "EC_drain_cible": 3.00,      # 1.80 × 1.65
        "pH_cible":    6.0,
    },
    {
        "nom":         "Développement",
        "j_debut":     31,
        "j_fin":       60,
        "Kc":          0.75,         # milieu 0.70-0.80
        "EC_cible":    2.10,
        "EC_drain_cible": 3.50,      # 2.10 × 1.65
        "pH_cible":    6.0,
    },
    {
        "nom":         "Floraison",
        "j_debut":     61,
        "j_fin":       90,
        "Kc":          1.125,        # milieu 1.10-1.15
        "EC_cible":    2.30,
        "EC_drain_cible": 3.80,      # 2.30 × 1.65
        "pH_cible":    6.0,
    },
    {
        "nom":         "Grossissement",
        "j_debut":     91,
        "j_fin":       120,
        "Kc":          1.075,        # milieu 1.05-1.10
        "EC_cible":    2.75,
        "EC_drain_cible": 4.20,      # 2.75 × 1.53 (données terrain median=4.5)
        "pH_cible":    5.9,
    },
    {
        "nom":         "Maturation",
        "j_debut":     121,
        "j_fin":       300,
        "Kc":          0.875,        # milieu 0.85-0.90
        "EC_cible":    2.80,
        "EC_drain_cible": 3.80,      # CORRECTION v5.0 : 4.50 → 3.80 (coco + maturation = risque stress salin/BER)
        "pH_cible":    6.0,
    },
]

def get_stade(jours_depuis_plantation: int) -> dict:
    """Retourne le dict du stade phénologique selon les jours depuis plantation."""
    for s in STADES:
        if s["j_debut"] <= jours_depuis_plantation <= s["j_fin"]:
            return s
    # Par défaut : maturation si > 300 jours
    return STADES[-1]


# ════════════════════════════════════════════════════════════════
# MODULE 2 — ET0 PENMAN-MONTEITH FAO-56
# Source : Allen et al. (1998) — équation standard
# ════════════════════════════════════════════════════════════════

def calc_et0_penman_monteith(
    T_mean_C: float,
    T_max_C: float,
    T_min_C: float,
    HR_mean_pct: float,
    Rs_MJ_m2: float,
    u2_ms: float,
    pression_kPa: float = PRESSION_KPA,
    lat_deg: float = LAT,
    doy: int = 180,
) -> float:
    """
    ET0 Penman-Monteith FAO-56 (mm/jour).
    
    Paramètres
    ----------
    T_mean_C     : température moyenne journalière (°C)
    T_max_C      : température maximale journalière (°C)
    T_min_C      : température minimale journalière (°C)
    HR_mean_pct  : humidité relative moyenne (%)
    Rs_MJ_m2     : rayonnement solaire incident (MJ/m²/jour)
    u2_ms        : vitesse du vent à 2 m (m/s)
    
    Retourne
    --------
    ET0 en mm/jour (float, >= 0)
    """
    # Garde-fous valeurs manquantes ou aberrantes
    if any(pd.isna(v) for v in [T_mean_C, T_max_C, T_min_C, HR_mean_pct, Rs_MJ_m2, u2_ms]):
        return np.nan
    T_mean_C   = float(T_mean_C)
    T_max_C    = float(T_max_C)
    T_min_C    = float(T_min_C)
    HR_mean_pct = max(5.0, min(100.0, float(HR_mean_pct)))
    Rs_MJ_m2   = max(0.0, float(Rs_MJ_m2))
    u2_ms      = max(0.5, float(u2_ms))   # min 0.5 m/s (FAO-56 recommandation)

    # Étape 1 — Pression vapeur saturante (kPa)
    # es = moyenne sur T_max et T_min (FAO-56 eq. 12)
    es_max = 0.6108 * np.exp(17.27 * T_max_C / (T_max_C + 237.3))
    es_min = 0.6108 * np.exp(17.27 * T_min_C / (T_min_C + 237.3))
    es     = (es_max + es_min) / 2.0

    # Étape 2 — Pression vapeur réelle (kPa)
    ea = es * HR_mean_pct / 100.0

    # Étape 3 — Pente courbe pression vapeur Δ (kPa/°C)
    es_mean = 0.6108 * np.exp(17.27 * T_mean_C / (T_mean_C + 237.3))
    delta   = 4098.0 * es_mean / (T_mean_C + 237.3) ** 2

    # Étape 4 — Constante psychrométrique γ (kPa/°C)
    gamma = 0.000665 * pression_kPa

    # Étape 5 — Rayonnement net Rn (MJ/m²/jour)
    # Rns = rayonnement net ondes courtes
    alpha = 0.23   # albédo végétation (FAO-56)
    Rns   = (1.0 - alpha) * Rs_MJ_m2

    # Rso = rayonnement ciel clair — FAO-56 eq. 37 + Ra calculé depuis latitude/jour julien
    # Ra (rayonnement extraterrestre) FAO-56 eq. 21 — varie chaque jour de l'année
    J       = doy if 'doy' in dir() else 180   # jour julien — passé en paramètre ci-dessous
    phi     = lat_deg * _math.pi / 180           # latitude en radians
    delta_sol   = 0.409 * _math.sin(2 * _math.pi / 365 * J - 1.39)   # déclinaison solaire
    dr      = 1 + 0.033 * _math.cos(2 * _math.pi / 365 * J)      # distance relative Terre-Soleil
    ws      = _math.acos(max(-1.0, min(1.0, -_math.tan(phi) * _math.tan(delta_sol))))  # angle horaire
    Ra      = (24 * 60 / _math.pi) * 0.082 * dr * (
                ws * _math.sin(phi) * _math.sin(delta_sol)
                + _math.cos(phi) * _math.cos(delta_sol) * _math.sin(ws)
            )   # MJ/m²/jour — FAO-56 eq. 21
    Rso          = (0.75 + 2e-5 * ALTITUDE) * Ra   # FAO-56 eq. 37
    Rs_Rso_ratio = min(1.0, Rs_MJ_m2 / max(Rso, 0.1))

    # Rnl = rayonnement net ondes longues (Stefan-Boltzmann)
    T_max_K = T_max_C + 273.16
    T_min_K = T_min_C + 273.16
    sigma   = 4.903e-9  # MJ/m²/K⁴/jour
    Rnl     = sigma * ((T_max_K**4 + T_min_K**4) / 2.0) \
              * (0.34 - 0.14 * np.sqrt(max(ea, 0.001))) \
              * (1.35 * Rs_Rso_ratio - 0.35)

    Rn = Rns - Rnl
    G  = 0.0  # flux chaleur sol = 0 (journalier, FAO-56)

    # Étape 6 — ET0 Penman-Monteith FAO-56 (mm/jour)
    numerateur   = (0.408 * delta * (Rn - G)
                    + gamma * (900.0 / (T_mean_C + 273.0)) * u2_ms * (es - ea))
    denominateur = delta + gamma * (1.0 + 0.34 * u2_ms)

    ET0 = numerateur / denominateur
    return max(0.0, round(ET0, 3))


def calc_et0_stanghellini(
    Rn_MJ_m2: float,        # rayonnement net serre (MJ/m²/jour) = Rs × TAU_SERRE × (1-albedo)
    T_mean_C: float,         # température moyenne (°C)
    HR_mean_pct: float,      # humidité relative (%)
    LAI: float,              # indice foliaire (m²/m²) — selon stade
    u_ms: float = 0.1,       # vitesse vent INTRA-serre (m/s) — typ. 0.05-0.20 m/s
    pression_kPa: float = PRESSION_KPA,
) -> float:
    """
    ET0 Stanghellini (1987) — modèle serre plastique.
    Source : Stanghellini C. (1987) — Wifaya et al. 2019 (INRA Maroc, Souss-Massa).
    Validé sur tomate cerise serre monochappe/canarienne Agadir.

    Formule simplifiée (Stanghellini 1987, eq. 5.3) :
        ET_ST = (Δ × Rn + ρ_air × Cp × VPD / r_a) / (λ × (Δ + γ × (1 + r_s/r_a)))

    Paramètres internes :
        r_a  : résistance aérodynamique (s/m)  = 220 / (LAI × u)
        r_s  : résistance stomatique (s/m)     = r_s_min / LAI (typique 70-200 s/m)
        ρ_air: densité air sec (kg/m³)         ≈ 1.2
        Cp   : chaleur spécifique air (J/kg/K) = 1013
        λ    : chaleur latente vaporisation    = 2.45 MJ/kg

    Retourne ET_ST en mm/jour.
    """
    if any(pd.isna(v) for v in [Rn_MJ_m2, T_mean_C, HR_mean_pct, LAI]):
        return np.nan

    LAI  = max(0.1, float(LAI))
    u_ms = max(0.05, float(u_ms))

    # Pression vapeur
    es   = 0.6108 * np.exp(17.27 * T_mean_C / (T_mean_C + 237.3))
    ea   = es * HR_mean_pct / 100.0
    VPD  = max(0.0, es - ea)

    # Pente courbe pression vapeur (kPa/°C)
    delta = 4098.0 * es / (T_mean_C + 237.3) ** 2

    # Constante psychrométrique
    gamma = 0.000665 * pression_kPa

    # Résistances (s/m)
    r_a = 220.0 / (LAI * u_ms)        # aérodynamique serre (Stanghellini 1987)
    r_s = 82.0 / LAI                   # stomatique minimale tomate = 82 s/m (Stanghellini)

    # Constantes air
    rho_air = 1.2        # kg/m³
    Cp      = 1013.0     # J/kg/K
    lambda_ = 2.45e6     # J/kg  (était 2.45 MJ/kg — sans conversion ×1e6 dans dénominateur)

    # Conversion en unités SI cohérentes
    Rn_W     = Rn_MJ_m2 * 1e6 / 86400.0   # W/m²  (était Rn_J = Rn_MJ_m2 * 1e6 — erreur d'unité)
    delta_Pa = delta * 1000.0              # Pa/K  (delta était en kPa/°C)
    gamma_Pa = gamma * 1000.0              # Pa/K  (gamma était en kPa/°C)
    VPD_Pa   = VPD * 1000.0               # Pa    (VPD était en kPa)

    # Formule Stanghellini — toutes unités SI (W/m², Pa, J/kg, s/m)
    numerateur   = delta_Pa * Rn_W + (rho_air * Cp * VPD_Pa / r_a)
    denominateur = lambda_ * (delta_Pa + gamma_Pa * (1.0 + r_s / r_a))

    ET_ST_kg_m2_s = numerateur / denominateur   # kg/(m²·s) = mm/s
    ET_ST_mm_jour = ET_ST_kg_m2_s * 86400.0     # mm/jour  (était × 86400 × 1000 — doublon ×1000)

    return max(0.0, round(ET_ST_mm_jour, 3))


# LAI par stade (Wifaya et al. 2019 — INRA Souss-Massa, tomate cerise serre)
LAI_PAR_STADE = {
    "Végétatif":     1.5,    # J0-J30 — jeune plant
    "Développement": 2.5,    # J31-J60
    "Floraison":     3.2,    # J61-J90 — LAI max
    "Grossissement": 3.0,    # J91-J120
    "Maturation":    2.5,    # J121+ — effeuillaison progressive
}

# ════════════════════════════════════════════════════════════════
# MODULE 3 — FRACTION DE LESSIVAGE FL
# Source : Tableau 8 rapport Azura / FAO-56
# ════════════════════════════════════════════════════════════════

def calc_FL(ec_bassin_dSm: float, scenario: str = "") -> float:
    if pd.isna(ec_bassin_dSm):
        ec_bassin_dSm = 0.8

    if scenario in ("6_CHERGUI_URGENT", "5b_FOG_CHAUD_VPD", "8_NUAGEUX_CHAUD") or ec_bassin_dSm >= 3.0:
        return 0.20   # CORRECTION v5.0 : 0.30 → 0.20 (coco retient nutriments par CEC → moins de lessivage nécessaire)
    elif scenario in ("5e_FOG_FROID", "9_NUIT_FROIDE_SOL"):
        return 0.15 if ec_bassin_dSm < 0.5 else 0.18   # transpiration très réduite
    elif ec_bassin_dSm >= 2.0:
        return 0.25
    elif ec_bassin_dSm >= 0.5:
        return 0.20
    else:
        return 0.15


# ════════════════════════════════════════════════════════════════
# MODULE 4 — NOMBRE DE CYCLES OPTIMAUX
# Source : Tableau 9 rapport Azura §4.2
# ════════════════════════════════════════════════════════════════

SCENARIO_CYCLES = {
    "1_TRES_ENSOLEILLE":  13,
    "2_ENSOLEILLE":       11,
    "3_NUAGEUX":           8,
    "4_TRES_NUAGEUX":      5,
    # CORRECTION v4.1 : calibré sur données terrain CSV 4 saisons (2021-2025)
    # Avant : 3 cycles (valeur rapport Azura pour brouillard PERSISTANT toute la journée)
    # Après : 8 cycles (médiane terrain réelle — brouillard classique Agadir se dissipe
    #         avant 10h dans 65% des jours classifiés BROUILLARD_MATIN)
    # Analyse : 537 jours BROUILLARD_MATIN, médiane humains=8 tours, ancien opt=3 → gap -5 tours
    "5_BROUILLARD_MATIN":  8,
    "5b_FOG_CHAUD_VPD":   10,   # dissipe vite + VPD fort l'après-midi → 10 cycles (terrain: 11)
    "5c_FOG_CHAUD_RS":     9,   # soleil fort après levée → 9 cycles (terrain: 10)
    "5d_FOG_RADIATION":   10,   # se lève tôt, Rs perce → 10-11 cycles (terrain: 11)
    "5e_FOG_FROID":        4,   # persiste longtemps, HR haute → 4 cycles max (terrain: 8)
    "6_CHERGUI_URGENT":   12,   # Limiter saturation coco
    "7_PLUIE_STOP":        3,   # Serre coco : même sous pluie il faut maintien hydrique minimum
    "8_NUAGEUX_CHAUD":     9,   # Rs modéré + chaleur + VPD — terrain médiane 9
    "9_NUIT_FROIDE_SOL":   7,   # nuit froide + racines froides — terrain médiane 7
}

# ─── Facteur de réduction cycles SERRE (v5.3) ──────────────────────────────
# Justification scientifique :
#   Les valeurs SCENARIO_CYCLES ci-dessus sont calibrées sur les données
#   humaines terrain (médiane). Or l'humain fait TROP de cycles (gaspillage).
#
#   En serre plastique (منزل شبكي) + substrat coco :
#     - TAU_SERRE = 0.82 → rayonnement réduit de 18%
#     - Humidité plus élevée → VPD réduite → transpiration réduite
#     - Vent nul → pas de perte par convection
#     - Coco : rétention 15-20% (vs sol 40-60%) → besoin de cycles plus espacés
#
#   Littérature :
#     - Carmassi et al. (2007) : serre coco = 4-8 cycles/jour suffisent
#     - Raviv et al. (2008) : réduire 30-40% vs plein champ
#     - Urrestarazu et al. (2008) : serre = cycles moins fréquents mais plus longs
#
#   Application :
#     - FACTEUR_REDUCTION_SERRE = 0.6 → réduit les cycles de 40%
#     - Volume total JOURNALIER reste le même (apport_total_mm inchangé)
#     - Chaque cycle est PLUS LONG (même volume, moins de cycles)
#     - Économie : moins de démarrages pompe, moins d'usure, moins d'évaporation
FACTEUR_REDUCTION_SERRE = 0.6

# ─── Plafond de cycles par stade phénologique ──────────────────────────────
# Les jeunes plants (Végétatif) ont un système racinaire limité :
# trop de cycles = asphyxie racinaire + maladies fongiques (botrytis)
# Source : INRA Maroc / Azura pratiques terrain Agadir
STADE_MAX_CYCLES = {
    "Végétatif":     5,    # J0-J30  — jeunes plants, racines non développées
    # CORRECTION v4.1 : 9 → 11 (terrain médiane développement = 10 tours,
    # plafond précédent bloquait les journées ensoleillées de fin octobre)
    "Développement": 11,   # J31-J60 — enracinement en cours
    "Floraison":    14,    # J61-J90 — pleine demande, pas de plafond limitant
    "Grossissement": 14,   # J91-J120
    "Maturation":   12,    # J121+   — légère réduction fin cycle
}

# ─── Sous-périodes dans le stade Végétatif ─────────────────────────────────
# Première semaine après plantation : le plant est en reprise racinaire
# → cycles très courts et peu nombreux pour éviter l'asphyxie
def get_max_cycles_vegetatif(jours: int) -> int:
    """
    Retourne le plafond de cycles pour les sous-périodes du stade Végétatif.
    
    J0-J7   : reprise racinaire — max 2 cycles (humidification douce)
    J8-J14  : début enracinement — max 3 cycles
    J15-J30 : végétatif normal  — max 5 cycles
    """
    if jours <= 7:
        return 4
    elif jours <= 14:
        return 5
    else:
        return 6

SCENARIO_HEURE = {
    "1_TRES_ENSOLEILLE":  "07:00",
    "2_ENSOLEILLE":       "08:00",
    "3_NUAGEUX":          "09:00",
    "4_TRES_NUAGEUX":     "09:30",
    "5_BROUILLARD_MATIN": "10:30",   # classique
    "5b_FOG_CHAUD_VPD":   "09:00",   # VPD monte vite → démarrer dès que T monte
    "5c_FOG_CHAUD_RS":    "09:20",   # attendre levée brouillard ~09h
    "5d_FOG_RADIATION":   "08:40",   # se lève tôt → démarrer plus tôt
    "5e_FOG_FROID":       "11:00",   # persiste → attendre 11h minimum
    "6_CHERGUI_URGENT":   "07:00_ALERTE",
    "7_PLUIE_STOP":       "STOP",
    "8_NUAGEUX_CHAUD":   "08:30",   # VPD monte tôt → démarrer avant la chaleur
    "9_NUIT_FROIDE_SOL": "09:30",   # attendre réchauffement sol/racines
}

SCENARIO_EC_AJUST = {
    # Ajustement EC cible selon scénario (facteur multiplicatif)
    # Chergui : EC réduite pour diluer les sels + stress osmotique
    # Brouillard : EC augmentée (plante absorbe moins)
    "1_TRES_ENSOLEILLE":  0.90,
    "2_ENSOLEILLE":       0.95,
    "3_NUAGEUX":          1.05,
    "4_TRES_NUAGEUX":     1.10,
    "5_BROUILLARD_MATIN": 1.15,    # +15% EC classique
    "5b_FOG_CHAUD_VPD":   1.00,    # VPD fort → EC normale (transpiration forte l'après-midi)
    "5c_FOG_CHAUD_RS":    1.05,    # +5% léger
    "5d_FOG_RADIATION":   1.05,    # +5% léger, brouillard court
    "5e_FOG_FROID":       1.20,    # +20% EC — transpiration très réduite toute la journée
    "6_CHERGUI_URGENT":   0.85,
    "7_PLUIE_STOP":       1.00,
    "8_NUAGEUX_CHAUD":   1.08,   # CORRECTION v5.0 : 1.15 → 1.08 (transpiration modérée = accumulation sels si EC trop haute)
    "9_NUIT_FROIDE_SOL": 0.85,   # CORRECTION v5.0 : 1.20 → 0.85 (racines froides = absorber MOINS → EC PLUS BASSE)
}


# ════════════════════════════════════════════════════════════════
# MODULE 4b — FACTEUR SAISONNIER EC (v5.0)
#
# Pattern terrain Azura 4 saisons : l'opérateur ajuste l'EC selon la saison,
# indépendamment du stade phénologique :
#   Hiver (déc-fév)  : EC ÉLEVÉ (2.7-2.9) — absorption racinaire réduite
#   Printemps (mar-mai) : EC BAS (2.0-2.4) — croissance explosive, forte transpiration
#   Été (jun-août)   : EC MODÉRÉ (2.0-2.2) — stress hydrique, dilution
#   Automne (sep-nov) : EC CROISSANT (2.1-2.6) — réduction métabolique
#
# Source : Analyse patterns humains CSV 2021-2025
# ════════════════════════════════════════════════════════════════

EC_SAISON_FACTOR = {
    12: 1.15,   # Décembre — hiver, absorption réduite
    1:  1.15,   # Janvier
    2:  1.10,   # Février — fin hiver
    3:  0.95,   # Mars — printemps, croissance rapide
    4:  0.90,   # Avril
    5:  0.90,   # Mai
    6:  0.95,   # Juin — début été
    7:  1.00,   # Juillet
    8:  1.00,   # Août
    9:  1.00,   # Septembre — début automne
    10: 1.05,   # Octobre
    11: 1.10,   # Novembre
}


def calc_ec_cycles_factor(nb_cycles: int) -> float:
    """
    Facteur de correction EC selon le nombre de cycles (v5.0).

    Pattern terrain : corrélation négative tours/EC (r=-0.57)
      Plus de cycles → chaque cycle apporte moins → EC réduite
      Moins de cycles → chaque cycle apporte plus → EC augmentée

    8 tours = référence (facteur 1.0)
    ±0.02 par tour d'écart
    Borné [0.90, 1.10]
    """
    facteur = 1.0 - (nb_cycles - 8) * 0.02
    return max(0.90, min(1.10, facteur))


# ════════════════════════════════════════════════════════════════
# MODULE 4b — pH DYNAMIQUE (v5.6)
# Source : Sonneveld & Voogt 2009, Urrestarazu 2008, Raviv 2008,
#          Frontiers Plant Sci. 2016, Truleaf/HortBio coco guides
# ════════════════════════════════════════════════════════════════
#
# Le pH d'irrigation n'est PAS constant — il doit varier selon :
#   1. Saison (Agadir) :
#        Hiver (nov-fév) → substrat s'acidifie → pH irrigation HAUT (6.0-6.2)
#        Été (mai-sep)   → transpiration concentre sels → pH irrigation BAS (5.5-5.8)
#   2. Température :
#        T_max > 30°C → concentration racinaire → abaisser pH
#        T_max < 20°C → absorption lente → remonter pH
#   3. pH drainage (feedback substrat) :
#        pH_drain > pH_base + 0.3 → substrat tamponne vers le haut → abaisser pH
#        pH_drain < pH_base - 0.3 → substrat s'acidifie → remonter pH
#   4. Stade phénologique (valeur de base) :
#        Grossissement → 5.9 (Ca/Mg uptake), autres → 6.0
#
# Bornes absolues scientifiques : 5.0 ≤ pH ≤ 7.0
# Fenêtre optimale tomate coco  : 5.5 ≤ pH ≤ 6.5

# Facteur saisonnier pH pour Agadir (Souss-Massa)
# Valeur neutre = 0.0 ; négatif = abaisser pH ; positif = remonter pH
PH_SAISON_OFFSET = {
    12: +0.15,   # Déc — hiver, substrat s'acidifie → pH irrigation haut
    1:  +0.15,   # Jan
    2:  +0.10,   # Fév
    3:  +0.05,   # Mar — printemps, transition
    4:  0.00,    # Avr — neutre
    5:  -0.05,   # Mai — début chaleur
    6:  -0.10,   # Juin — été, transpiration forte
    7:  -0.15,   # Juillet — pic chaleur Agadir
    8:  -0.15,   # Août
    9:  -0.10,   # Sep — fin été
    10: -0.05,   # Oct
    11: +0.10,   # Nov — retour frais
}

# Ajustement température : linéaire par tranche de T_max
# T_max < 20°C → +0.10 (substrat froid, absorption lente)
# T_max 20-30°C → 0.00 (neutre)
# T_max 30-35°C → -0.10 (concentration racinaire)
# T_max > 35°C → -0.20 (stress thermique, forte concentration)
PH_TEMP_OFFSET_RANGES = [
    (20.0,  0.10),   # en dessous de 20°C
    (30.0,  0.00),   # 20-30°C
    (35.0, -0.10),   # 30-35°C
    (99.0, -0.20),   # > 35°C
]

# Seuils feedback drainage pH
PH_DRAIN_SEUIL_HAUT  = +0.4   # pH drain dépasse irrigation de +0.4 → substrat monte
PH_DRAIN_SEUIL_BAS   = -0.4   # pH drain sous irrigation de -0.4 → substrat descend
PH_DRAIN_MAX_CORR    = 0.15   # correction max par feedback drainage (±0.15)


def calc_ph_cible(
    ph_base: float,
    mois: int,
    t_max: float | None,
    ph_drain_prev: float | None,
) -> float:
    """
    Calcule le pH d'irrigation dynamique (v5.6).

    Algorithme :
      pH = pH_base(stade)
         + offset_saisonnier(mois Agadir)
         + offset_temperature(T_max)
         + feedback_drainage(pH_drain_prev - pH_base)

    Borné à [5.0, 7.0] (limites absolues) puis arrondi à 0.1.

    Paramètres
    ----------
    ph_base : float
        pH de référence du stade (depuis STADES, ex: 6.0 ou 5.9).
    mois : int
        Mois de l'année (1-12).
    t_max : float ou None
        Température maximale du jour (°C).
    ph_drain_prev : float ou None
        pH du drainage mesuré au tour précédent (J-1 ou tour N-1).

    Retour
    -------
    float
        pH cible arrondi à 0.1 (ex: 5.7, 6.1).
    """
    # 1. Valeur de base par stade
    ph = float(ph_base)

    # 2. Ajustement saisonnier (Agadir)
    ph += PH_SAISON_OFFSET.get(mois, 0.0)

    # 3. Ajustement température
    if t_max is not None and not pd.isna(t_max):
        t = float(t_max)
        for seuil, offset in PH_TEMP_OFFSET_RANGES:
            if t < seuil:
                ph += offset
                break

    # 4. Feedback drainage pH (Gieling 2001 — feedback substrat)
    if ph_drain_prev is not None and not pd.isna(ph_drain_prev):
        ecart = float(ph_drain_prev) - float(ph_base)
        if ecart > PH_DRAIN_SEUIL_HAUT:
            # Substrat tamponne vers le haut → abaisser pH irrigation
            correction = -min(PH_DRAIN_MAX_CORR, (ecart - PH_DRAIN_SEUIL_HAUT) * 0.5)
            ph += correction
        elif ecart < PH_DRAIN_SEUIL_BAS:
            # Substrat s'acidifie → remonter pH irrigation
            correction = min(PH_DRAIN_MAX_CORR, (PH_DRAIN_SEUIL_BAS - ecart) * 0.5)
            ph += correction

    # 5. Bornes absolues scientifiques
    ph = max(5.0, min(7.0, ph))

    # 6. Arrondi à 0.1 (précision injecteur)
    return round(ph, 1)


# ════════════════════════════════════════════════════════════════
# MODULE 5 — BOUCLE ADAPTATIVE CYCLE PAR CYCLE
# Source : §6.1 drainage, §6.2 régulation EC drain
#
# v6.0 — MODÈLE ADAPTATIF BASÉ SUR LA STRATÉGIE OPÉRATEUR
# ════════════════════════════════════════════════════════════════
#
# PRINCIPE : Le drainage cible n'est PAS fixe. Il varie selon :
#   1. Temperature (Tmax) — plus chaud = plus de drainage nécessaire
#   2. EC drainage/apport — si accumulation sels = plus de drainage
#   3. Position dans la journée (phase 1/2/3)
#   4. Scenario météo (Chergui, Brouillard, etc.)
#
# FORMULE VOLUME ADAPTATIVE :
#   V = ETc / (1 - drainage_cible)
#   → drainage_cible = 30% → V = ETc / 0.70 = 1.43 × ETc
#   → drainage_cible = 40% → V = ETc / 0.60 = 1.67 × ETc
#   → drainage_cible = 20% → V = ETc / 0.80 = 1.25 × ETc
#
# STRATÉGIE 3 PHASES (alignée sur opérateur Azura) :
#   Phase 1 (tours 1-3) : Remplissage substrat, gros volumes, repos 15-20min
#                         Drainage → 0-10% (normal, substrat sec après nuit)
#   Phase 2 (tours 4-6) : Augmentation drainage, volumes réduits, repos 9-12min
#                         Drainage → monte vers cible (30-45% selon T°)
#   Phase 3 (tours 7+)  : Réduction drainage via repos croissant (16→22→27→31min)
#                         Drainage → diminue vers ~20%
#   Stop               : Volume cible OU drainage < 15% OU nb_tours = max_stade
#
# SOURCES : Analyse CSV Azura 4 saisons (2021-2025) | §6.1 rapport Azura
# ════════════════════════════════════════════════════════════════

# ── Table de drainage cible selon Tmax (°C) ──────────────────────────
# Basé sur l'analyse des données opérateur Azura 4 saisons :
#   Tmax < 18°C  → froid   → drainage 30% (moins de transpiration, risque asphyxie)
#   18-22°C      → frais   → drainage 33%
#   22-27°C      → moyen   → drainage 37%
#   27-32°C      → chaud   → drainage 40%
#   32-37°C      → très chaud → drainage 43%
#   > 37°C       → extrême → drainage 45% (Chergui, stress thermique)
DRAINAGE_CIBLE_TMAX = [
    (18.0, 0.30),
    (22.0, 0.33),
    (27.0, 0.37),
    (32.0, 0.40),
    (37.0, 0.43),
    (99.0, 0.45),
]


def compute_drainage_cible_base(tmax: float) -> float:
    """
    Drainage cible de base selon la température maximale.
    Utilise une interpolation linéaire entre les paliers.
    """
    if tmax is None or pd.isna(tmax):
        return 0.35  # valeur par défaut
    tmax = float(tmax)
    for seuil, drainage in DRAINAGE_CIBLE_TMAX:
        if tmax < seuil:
            return drainage
    return 0.45


def compute_drainage_cible_ajuste(
    base: float,
    ec_apport: float,
    ec_drain: float,
    scenario: str,
    drain_prev_pct: float,
    num_tour: int,
    nbr_tours_total: int,
) -> float:
    """
    Ajuste le drainage cible selon EC, scénario, position dans la journée.

    Règles EC :
      EC_drain/EC_apport > 2.0 → +10% drainage (accumulation sels sévère)
      EC_drain/EC_apport > 1.5 → +7%  drainage (accumulation modérée)
      EC_drain/EC_apport > 1.2 → +4%  drainage (début accumulation)

    Règles position (3 phases) :
      Phase 1 (tours 1-3) : cible réduite (substrat se remplit)
      Phase 2 (tours 4-6) : cible pleine (montée vers target)
      Phase 3 (tours 7+)  : cible réduite progressivement (descente vers 20%)

    Règles scénario :
      Chergui → +5% drainage
      Brouillard → -5% drainage (substrat déjà humide)
    """
    cible = base

    # Ajustement EC
    if (not pd.isna(ec_drain) and not pd.isna(ec_apport)
            and ec_apport > 0 and ec_drain > 0):
        ratio = ec_drain / ec_apport
        if ratio > 2.0:
            cible += 0.10
        elif ratio > 1.5:
            cible += 0.07
        elif ratio > 1.2:
            cible += 0.04

    # Ajustement scénario
    if scenario == "6_CHERGUI_URGENT":
        cible += 0.05
    elif scenario in ("5_BROUILLARD_MATIN", "5e_FOG_FROID", "4_TRES_NUAGEUX"):
        cible -= 0.05

    # Ajustement position (3 phases)
    if num_tour <= 3:
        # Phase 1 : substrat se remplit, drainage encore faible = normal
        cible *= 0.70  # réduire la cible (on n'attend pas encore 30-40%)
    elif num_tour <= 6:
        # Phase 2 : montée vers cible pleine
        cible *= 1.00  # cible pleine
    else:
        # Phase 3 : réduction progressive vers ~20%
        # Plus on avance dans la journée, plus on réduit la cible
        tours_depuis_7 = num_tour - 6
        reduction = min(0.15, tours_depuis_7 * 0.03)  # -3% par tour après tour 7
        cible -= reduction

    # Bornes absolues
    return max(0.15, min(0.50, cible))


# ── K_scenario : multiplicateur volume/ETc dérivé de l'analyse humaine (v6.2) ──
# L'opérateur humain applique V = ETc × K où K varie selon le scénario météo.
# K = 3.0× à 4.7× selon les conditions (moyenne 3.84×).
# Ceci reflète : besoins de lessivage (sels Agadir), remplissage substrat coco,
# et stratégie multi-tours (7-15 tours/jour).
# Calibré sur les médianes humaines pour éviter les biais des extrêmes.
K_SCENARIO_VOLUME = {
    "1_TRES_ENSOLEILLE":  3.20,
    "2_ENSOLEILLE":        4.00,
    "3_NUAGEUX":           3.70,
    "4_TRES_NUAGEUX":      5.50,
    "5_BROUILLARD_MATIN":  4.00,
    "5b_FOG_CHAUD_VPD":    3.10,
    "5c_FOG_CHAUD_RS":     3.00,
    "5d_FOG_RADIATION":    3.60,
    "5e_FOG_FROID":        3.70,
    "6_CHERGUI_URGENT":    3.80,
    "7_PLUIE_STOP":        4.00,  # humain K≈4.0-5.5 (nom trompeur, ne s'arrête jamais)
    "7b_PLUIE_LEGERE":     3.90,
    "8_NUAGEUX_CHAUD":     3.70,
    "9_NUIT_FROIDE_SOL":   3.80,
}

# ── K_stade : facteur correctif selon le stade phénologique (v6.2) ──
# Le même scénario météo ne produit pas le même volume selon le stade :
#   - Pépinière (Végétatif) : plants petits, racines peu développées → moins d'eau
#   - Floraison/Grossissement : pleine demande → K normal
#   - Maturation : réduction volontaire (qualité fruit, économie d'eau) → K réduit
#
# Calibré sur l'analyse des volumes humains par stade :
#   Végétatif     : humain K=4.87, mais litérature dit 3-5 → facteur 0.75
#   Développement : humain K=5.24, litérature 5-8 → facteur 0.85
#   Floraison     : humain K=3.40, litérature 7-12 → facteur 1.00 (référence)
#   Grossissement : humain K=3.38, litérature 8-15 → facteur 1.00 (référence)
#   Maturation    : humain K=3.58, litérature 5-10 → facteur 0.70
K_STADE_FACTOR = {
    "Végétatif":     0.75,   # pépinière : réduire de 25%
    "Développement": 0.85,   # début cycle : réduire de 15%
    "Floraison":     1.00,   # référence : pas de correction
    "Grossissement": 1.00,   # référence : pas de correction
    "Maturation":    0.70,   # fin cycle : réduire de 30%
}


def compute_volume_adaptatif(etc_mm: float, scenario: str, tmax: float,
                              stade: str = "", ec_apport: float = 0,
                              ec_drain: float = 0) -> float:
    """
    Volume adaptatif v6.2 : V = ETc × K_scenario × K_stade × f(T°) × f(EC)

    Dérivé de l'analyse des volumes humains réels :
      - L'humain applique 3.0× à 4.7× ETc selon le scénario
      - K_scenario reflète lessivage + substrat coco + multi-tours
      - K_stade ajuste selon le stade phénologique (pépinière ↓, maturation ↓)
      - f(T°) : léger ajustement température
      - f(EC) : si EC_drain >> EC_apport → plus de lessivage nécessaire

    Paramètres
    ----------
    etc_mm : ETc en mm/jour
    scenario : scénario météo
    tmax : température maximale (°C)
    stade : stade phénologique (Végétatif, Floraison, etc.)
    ec_apport, ec_drain : EC pour ajustement lessivage

    Retourne
    --------
    Volume en mm/jour
    """
    if etc_mm is None or etc_mm <= 0:
        return 0.0

    # K de base selon scénario
    k = K_SCENARIO_VOLUME.get(scenario, 3.50)

    # K_stade : ajustement selon le stade phénologique
    k *= K_STADE_FACTOR.get(stade, 1.00)

    # Ajustement température : l'humain donne proportionnellement plus quand ETc est faible
    # Froid (<18°C) : ETc bas mais lessivage minimum nécessaire → K plus élevé
    # Chaud (>35°C) : besoin accru → K légèrement plus élevé
    if tmax is not None and not pd.isna(tmax):
        tmax = float(tmax)
        if tmax > 35:
            k *= 1.05  # très chaud → +5% volume
        elif tmax < 18:
            k *= 1.10  # froid → ETc bas mais lessivage minimum → +10% K

    # Ajustement EC : si ratio élevé → plus de lessivage
    if ec_apport > 0 and ec_drain > 0:
        ratio = ec_drain / ec_apport
        if ratio > 2.0:
            k *= 1.15  # accumulation sels sévère → +15% volume
        elif ratio > 1.5:
            k *= 1.08
        elif ratio > 1.2:
            k *= 1.03

    return etc_mm * k


def compute_repos_time(
    num_tour: int,
    drain_prev_pct: float,
    drainage_cible: float,
    tmax: float,
) -> int:
    """
    Temps de repos adaptatif — mécanisme de contrôle du drainage.

    Principe : repos COURT → drainage PLUS ÉLEVÉ (substrat reste humide)
              repos LONG   → drainage PLUS FAIBLE (substrat se ressuie)

    Phase 1 (tours 1-3) : repos 15-20 min (laisser le substrat s'imbiber)
    Phase 2 (tours 4-6) : repos 9-12 min (drainage monte vite)
    Phase 3 (tours 7+)  : repos croissant 16→22→27→31 min (drainage descend)

    Ajustement température :
      Tmax > 30°C → repos -3 min (drainage plus rapide nécessaire)
      Tmax < 18°C → repos +3 min (éviter asphyxie)
    """
    if num_tour <= 1:
        repos = 18  # tour 1 : laisser imbiber après nuit
    elif num_tour <= 3:
        repos = 15  # tours 2-3 : phase de remplissage
    elif num_tour <= 6:
        repos = 10  # tours 4-6 : repos court pour monter le drainage
    else:
        # Phase 3 : repos croissant
        tours_depuis_7 = num_tour - 6
        repos = min(31, 16 + (tours_depuis_7 - 1) * 5)  # 16, 21, 26, 31...

    # Ajustement température
    if tmax is not None and not pd.isna(tmax):
        if float(tmax) > 32:
            repos = max(5, repos - 3)
        elif float(tmax) < 18:
            repos = min(35, repos + 3)

    return max(5, min(40, repos))


def calc_ajustement_drainage(
    pct_drainage: float,
    T_max_C: float = None,
    v_drainage_brut=None,
    num_tour: int = 1,
    scenario: str = "",
) -> tuple[float, str]:
    """
    Ajustement volume selon % drainage réel — v6.0 ADAPTATIF.

    Utilise le drainage cible adaptatif (dépend de T°, scénario, position)
    au lieu de seuils fixes.

    Règles :
      - drainage < cible×0.5 → TRES_SEC (substrat très sec, +20-25% volume)
      - drainage < cible×0.8 → INSUFFISANT (+10% volume)
      - drainage dans [cible×0.8, cible×1.2] → OPTIMAL (maintien)
      - drainage > cible×1.2 → LEGER_EXCES (-10% volume)
      - drainage > cible×1.5 ou >45% → EXCES (-20% volume)

    Retourne : (facteur_ajust_volume, label_drainage)
    """
    # Si v_drainage=0 ET pct=0 → donnée manquante, ne pas pénaliser
    if pct_drainage == 0 and (v_drainage_brut is None or v_drainage_brut == 0):
        return 1.00, "INCONNU"

    # Calcul du drainage cible adaptatif
    cible = compute_drainage_cible_ajuste(
        base=compute_drainage_cible_base(T_max_C),
        ec_apport=float("nan"),
        ec_drain=float("nan"),
        scenario=scenario,
        drain_prev_pct=pct_drainage,
        num_tour=num_tour,
        nbr_tours_total=10,
    )
    cible_pct = cible * 100  # convertir en pourcentage

    if pct_drainage < cible_pct * 0.5:
        return 1.25, "TRES_SEC"
    elif pct_drainage < cible_pct * 0.8:
        return 1.10, "INSUFFISANT"
    elif pct_drainage <= cible_pct * 1.2:
        return 1.00, "OPTIMAL"
    elif pct_drainage <= max(cible_pct * 1.5, 45.0):
        return 0.90, "LEGER_EXCES"
    else:
        return 0.80, "EXCES"




# ════════════════════════════════════════════════════════════════
# MODULE 8 — SEUIL RADS PAR CYCLE
# Source : §4.3 rapport Azura — déclenchement cycles par rayonnement
# ════════════════════════════════════════════════════════════════

def calc_rads_seuil(
    rs_total_Jcm2_jour: float,   # ← remplace rs_wm2_max
    nb_cycles: int,
    stade_nom: str,
    scenario: str,
) -> dict:
    """
    Calcule le seuil RadS de déclenchement par cycle (J/cm²).
    Source : §4.3 rapport Azura — Bellouch et al. 2007.

    Formule : RadS_seuil = Rs_total_Jcm2_jour / Nb_cycles
    Rs_total_Jcm2_jour : rayonnement total journalier en J/cm²
                         = meteo_shortwave_radiation_sum (MJ/m²) × 100
                         Déjà calculé dans meteo_rs_total_Jcm2 par fusion_irrigation_meteo_complet.py
    """
    if pd.isna(rs_total_Jcm2_jour) or rs_total_Jcm2_jour <= 0 or nb_cycles == 0:
        return {
            "opt_RadS_seuil_Jcm2": 0.0,
            "opt_rs_total_Jcm2":   0.0,
            "opt_RadS_mode":       "STOP",
        }

    rads_seuil = rs_total_Jcm2_jour / nb_cycles

    # Ajustement par stade (Tableau 10 rapport Azura)
    stade_rads_min = {
        "Végétatif":     50.0,
        "Développement": 70.0,
        "Floraison":    100.0,
        "Grossissement": 90.0,
        "Maturation":    80.0,
    }
    rads_min = stade_rads_min.get(stade_nom, 50.0)

    if scenario == "6_CHERGUI_URGENT":
        rads_seuil = 20.0
        mode = "CHERGUI_IMMEDIAT"
    elif scenario in ("5_BROUILLARD_MATIN", "5e_FOG_FROID"):
        mode = "BLOQUE_HR_MATIN"
    elif rads_seuil < rads_min:
        mode = "SEUIL_MIN_STADE"
        rads_seuil = rads_min
    else:
        mode = "NORMAL"

    return {
        "opt_RadS_seuil_Jcm2": round(rads_seuil, 1),
        "opt_rs_total_Jcm2":   round(rs_total_Jcm2_jour, 1),
        "opt_RadS_mode":        mode,
    }

# ════════════════════════════════════════════════════════════════
# MODULE 9 — LABEL QUALITÉ DÉCISION HUMAINE (conservé v1)
# Comparaison humain vs optimal sur EC et pH uniquement.
# NB : la comparaison nb_tours_humain vs nb_cycles_opt est supprimée
#      car elle génère de faux CRITIQUE (opérateur adapte tour par tour).
#      Utiliser opt_label_sequentiel pour évaluer la logique tour par tour.
# ════════════════════════════════════════════════════════════════

def labelliser_decision(
    ec_apport_humain: float,
    ec_opt: float,
    ph_apport_humain: float,
    ph_opt: float,
    pct_drainage: float,
    scenario: str,
) -> dict:
    """
    Compare la décision humaine sur EC et pH à la cible agronomique.
    N'évalue PAS le nombre de tours (logique séquentielle → opt_label_sequentiel).

    Niveaux :
      OPTIMAL      — EC et pH dans la plage cible (écart < 10%)
      ACCEPTABLE   — écart 10-25%, résultat satisfaisant
      A_CORRIGER   — écart 25-40%, performance dégradée
      CRITIQUE     — écart > 40% ou irrigation pendant pluie
    """
    score = 0.0
    raisons = []

    # ── Écart EC apport (indicateur principal)
    if not pd.isna(ec_apport_humain) and not pd.isna(ec_opt) and ec_opt > 0:
        ecart_ec = abs(ec_apport_humain - ec_opt) / ec_opt
        if ecart_ec > 0.40:
            score += 40
            raisons.append(f"EC_ECART_{ecart_ec:.0%}")
        elif ecart_ec > 0.25:
            score += 25
            raisons.append(f"EC_ECART_{ecart_ec:.0%}")
        elif ecart_ec > 0.10:
            score += 10
            raisons.append(f"EC_ECART_{ecart_ec:.0%}")

    # ── Écart pH apport
    if not pd.isna(ph_apport_humain) and ph_apport_humain > 0:
        ecart_ph = abs(ph_apport_humain - ph_opt)
        if ecart_ph > 0.5:
            score += 20
            raisons.append(f"PH_HORS_PLAGE_{ph_apport_humain:.1f}")
        elif ecart_ph > 0.3:
            score += 10
            raisons.append(f"PH_LIMITE_{ph_apport_humain:.1f}")

    # ── Drainage hors plage cible
    # Plage optimale différenciée : chaud (T>25°C) → 20-40 % | froid → 20-30 %
    if not pd.isna(pct_drainage):
        if pct_drainage > 55 or (pct_drainage < 10 and scenario != "7_PLUIE_STOP"):
            score += 20
            raisons.append(f"DRAINAGE_{pct_drainage:.0f}PCT")
        elif pct_drainage > 40 or pct_drainage < 15:
            score += 10
            raisons.append(f"DRAINAGE_{pct_drainage:.0f}PCT")

    # ── Pluie ignorée (irrigation pendant pluie)
    if scenario == "7_PLUIE_STOP":
        score += 50
        raisons.append("IRRIGATION_SOUS_PLUIE")

    # Classification
    if score == 0:
        label = "OPTIMAL"
    elif score <= 10:
        label = "ACCEPTABLE"
    elif score <= 30:
        label = "A_CORRIGER"
    else:
        label = "CRITIQUE"

    return {
        "opt_label_qualite":   label,
        "opt_score_ecart":     score,
        "opt_raisons_ecart":   "|".join(raisons) if raisons else "OK",
    }


# ════════════════════════════════════════════════════════════════
# MODULE 10 — LABEL SÉQUENTIEL TOUR PAR TOUR (NOUVEAU)
# "Après ce tour-ci, était-il agronomiquement correct de continuer ?"
#
# C'est le label cible pour le MODÈLE 2 : décision temps réel.
# Basé uniquement sur la physique du substrat et les règles §6 Azura.
# NE compare PAS au comportement humain — règles pures.
#
# Labels possibles :
#   CONTINUER         — conditions OK, le tour suivant est justifié
#   STOP_OPTIMAL      — objectif drainage atteint 2 tours consécutifs
#   STOP_VOLUME       — volume journalier cible atteint
#   STOP_EC_URGENCE   — accumulation sels sévère (ratio > 1.3)
#   STOP_HEURE        — heure limite journalière atteinte
#   STOP_PLUIE        — pluie détectée (> 0.5 mm/h)
#   STOP_BROUILLARD   — HR > 90% matin, risque asphyxie
#   STOP_CHERGUI_MAX  — cycles Chergui max atteint
#
# Source règles : §6.1 drainage, §6.2 EC drain, §6.3 arrêt journalier
# ════════════════════════════════════════════════════════════════

# Heure limite irrigation selon saison (approximation mois)
def get_heure_limite(mois: int) -> float:
    """
    Heure limite d'irrigation (décimale, ex: 16.0 = 16h00).
    Hiver (nov-fév) : 16h00 | Eté (mai-sep) : 17h30
    Source : §6.3 rapport Azura.
    """
    if mois in (11, 12, 1, 2):
        return 16.0   # hiver
    elif mois in (3, 4, 10):
        return 17.0   # inter-saison
    else:
        return 17.5   # été (mai-septembre)


def labelliser_tour_sequentiel(
    num_tour: int,
    pct_drainage_ce_tour: float,
    pct_drainage_tour_prec: float,
    ec_drain_ce_tour: float,
    ec_cible_drain: float,
    volume_cumule_L: float,
    volume_journalier_cible_L: float,
    heure_debut_str: str,
    scenario: str,
    mois: int,
    nb_cycles_max_stade: int,
    T_max_C: float = None,
    volume_cumule_avant_tour_L: float = None,
) -> dict:
    """
    Génère le label séquentiel agronomique pour un tour d'irrigation.

    Paramètres
    ----------
    num_tour                : numéro du tour dans la journée (1, 2, 3, ...)
    pct_drainage_ce_tour    : % drainage mesuré à la sortie de CE tour (float)
    pct_drainage_tour_prec  : % drainage du tour précédent (NaN si tour 1)
    ec_drain_ce_tour        : EC drainage mesuré à la sortie de CE tour (dS/m)
    ec_cible_drain          : EC drain cible du stade phénologique (dS/m)
    volume_cumule_L         : volume total apporté depuis le début de journée (L)
    volume_journalier_cible_L : volume journalier optimal calculé FAO-56 (L)
    heure_debut_str         : heure de début de CE tour (ex: "14:30")
    scenario                : scénario météo classifié (ex: "6_CHERGUI_URGENT")
    mois                    : mois de la date (1-12)
    nb_cycles_max_stade     : plafond de tours pour ce stade (ex: 5 végétatif)

    Retourne
    --------
    dict avec opt_label_sequentiel, opt_raison_stop, opt_continuer (0/1)
    """
    raison = "OK"

    # ── Priorité 1 : arrêt immédiat pluie (§6.3)
    if scenario == "7_PLUIE_STOP":
        return {
            "opt_label_sequentiel": "STOP_PLUIE",
            "opt_raison_stop":      "pluie_detectee_>0.5mm",
            "opt_continuer":        0,
        }

    # ── Priorité 2 : accumulation sels sévère (§6.2)
    if not pd.isna(ec_drain_ce_tour) and not pd.isna(ec_cible_drain) and ec_cible_drain > 0:
        ratio_ec = ec_drain_ce_tour / ec_cible_drain
        seuil_ec = 1.50 if scenario == "9_NUIT_FROIDE_SOL" else 1.30
        if ratio_ec > seuil_ec:
            return {
                "opt_label_sequentiel": "STOP_EC_URGENCE",
                "opt_raison_stop":      f"EC_drain/EC_cible={ratio_ec:.2f}>{seuil_ec}_stress_salin",
                "opt_continuer":        0,
            }

    # ── Priorité 3 : heure limite journalière (§6.3)
    heure_limite = get_heure_limite(mois)
    heure_dec = np.nan
    if isinstance(heure_debut_str, str) and ":" in str(heure_debut_str):
        try:
            parts = str(heure_debut_str).strip().split(":")
            heure_dec = float(parts[0]) + float(parts[1]) / 60.0
        except Exception:
            heure_dec = np.nan

    if not np.isnan(heure_dec) and heure_dec >= heure_limite:
        return {
            "opt_label_sequentiel": "STOP_HEURE",
            "opt_raison_stop":      f"heure_{heure_dec:.1f}h>=limite_{heure_limite}h",
            "opt_continuer":        0,
        }

    # Priorité 4 : brouillard — tous les sous-types bloquent tour 1 avant levée
    FOG_SCENARIOS = {
        "5_BROUILLARD_MATIN": 11.0,   # bloquer jusqu'à 11h classique
        "5b_FOG_CHAUD_VPD":    9.0,   # levée rapide
        "5c_FOG_CHAUD_RS":     9.5,
        "5d_FOG_RADIATION":    8.75,  # 08h45
        "5e_FOG_FROID":       11.5,   # 11h30 minimum
    }
    if scenario in FOG_SCENARIOS and not np.isnan(heure_dec) and heure_dec < FOG_SCENARIOS[scenario] and num_tour == 1:
        return {
            "opt_label_sequentiel": "STOP_BROUILLARD",
            "opt_raison_stop":      f"{scenario}_HR>90pct_retard_jusqu_{FOG_SCENARIOS[scenario]}h",
            "opt_continuer":        0,
        }

    # ── Priorité 5 : plafond max cycles du stade
    if num_tour > nb_cycles_max_stade:
        if scenario == "6_CHERGUI_URGENT":
            # Chergui : on tolère le dépassement si drainage insuffisant
            pass  # → vérification drainage ci-dessous prévaudra
        else:
            return {
                "opt_label_sequentiel": "STOP_CHERGUI_MAX" if scenario == "6_CHERGUI_URGENT" else "STOP_VOLUME",
                "opt_raison_stop":      f"nb_tours_{num_tour}>=max_stade_{nb_cycles_max_stade}",
                "opt_continuer":        0,
            }

    # ── Priorité 6 : volume journalier cible atteint (§6.3)
    # v5.9 : utilise volume_cumule_avant_tour_L (cumul AVANT ce tour) pour décider.
    #   Le volume_cumule_L inclut le tour en cours → ratio artificiellement élevé.
    #   En utilisant le cumul avant tour, le STOP se déclenche à 95% de la cible,
    #   ce qui donne au ML un signal plus précoce et plus précis.
    vol_check = volume_cumule_avant_tour_L if (volume_cumule_avant_tour_L is not None and not pd.isna(volume_cumule_avant_tour_L)) else volume_cumule_L
    if (not pd.isna(vol_check) and not pd.isna(volume_journalier_cible_L)
            and volume_journalier_cible_L > 0
            and vol_check >= volume_journalier_cible_L * 0.95):
        # Sauf si drainage insuffisant (substrat trop sec malgré le volume)
        drain_ok = (not pd.isna(pct_drainage_ce_tour) and pct_drainage_ce_tour >= 15.0)
        if drain_ok:
            return {
                "opt_label_sequentiel": "STOP_VOLUME",
                "opt_raison_stop":      f"volume_cumule_{vol_check:.0f}L>=cible_{volume_journalier_cible_L:.0f}L",
                "opt_continuer":        0,
            }

    # ── Priorité 7 : STOP_OPTIMAL — logique ADAPTATIVE basée sur le drainage cible
    #
    # v6.0 — SEUILS ADAPTATIFS selon température et position dans la journée
    #
    # Les seuils de stop ne sont PLUS fixes. Ils s'adaptent à :
    #   1. La température (Tmax) → cible plus haute en journée chaude
    #   2. La position (num_tour) → cible réduite en phase 3 (tours 7+)
    #   3. Le scénario (Chergui, Brouillard, etc.)
    #
    # Stratégie 3 phases :
    #   Phase 1 (tours 1-3) : on ne stop PAS (substrat se remplit)
    #   Phase 2 (tours 4-6) : stop si drainage dans la plage cible ET stable/baisse
    #   Phase 3 (tours 7+)  : stop si drainage descend vers 20%
    #
    # SOURCES : Analyse trajectoires CSV Azura 2021-2025 | §6.1 rapport Azura
    # ─────────────────────────────────────────────────────────────────────────

    # Calcul du drainage cible adaptatif pour CE tour
    ec_apport_lab = float("nan")  # pas disponible ici, NaN = ignoré
    ec_drain_lab = ec_drain_ce_tour if not pd.isna(ec_drain_ce_tour) else float("nan")
    drainage_cible_tour = compute_drainage_cible_ajuste(
        base=compute_drainage_cible_base(T_max_C),
        ec_apport=ec_apport_lab,
        ec_drain=ec_drain_lab,
        scenario=scenario,
        drain_prev_pct=pct_drainage_tour_prec,
        num_tour=num_tour,
        nbr_tours_total=nb_cycles_max_stade,
    )

    # Seuils adaptatifs basés sur le drainage cible
    # Phase 1 : pas de stop (tours 1-3 toujours CONTINUER pour remplir substrat)
    # Phase 2 : stop si drainage dans la plage cible ET tendance baisse/stable
    # Phase 3 : stop si drainage < cible (en descente vers 20%)
    #
    # v6.1 — Plages STOP_OPTIMAL adaptées à la température :
    #   Jour chaud  (drainage_cible ≥ 40%, Tmax ≥ ~32°C) : 45-50%
    #   Jour froid  (drainage_cible < 40%, Tmax < ~32°C) : 35-45%
    #   → Un drainage à 40% est "normal" en journée chaude mais "élevé" en journée froide.
    #     On adapte les seuils pour ne pas arrêter trop tôt quand il fait chaud.
    if drainage_cible_tour >= 0.40:
        # Jour chaud : drainage naturellement plus élevé
        DRAIN_STOP_BAS  = 45.0
        DRAIN_STOP_HAUT = 50.0
    else:
        # Jour froid/standard : drainage plus faible
        DRAIN_STOP_BAS  = 35.0
        DRAIN_STOP_HAUT = 45.0
    DRAIN_HAUT_ABS    = 50.0   # seuil gaspillage absolu (fixe) — aligné sur plage chaude
    DELTA_CONTINUER   = 3.0    # montée minimale pour "encore en montée"

    has_prev = (
        not pd.isna(pct_drainage_tour_prec)
        and float(pct_drainage_tour_prec) > 0.5
    )
    has_curr = (
        not pd.isna(pct_drainage_ce_tour)
        and float(pct_drainage_ce_tour) >= 0
    )

    if has_curr and has_prev:
        d_curr = float(pct_drainage_ce_tour)
        d_prev = float(pct_drainage_tour_prec)
        tendance = d_curr - d_prev   # >0 = monte, <0 = baisse

        # ── Règle 7b : gaspillage absolu → STOP_EXCES
        if d_curr > DRAIN_HAUT_ABS:
            return {
                "opt_label_sequentiel": "STOP_EXCES",
                "opt_raison_stop":      f"drain_{d_curr:.0f}pct_>{DRAIN_HAUT_ABS:.0f}pct_gaspillage",
                "opt_continuer":        0,
            }

        # ── Règle 7c : drainage encore en montée significative → CONTINUER
        # La plante absorbe encore activement, substrat pas à saturation de drainage
        if tendance > DELTA_CONTINUER:
            diag = [f"drain_{d_curr:.0f}pct_monte_{tendance:+.0f}pct_vs_prev_{d_prev:.0f}pct"]
            if not pd.isna(volume_cumule_L) and volume_journalier_cible_L > 0:
                pct_vol = volume_cumule_L / volume_journalier_cible_L * 100
                diag.append(f"vol_{pct_vol:.0f}pct_objectif")
            return {
                "opt_label_sequentiel": "CONTINUER",
                "opt_raison_stop":      "|".join(diag),
                "opt_continuer":        1,
            }

        # ── Règle 7a : drainage dans la plage ET tendance stable/baisse → STOP_OPTIMAL
        # Vérifier EC drain (§6.2)
        ec_drain_ok = True
        if not pd.isna(ec_drain_ce_tour) and not pd.isna(ec_cible_drain) and ec_cible_drain > 0:
            ratio_ec = ec_drain_ce_tour / ec_cible_drain
            ec_drain_ok = 0.90 <= ratio_ec <= 1.10

        if DRAIN_STOP_BAS <= d_curr <= DRAIN_STOP_HAUT and ec_drain_ok:
            tendance_str = "stabilise" if abs(tendance) <= DELTA_CONTINUER else f"baisse_{tendance:.0f}pct"
            return {
                "opt_label_sequentiel": "STOP_OPTIMAL",
                "opt_raison_stop":      f"drain_{d_curr:.0f}pct_dans_plage_{tendance_str}_prev_{d_prev:.0f}pct_EC_OK",
                "opt_continuer":        0,
            }

    elif has_curr and not has_prev:
        # Tour 1 — pas de tour précédent, on ne peut pas évaluer la tendance
        # Appliquer juste le seuil haut absolu
        d_curr = float(pct_drainage_ce_tour)
        if d_curr > DRAIN_HAUT_ABS:
            return {
                "opt_label_sequentiel": "STOP_EXCES",
                "opt_raison_stop":      f"drain_{d_curr:.0f}pct_>{DRAIN_HAUT_ABS:.0f}pct_tour1",
                "opt_continuer":        0,
            }

    # ── Sinon : CONTINUER
    diag = []
    if has_curr:
        d_curr = float(pct_drainage_ce_tour)
        if d_curr < 15:
            diag.append(f"drain_{d_curr:.0f}pct_<15_substrat_sec")
        elif d_curr < DRAIN_STOP_BAS:
            diag.append(f"drain_{d_curr:.0f}pct_<{DRAIN_STOP_BAS:.0f}_pas_encore_plage")
        else:
            diag.append(f"drain_{d_curr:.0f}pct_en_montee_active")

    if not pd.isna(volume_cumule_L) and not pd.isna(volume_journalier_cible_L) and volume_journalier_cible_L > 0:
        pct_vol = volume_cumule_L / volume_journalier_cible_L * 100
        diag.append(f"vol_{pct_vol:.0f}pct_objectif")

    return {
        "opt_label_sequentiel": "CONTINUER",
        "opt_raison_stop":      "|".join(diag) if diag else "conditions_OK",
        "opt_continuer":        1,
    }


# ════════════════════════════════════════════════════════════════
# MODULE 11 — LABEL MATIN (NOUVEAU)
# Label de qualité spécifique au MODÈLE 1 : recommandation matin.
# Évalue si les paramètres programmés en début de journée
# (EC, pH) correspondent aux cibles agronomiques du jour.
# Ne juge PAS les décisions intra-journalières.
# ════════════════════════════════════════════════════════════════

def labelliser_recommandation_matin(
    ec_apport_humain: float,
    ec_opt: float,
    ph_apport_humain: float,
    ph_opt: float,
    scenario: str,
) -> dict:
    """
    Évalue la qualité de la programmation matin (EC et pH uniquement).
    C'est le label cible du MODÈLE 1.

    Niveaux :
      MATIN_OPTIMAL    — EC et pH dans la plage (écart < 10%)
      MATIN_ACCEPTABLE — écart 10-25%
      MATIN_A_CORRIGER — écart 25-40%
      MATIN_CRITIQUE   — écart > 40% ou pluie ignorée
    """
    score = 0.0
    raisons = []

    # EC programmé vs EC optimal du stade
    if not pd.isna(ec_apport_humain) and not pd.isna(ec_opt) and ec_opt > 0:
        ecart_ec = abs(ec_apport_humain - ec_opt) / ec_opt
        if ecart_ec > 0.40:
            score += 40; raisons.append(f"EC_ECART_{ecart_ec:.0%}")
        elif ecart_ec > 0.25:
            score += 25; raisons.append(f"EC_ECART_{ecart_ec:.0%}")
        elif ecart_ec > 0.10:
            score += 10; raisons.append(f"EC_ECART_{ecart_ec:.0%}")

    # pH programmé vs pH optimal
    if not pd.isna(ph_apport_humain) and ph_apport_humain > 0:
        ecart_ph = abs(ph_apport_humain - ph_opt)
        if ecart_ph > 0.5:
            score += 20; raisons.append(f"PH_HORS_PLAGE_{ph_apport_humain:.1f}")
        elif ecart_ph > 0.3:
            score += 10; raisons.append(f"PH_LIMITE_{ph_apport_humain:.1f}")

    # Pluie ignorée — irrigation programmée malgré la pluie
    if scenario == "7_PLUIE_STOP":
        score += 50; raisons.append("PLUIE_IGNOREE")

    if score == 0:
        label = "MATIN_OPTIMAL"
    elif score <= 10:
        label = "MATIN_ACCEPTABLE"
    elif score <= 30:
        label = "MATIN_A_CORRIGER"
    else:
        label = "MATIN_CRITIQUE"

    return {
        "opt_label_matin":        label,
        "opt_score_matin":        score,
        "opt_raisons_matin":      "|".join(raisons) if raisons else "OK",
    }


# ════════════════════════════════════════════════════════════════
# MODULE 12 — CONVERSIONS VOLUMES (UNITÉS TERRAIN)
#
# IMPORTANT — Unités réelles dans le CSV Azura :
#   v_apport    : cc PAR GOUTTEUR pour ce tour
#                 Formule : (duree_min * 1000) / 60
#                 → 1 goutteur débite 1 L/h = 1000 cc/h = 1000/60 cc/min
#
#   v_drainage  : cc TOTAL mesuré sur les 8 goutteurs d'un bras
#                 → mesure brute du bac de collecte
#
#   pct_drainage : % pour 1 goutteur
#                 Formule JS terrain :
#                   pctDrain = (v_drain / nbr_goutteurs / v_apport) * 100
#                 → v_drain divisé par nbr_goutteurs → ramène à 1 goutteur
#                 → divisé par v_apport (cc/goutteur) → ratio
#
#   total_v_apport : cumul de v_apport (cc/goutteur) sur la journée
#
# Conversions utilisées dans ce script :
#   cc → L  : diviser par 1000
#   cc → mL : 1:1
# ════════════════════════════════════════════════════════════════

# Débit standard goutteur Netafim Azura : 1 L/h = 1000 cc/h
DEBIT_GOUTT_CC_MIN = 1000.0 / 60.0   # cc/min ≈ 16.667 cc/min


def v_apport_cc_par_goutt(duree_min: float) -> float:
    """
    Volume apporté par un goutteur pour une durée donnée (cc).
    Formule terrain Azura : (duree_min * 1000) / 60
    """
    if pd.isna(duree_min) or duree_min <= 0:
        return 0.0
    return (float(duree_min) * 1000.0) / 60.0


def pct_drainage_calcule(
    v_drain_cc_total: float,
    nbr_goutteurs: float,
    v_apport_cc_par_goutt: float,
) -> float:
    """
    Calcule le % de drainage pour 1 goutteur.
    Réplique exacte de la formule JS terrain Azura :
      pctDrain = (v_drain / nbr_goutteurs / v_apport) * 100

    Paramètres
    ----------
    v_drain_cc_total      : cc total mesuré sur tous les goutteurs du bras
    nbr_goutteurs         : nombre de goutteurs du bras (typiquement 8)
    v_apport_cc_par_goutt : cc apportés par 1 goutteur ce tour

    Retourne NaN si l'une des valeurs est invalide.
    """
    if (pd.isna(v_drain_cc_total) or pd.isna(nbr_goutteurs) or pd.isna(v_apport_cc_par_goutt)
            or nbr_goutteurs <= 0 or v_apport_cc_par_goutt <= 0):
        return np.nan
    return (float(v_drain_cc_total) / float(nbr_goutteurs) / float(v_apport_cc_par_goutt)) * 100.0


def calculer_volume_cycle_L(row: pd.Series) -> float:
    """
    Volume apporté ce tour (L) — échelle PAR GOUTTEUR (cohérent avec opt_apport_total_mm).

    Structure physique Azura :
      v_apport (cc/goutteur) / 1000 → litres par goutteur

    Formule :
      v_apport (cc/goutteur) / 1000 → L/goutteur

    Priorité :
      1. v_apport CSV / 1000
      2. Recalcul depuis duree_min si v_apport absent
      3. Fallback 0.166 L (1 goutt × 166 cc = tour type 10 min)
    """
    try:
        v_apport_cc   = float(row.get("v_apport",      0) or 0)   # cc/goutteur
        duree_min     = float(row.get("duree_min",     0) or 0)

        if v_apport_cc > 0:
            # Volume par goutteur = cc/goutt / 1000 → L/goutteur
            return max(0.01, v_apport_cc / 1000.0)

        elif duree_min > 0:
            # Recalcul depuis durée : (duree × 1000/60) / 1000
            v_ap_cc = v_apport_cc_par_goutt(duree_min)
            return max(0.01, v_ap_cc / 1000.0)

        else:
            # Fallback : 1 goutteur × 166 cc (tour type 10 min) / 1000
            return 0.166
    except Exception:
        return 0.166


# ════════════════════════════════════════════════════════════════
# MODULE 13 — DURÉE OPTIMALE DU TOUR (opt_duree_min)  [v4.0 — REDISTRIBUTION]
#
# PROBLÈME v3 : vol_total / nb_cycles = cycles ÉGAUX (hypothèse fausse)
#   → feedback Gieling dérive librement → Σ(duree) ≠ budget agronomique
#
# SOLUTION v4 : redistribution dynamique du budget restant
#   Budget total (min) = duree_base_tour1 × nb_cycles_opt
#   À chaque cycle N   : cible_N = budget_restant / cycles_restants
#   Puis feedback Gieling par-dessus la cible redistribuée
#   → Σ(opt_duree_min) ≈ budget_total  (écart < 5%)
#
# ARCHITECTURE 3 PASSES :
#   Pass 1 (léger)   : ET0 → ETc → nb_cycles → duree_base  (par ligne)
#   Redistribution   : budget_total → _duree_cycle_cible    (par groupe)
#   Pass 2 (complet) : optimiser_ligne avec _duree_cycle_cible
#
# NOTE NETAJET : le float calculé sert au ML et à la redistribution interne.
#   La consigne envoyée au contrôleur = int(round(opt_duree_min)) minutes.
#   L'arrondi est compensé automatiquement par le feedback du cycle suivant.
#
# SOURCES :
#   Gieling T.H. (2001) — Sensors and control in horticulture. IMAG/WUR.
#   Van Vosselen et al. (2005) — Biosystems Engineering 89(2), 145-157.
#   Rapport Azura §6.1 — Tableau 14 ajustement volume drainage.
# ════════════════════════════════════════════════════════════════

# Débit goutteur Netafim Azura
DEBIT_GOUTT_L_MIN = 1.0 / 60.0   # 1 L/h = 1/60 L/min ≈ 0.01667 L/min

# Cible drainage optimal (milieu 20-30 %)
# CORRECTION v5.4 : 25% → 30% pour substrat coco
#   Justification : en coco, le drainage optimal est 25-35% (pas 20-25% comme le sol)
#   - Sol : rétention 40-60% → drainage 20-25% optimal
#   - Coco : rétention 15-20% → drainage 25-35% optimal (Raviv 2008, Carmassi 2007)
#   - Humain tours 6-10 : drainage médian = 35.7% → le coco fonctionne bien à ce niveau
#   - Avec 25% : le Gieling réduit trop les durées (facteur 0.66-0.75)
#   - Avec 30% : le Gieling est plus doux (facteur 0.80-0.95) → durées plus réalistes
PCT_DRAIN_CIBLE = 30.0

# Bornes feedback — ne pas corriger de plus de ±30 % d'un tour à l'autre
FEEDBACK_FACTEUR_MIN = 0.85   # v5.5 : resserré (table drainage fait l'essentiel)
FEEDBACK_FACTEUR_MAX = 1.15   # v5.5 : resserré (ajustement fin uniquement)

# Bornes absolues terrain Azura (minutes) — v5.1
#   MIN : 6→4 min (humain descend à 4 min en fin de journée / coco saturé)
#   MAX : 20→14 min (coco coir = saturation si >14 min à 8 L/h)
#     Justification MAX : bloc coco 10L, capacité champ 85%, drainage 20-30%
#       14 min × 8 goutteurs × 1 L/h / 60 = 1.87 L (OK, drainage ~20%)
#       20 min × 8 goutteurs × 1 L/h / 60 = 2.67 L (trop, risque asphyxie)
DUREE_MIN_ABS = 4.0
DUREE_MAX_ABS = 14.0

# Facteur de correction ETc pour substrat coco (v5.2c — ADAPTATIF)
#   Le modèle FAO-56 est calibré pour le SOL, pas le coco.
#   Le coco a une rétention d'eau plus faible → besoin de plus d'eau.
#   MAIS : l'humain gaspille de l'eau (apport > besoin réel plante).
#   Objectif : recommandation OPTIMISÉE < humain pour économiser l'eau,
#   tout en restant suffisante pour la plante (pas de stress hydrique).
#
#   Humain médian = 4.49 mm/jour (mesuré)
#   FAO-56 pur médian = 2.49 mm/jour
#
#   v5.2a : FACTEUR_COCO_ETc = 1.40 → rec = 4.73 mm (= humain, 0% économie) TROP HAUT
#   v5.2b : FACTEUR_COCO_ETc = 1.10 → rec = 3.72 mm (17% < humain) OPTIMISÉ
#   v5.2c : FACTEUR ADAPTATIF selon température/scénario:
#     - Jour normal/frais (Tmax ≤ 30°C) : 1.10× → rec ≈ 3.2 mm/jour (économie 21%)
#     - Jour chaud (Tmax > 30°C, Chergui, Fog chaud) : 1.25× → rec ≈ 4.5 mm/jour
#     Justification scientifique (Carmassi 2007, Raviv 2008, Urrestarazu 2008):
#       Coco = rétention 15-20% vs sol 40-60% → besoin +20-50% en conditions chaudes
#       En journée normale, le FAO×1.10 suffit (économie d'eau)
#       En journée chaude, le FAO×1.25 couvre le besoin réel sans excès
#
#   Scénarios "chauds" : 1_TRES_ENSOLEILLE, 5b_FOG_CHAUD_VPD, 5c_FOG_CHAUD_RS,
#                        6_CHERGUI_URGENT, 8_NUAGEUX_CHAUD
#   Ou simplement Tmax > 30°C (détection automatique)
FACTEUR_COCO_ETc_NORMAL = 1.10   # Jour normal/frais
FACTEUR_COCO_ETc_CHAUD  = 1.20   # Jour chaud (Tmax>30°C ou scénario chaud)
TMAX_SEUIL_CHAUD_C      = 30.0   # Seuil température pour facteur chaud (°C)

# Scénarios considérés comme "chauds" (force le facteur 1.20× au lieu de 1.10×)
#   Ces scénarios ont une forte demande évaporative → besoin de plus d'eau en coco
#   Exclusion de 5b/5c : l'humain y donne déjà beaucoup → facteur 1.10 suffit
SCENARIOS_CHAUDS = {
    "1_TRES_ENSOLEILLE",
    "6_CHERGUI_URGENT",
    "8_NUAGEUX_CHAUD",
}

# Facteur de calibration du budget (v5.1)
#   budget = base_mediane_par_groupe × nb_cycles × BUDGET_CALIBRATION
#   cible_uniforme = budget / nb_cycles = base_mediane × BUDGET_CALIBRATION
#   base_mediane (par groupe) ≈ 9 min
#   Objectif cible_uniforme ≈ 10-11 min → BUDGET_CALIBRATION ≈ 1.11-1.22
#   Avec 1.2 : cible = 10.8 min → tour 1 (profil 1.30) = 14.0 min (OK, ≤14 max)
#                              → tour 5 (profil 0.90) = 9.7 min (≈10 min humain)
#                              → tour 10 (profil 0.86) = 9.3 min (≈8 min humain)
#                              → médiane globale ≈ 10 min (alignée sur humain)
BUDGET_CALIBRATION = 1.2


# ════════════════════════════════════════════════════════════════
# PASS 1 — CALCUL LÉGER DES VOLUMES THÉORIQUES
# But : obtenir duree_base et nb_cycles AVANT la redistribution
# Sans feedback, sans NPK, sans labels — juste ET0 → durée base
# ════════════════════════════════════════════════════════════════

def facteur_coco_adaptatif(scenario: str, T_max_C: float) -> float:
    """
    Retourne le facteur de correction coco adaptatif (v5.2c).
    - Jour chaud (scénario chaud OU Tmax > 30°C) → 1.25×
    - Jour normal/frais                             → 1.10×
    """
    if scenario in SCENARIOS_CHAUDS:
        return FACTEUR_COCO_ETc_CHAUD
    if T_max_C is not None and not pd.isna(T_max_C) and float(T_max_C) > TMAX_SEUIL_CHAUD_C:
        return FACTEUR_COCO_ETc_CHAUD
    return FACTEUR_COCO_ETc_NORMAL


def calc_pass1_theorique(row: pd.Series, date_plantation: pd.Timestamp) -> dict:
    """
    Calcule uniquement les valeurs nécessaires pour le budget de durée.
    Retourne 3 colonnes préfixées _ (colonnes de travail internes, pas opt_).
    """
    # ── Stade
    jours = max(0, (pd.Timestamp(row["date"]) - date_plantation).days)
    stade = get_stade(jours)

    # ── ET0 simplifié (même logique que optimiser_ligne mais sans résultats complets)
    T_mean = float(row.get("meteo_T_mean_C", 20) or 20)
    T_max  = float(row.get("meteo_T_max_C",  25) or 25)
    T_min  = float(row.get("meteo_T_min_C",  15) or 15)
    HR     = float(row.get("meteo_HR_mean_pct", 65) or 65)
    Rs_MJ  = float(row.get("meteo_shortwave_radiation_sum", 15) or 15)
    u2_ms  = max(float(row.get("meteo_vent_mean_kmh", 20) or 20) / 3.6, 0.5)
    doy    = int(pd.Timestamp(row["date"]).day_of_year)

    Rn_serre = Rs_MJ * TAU_SERRE * (1 - 0.23)
    LAI      = LAI_PAR_STADE.get(stade["nom"], 2.5)
    et0      = calc_et0_stanghellini(Rn_serre, T_mean, HR, LAI)
    if pd.isna(et0):
        et0 = calc_et0_penman_monteith(T_mean, T_max, T_min, HR, Rs_MJ, u2_ms, doy=doy)
    et0 = float(et0 or 3.0)

    # ── ETc dynamique réel
    ETc = et0 * stade["Kc"] * TAU_SERRE

    # CORRECTION v5.2c : facteur coco ADAPTATIF (FAO calibré sol, pas coco)
    #   Coco = rétention plus faible → besoin de plus d'eau en chaleur
    #   Jour normal : 1.10× (économie d'eau vs humain)
    #   Jour chaud  : 1.25× (couvre besoin réel coco, littérature Carmassi 2007)
    scenario_p1 = str(row.get("scenario_meteo", "2_ENSOLEILLE") or "2_ENSOLEILLE")
    facteur_coco = facteur_coco_adaptatif(scenario_p1, T_max)
    ETc = ETc * facteur_coco

    # CORRECTION v4.1 : cohérence avec optimiser_ligne (cap 8.0 mm/j)
    ETc = max(0.5, min(8.0, ETc))

    # ── Nb cycles (même logique que optimiser_ligne)
    scenario        = str(row.get("scenario_meteo", "2_ENSOLEILLE") or "2_ENSOLEILLE")
    nb_cycles_meteo = SCENARIO_CYCLES.get(scenario, 8)

    if stade["nom"] == "Végétatif":
        max_cycles = get_max_cycles_vegetatif(jours)
    else:
        max_cycles = STADE_MAX_CYCLES.get(stade["nom"], 14)

    if scenario == "6_CHERGUI_URGENT" and stade["nom"] != "Végétatif":
        nb_cycles = nb_cycles_meteo
    elif scenario == "6_CHERGUI_URGENT" and stade["nom"] == "Végétatif":
        # CORRECTION v4.1 — cohérence avec optimiser_ligne :
        # Chergui+végétatif → cap à 10 (pas au plafond physiologique 4-6)
        nb_cycles = min(nb_cycles_meteo, 10)
    else:
        nb_cycles = min(nb_cycles_meteo, max_cycles)

    # ── Volume terrain et durée base (feedforward pur, sans feedback)
    pluie       = float(row.get("meteo_pluie_mm_jour", 0) or 0)
    vol_cycle_L = calculer_volume_cycle_L(row)
    nbr_goutt   = float(row.get("nbr_goutteurs", 8) or 8)

    if scenario == "7_PLUIE_STOP" and pluie > 12:
        duree_base = 0.0
    else:
        vol_par_goutt = vol_cycle_L / max(nbr_goutt, 1)
        duree_base    = vol_par_goutt / DEBIT_GOUTT_L_MIN
        duree_base    = max(DUREE_MIN_ABS, min(DUREE_MAX_ABS, duree_base))

    return {
        "_nb_cycles_opt":     nb_cycles,
        "_duree_base_min":    round(duree_base, 2),
        "_vol_cycle_local_L": round(vol_cycle_L, 3),
    }


# ════════════════════════════════════════════════════════════════
# REDISTRIBUTION DYNAMIQUE DU BUDGET DE DURÉE
#
# Problème résolu : vol_total / nb_cycles = cycles ÉGAUX (faux)
# Solution        : à chaque cycle, redistribuer le budget restant
#                   sur les cycles restants
#
# Budget total (min) = duree_base_tour1 × nb_cycles_opt
# Restant (min)      = budget_total - Σ(durees tours précédents)
# Cible cycle N      = restant / nb_cycles_restants
#
# Note sur _duree_cumule :
#   On cumule les duree_min du CSV (décisions humaines réelles) comme proxy.
#   Dans un système temps réel on cumulera opt_duree_min.
# ════════════════════════════════════════════════════════════════

def precompute_redistribution(df: pd.DataFrame, GROUP_KEYS: list) -> pd.DataFrame:
    """
    Pré-calcule les colonnes de redistribution dynamique.
    Doit être appelé APRÈS le Pass 1 (colonnes _nb_cycles_opt et _duree_base_min
    doivent exister dans df).

    Colonnes ajoutées :
      _duree_budget_total  : budget total du jour (min) — constant dans le groupe
      _duree_cumule_opt    : durées déjà dépensées avant ce tour (min)
      _duree_restante      : budget restant pour ce tour et les suivants (min)
      _nb_cycles_restants  : nombre de cycles restants (ce tour inclus)
      _duree_cycle_cible   : durée cible redistribuée pour CE cycle (min),
                             avant feedback Gieling
    """
    df = df.copy()

    # ── Budget total = duree_base médiane × nb_cycles_opt × BUDGET_CALIBRATION
    # CORRECTION v5.1e : utiliser la MÉDIANE (pas le tour 1) comme référence
    #   Le tour 1 est atypique (réhydratation coco, v_apport=250cc vs 166cc médian)
    #   → base_ref = 14 min (borné DUREE_MAX_ABS) au lieu de 10 min (médiane réelle)
    #   → budget = 14 × 9 × 0.80 = 100.8 min (trop haut)
    #   Solution : médiane de _duree_base_min du groupe = 10 min (représentatif)
    #   → budget = 10 × 9 × 0.80 = 72 min (cohérent avec humain 90 min)
    #
    # CORRECTION v5.4c : budget arrondi à l'entier (NetaJet travaille en minutes entières)
    #   Un budget de 96.3 min → 96 min (le NetaJet ne peut pas faire 0.3 min)
    #   L'erreur d'arrondi du budget (~0.5 min) est absorbée par le dernier tour
    def budget_du_groupe(groupe):
        base_ref   = float(groupe["_duree_base_min"].median())
        cycles_ref = int(groupe["_nb_cycles_opt"].median())
        budget     = int(round(base_ref * cycles_ref * BUDGET_CALIBRATION))  # ← entier NetaJet
        return pd.Series([budget] * len(groupe), index=groupe.index)

    df["_duree_budget_total"] = (
        df.groupby(GROUP_KEYS, group_keys=False)
          .apply(budget_du_groupe)
          .squeeze()
    )

    # ── Durée cible de base (uniforme) = budget / nb_cycles
    # CORRECTION v5.1 : redistribution UNIFORME (pas de cumul humain)
    #   L'ancien cumul sur duree_min créait une boucle perverse :
    #   le budget restant chutait trop vite car l'humain fait des tours
    #   plus longs que le budget calibré en début de journée.
    #   Solution : cible uniforme = budget / nb_cycles, puis le profil
    #   et le feedback Gieling ajustent chaque tour individuellement.
    #
    # v5.4c : le budget est entier, la cible est float (pour le calcul interne)
    #   L'arrondi final se fait dans calc_opt_duree_v2 → opt_duree_min_int
    df["_duree_cycle_cible"] = (
        df["_duree_budget_total"] / df["_nb_cycles_opt"]
    ).clip(lower=DUREE_MIN_ABS, upper=DUREE_MAX_ABS)

    # ── Colonnes de cumul (pour compatibilité, mais non utilisées dans le calcul)
    df["_duree_cumule_opt"] = 0.0
    df["_duree_restante"] = df["_duree_budget_total"]
    df["_nb_cycles_restants"] = df["_nb_cycles_opt"]

    # ── Log rapide
    print(f"    Budget médian par journée      : "
          f"{df.groupby(GROUP_KEYS)['_duree_budget_total'].first().median():.1f} min")
    print(f"    Durée cible redistribuée (méd) : "
          f"{df['_duree_cycle_cible'].median():.1f} min")
    print(f"    Durée base Pass 1 (méd)        : "
          f"{df['_duree_base_min'].median():.1f} min")

    return df


def verifier_coherence_volume(df: pd.DataFrame, GROUP_KEYS: list) -> None:
    """
    Vérifie que Σ(opt_duree_min_int) ≈ _duree_budget_total par groupe.
    v5.4c : utilise opt_duree_min_int (entier NetaJet) pour la vérification,
    car c'est la durée RÉELLEMENT programmée sur le contrôleur.
    L'écart float vs int est tolérable (±0.5 min/cycle) mais doit être tracé.
    """
    print("\n  ── VÉRIFICATION FERMETURE BOUCLE VOLUME ──────────────────────")

    grp = df.groupby(GROUP_KEYS).agg(
        budget_total    = ("_duree_budget_total", "first"),
        somme_opt_duree = ("opt_duree_min", "sum"),        # float (ML / trace)
        somme_opt_int   = ("opt_duree_min_int", "sum"),    # int (NetaJet réel)
        nb_tours_reel   = ("num_tour", "count"),
        nb_cycles_opt   = ("_nb_cycles_opt", "first"),
        scenario        = ("scenario_meteo", "first"),
    ).reset_index()

    # Écart basé sur les ENTIERS (ce qui compte pour le NetaJet)
    grp["ecart_min"] = (grp["somme_opt_int"] - grp["budget_total"]).round(1)
    grp["ecart_pct"] = (
        grp["ecart_min"] / grp["budget_total"].replace(0, np.nan) * 100
    ).round(1)
    grp["taux_real"] = (
        grp["somme_opt_int"] / grp["budget_total"].replace(0, np.nan) * 100
    ).round(1)

    # Écart float vs int (erreur d'arrondi cumulée)
    grp["ecart_arrondi"] = (grp["somme_opt_int"] - grp["somme_opt_duree"]).round(1)

    def classif(row):
        if row["scenario"] == "7_PLUIE_STOP":
            return "PLUIE_STOP"
        if pd.isna(row["ecart_pct"]):
            return "INCONNU"
        if abs(row["ecart_pct"]) < 10:
            return "OK"
        elif abs(row["ecart_pct"]) < 25:
            return "ECART_MODERE"
        else:
            return "DIVERGENT"

    grp["coherence"] = grp.apply(classif, axis=1)

    print(f"  {'Cohérence':<25} {'Groupes':>8} {'%':>6}")
    print(f"  {'-'*42}")
    for label, sub in grp.groupby("coherence"):
        pct = len(sub) / len(grp) * 100
        print(f"  {label:<25} {len(sub):>8} {pct:>5.1f}%")

    print(f"\n  Écart médian |Σint - budget|  : {grp['ecart_pct'].abs().median():.1f}%")
    print(f"  Taux réalisation médian        : {grp['taux_real'].median():.1f}%")
    print(f"  Budget moyen journée           : {grp['budget_total'].mean():.1f} min")
    print(f"  Durée totale int moyenne       : {grp['somme_opt_int'].mean():.1f} min")
    print(f"  Durée totale float moyenne     : {grp['somme_opt_duree'].mean():.1f} min")
    print(f"  Erreur arrondi cumulée médiane : {grp['ecart_arrondi'].abs().median():.1f} min")


# ════════════════════════════════════════════════════════════════
# PROFIL DE DUREE PAR TOUR (v5.0)
#
# Pattern terrain Azura 4 saisons : l'opérateur fait des durées variables
# selon le numéro du tour dans la journée :
#   Tours 1-2  : longs (réhydratation coco après nuit)
#   Tour 3     : transition
#   Tours 4-10 : courts et stables (régime établi)
#   Tours 11+  : décroissants (fin de journée)
#
# Le profil est un facteur multiplicatif appliqué à la durée cible
# (après redistribution + feedback Gieling, avant bornes absolues).
# Calibré sur médianes humaines CSV 2021-2025.
# ════════════════════════════════════════════════════════════════

# ════════════════════════════════════════════════════════════════
# REGLE DE DUREE PAR DRAINAGE (v5.5) — MÊME LOGIQUE HUMAINE
#
# Le drainage DÉCIDE la durée. Durées ENTIÈRES (NetaJet 4G).
# Optimisé vs humain : même logique, valeurs réduites.
#
# Pattern humain (CSV 2021-2025) :
#   Drain 0%    → 15 min (réhydratation coco après nuit)
#   Drain 1-30% → 10 min (régime normal)
#   Drain >30%  →  8 min (substrat humide, réduire)
#
# Optimisation v5.5 :
#   Drain 0%    → 12 min  (coco sec → réhydrater, -3 min vs humain)
#   Drain 1-25% → 10 min  (régime normal, identique humain)
#   Drain >25%  →  8 min  (humide, réduire, identique humain)
#
# Le humain fait : 15→10→8 (3 valeurs seulement).
# L'opt fait     : 12→10→8 (même logique, -3 min sur réhydratation).
# Le Gieling (±15%) ajuste finement autour de ces 3 valeurs de base.
#
# Justification :
#   - Coco retient peu (15-20%) : 12 min suffisent pour réhydrater
#   - Urrestarazu 2008 : tours 8-12 min optimaux en coco sous serre
#   - Gieling 2001 : feedback proportionnel borné ±15% (ajustement fin)
# ════════════════════════════════════════════════════════════════

# Table drainage → durée entière (MINUTES) — 3 valeurs comme l'humain
def duree_by_drainage(pct_drain_prev: float) -> int:
    """Retourne la durée entière (min) selon le drainage précédent.
    Même logique humaine (3 paliers) mais optimisée et entière."""
    if pd.isna(pct_drain_prev) or float(pct_drain_prev) <= 0:
        return 12   # drain 0%  → réhydratation (humain: 15, opt: 12)
    d = float(pct_drain_prev)
    if d <= 25.0:
        return 10   # drain 1-25% → régime normal (humain: 10, opt: 10)
    else:
        return 8    # drain >25%  → humide, réduire (humain: 8, opt: 8)


# ════════════════════════════════════════════════════════════════
# PROFIL DE DÉCROISSANCE PAR TOUR (v5.6)
#
# Pattern humain observé (CSV 2021-2025) :
#   Tours 1-2  : ~15 min (réhydratation coco sec)
#   Tour 3     : ~10 min (transition)
#   Tours 4-10 : ~8-9 min (régime établi)
#   Tours 11+  : ~7-8 min (fin de journée)
#
# L'optimisation garde la logique drainage MAIS ajoute
# un facteur de décroissance progressive par tour.
#
# Le facteur est un MULTIPLICATEUR appliqué à la durée drainage.
# Calibré sur médianes humaines / médianes optimales.
# ════════════════════════════════════════════════════════════════

# Facteur multiplicatif par tour (v5.6)
#   1.0 = pas de réduction (table drainage déjà courte)
#   < 1.0 = réduction progressive
#
# Calibré pour NE PAS réduire les tours 6-10 (table=8 min déjà court)
# mais appliquer la décroissance sur les tours 3-5 (transition)
# et 11+ (fin de journée, drainage remonte → table=10 à réduire).
#
# Résultat attendu (journée type drain 0→30→20%) :
#   Tours 1-2  : 12 min (réhydratation, facteur=1.00)
#   Tour 3     :  9 min (transition, facteur=0.90)
#   Tours 4-5  :  8-9 min (régime, facteur=0.85)
#   Tours 6-10 :  8 min (table=8 déjà court, facteur=1.00)
#   Tours 11+  :  6-8 min (fin de journée, facteur=0.65-0.75)
FACTEUR_PAR_TOUR = {
    1:  1.00,   # Tour 1 : pleine durée (réhydratation)
    2:  1.00,   # Tour 2 : pleine durée
    3:  0.90,   # Tour 3 : transition (-10%)
    4:  0.85,   # Tour 4 : régime établi (-15%)
    5:  0.85,   # Tour 5 : (-15%)
    6:  1.00,   # Tour 6 : table=8 déjà court → pas de réduction
    7:  1.00,   # Tour 7 : idem
    8:  1.00,   # Tour 8 : idem
    9:  1.00,   # Tour 9 : idem
    10: 1.00,   # Tour 10 : idem
    11: 0.75,   # Tour 11 : fin de journée (-25%)
    12: 0.73,   # Tour 12 : (-27%)
    13: 0.70,   # Tour 13 : (-30%)
    14: 0.68,   # Tour 14 : (-32%)
    15: 0.65,   # Tour 15 : (-35%)
}

def get_facteur_tour(num_tour: int) -> float:
    """Retourne le facteur de décroissance pour un tour donné."""
    if num_tour <= 0:
        return 1.0
    if num_tour in FACTEUR_PAR_TOUR:
        return FACTEUR_PAR_TOUR[num_tour]
    # Tours au-delà de 15 : plancher à 0.55
    return 0.55


def calc_opt_duree_v2(
    vol_cycle_corrige_L: float,
    nbr_goutteurs: float,
    pct_drain_prev: float,
    scenario: str = "",
    T_max_C: float = None,
    duree_cycle_cible: float = None,
    duree_restante: float = None,
    nb_cycles_restants: int = None,
    duree_min_abs: float = DUREE_MIN_ABS,
    duree_max_abs: float = DUREE_MAX_ABS,
    num_tour: int = 1,
    duree_tour_precedent: int = 0,
) -> dict:
    """
    Durée optimale du tour v5.8 : RÈGLE PAR DRAINAGE + PROFIL TOUR + DÉCROISSANCE.

    LOGIQUE :
      1. Table drainage → durée entière (12/10/8 min)
      2. Facteur de décroissance par tour (v5.6)
      3. Ajustement Gieling fin (±15% max) si drainage mesurable
      4. v5.8 : DÉCROISSANCE OBLIGATOIRE — durée tour N ≤ durée tour N-1
         (logique opérateur : après drainage élevé → substrat humide → réduire durée)
      5. Bornes absolues [DUREE_MIN_ABS, DUREE_MAX_ABS]

    La durée est TOUJOURS entière (NetaJet 4G).
    opt_duree_min = opt_duree_min_int = valeur entière unique.
    """
    # Pluie → stop immédiat
    if scenario == "7_PLUIE_STOP":
        return {
            "opt_duree_min":             0,
            "opt_duree_min_int":         0,
            "opt_duree_base_min":        0,
            "opt_duree_redistrib_cible": 0,
            "opt_duree_facteur":         0.0,
            "opt_duree_mode":            "PLUIE_STOP",
        }

    # Chergui : cycles courts → plafonner à 10 min
    if scenario == "6_CHERGUI_URGENT":
        duree_table = duree_by_drainage(pct_drain_prev)
        # Appliquer le facteur tour aussi en chergui
        facteur_tour = get_facteur_tour(num_tour)
        duree_int = max(duree_min_abs, min(10, round(duree_table * facteur_tour)))
        # v5.8 : décroissance obligatoire aussi en chergui
        if duree_tour_precedent > 0 and duree_int > duree_tour_precedent:
            duree_int = duree_tour_precedent
        return {
            "opt_duree_min":             duree_int,
            "opt_duree_min_int":         duree_int,
            "opt_duree_base_min":        duree_int,
            "opt_duree_redistrib_cible": duree_int,
            "opt_duree_facteur":         round(facteur_tour, 3),
            "opt_duree_mode":            "CHERGUI_URGENCE",
        }

    # ── ÉTAPE 1 : durée de base par table drainage (ENTIÈRE)
    duree_int = duree_by_drainage(pct_drain_prev)
    mode = "DRAIN_TABLE"

    # ── ÉTAPE 1b : facteur de décroissance par tour (v5.6 NOUVEAU)
    facteur_tour = get_facteur_tour(num_tour)
    duree_avec_profil = round(duree_int * facteur_tour)
    if duree_avec_profil < duree_int:
        duree_int = duree_avec_profil
        mode = "DRAIN_TOUR_PROFIL"

    # ── ÉTAPE 2 : ajustement Gieling fin (±15%) si drainage mesurable
    # Le drainage 0% (tours 1-2) n'a pas de signal fiable → pas d'ajustement
    has_signal = (not pd.isna(pct_drain_prev) and float(pct_drain_prev) > 5.0)
    facteur_gieling = 1.0

    if has_signal:
        # Cible : 30% si chaud, sinon PCT_DRAIN_CIBLE
        pct_drain_cible = 30.0 if (
            T_max_C is not None and not pd.isna(T_max_C) and float(T_max_C) > 25.0
        ) else PCT_DRAIN_CIBLE

        facteur_gieling = pct_drain_cible / float(pct_drain_prev)
        facteur_gieling = max(FEEDBACK_FACTEUR_MIN, min(FEEDBACK_FACTEUR_MAX, facteur_gieling))

        # Appliquer le facteur et arrondir à l'entier
        duree_ajustee = round(duree_int * facteur_gieling)
        duree_ajustee = max(duree_min_abs, min(duree_max_abs, duree_ajustee))

        # Ne changer que si l'ajustement est significatif (±1 min minimum)
        if abs(duree_ajustee - duree_int) >= 1:
            duree_int = duree_ajustee
            mode = "DRAIN_GIELING"

    # ── ÉTAPE 3 : bornes absolues terrain Azura
    duree_int = max(duree_min_abs, min(duree_max_abs, int(duree_int)))

    # ── ÉTAPE 4 : v5.8 DÉCROISSANCE OBLIGATOIRE ────────────────
    # La durée ne doit JAMAIS augmenter par rapport au tour précédent.
    # Logique opérateur : après un drainage élevé, le substrat est humide,
    #                     on réduit la durée, on ne l'augmente pas.
    if duree_tour_precedent > 0 and duree_int > duree_tour_precedent:
        duree_int = duree_tour_precedent
        mode = "DRAIN_DECROISSANCE"

    return {
        "opt_duree_min":             duree_int,       # = entier (NetaJet)
        "opt_duree_min_int":         duree_int,       # idem
        "opt_duree_base_min":        duree_int,
        "opt_duree_redistrib_cible": duree_int,
        "opt_duree_facteur":         round(facteur_gieling * facteur_tour, 3),
        "opt_duree_mode":            mode,
    }


# Alias conservé pour compatibilité descendante (ne pas supprimer)
def calc_opt_duree(*args, **kwargs):
    """Alias v3 → redirige vers calc_opt_duree_v2 (sans redistribution)."""
    kwargs.pop("duree_cycle_cible",  None)
    kwargs.pop("duree_restante",     None)
    kwargs.pop("nb_cycles_restants", None)
    result = calc_opt_duree_v2(*args, **kwargs)
    # Retirer la clé redistrib pour compatibilité v3
    result.pop("opt_duree_redistrib_cible", None)
    return result



# ════════════════════════════════════════════════════════════════
# MODULE 14 — POURCENTAGE DE RÉSSUYAGE (PRT / DRY-BACK)  [NOUVEAU v3.0]
#
# Le PRT (Pourcentage de Réssuyage = dry-back) mesure la perte d'eau
# nocturne du substrat. C'est le "juge de paix" pour décider si la
# première tour d'irrigation peut être déclenchée le matin.
#
# FORMULE (terrain Azura) :
#   PRT = (poids_soir_kg - poids_matin_kg) / poids_soir_kg × 100
#   → Plus le PRT est élevé, plus le substrat est sec.
#   → Seuil atteint = déclencher la première tour.
#
# SEUILS SELON SCÉNARIO MÉTÉO (PDF Analyse PRT — Azura) :
#
#   Scénario                  | Seuil bas | Seuil haut | Heure type
#   Brouillard / Très nuageux | 10 %      | 12 %       | 09h30-11h00
#   Standard (ensoleillé)     |  9 %      | 10 %       | 08h00-09h00
#   Chergui / Forte chaleur   |  8 %      |  9 %       | 07h00-08h00
#   Pluie                     | STOP      | STOP       | 0 min
#
# LOGIQUE DE DÉCISION :
#   PRT < seuil_bas  → ATTENDRE  (substrat encore humide → asphyxie racinaire)
#   seuil_bas ≤ PRT ≤ seuil_haut → DECLENCHER (fenêtre optimale)
#   PRT > seuil_haut → STRESS_HYDRIQUE (substrat trop sec → déclencher URGENT)
#   PRT < 0          → ERREUR_MESURE (poids_matin > poids_soir → incohérence)
#
# SCIENCE :
#   • Dry-back 8-12% : plage validée en hydroponie hors-sol tomate
#     (AROYA.io, Growlink, Hortidaily — confirme §PRT Azura)
#   • PRT végétatif (< 8%) → favorise croissance feuilles/tiges
#   • PRT génératif (≥ 8%) → favorise floraison/fructification
#   • Corrélation PRT/météo ≈ 0 dans le dataset Azura → signal substrat
#     INDÉPENDANT des variables météo : seul indicateur de l'état réel
#
# SOURCES :
#   Analyse_Methode_PRT.pdf — Azura 2025
#   AROYA.io "Mastering dry backs to optimize yield and quality"
#   Hortidaily "Irrigation de-mystified" — règles dry-back tomate
# ════════════════════════════════════════════════════════════════

# Seuils PRT par scénario (% dry-back)
PRT_SEUILS = {
    "1_TRES_ENSOLEILLE":  (9.0,  11.0),
    "2_ENSOLEILLE":       (9.0,  11.0),
    "3_NUAGEUX":          (9.0,  11.0),
    "4_TRES_NUAGEUX":     (10.0, 12.0),
    "5_BROUILLARD_MATIN": (10.0, 12.0),
    "5b_FOG_CHAUD_VPD":   (8.5,  10.0),  # VPD fort → sec plus vite la nuit
    "5c_FOG_CHAUD_RS":    (9.0,  11.0),  # intermédiaire
    "5d_FOG_RADIATION":   (9.0,  10.5),  # brouillard court
    "5e_FOG_FROID":       (10.0, 13.0),  # transpiration très réduite → dry-back lent
    "6_CHERGUI_URGENT":   (8.0,   9.0),
    "7_PLUIE_STOP":       (None, None),
    "7b_PLUIE_LEGERE":    (9.0,  10.0),
    "8_NUAGEUX_CHAUD":    (8.5,  10.0),  # VPD > 2 → substrat se sèche vite
    "9_NUIT_FROIDE_SOL":  (10.0, 12.0),  # racines froides → absorption lente
}

# Retard estimé si PRT trop bas (minutes à attendre par % manquant)
# Basé sur : transpiration nocturne moyenne Agadir ≈ 0.3-0.5% PRT/heure
# → 1% PRT manquant ≈ 2-3h d'attente → 120-180 min
PRT_MIN_PAR_PCT = 120.0   # minutes d'attente estimée par 1% de PRT manquant


def calc_opt_PRT(
    poids_soir_kg: float,
    poids_matin_kg: float,
    pct_ressuyage_terrain: float,
    scenario: str,
    num_tour: int = 1,
) -> dict:
    """
    Calcule le PRT et la décision de déclenchement de la première tour.

    Paramètres
    ----------
    poids_soir_kg          : poids substrat mesuré la veille au soir (kg)
    poids_matin_kg         : poids substrat mesuré le matin avant irrigation (kg)
    pct_ressuyage_terrain  : PRT déjà enregistré dans le CSV (fallback)
    scenario               : scénario météo classifié (ex: "2_ENSOLEILLE")
    num_tour               : numéro du tour dans la journée (PRT = tour 1 uniquement)

    Retourne
    --------
    dict avec :
      opt_PRT_pct           : PRT calculé (%) — (poids_soir - poids_matin) / poids_soir × 100
      opt_PRT_source        : 'POIDS' si calculé depuis les balances | 'TERRAIN' si fallback
      opt_PRT_seuil_bas     : seuil bas du scénario (%)
      opt_PRT_seuil_haut    : seuil haut du scénario (%)
      opt_PRT_zone          : CHERGUI | BROUILLARD_NUAGEUX | STANDARD | PLUIE
      opt_PRT_decision      : DECLENCHER | ATTENDRE | STRESS_HYDRIQUE | ERREUR_MESURE | PLUIE_STOP | NA_NON_TOUR1
      opt_PRT_retard_min    : minutes d'attente estimée si ATTENDRE (0 sinon)
      opt_PRT_confiance     : HIGH (balances OK) | MEDIUM (terrain) | LOW (aucune mesure)
    """
    result = {
        "opt_PRT_pct":        float("nan"),
        "opt_PRT_source":     "AUCUNE",
        "opt_PRT_seuil_bas":  float("nan"),
        "opt_PRT_seuil_haut": float("nan"),
        "opt_PRT_zone":       "INCONNUE",
        "opt_PRT_decision":   "NA_SANS_MESURE",
        "opt_PRT_retard_min": 0.0,
        "opt_PRT_confiance":  "LOW",
    }

    # ── Pluie : STOP immédiat
    if scenario == "7_PLUIE_STOP":
        result.update({
            "opt_PRT_zone":     "PLUIE",
            "opt_PRT_decision": "PLUIE_STOP",
            "opt_PRT_seuil_bas":  0.0,
            "opt_PRT_seuil_haut": 0.0,
            "opt_PRT_confiance":  "HIGH",
        })
        return result

    if scenario == "7b_PLUIE_LEGERE":
        # Bruine légère — pas de stop mais alerte : seuil légèrement relevé
        # (humidité élevée réduit transpiration)
        result.update({
            "opt_PRT_zone":      "PLUIE_LEGERE",
            "opt_PRT_seuil_bas":  9.0,
            "opt_PRT_seuil_haut": 11.0,
            "opt_PRT_confiance":  "MEDIUM",
        })
        # Continue vers le calcul PRT normal avec ces seuils ajustés

    # ── PRT n'est pertinent que pour la 1ère tour de la journée
    if num_tour > 1:
        result["opt_PRT_decision"] = "NA_NON_TOUR1"
        return result

    # ── Calcul PRT depuis les balances (priorité)
    has_poids = (
        not pd.isna(poids_soir_kg)  and poids_soir_kg  > 0
        and not pd.isna(poids_matin_kg) and poids_matin_kg > 0
    )
    if has_poids:
        prt = (poids_soir_kg - poids_matin_kg) / poids_soir_kg * 100.0
        source = "POIDS"
        confiance = "HIGH"
    elif not pd.isna(pct_ressuyage_terrain) and pct_ressuyage_terrain > 0:
        prt = float(pct_ressuyage_terrain)
        source = "TERRAIN"
        confiance = "MEDIUM"
    else:
        result["opt_PRT_decision"] = "NA_SANS_MESURE"
        return result

    result["opt_PRT_pct"]    = round(prt, 2)
    result["opt_PRT_source"] = source
    result["opt_PRT_confiance"] = confiance

    # ── Seuils selon scénario
    seuils = PRT_SEUILS.get(scenario, (9.0, 10.0))
    seuil_bas, seuil_haut = seuils

    # Zone météo
    if scenario in ("6_CHERGUI_URGENT", "5b_FOG_CHAUD_VPD", "8_NUAGEUX_CHAUD"):
        zone = "CHERGUI"        # stress thermique/VPD dominant
    elif scenario in ("5_BROUILLARD_MATIN", "5c_FOG_CHAUD_RS",
                    "5d_FOG_RADIATION", "5e_FOG_FROID",
                    "4_TRES_NUAGEUX", "3_NUAGEUX"):
        zone = "BROUILLARD_NUAGEUX"
    elif scenario == "9_NUIT_FROIDE_SOL":
        zone = "NUIT_FROIDE"
    else:
        zone = "STANDARD"

    result["opt_PRT_zone"]       = zone
    result["opt_PRT_seuil_bas"]  = seuil_bas
    result["opt_PRT_seuil_haut"] = seuil_haut

    # ── Décision PRT
    if prt < 0:
        # Erreur mesure : poids_matin > poids_soir (impossible physiquement)
        result["opt_PRT_decision"]   = "ERREUR_MESURE"
        result["opt_PRT_confiance"]  = "LOW"
        result["opt_PRT_retard_min"] = 0.0

    elif prt < seuil_bas:
        # Substrat encore trop humide → risque asphyxie racinaire si on irrigue
        manque_pct = seuil_bas - prt
        retard_est = round(manque_pct * PRT_MIN_PAR_PCT, 0)
        result["opt_PRT_decision"]   = "ATTENDRE"
        result["opt_PRT_retard_min"] = retard_est

    elif prt <= seuil_haut:
        # Fenêtre optimale → déclencher la première tour
        result["opt_PRT_decision"]   = "DECLENCHER"
        result["opt_PRT_retard_min"] = 0.0

    else:
        # PRT > seuil_haut → substrat trop sec → stress hydrique déjà en cours
        # Déclencher immédiatement (urgence relative)
        result["opt_PRT_decision"]   = "STRESS_HYDRIQUE"
        result["opt_PRT_retard_min"] = 0.0

    return result

# ════════════════════════════════════════════════════════════════
# MODULE 15 — VRAI TEMPS DE REPOS OPÉRATEUR (opt_vrai_repos_min)
#
# RÉALITÉ TERRAIN :
#   vrai_repos_reel = temps_repos_min - duree_min_tour_précédent
#   = délai PUR après fin du tour complet (groupe A + groupe B)
#
# TABLE 2D CALIBRÉE SUR DONNÉES RÉELLES (CSV Azura 4 saisons) :
#   Clé : repos_apres_ce_tour = médiane(vrai_repos_reel[T(N+1)])
#         groupé par (num_tour=N, tranche(pct_drainage[T(N)]))
#   → "après avoir observé ce drainage à ce tour, combien l'opérateur
#      attend avant de déclencher le tour suivant"
#
#   Tranches drainage : '0-10', '10-20', '20-30', '30-40', '40-60', '>60'
#   Tours 1-12 (non borné côté bas — tour 1 a sa propre ligne)
# ════════════════════════════════════════════════════════════════

_REPOS_TABLE_2D = {
    #          0-10  10-20  20-30  30-40  40-60  >60
    1:  dict(zip(['0-10','10-20','20-30','30-40','40-60','>60'], [ 0,  0,  0,  0,  0,  0])),
    2:  dict(zip(['0-10','10-20','20-30','30-40','40-60','>60'], [ 5, 15, 20,  9, 14,  0])),
    3:  dict(zip(['0-10','10-20','20-30','30-40','40-60','>60'], [ 5, 10, 15, 25, 34,  0])),
    4:  dict(zip(['0-10','10-20','20-30','30-40','40-60','>60'], [ 5, 10, 15, 19, 29, 44])),
    5:  dict(zip(['0-10','10-20','20-30','30-40','40-60','>60'], [ 5,  5, 10, 18, 24, 23])),
    6:  dict(zip(['0-10','10-20','20-30','30-40','40-60','>60'], [ 3,  5,  8, 15, 24, 14])),
    7:  dict(zip(['0-10','10-20','20-30','30-40','40-60','>60'], [ 0,  5,  8, 20, 23, 14])),
    8:  dict(zip(['0-10','10-20','20-30','30-40','40-60','>60'], [14,  7, 24, 20, 16,  6])),
    9:  dict(zip(['0-10','10-20','20-30','30-40','40-60','>60'], [19, 25, 24, 20, 14,  6])),
    10: dict(zip(['0-10','10-20','20-30','30-40','40-60','>60'], [14, 20, 24, 19, 14,  5])),
    11: dict(zip(['0-10','10-20','20-30','30-40','40-60','>60'], [14, 20, 24, 19, 13, 18])),
    12: dict(zip(['0-10','10-20','20-30','30-40','40-60','>60'], [19, 21, 19, 18, 18, 17])),
}


def _tranche_drainage(pct: float) -> str:
    """Convertit un % drainage en clé de tranche."""
    if pd.isna(pct) or pct < 0:
        return '20-30'
    if pct < 10:  return '0-10'
    if pct < 20:  return '10-20'
    if pct < 30:  return '20-30'
    if pct < 40:  return '30-40'
    if pct < 60:  return '40-60'
    return '>60'


def calc_opt_vrai_repos(
    pct_drainage_ce_tour: float,
    num_tour: int,
    scenario: str,
    opt_continuer: int,
    T_max_C: float = None,
) -> dict:
    """
    Calcule le temps de repos optimal APRÈS ce tour, avant le tour suivant.

    v6.0 — REPOS ADAPTATIF (remplace la table 2D fixe)
      Phase 1 (tours 1-3) : repos 15-18 min (laisser imbiber)
      Phase 2 (tours 4-6) : repos 9-12 min (drainage monte)
      Phase 3 (tours 7+)  : repos croissant 16→22→27→31 min (drainage descend)
      Ajustement T° : >32°C → -3 min, <18°C → +3 min

    Le résultat est ensuite décalé via shift(1) dans main() pour être
    positionné sur la ligne du tour suivant.
    """
    if scenario == "7_PLUIE_STOP":
        return {
            "opt_vrai_repos_min": 0,
            "opt_repos_mode":     "PLUIE_STOP",
        }

    repos = compute_repos_time(
        num_tour=num_tour,
        drain_prev_pct=pct_drainage_ce_tour,
        drainage_cible=0.35,  # valeur moyenne, ajustée par compute_repos_time
        tmax=T_max_C,
    )

    tour_key = min(max(num_tour, 1), 12)
    tranche = _tranche_drainage(pct_drainage_ce_tour)
    mode = f"T{num_tour}_D{tranche}"

    return {
        "opt_vrai_repos_min": repos,
        "opt_repos_mode":     mode,
    }

def calculer_pct_drainage_from_row(row: pd.Series) -> float:
    """
    Recalcule le % drainage depuis les colonnes brutes du CSV.
    Réplique exacte de la formule JS Azura.

    Utilise pct_drainage du CSV si disponible et cohérent,
    sinon recalcule depuis v_drainage + nbr_goutteurs + v_apport.
    """
    pct_csv = row.get("pct_drainage", np.nan)
    if not pd.isna(pct_csv) and float(pct_csv or 0) > 0:
        return float(pct_csv)   # déjà calculé correctement en amont

    # Recalcul depuis données brutes
    v_drain     = float(row.get("v_drainage",    0) or 0)   # cc total bras
    nbr_goutt   = float(row.get("nbr_goutteurs", 0) or 0)
    v_apport    = float(row.get("v_apport",      0) or 0)   # cc/goutteur

    return pct_drainage_calcule(v_drain, nbr_goutt, v_apport)


def optimiser_ligne(row: pd.Series, date_plantation: pd.Timestamp) -> dict:
    """
    Calcule l'ensemble des décisions optimales pour une ligne (cycle).
    
    Retourne un dictionnaire avec toutes les colonnes opt_ à ajouter.
    """
    result = {}

    # ── Stade phénologique
    date_row = pd.Timestamp(row["date"])
    jours_depuis = max(0, (date_row - date_plantation).days)
    stade         = get_stade(jours_depuis)
    mois          = int(date_row.month)  # pour facteur saisonnier EC (v5.0)
    result["opt_jours_depuis_plantation"] = jours_depuis
    result["opt_stade"]                   = stade["nom"]
    result["opt_Kc"]                      = stade["Kc"]
    result["opt_EC_drain_cible_dSm"]      = stade["EC_drain_cible"]
    # ── Récupération données météo
    T_mean = row.get("meteo_T_mean_C",    row.get("meteo_temperature_2m_mean",  20.0))
    T_max  = row.get("meteo_T_max_C",     row.get("meteo_temperature_2m_max",   25.0))
    T_min  = row.get("meteo_T_min_C",     row.get("meteo_temperature_2m_min",   15.0))
    HR     = row.get("meteo_HR_mean_pct", row.get("meteo_relative_humidity_2m_mean", 65.0))
    Rs_MJ  = row.get("meteo_shortwave_radiation_sum", 15.0)   # MJ/m²/jour
    
    u2_kmh = row.get("meteo_vent_mean_kmh",
            row.get("meteo_windspeed_10m_max", 20.0))
    u2_ms  = max(float(u2_kmh or 10.0) / 3.6, 0.5)
    # FAO-56 §5 : u2 = vitesse MOYENNE journalière à 2m, minimum 0.5 m/s
    # vent_max (5.25 m/s médiane) vs vent_mean (2.94 m/s) → ET0 surestimé +69%
    # Impact: 9.7% des lignes ont ET0 > 8 mm/j (physiquement impossible Agadir)
    # Impact direct: volume_total_Lha surestimé → surirrigations calculées
    
    rs_wm2 = row.get("meteo_rs_wm2_max_jour", row.get("meteo_rs_wm2_mean_jour", 500.0))
    
    pluie  = row.get("meteo_pluie_mm_jour", 0.0)
    scenario = str(row.get("scenario_meteo", "2_ENSOLEILLE") or "2_ENSOLEILLE")
    ec_bassin = float(row.get("ec_bassin", 0.8) or 0.8)

    # ── ET0 Penman-Monteith recalculé
    doy_val = int(pd.Timestamp(row["date"]).day_of_year)
    # ── Stanghellini (prioritaire — rapport §2.3, Wifaya et al. 2019)
    Rn_serre = (Rs_MJ or 15.0) * TAU_SERRE * (1 - 0.23)   # Rn intra-serre
    LAI_stade = LAI_PAR_STADE.get(stade["nom"], 2.5)
    et0_st = calc_et0_stanghellini(Rn_serre, T_mean, HR, LAI_stade)

    # ── Penman-Monteith FAO-56 (fallback si Stanghellini échoue)
    et0_pm = calc_et0_penman_monteith(T_mean, T_max, T_min, HR, Rs_MJ or 15.0, u2_ms, doy=doy_val)
    if pd.isna(et0_pm):
        et0_pm = float(row.get("meteo_ET0_mm_jour", 3.0) or 3.0)

    # ── Sélection modèle + traçabilité
    if not pd.isna(et0_st):
        et0 = et0_st
        result["opt_ET0_modele"] = "STANGHELLINI"
    else:
        et0 = et0_pm
        result["opt_ET0_modele"] = "PENMAN_MONTEITH_FAO56"

    # Toujours enregistrer
    result["opt_ET0_mm_jour"]    = round(et0, 3)
    result["opt_ET0_PM_mm_jour"] = round(et0_pm, 3)
    result["opt_LAI_stade"]      = LAI_stade

    # ── ETc = ET0 × Kc × τ / IE
    ETc = et0 * stade["Kc"] * TAU_SERRE

    # CORRECTION v5.2c : facteur coco ADAPTATIF (FAO calibré sol, pas coco)
    #   Coco = rétention plus faible → besoin de plus d'eau en chaleur
    #   Jour normal : 1.10× (économie d'eau vs humain)
    #   Jour chaud  : 1.25× (couvre besoin réel coco, littérature Carmassi 2007)
    facteur_coco = facteur_coco_adaptatif(scenario, T_max)
    ETc = ETc * facteur_coco

    # CORRECTION v4.1 : cap ETc élargi à 8.0 mm/j (était 6.0)
    # Justification : Chergui à 40°C + VPD 5-7 kPa → ETc réelle peut dépasser 6 mm/j
    # sur tomate cerise en pleine floraison/grossissement (Wifaya et al. 2019, tableau 3)
    # 0.5 = minimum physique brouillard hivernal (relevé vs 0.3 — plus réaliste)
    ETc = max(0.5, min(8.0, ETc))

    result["opt_ETc_mm_jour"] = round(ETc, 3)
    result["opt_facteur_coco"] = facteur_coco  # Traçabilité du facteur coco utilisé

    # ── Fraction lessivage FL
    FL = calc_FL(ec_bassin, scenario)
    result["opt_FL"]           = FL
    result["opt_FL_pct"]       = int(FL * 100)

    # ── Nombre de cycles optimal — météo + plafond stade phénologique
    nb_cycles_meteo = SCENARIO_CYCLES.get(scenario, 8)

    # Plafond par stade : les jeunes plants ne supportent pas autant de cycles
    # qu'une plante en floraison pleine (risque asphyxie / botrytis)
    if stade["nom"] == "Végétatif":
        max_cycles_stade = get_max_cycles_vegetatif(jours_depuis)
    else:
        max_cycles_stade = STADE_MAX_CYCLES.get(stade["nom"], 14)

    # Calcul brut (avant réduction serre)
    # v5.4 : pour les scénarios chauds extrêmes, le plafond stade est relevé
    # car même un jeune plant a besoin de cycles fréquents en coco chaud
    SCENARIOS_CHAUDS = {"6_CHERGUI_URGENT", "1_TRES_ENSOLEILLE"}
    if scenario in SCENARIOS_CHAUDS:
        # Plafond relevé : ignorer la limitation vegetatif asphyxie
        # En coco chaud, le risque de stress hydrique dépense le risque d'asphyxie
        nb_cycles_brut = nb_cycles_meteo  # pas de plafond stade
    else:
        nb_cycles_brut = min(nb_cycles_meteo, max_cycles_stade)

    # CORRECTION v5.3 : réduction cycles SERRE (منزل شبكي + coco)
    #   En serre : TAU=0.82, HR élevée, vent nul → demande évaporative réduite
    #   En coco : rétention faible → cycles plus espacés mais plus longs
    #   Volume total JOURNALIER inchangé (apport_total_mm reste le même)
    #   Chaque cycle est PLUS LONG (même volume / moins de cycles)
    #   Littérature : Carmassi 2007, Raviv 2008 → 4-8 cycles/jour suffisent
    #
    # CORRECTION v5.4 : facteur ADAPTATIF par scénario (agronome tomate cerise/coco)
    #   Problème v5.3 : facteur 0.6 fixe pénalise les scénarios chauds
    #     - Chergui : 12 × 0.6 = 7 tours → INSUFFISANT (coco sèche 3-4× plus vite)
    #     - Tres Ensoleillé : 13 × 0.6 = 8 → limite
    #   Solution : facteur adaptatif + plafond stade ignoré en jour chaud
    #
    #   Logique agronomique :
    #     - Scénarios chauds (Chergui, Tres Ensoleille) : coco sèche très vite
    #       → besoin de cycles fréquents même pour jeune plant
    #       → plafond stade ignoré, facteur 0.85
    #     - Scénarios modérés (Ensoleille, Fog Chaud) : réduction modérée
    #       → facteur 0.65-0.70
    #     - Scénarios froids/pluie/brouillard : réduction forte
    #       → facteur 0.45-0.55 (coco reste humide longtemps)
    #
    #   Source : Raviv 2008, Urrestarazu 2008, pratique terrain Azura 2021-2025
    FACTEUR_CYCLES_ADAPTATIF = {
        "1_TRES_ENSOLEILLE":  0.85,
        "2_ENSOLEILLE":       0.70,
        "3_NUAGEUX":          0.60,
        "4_TRES_NUAGEUX":     0.50,
        "5_BROUILLARD_MATIN": 0.55,
        "5b_FOG_CHAUD_VPD":   0.70,
        "5c_FOG_CHAUD_RS":    0.60,
        "5d_FOG_RADIATION":   0.65,
        "5e_FOG_FROID":       0.45,
        "6_CHERGUI_URGENT":   1.00,   # Chergui: facteur 1.0 → pas de reduction (stress extreme coco)
        "7_PLUIE_STOP":       0.45,
        "7b_PLUIE_LEGERE":    0.55,
        "8_NUAGEUX_CHAUD":    0.65,
        "9_NUIT_FROIDE_SOL":  0.50,
    }
    facteur = FACTEUR_CYCLES_ADAPTATIF.get(scenario, FACTEUR_REDUCTION_SERRE)

    # Plafond minimum en jour chaud : même un jeune plant a besoin de
    # cycles fréquents pour éviter le stress hydrique en coco
    min_cycles = 6 if (scenario in ("6_CHERGUI_URGENT", "1_TRES_ENSOLEILLE")
                        and T_max is not None and not pd.isna(T_max) and float(T_max) > 32) else 3

    nb_cycles = max(min_cycles, round(nb_cycles_brut * facteur))

    result["opt_nb_cycles"]             = nb_cycles
    result["opt_nb_cycles_brut"]        = nb_cycles_brut  # avant réduction serre
    result["opt_nb_cycles_meteo_brut"]  = nb_cycles_meteo   # scénario brut
    result["opt_max_cycles_stade"]      = max_cycles_stade  # plafond stade
    result["opt_heure_demarrage"]       = SCENARIO_HEURE.get(scenario, "08:00")

    # ── Volume total journalier ADAPTATIF (v6.1) ─────────────────────
    # ANCIEN (rigide v5) : V = ETc / (1 - FL) / IE_GOUTTE  → ratio fixe ~1.36× ETc
    # ANCIEN (v6.0)      : V = ETc / (1 - drainage_cible)  → ~1.4-1.7× ETc (encore trop bas)
    # NOUVEAU (v6.1)     : V = ETc × K_scenario × f(T°) × f(EC)
    #
    # Analyse humaine : l'opérateur applique V/ETc = 3.0× à 4.7× selon scénario
    # (moyenne 3.84×). K_scenario reflète :
    #   - Besoin de lessivage (sels Agadir)
    #   - Remplissage substrat coco
    #   - Stratégie multi-tours (7-15 tours/jour)
    drainage_base = compute_drainage_cible_base(T_max)

    # PLUIE_STOP : l'humain ne s'arrête jamais complètement (même >20mm pluie → ~5mm)
    # K_base=4.00 déjà calibré sur les volumes humains PLUIE_STOP
    # Réduction légère selon pluie : humain donne ~5mm même sous forte pluie
    pluie_stop_reduction = 1.0
    if scenario == "7_PLUIE_STOP":
        if pluie > 20:
            pluie_stop_reduction = 0.60  # forte pluie → 60% du volume normal
        elif pluie > 12:
            pluie_stop_reduction = 0.75  # pluie modérée → 75%
        elif pluie > 5:
            pluie_stop_reduction = 0.90  # légère pluie → 90%
        else:
            pluie_stop_reduction = 1.00  # pas de pluie → volume normal

    # EC apport/drainage pour ajustement
    ec_apport_val = float(row.get("ec_apport", ec_bassin) or ec_bassin)
    ec_drain_val  = float(row.get("ec_drainage", np.nan) or np.nan)

    # Drainage cible ajusté (pour traçabilité et logique tour-par-tour)
    drainage_cible_used = compute_drainage_cible_ajuste(
        base=drainage_base,
        ec_apport=ec_apport_val,
        ec_drain=ec_drain_val,
        scenario=scenario,
        drain_prev_pct=np.nan,
        num_tour=1,
        nbr_tours_total=nb_cycles,
    )

    # Volume adaptatif v6.2 : V = ETc × K_scenario × K_stade × f(T°) × f(EC) × reduction_pluie
    apport_total_mm  = compute_volume_adaptatif(
        ETc, scenario, T_max,
        stade=stade["nom"],
        ec_apport=ec_apport_val, ec_drain=ec_drain_val,
    )
    apport_total_mm  = apport_total_mm * pluie_stop_reduction
    k_scenario_used  = (apport_total_mm / ETc) if ETc > 0 else 0.0
    apport_total_mm  = apport_total_mm / IE_GOUTTE  # ajouter pertes irrigation
    volume_total_Lha = apport_total_mm * 10_000  # mm × 10000 = L/ha

    result["opt_apport_total_mm"]        = round(apport_total_mm, 3)
    result["opt_volume_total_Lha"]       = round(volume_total_Lha, 0)
    result["opt_drainage_cible_base"]    = round(drainage_base, 3)
    result["opt_drainage_cible_ajuste"]  = round(drainage_cible_used, 3)
    result["opt_k_scenario_volume"]      = round(k_scenario_used, 3)

    # ── Volume par cycle (L/ha)
    vol_cycle_Lha = (volume_total_Lha / nb_cycles) if nb_cycles > 0 else 0.0
    result["opt_volume_cycle_Lha"] = round(vol_cycle_Lha, 1)

    # ── Volume par cycle pour cette configuration terrain (L)
    vol_cycle_L = calculer_volume_cycle_L(row)
    result["opt_volume_cycle_L"] = round(vol_cycle_L, 1)

    # ── EC cible ajustée au scénario + saison + nb_cycles (v5.0)
    EC_cible_base    = stade["EC_cible"]
    EC_ajust_scenario = SCENARIO_EC_AJUST.get(scenario, 1.0)
    EC_ajust_saison  = EC_SAISON_FACTOR.get(mois, 1.0)
    EC_ajust_cycles  = calc_ec_cycles_factor(nb_cycles)
    EC_cible         = EC_cible_base * EC_ajust_scenario * EC_ajust_saison * EC_ajust_cycles
    # ── pH dynamique v5.6 : ajusté saison + T_max + feedback drainage
    # T_max_val extrait ici (avant toute utilisation dans calc_ph_cible)
    T_max_val = float(row.get("meteo_T_max_C", row.get("meteo_temperature_2m_max", None)) or 0) or None
    ph_drain_prev = row.get("_ph_drain_prev", row.get("ph_drainage", None))
    pH_cible = calc_ph_cible(
        ph_base       = stade["pH_cible"],
        mois          = mois,
        t_max         = T_max_val,
        ph_drain_prev = ph_drain_prev,
    )
    result["opt_EC_cible_dSm"]     = round(EC_cible, 3)
    result["opt_pH_cible"]         = pH_cible
    result["opt_pH_base_stade"]    = stade["pH_cible"]
    result["opt_pH_saison_offset"] = PH_SAISON_OFFSET.get(mois, 0.0)
    result["opt_EC_saison_factor"] = EC_ajust_saison
    result["opt_EC_cycles_factor"] = round(EC_ajust_cycles, 3)

    # ── Numéro du tour (utilisé par plusieurs modules ci-dessous)
    num_tour_calc = int(row.get("num_tour", 1) or 1)

    # ── Boucle adaptative — ajustement drainage (§6.1)
    # pct_drainage dans le CSV = (v_drain_cc / nbr_goutteurs / v_apport_cc) * 100
    # On recalcule depuis les bruts pour garantir la cohérence des unités
    pct_drain = calculer_pct_drainage_from_row(row)
    if pd.isna(pct_drain):
        pct_drain = 25.0   # valeur neutre si données manquantes
    # T_max_val déjà extrait plus haut (pour calc_ph_cible v5.6)
    v_drain_brut = float(row.get("v_drainage", 0) or 0)
    facteur_vol, label_drain = calc_ajustement_drainage(
        pct_drainage=pct_drain,
        T_max_C=T_max_val,
        v_drainage_brut=v_drain_brut,
        num_tour=num_tour_calc,
        scenario=scenario,
    )    

    result["opt_facteur_ajust_volume"] = facteur_vol
    result["opt_label_drainage"]       = label_drain

    # ── Volume corrigé après boucle adaptative
    vol_cycle_corrige_L  = vol_cycle_L  * facteur_vol
    result["opt_volume_cycle_corrige_L"]  = round(vol_cycle_corrige_L, 1)
    result["opt_volume_cycle_corrige_Lha"] = round(vol_cycle_Lha * facteur_vol, 1)

    # ── Durée optimale du tour (MODULE 13 — v4.0 redistribution)
    # _pct_drain_prev      : précalculé par groupby+shift dans main()
    # _duree_cycle_cible   : redistribution dynamique du budget (precompute_redistribution)
    # Si _duree_cycle_cible absent → fallback v3 (base FAO-56 depuis volume)
    pct_drain_prec_val    = float(row.get("_pct_drain_prev",    np.nan) or np.nan)
    nbr_goutt_val         = float(row.get("nbr_goutteurs",      8)      or 8)
    duree_cycle_cible_val = float(row.get("_duree_cycle_cible", np.nan) or np.nan)
    duree_restante_val    = float(row.get("_duree_restante",    np.nan) or np.nan)
    nb_cycles_rest_val    = int(row.get("_nb_cycles_restants",  1)      or 1)
    # v5.8 : durée du tour précédent pour forcer la décroissance
    _duree_prev_raw       = row.get("_duree_prev", 0)
    duree_tour_prec_val   = int(_duree_prev_raw) if pd.notna(_duree_prev_raw) else 0

    duree_result = calc_opt_duree_v2(
        vol_cycle_corrige_L    = vol_cycle_corrige_L,
        nbr_goutteurs          = nbr_goutt_val,
        pct_drain_prev         = pct_drain_prec_val,
        scenario               = scenario,
        T_max_C                = T_max_val,
        duree_cycle_cible      = duree_cycle_cible_val,   # ← redistribution dynamique
        duree_restante         = duree_restante_val,      # ← pour traçabilité
        nb_cycles_restants     = nb_cycles_rest_val,      # ← pour traçabilité
        num_tour               = num_tour_calc,           # ← profil durée v5.0
        duree_tour_precedent   = duree_tour_prec_val,     # ← v5.8 décroissance obligatoire
    )
    result.update(duree_result)

    # ── Consigne entière NetaJet 4G (contrainte matérielle : minutes entières)
    # v5.5 : opt_duree_min est DÉJÀ entier (table drainage → duree_by_drainage)
    # opt_duree_min_int = opt_duree_min (pas de conversion float→int nécessaire)
    duree_val = int(duree_result.get("opt_duree_min", 0) or 0)
    # Ne pas appliquer DUREE_MIN_ABS si PLUIE_STOP ou CHERGUI (déjà borné dans calc_opt_duree_v2)
    if duree_val > 0:
        duree_val = max(int(DUREE_MIN_ABS), min(int(DUREE_MAX_ABS), duree_val))
    result["opt_duree_min_int"] = duree_val   # ← programmer ce chiffre sur NetaJet

    # ── Seuil RadS
    rs_total_Jcm2 = float(
        row.get("meteo_rs_total_Jcm2") or
        ((row.get("meteo_shortwave_radiation_sum") or 0) * 100) or
        ((rs_wm2 or 0) * 0.0864 * 10.0) or
        150.0   # fallback journée standard Agadir hiver
    )
    rs_total_Jcm2 = min(rs_total_Jcm2, 2500.0)

    rads = calc_rads_seuil(rs_total_Jcm2, nb_cycles, stade["nom"], scenario)
    result.update(rads)

    # ── Alertes dérivées
    vpd_max = float(row.get("meteo_VPD_max_kPa", 0.0) or 0.0)
    result["opt_alerte_chergui"]     = int(scenario == "6_CHERGUI_URGENT")
    result["opt_alerte_pluie"]       = int(scenario == "7_PLUIE_STOP")
    result["opt_alerte_brouillard"]  = int(scenario == "5_BROUILLARD_MATIN")
    result["opt_alerte_vpd_stress"]  = int(vpd_max > 1.5)
    result["opt_alerte_vpd_urgent"]  = int(vpd_max > 2.5)
    result["opt_alerte_drainage_ko"] = int(label_drain not in ["OPTIMAL", "INCONNU"])

    # ── Recommandation NetaJet 4G finale (texte opérateur)
    if scenario == "7_PLUIE_STOP":
        result["opt_consigne_netajet"] = "STOP — reprise 2h après arrêt pluie"
    elif scenario == "6_CHERGUI_URGENT":
        if stade["nom"] == "Végétatif":
            result["opt_consigne_netajet"] = (
                f"ALERTE CHERGUI VÉGÉTATIF — MAX {nb_cycles} cycles (asphyxie) | "
                f"EC={EC_cible:.1f} dS/m | MISTING OBLIGATOIRE | Ombrage 30% | "
                f"Départ 07:00 | NE PAS DÉPASSER {nb_cycles} tours"
            )
        else:
            result["opt_consigne_netajet"] = (
                f"ALERTE CHERGUI — EC={EC_cible:.1f} dS/m | {nb_cycles} cycles | "
                f"Départ 07:00 | RadS=20 J/cm² | Misting OBLIGATOIRE"
            )
    elif scenario in ("5_BROUILLARD_MATIN","5b_FOG_CHAUD_VPD","5c_FOG_CHAUD_RS",
                    "5d_FOG_RADIATION","5e_FOG_FROID"):
        heure_map = SCENARIO_HEURE.get(scenario, "10:30")
        desc = {
            "5_BROUILLARD_MATIN": "BROUILLARD classique — attendre levée",
            "5b_FOG_CHAUD_VPD":   "BROUILLARD+VPD — démarrer dès levée, cycles normaux",
            "5c_FOG_CHAUD_RS":    "BROUILLARD+soleil — levée ~09h20 puis irriguer normalement",
            "5d_FOG_RADIATION":   "BROUILLARD radiation — se lève tôt, démarrage anticipé",
            "5e_FOG_FROID":       "BROUILLARD FROID persistant — attendre 11h, EC élevée, ventiler",
        }
        result["opt_consigne_netajet"] = (
            f"{desc[scenario]} | Départ {heure_map} | {nb_cycles} cycles | "
            f"EC={EC_cible:.1f} dS/m"
        )
    elif scenario == "8_NUAGEUX_CHAUD":
        result["opt_consigne_netajet"] = (
            f"NUAGEUX CHAUD — VPD>{vpd_max:.1f} kPa | EC={EC_cible:.1f} dS/m | "
            f"{nb_cycles} cycles | Départ 08:30 | surveiller EC drain"
        )
    elif scenario == "9_NUIT_FROIDE_SOL":
        result["opt_consigne_netajet"] = (
            f"NUIT FROIDE — racines froides | EC={EC_cible:.1f} dS/m | "
            f"{nb_cycles} cycles | Départ 09:30 | attendre réchauffement sol"
        )
    else:
        result["opt_consigne_netajet"] = (
            f"EC={EC_cible:.1f} dS/m | pH={pH_cible} | {nb_cycles} cycles | "
            f"Départ {SCENARIO_HEURE.get(scenario, '08:00')}"
        )

    # ── Label qualité v1 (EC + pH uniquement, sans nb_tours)
    label_qualite = labelliser_decision(
        ec_apport_humain   = float(row.get("ec_apport",  EC_cible) or EC_cible),
        ec_opt             = EC_cible,
        ph_apport_humain   = float(row.get("ph_apport",  pH_cible) or pH_cible),
        ph_opt             = pH_cible,
        pct_drainage       = pct_drain,
        scenario           = scenario,
    )
    result.update(label_qualite)

    # ── Label matin — MODÈLE 1 (EC + pH programmés le matin)
    label_matin = labelliser_recommandation_matin(
        ec_apport_humain   = float(row.get("ec_apport",  EC_cible) or EC_cible),
        ec_opt             = EC_cible,
        ph_apport_humain   = float(row.get("ph_apport",  pH_cible) or pH_cible),
        ph_opt             = pH_cible,
        scenario           = scenario,
    )
    result.update(label_matin)

    # ── Label séquentiel — MODÈLE 2 (décision tour par tour)
    #
    # IMPORTANT — Ces deux colonnes sont précalculées dans main() par
    # groupby(date+bloc+serre+vanne) + shift/cumsum AVANT la boucle.
    # C'est la seule façon correcte : optimiser_ligne() voit une seule
    # ligne et ne peut pas accéder au tour N-1 par elle-même.
    #
    # _pct_drain_prev : pct_drainage du tour N-1 réel
    #   ≠ moy_pct_drainage (= moyenne cumulative depuis tour 1, pas le dernier)
    #   Exemple journée 9 tours :
    #     Tour 6 : pct=33.8% | moy_csv=6.1% | _pct_drain_prev RÉEL = 11.3% (tour 5)
    #
    # _vol_cumule_L : volume total (L) apporté depuis le début de la journée
    #   Reconstruit depuis v_apport (cc/goutt) × nbr_goutteurs × nbr_bras / 1000
    #   ≠ total_v_apport (= valeur finale de la journée, identique sur toutes les lignes)

    # num_tour déjà calculé plus haut (num_tour_calc) pour le profil durée v5.0
    num_tour_val = int(row.get("num_tour", 1) or 1)

    # Lecture colonnes précalculées
    pct_drain_prec = float(row.get("_pct_drain_prev", np.nan) or np.nan)
    vol_cumule_L   = float(row.get("_vol_cumule_L",   0)      or 0)

    # Volume journalier cible pour cette vanne (L) = vol/tour × nb_cycles recommandé
    vol_jour_cible_L = vol_cycle_L * nb_cycles if nb_cycles > 0 else 0.0

    # mois déjà calculé en haut de la fonction (pour facteur saisonnier v5.0)
    # fallback si non défini
    if 'mois' not in dir():
        mois = 6

    # v5.9 : volume cumulé AVANT ce tour (pour condition STOP_VOLUME à 95%)
    vol_cumule_avant_tour_L = vol_cumule_L - vol_cycle_L

    label_seq = labelliser_tour_sequentiel(
        num_tour                  = num_tour_val,
        pct_drainage_ce_tour      = pct_drain,
        pct_drainage_tour_prec    = pct_drain_prec,
        ec_drain_ce_tour          = float(row.get("ec_drainage", np.nan) or np.nan),
        ec_cible_drain            = stade["EC_drain_cible"],
        volume_cumule_L           = vol_cumule_L,
        volume_journalier_cible_L = vol_jour_cible_L,
        heure_debut_str           = str(row.get("heure_debut", "") or ""),
        scenario                  = scenario,
        mois                      = mois,
        nb_cycles_max_stade       = max_cycles_stade,
        T_max_C                   = T_max_val,
        volume_cumule_avant_tour_L= vol_cumule_avant_tour_L,
    )
    result.update(label_seq)

    # ── Colonnes de diagnostic (utiles pour debug et features ML)
    result["opt_vol_cumule_L"]        = round(vol_cumule_L, 1)
    result["opt_vol_jour_cible_L"]    = round(vol_jour_cible_L, 1)
    result["opt_pct_drain_recalcule"] = round(pct_drain, 2)
    result["opt_pct_drain_prev"]      = round(pct_drain_prec, 2) if not np.isnan(pct_drain_prec) else np.nan

    # ── MODULE 14 — PRT (Pourcentage de Réssuyage / Dry-back)
    # Décisionnaire du déclenchement de la 1ère tour.
    # N'est significatif qu'au tour 1 — les tours suivants reçoivent NA_NON_TOUR1.
    prt_result = calc_opt_PRT(
        poids_soir_kg          = float(row.get("poids_soir_kg", np.nan)      or np.nan),
        poids_matin_kg         = float(row.get("poids_matin_kg", np.nan)     or np.nan),
        pct_ressuyage_terrain  = float(row.get("pct_ressuyage", np.nan)      or np.nan),
        scenario               = scenario,
        num_tour               = num_tour_val,
    )
    result.update(prt_result)

    # ── MODULE 15 — VRAI TEMPS DE REPOS OPÉRATEUR (opt_vrai_repos_min)
    # Calcule le temps de repos avant le tour suivant, en tenant compte du drainage,
    # du scénario météo et du numéro de tour.
    repos_result = calc_opt_vrai_repos(
        pct_drainage_ce_tour = pct_drain,
        num_tour             = num_tour_val,
        scenario             = scenario,
        opt_continuer        = result.get("opt_continuer", 0),
        T_max_C              = T_max_val,
    )
    result.update(repos_result)

    return result


# ════════════════════════════════════════════════════════════════
# MAIN — LECTURE → OPTIMISATION → SAUVEGARDE
# ════════════════════════════════════════════════════════════════

def main():
    import sys, io
    # Forcer UTF-8 sur Windows (console cp1252 ne supporte pas les box-drawing)
    if sys.stdout.encoding != 'utf-8':
        sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
    print("╔" + "═" * 70 + "╗")
    print("║   OPTIMISATION AGRONOMIQUE — TOMATE CERISE / AGADIR  v5.0            ║")
    print("║   3 PASSES : Budget → Redistribution → Gieling + NetaJet int         ║")
    print("╚" + "═" * 70 + "╝\n")

    # ── Lecture CSV enrichi
    if not Path(INPUT_FILE).exists():
        raise FileNotFoundError(
            f"Fichier introuvable : {INPUT_FILE}\n"
            f"Lancez d'abord fusion_irrigation_meteo_complet.py"
        )

    print(f"  Lecture : {INPUT_FILE}")
    df = pd.read_csv(INPUT_FILE, low_memory=False, encoding="utf-8-sig")
    df["date"] = pd.to_datetime(df["date"], errors="coerce", dayfirst=False)
    df = df.dropna(subset=["date"]).reset_index(drop=True)
    print(f"  → {len(df):,} lignes | {df.shape[1]} colonnes")
    print(f"  → Période : {df['date'].min().date()} → {df['date'].max().date()}\n")

    # ════════════════════════════════════════════════════════════════════
    # PRÉ-TRAITEMENT SÉQUENTIEL — reconstruit les colonnes qui nécessitent
    # de connaître le tour précédent dans la même journée/vanne.
    #
    # Pourquoi ce pré-traitement ?
    #   optimiser_ligne() reçoit une seule ligne : elle ne peut pas voir
    #   le tour N-1. On précalcule ici les colonnes "historiques" par groupe
    #   (date + bloc + serre + vanne), triés par num_tour croissant.
    #
    # Colonnes précalculées :
    #   _pct_drain_prev     : pct_drainage du tour N-1 réel
    #                         (≠ moy_pct_drainage qui est une moyenne cumulative)
    #   _vol_cumule_L       : volume total apporté (L) depuis début journée,
    #                         reconstruit tour par tour depuis v_apport (cc/goutt)
    #                         × nbr_goutteurs × nbr_bras / 1000
    #                         (≠ total_v_apport qui est la valeur FINALE du jour)
    # ════════════════════════════════════════════════════════════════════
    print("  Pré-traitement séquentiel (pct_prev + cumul volume tour par tour)...")

    GROUP_KEYS = ["date", "bloc", "serre", "vanne"]

    df = df.sort_values(GROUP_KEYS + ["num_tour"], na_position="last").reset_index(drop=True)

    # Défragmentation : évite PerformanceWarning sur DataFrames à 100+ colonnes
    df = df.copy()

    # pct_drain_prev : shift(1) dans chaque groupe journée+vanne
    df["_pct_drain_prev"] = (
        df.groupby(GROUP_KEYS)["pct_drainage"]
          .shift(1)
    )

    # _ph_drain_prev : pH drainage du tour précédent (feedback substrat pour pH dynamique v5.6)
    df["_ph_drain_prev"] = (
        df.groupby(GROUP_KEYS)["ph_drainage"]
          .shift(1)
    )

    # vrai_repos_reel : repos pur réel pour validation (= ce que le module 15 doit apprendre)
    df["_duree_prev"] = df.groupby(GROUP_KEYS)["duree_min"].shift(1)
    df["vrai_repos_reel"] = (df["temps_repos_min"] - df["_duree_prev"]).clip(lower=0)

    # _vol_cumule_L : cumsum du volume par tour, converti en L PAR GOUTTEUR
    #
    # Formule : v_apport (cc/goutt) / 1000 → L/goutteur
    # Cohérent avec opt_apport_total_mm (mm/goutteur) et calcul volume cible.
    vap = df["v_apport"].fillna(0)
    df["_vol_tour_L"] = vap / 1000.0  # cc/goutt → L/goutteur

    df["_vol_cumule_L"] = (
        df.groupby(GROUP_KEYS)["_vol_tour_L"]
          .cumsum()
    )

    print(f"  → Colonnes séquentielles précalculées sur {len(df):,} lignes")

    # ════════════════════════════════════════════════════════════════════
    # PASS 1 — CALCUL LÉGER DES VOLUMES THÉORIQUES
    # But : obtenir duree_base et nb_cycles pour CHAQUE ligne AVANT
    # la redistribution. Sans feedback, sans NPK, sans labels.
    # Produit : _nb_cycles_opt, _duree_base_min, _vol_cycle_local_L
    # ════════════════════════════════════════════════════════════════════
    print("\n  ─── PASS 1 : Budgets théoriques (ET0 → nb_cycles → duree_base) ───")
    pass1_records = []
    for _, row in tqdm(df.iterrows(), total=len(df), desc="  Pass 1"):
        saison = str(row.get("saison", "2021_2022") or "2021_2022")
        date_plantation = DATES_PLANTATION.get(saison, pd.Timestamp("2021-09-20"))
        pass1_records.append(calc_pass1_theorique(row, date_plantation))

    df_p1 = pd.DataFrame(pass1_records)
    df = pd.concat([df.reset_index(drop=True), df_p1.reset_index(drop=True)], axis=1)
    print(f"  → Pass 1 terminé : {df_p1.shape[1]} colonnes ajoutées")

    # ════════════════════════════════════════════════════════════════════
    # REDISTRIBUTION DYNAMIQUE DU BUDGET DE DURÉE
    # Pour chaque groupe (date+bloc+serre+vanne), calcule :
    #   _duree_budget_total  : budget total du jour = duree_base_tour1 × nb_cycles
    #   _duree_cycle_cible   : durée cible redistribuée pour CE cycle
    #                          = budget_restant / cycles_restants
    # Garantit Σ(opt_duree_min) ≈ budget_total (fermeture boucle volume)
    # ════════════════════════════════════════════════════════════════════
    print("\n  ─── REDISTRIBUTION : Budget de durée par groupe ───")
    df = precompute_redistribution(df, GROUP_KEYS)

    # ════════════════════════════════════════════════════════════════════
    # PASS 2 — OPTIMISATION COMPLÈTE
    # optimiser_ligne() lit _duree_cycle_cible → calc_opt_duree_v2
    # → redistribution + feedback Gieling + arrondi NetaJet
    # ════════════════════════════════════════════════════════════════════
    print("\n  ─── PASS 2 : Décisions optimales complètes (redistribution + Gieling) ───")
    opt_records = []
    for _, row in tqdm(df.iterrows(), total=len(df), desc="  Pass 2"):
        saison = str(row.get("saison", "2021_2022") or "2021_2022")
        date_plantation = DATES_PLANTATION.get(saison, pd.Timestamp("2021-09-20"))
        opt = optimiser_ligne(row, date_plantation)
        opt_records.append(opt)

    # ── Fusion avec le DataFrame original
    df_opt = pd.DataFrame(opt_records)

    df_final = pd.concat([df.reset_index(drop=True), df_opt.reset_index(drop=True)], axis=1)

    # ── Calcul du volume total en mm d'eau apporté sur le substrat (coco)
    #   - total_v_apport est exprimé en cc/goutteur (cumul de v_apport)
    #   - surface du sac de coco : 1.0 m × 0.15 m = 0.15 m²
    #   - 1 mm d'eau sur 1 m² correspond à 1 L, donc sur 0.15 m² correspond à 0.15 L
    #   - facteur de conversion : (nbr_goutteurs = 4 par sac de coco) / (1000 cc · 0.15 L) = 4 / 150
    df_final["total_v_apport_mm"] = (
        df_final["total_v_apport"] * 4 / 1000
    ) / 0.15
    # diviser par 4 car on a besoin du volume pour un seul goutteur et non pour les 4 goutteurs
    df_final["total_v_apport_mm"] = df_final["total_v_apport_mm"] / 4 
    # arrondi à trois décimales pour la lisibilité
    df_final["total_v_apport_mm"] = df_final["total_v_apport_mm"].round(3)

    # ── Décaler opt_vrai_repos_min vers le tour SUIVANT
    # La valeur calculée pour le tour N = repos avant le tour N+1
    # → stocker dans la ligne du tour N+1 | tour 1 = NaN (pas de tour avant)
    df_final["opt_vrai_repos_min"] = (
        df_final.groupby(GROUP_KEYS)["opt_vrai_repos_min"]
        .shift(1)
        .fillna(0)   # tour 1 : pas de repos précédent → 0 par définition
    )
    df_final["opt_repos_mode"] = (
        df_final.groupby(GROUP_KEYS)["opt_repos_mode"]
        .shift(1)
        .fillna("PREMIER_TOUR")   # label explicite
    )

    # ← AJOUTER CES LIGNES :
    # Corriger opt_repos_mode pour les tours hors programme
    # (tours qui viennent après le premier STOP dans le groupe journée+vanne)
    def _marquer_hors_programme(df_final):
        df_final = df_final.copy()
        # cumul des STOP dans chaque groupe, décalé de 1 pour regarder le passé
        df_final["_cumul_stop_prev"] = (
            df_final.groupby(GROUP_KEYS)["opt_continuer"]
                    .transform(lambda s: s.fillna(1).shift(1).fillna(1).cumprod())
        )
        # cumprod de opt_continuer : dès qu'un 0 apparaît, tout ce qui suit = 0
        # → si _cumul_stop_prev == 0 : ce tour vient après un STOP
        masque = df_final["_cumul_stop_prev"] == 0
        df_final.loc[masque, "opt_repos_mode"]    = "HORS_PROGRAMME"
        df_final = df_final.drop(columns=["_cumul_stop_prev"])
        return df_final

    df_final = _marquer_hors_programme(df_final)

    # Supprimer colonnes temporaires de travail
    df_final = df_final.drop(columns=["_vol_tour_L"], errors="ignore")

    # ════════════════════════════════════════════════════════════════════
    # VÉRIFICATION FERMETURE BOUCLE VOLUME
    # Σ(opt_duree_min) ≈ _duree_budget_total ?
    # Si écart > 10% → redistribution insuffisante ou STOP précoce
    # ════════════════════════════════════════════════════════════════════
    verifier_coherence_volume(df_final, GROUP_KEYS)

    # ── Consigne NetaJet : log arrondi entier vs float
    if "opt_duree_min" in df_final.columns and "opt_duree_min_int" in df_final.columns:
        diff_arrondi = (df_final["opt_duree_min_int"] - df_final["opt_duree_min"]).abs()
        print(f"\n  ── CONSIGNE NETAJET (entiers) ────────────────────────────────")
        print(f"  Durée float médiane (ML)   : {df_final['opt_duree_min'].median():.1f} min")
        print(f"  Durée int médiane (NetaJet): {df_final['opt_duree_min_int'].median():.0f} min")
        print(f"  Erreur arrondi médiane     : {diff_arrondi.median():.2f} min")
        print(f"  Erreur arrondi max         : {diff_arrondi.max():.2f} min")
        print(f"  Tours avec arrondi ≤0.5min : {(diff_arrondi <= 0.5).mean()*100:.1f}%")

    # ── Statistiques de validation agronomique
    print("\n  ─── STATISTIQUES AGRONOMIQUES ──────────────────────────────────────")
    print(f"  {'Colonne':<35} {'Valeur moy'}")
    print(f"  {'-'*55}")
    stats = [
        ("opt_ET0_mm_jour",         "mean"),
        ("opt_ETc_mm_jour",         "mean"),
        ("opt_nb_cycles",           "mean"),
        ("opt_EC_cible_dSm",        "mean"),
        ("opt_pH_cible",            "mean"),
        ("opt_volume_total_Lha",    "mean"),
        ("opt_RadS_seuil_Jcm2",     "mean"),
        ("opt_duree_min",           "mean"),
        ("opt_duree_min_int",       "mean"),   # ← entier NetaJet
        ("opt_duree_redistrib_cible","mean"),  # ← cible redistribution
        ("opt_duree_base_min",      "mean"),
        ("opt_duree_facteur",       "mean"),
    ]
    for col, agg in stats:
        if col in df_final.columns:
            val = df_final[col].mean()
            print(f"  {col:<35} {val:.2f}")

    # ── Distribution stades
    print("\n  Distribution des stades phénologiques :")
    stade_dist = df_final.drop_duplicates("date").groupby("opt_stade")["date"].count().sort_index()
    for s, n in stade_dist.items():
        print(f"    {s:<20} {n:>5} jours")

    # ── Distribution opt_PRT_decision (MODULE 14 — v3.0)
    if "opt_PRT_decision" in df_final.columns:
        print("\n  ══ MODULE 14 — Distribution opt_PRT_decision (dry-back / réssuyage) ══")
        prt_tour1 = df_final[df_final["num_tour"] == 1]
        prt_dist  = prt_tour1["opt_PRT_decision"].value_counts()
        for dec, n in prt_dist.items():
            pct = n / len(prt_tour1) * 100
            emoji = {
                "DECLENCHER":         "✅",
                "ATTENDRE":           "⏳",
                "STRESS_HYDRIQUE":    "🔴",
                "ERREUR_MESURE":      "⚠",
                "PLUIE_STOP":         "🌧",
                "NA_SANS_MESURE":     "❓",
                "NA_NON_TOUR1":       "—",
            }.get(dec, "")
            print(f"    {emoji} {dec:<30} {n:>6} tours 1 ({pct:.1f}%)")
        # PRT stats sur tours avec mesure valide
        prt_valides = df_final[
            df_final["opt_PRT_pct"].notna() &
            (df_final["opt_PRT_pct"] > 0) &
            (df_final["num_tour"] == 1)
        ]
        if len(prt_valides) > 0:
            print(f"\n    PRT médian     : {prt_valides['opt_PRT_pct'].median():.2f}%")
            print(f"    PRT moy        : {prt_valides['opt_PRT_pct'].mean():.2f}%")
            print(f"    PRT min / max  : {prt_valides['opt_PRT_pct'].min():.2f}% / {prt_valides['opt_PRT_pct'].max():.2f}%")
            print(f"    Tours 1 avec PRT mesurable : {len(prt_valides)}")
            # PRT par scénario
            print("\n    PRT médian par scénario météo :")
            sc_prt = prt_valides.groupby("scenario_meteo")["opt_PRT_pct"].median().sort_index()
            for sc, med in sc_prt.items():
                print(f"      {sc:<25} {med:.2f}%")

    # ── Distribution opt_duree_mode (v3.0)
    if "opt_duree_mode" in df_final.columns:
        print("\n  ══ MODULE 13 — Distribution opt_duree_mode (durée tour) ══")
        duree_dist = df_final["opt_duree_mode"].value_counts()
        for mode, n in duree_dist.items():
            pct = n / len(df_final) * 100
            emoji = {
                "FEEDBACK_REDISTRIB": "📊✅",
                "REDISTRIB":          "📐",
                "FEEDBACK":           "📊",
                "BASE_FAO":           "🌱",
                "FEEDBACK_BASE_FAO":  "📊🌱",
                "BORNE_MIN":          "⬇",
                "BORNE_MAX":          "⬆",
                "CHERGUI_URGENCE":    "🔴",
                "PLUIE_STOP":         "🌧",
            }.get(mode, "")
            print(f"    {emoji} {mode:<20} {n:>7} tours ({pct:.1f}%)")
        # Comparaison duree humaine vs optimale
        if "duree_min" in df_final.columns and "opt_duree_min" in df_final.columns:
            df_d = df_final.dropna(subset=["duree_min", "opt_duree_min"])
            df_d = df_d[(df_d["duree_min"] > 0) & (df_d["opt_duree_min"] > 0)]
            if len(df_d) > 0:
                ecart = (df_d["duree_min"] - df_d["opt_duree_min"]).abs()
                print(f"\n    Médiane duree_min humain  : {df_d['duree_min'].median():.1f} min")
                print(f"    Médiane opt_duree_min     : {df_d['opt_duree_min'].median():.1f} min")
                print(f"    Médiane écart |humain-opt|: {ecart.median():.1f} min")
                print(f"    Tours humain dans ±2 min  : {(ecart <= 2).mean()*100:.1f}%")

    # ── Distribution MODÈLE 1 — labels matin
    print("\n  ══ MODÈLE 1 — Recommandation matin (EC + pH programmés) ══")
    labels_matin = df_final["opt_label_matin"].value_counts()
    total = len(df_final)
    for lbl, n in labels_matin.items():
        pct = n / total * 100
        emoji = {
            "MATIN_OPTIMAL":    "✅",
            "MATIN_ACCEPTABLE": "🟡",
            "MATIN_A_CORRIGER": "🟠",
            "MATIN_CRITIQUE":   "🔴",
        }.get(lbl, "")
        print(f"    {emoji} {lbl:<25} {n:>6} lignes ({pct:.1f}%)")

    # ── Distribution MODÈLE 2 — labels séquentiels
    print("\n  ══ MODÈLE 2 — Décision tour par tour (label séquentiel) ══")
    labels_seq = df_final["opt_label_sequentiel"].value_counts()
    for lbl, n in labels_seq.items():
        pct = n / total * 100
        emoji = {
            "CONTINUER":        "▶",
            "STOP_OPTIMAL":     "✅",
            "STOP_VOLUME":      "✅",
            "STOP_EC_URGENCE":  "🔴",
            "STOP_HEURE":       "🕐",
            "STOP_PLUIE":       "🌧",
            "STOP_BROUILLARD":  "🌫",
            "STOP_CHERGUI_MAX": "🔴",
        }.get(lbl, "")
        print(f"    {emoji} {lbl:<25} {n:>6} lignes ({pct:.1f}%)")

    # ── Taux de cohérence : nb tours humain dans la plage attendue ?
    if "nbr_tours" in df_final.columns and "opt_nb_cycles" in df_final.columns:
        print("\n  Distribution nb tours humains vs nb cycles recommandés :")
        df_tours = df_final.dropna(subset=["nbr_tours", "opt_nb_cycles"])
        if len(df_tours) > 0:
            diff = (df_tours["nbr_tours"] - df_tours["opt_nb_cycles"]).abs()
            print(f"    Médiane écart |humain - recommandé| : {diff.median():.1f} tours")
            print(f"    Tours humains ≤ recommandé ± 2      : {(diff <= 2).mean()*100:.1f}%")
            print(f"    Tours humains > recommandé + 4       : {(df_tours['nbr_tours'] > df_tours['opt_nb_cycles'] + 4).mean()*100:.1f}% (adaptation terrain normale)")

    # ── Sauvegarde
    df_final = df_final.sort_values(
        by=["date", "bloc", "num_tour", "heure_debut"],
        ascending=[True, True, True, True],
        na_position="last"
    ).reset_index(drop=True)
    # ════════════════════════════════════════════════════════════════════
    # RÉSUMÉ JOURNALIER — Consignes NetaJet 4G du matin (v5.6)
    # Une ligne par jour : EC cible, pH cible, nb_cycles, heure début
    # → À programmer sur le NetaJet 4G au début de chaque journée
    # ════════════════════════════════════════════════════════════════════
    if "opt_pH_cible" in df_final.columns:
        daily_keys = GROUP_KEYS  # ["date", "bloc", "serre", "vanne"]

        # Filtrer les tours avec durée > 0 (exclure PLUIE_STOP = 0 min)
        df_active = df_final[df_final["opt_duree_min_int"] > 0].copy()

        # --- Agrégations journalières ---
        # EC & pH : moyenne des tours actifs (valeur à programmer sur NetaJet)
        daily_ph = (
            df_active.groupby(daily_keys)["opt_pH_cible"]
            .mean().round(1)
            .reset_index()
            .rename(columns={"opt_pH_cible": "_ph_cible_jour"})
        )
        daily_ec = (
            df_active.groupby(daily_keys)["opt_EC_cible_dSm"]
            .mean().round(1)
            .reset_index()
            .rename(columns={"opt_EC_cible_dSm": "_ec_cible_jour"})
        )

        # nb_cycles : nombre RÉEL de tours effectués (pas le théorique opt_nb_cycles)
        daily_cycles_reel = (
            df_active.groupby(daily_keys)
            .size()
            .reset_index(name="_nb_tours_reel_jour")
        )
        # nb_cycles théorique (première ligne = même valeur pour tous les tours)
        daily_cycles_theo = (
            df_final.groupby(daily_keys)["opt_nb_cycles"]
            .first()
            .reset_index()
            .rename(columns={"opt_nb_cycles": "_nb_cycles_theo_jour"})
        )

        # Heure de début, scénario : première ligne du jour
        daily_heure = (
            df_final.groupby(daily_keys)["opt_heure_demarrage"]
            .first().reset_index()
            .rename(columns={"opt_heure_demarrage": "_heure_debut_jour"})
        )
        daily_scenario = (
            df_final.groupby(daily_keys)["scenario_meteo"]
            .first().reset_index()
            .rename(columns={"scenario_meteo": "_scenario_jour"})
        )

        # Durée totale réelle (somme des tours actifs, en minutes)
        daily_duree = (
            df_active.groupby(daily_keys)["opt_duree_min_int"]
            .sum()
            .reset_index()
            .rename(columns={"opt_duree_min_int": "_duree_totale_jour_min"})
        )

        # Volume journalier total (L/ha) — même valeur pour tous les tours
        daily_volume = (
            df_final.groupby(daily_keys)["opt_volume_total_Lha"]
            .first().reset_index()
            .rename(columns={"opt_volume_total_Lha": "_volume_total_Lha_jour"})
        )

        # Apport total (mm) — même valeur pour tous les tours
        daily_mm = (
            df_final.groupby(daily_keys)["opt_apport_total_mm"]
            .first().reset_index()
            .rename(columns={"opt_apport_total_mm": "_apport_total_mm_jour"})
        )

        # --- Fusionner toutes les colonnes ---
        daily_summary = daily_ph
        for _df in [daily_ec, daily_cycles_reel, daily_cycles_theo,
                     daily_heure, daily_scenario, daily_duree,
                     daily_volume, daily_mm]:
            daily_summary = daily_summary.merge(_df, on=daily_keys, how="left")

        # Cycles entier pour NetaJet 4G (arrondi .5 → supérieur)
        daily_summary["_cycles_netajet_jour"] = daily_summary["_nb_cycles_theo_jour"].apply(
            lambda x: max(1, int(round(x)))
        )

        # Réordonner les colonnes
        daily_summary = daily_summary[[
            *daily_keys,
            "_ec_cible_jour",
            "_ph_cible_jour",
            "_cycles_netajet_jour",
            "_nb_cycles_theo_jour",
            "_nb_tours_reel_jour",
            "_heure_debut_jour",
            "_scenario_jour",
            "_duree_totale_jour_min",
            "_apport_total_mm_jour",
            "_volume_total_Lha_jour",
        ]]

        # Sauvegarder le résumé journalier
        daily_file = OUTPUT_FILE.replace(".csv", "_daily.csv")
        daily_summary.to_csv(daily_file, index=False, encoding="utf-8-sig")

        print(f"\n  ── CONSIGNE NETAJET 4G — RÉSUMÉ JOURNALIER (v5.6) ──────────")
        print(f"  Fichier : {daily_file}")
        print(f"  Lignes  : {len(daily_summary):,} jours")
        print()
        print(f"  {'Colonne':<32} {'Moy':>7} {'Min':>7} {'Max':>7}")
        print(f"  {'-'*56}")
        for col in ["_ec_cible_jour", "_ph_cible_jour",
                     "_cycles_netajet_jour",
                     "_nb_cycles_theo_jour", "_nb_tours_reel_jour",
                     "_duree_totale_jour_min", "_apport_total_mm_jour",
                     "_volume_total_Lha_jour"]:
            if col in daily_summary.columns:
                print(f"  {col:<32} {daily_summary[col].mean():>7.1f} "
                      f"{daily_summary[col].min():>7.1f} {daily_summary[col].max():>7.1f}")
        print()
        print(f"  → Programmez sur NetaJet 4G chaque matin :")
        print(f"     EC     = _ec_cible_jour     (dS/m)")
        print(f"     pH     = _ph_cible_jour")
        print(f"     Cycles = _cycles_netajet_jour (entier)")
        print(f"     Début  = _heure_debut_jour")

    df_final.to_csv(OUTPUT_FILE, index=False, encoding="utf-8-sig")

    n_opt_cols = len([c for c in df_final.columns if c.startswith("opt_")])

    print(f"\n  {'═'*65}")
    print(f"  ✅ Fichier sauvegardé : {OUTPUT_FILE}")
    print(f"     Lignes             : {len(df_final):,}")
    print(f"     Colonnes totales   : {df_final.shape[1]}")
    print(f"     Colonnes opt_      : {n_opt_cols}")
    print(f"  {'═'*65}")
    print("""
  ─── GUIDE ENTRAÎNEMENT ML — DOUBLE MODÈLE ────────────────────────

  ┌─────────────────────────────────────────────────────────────────┐
  │  MODÈLE 1 — RECOMMANDATION MATIN (avant 07h00)                  │
  │  Quand : une fois par jour, avant de démarrer l'irrigation      │
  ├─────────────────────────────────────────────────────────────────┤
  │  FEATURES (météo + agronomie du jour) :                         │
  │    meteo_T_max_C, meteo_HR_mean_pct, meteo_VPD_max_kPa          │
  │    meteo_shortwave_radiation_sum, meteo_ET0_mm_jour             │
  │    scenario_meteo, meteo_pluie_mm_jour                          │
  │    opt_stade, opt_Kc, opt_jours_depuis_plantation               │
  │    ec_bassin, moy_pct_drainage (J-1), ec_cumul_drainage (J-1)   │
  │                                                                 │
  │  TARGETS à prédire :                                            │
  │    opt_EC_cible_dSm     → EC à programmer sur NetaJet 4G        │
  │    opt_pH_cible         → pH cible                              │
  │    opt_nb_cycles        → Nb cycles estimé (plafond stade)      │
  │    opt_heure_demarrage  → Heure de départ                       │
  │    opt_duree_base_min   → Durée base tour (FAO-56, sans feedback)│
│    opt_PRT_pct          → % réssuyage (dry-back) mesure balances │
│    opt_PRT_decision     → DECLENCHER/ATTENDRE/STRESS_HYDRIQUE    │
│    opt_PRT_retard_min   → Retard estimé si substrat trop humide  │
  │    opt_canal_A_KNO3_g   → Dose KNO3 / cycle                     │
  │    opt_canal_B_CaNO3_g  → Dose Ca(NO3)2 / cycle                 │
  │    opt_canal_C_MgSO4_g  → Dose MgSO4 / cycle                    │
  │    opt_canal_D_K2SO4_g  → Dose K2SO4 / cycle                    │
  │    opt_dose_acide_HNO3_ml → Correction pH                       │
  │                                                                 │
  │  FILTRE RECOMMANDÉ :                                            │
  │    df_m1 = df[df['opt_label_matin'].isin(                       │
  │        ['MATIN_OPTIMAL', 'MATIN_ACCEPTABLE'])]                  │
  │    # → Une ligne par tour, dédupliquée sur date+bloc+vanne      │
  │    df_m1 = df_m1.groupby(['date','bloc','vanne']).first()       │
  └─────────────────────────────────────────────────────────────────┘

  ┌─────────────────────────────────────────────────────────────────┐
  │  MODÈLE 2 — DÉCISION TOUR PAR TOUR (temps réel)                 │
  │  Quand : après chaque tour, avant de déclencher le suivant      │
  ├─────────────────────────────────────────────────────────────────┤
  │  FEATURES (état substrat + contexte du moment) :                │
  │    pct_drainage         → % drainage CE tour (mesuré)           │
  │    moy_pct_drainage     → % drainage tour PRÉCÉDENT             │
  │    ec_drainage          → EC drain CE tour                      │
  │    ph_drainage          → pH drain CE tour                      │
  │    num_tour             → Position dans la journée (1, 2, 3…)   │
  │    heure_debut          → Heure de démarrage CE tour            │
  │    total_v_apport       → Volume cumulé depuis début journée    │
  │    opt_EC_drain_cible_dSm → EC drain cible du stade             │
  │    opt_volume_total_Lha → Volume journalier cible               │
  │    opt_nb_cycles        → Nb cycles recommandé le matin         │
  │    opt_max_cycles_stade → Plafond physiologique du stade        │
  │    scenario_meteo       → Scénario météo du jour                │
  │    opt_stade            → Stade phénologique                    │
  │    opt_pct_drain_prev   → % drainage tour N-1 précalculé        │
│    opt_PRT_pct          → % réssuyage du matin (tour 1 = signal │
│                           décisif ; tours suivants = NA_NON_TOUR1)│
  │                                                                 │
  │  TARGETS à prédire :                                            │
  │    opt_continuer  (0/1) → STOP ou CONTINUER le tour suivant     │
  │    opt_label_sequentiel → Raison détaillée (classe multiclasse) │
  │    opt_duree_min        → Durée optimale du tour suivant (min)  │
  │                           [Gieling 2001 — feedback proportionnel│
  │                           pct_drain_cible/pct_drain_prev × base]│
  │                                                                 │
  │  FILTRE RECOMMANDÉ :                                            │
  │    # Garder uniquement tours avec drainage mesuré               │
  │    df_m2 = df[df['pct_drainage'].notna()]                       │
  │    # Exclure tours sans mesure fiable                           │
  │    df_m2 = df_m2[df_m2['v_drainage'] > 0]                       │
  │                                                                 │
  │  STRUCTURE SÉQUENTIELLE pour l'entraînement :                   │
  │    - Grouper par (date, bloc, serre, vanne)                     │
  │    - Trier par num_tour croissant                               │
  │    - ajouter pct_drainage_prec = pct_drainage.shift(1)          │
  │    - opt_duree_min est calculé avec ce shift → prêt à l'emploi  │
  │    - Modèle binaire : opt_continuer = 0 ou 1                    │
  │      OU multiclasse : opt_label_sequentiel                      │
  └─────────────────────────────────────────────────────────────────┘

  ─── GUIDE opt_duree_min — INTERPRÉTATION ──────────────────────────

  opt_duree_mode = 'BASE_FAO'   → Tour 1 du jour (aucun drainage précédent)
                                  Durée = volume FAO-56 / débit goutteur
                                  C'est la durée "théorique pure" la plus fiable.

  opt_duree_mode = 'FEEDBACK'   → Tour N≥2 : feedback proportionnel activé
                                  Si drain_prev < 25% → durée augmentée (substrat sec)
                                  Si drain_prev > 25% → durée réduite (gaspillage)
                                  Formule : duree_base × (25 / pct_drain_prev)
                                  Borné à ±30% max par tour (Gieling 2001)

  opt_duree_mode = 'BORNE_MIN'  → Feedback aurait donné < 4 min → forcé à 4 min
                                  (substrat ne peut pas être correctement humidifié)

  opt_duree_mode = 'BORNE_MAX'  → Feedback aurait donné > 14 min → forcé à 14 min
                                  (risque asphyxie racinaire sur substrat coco)

  opt_duree_mode = 'CHERGUI_URGENCE' → Plafonné à 10 min (cycles courts + fréquents)
  opt_duree_mode = 'PLUIE_STOP'      → 0 min (irrigation stoppée)

  Labels STOP agronomiquement sûrs (aucun risque plante) :
    STOP_OPTIMAL     → objectif drainage atteint 2 tours consécutifs
    STOP_VOLUME      → volume journalier cible atteint
    STOP_HEURE       → heure limite (plante ne transpire plus)
    STOP_PLUIE       → humidité naturelle suffisante

  Labels STOP urgence (risque si on ne STOP pas) :
    STOP_EC_URGENCE  → accumulation sels → stress osmotique → perte récolte
    STOP_CHERGUI_MAX → asphyxie racinaire si trop de tours

  CONTINUER → substrat encore sec, objectif volume non atteint, état OK
""")


if __name__ == "__main__":
    main()