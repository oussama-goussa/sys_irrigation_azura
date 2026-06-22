import sys
import io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

"""
╔══════════════════════════════════════════════════════════════════════════════╗
║   AGENT IA IRRIGATION — TOMATE CERISE / AGADIR                              ║
║   Groupe Azura — Souss-Massa, Maroc                                         ║
╠══════════════════════════════════════════════════════════════════════════════╣
║  ARCHITECTURE : 2 × XGBoost                                                 ║
║                                                                              ║
║  XGBoost MATIN  → 1 fois/jour avant 07h00                                  ║
║    Prédit : heure, nb_cycles, EC, pH, alertes, scénario                     ║f
║    Calcule : canaux A/B/C/D par formule directe (physique pure)             ║
║                                                                              ║
║  XGBoost TOUR/TOUR → après chaque cycle d'irrigation                        ║
║    Prédit : CONTINUER ou STOP + raison + durée tour suivant + repos         ║
║                                                                              ║
║  Usage :                                                                     ║
║    python agent_irrigation_xgboost.py --train     → entraîne et sauvegarde ║
║    python agent_irrigation_xgboost.py --predict   → démo prédiction         ║
║    python agent_irrigation_xgboost.py             → train + predict          ║
╚══════════════════════════════════════════════════════════════════════════════╝
"""

import pandas as pd
import numpy as np
import joblib
import json
import warnings
import argparse
from pathlib import Path
from datetime import datetime

warnings.filterwarnings("ignore")

import xgboost as xgb
from sklearn.preprocessing import LabelEncoder
from sklearn.metrics import accuracy_score, r2_score, mean_absolute_error, f1_score, mean_squared_error

# v5.9: Plus besoin d'importer FACTEUR_PAR_TOUR/get_facteur_tour ici.
#   Ces règles sont déjà intégrées dans le label d'entraînement (calc_opt_duree_v2).
#   predict_tour() ne garde que les bornes [4,14] et la décroissance obligatoire.

# ════════════════════════════════════════════════════════════════
# CONFIGURATION
# ════════════════════════════════════════════════════════════════

INPUT_FILE   = "irrigation_meteo_optimise.csv"
MODELS_DIR   = Path("models_xgboost")

# ── v2 : Dossiers de sortie pour prédictions individuelles + importances ──
# (nécessaires pour scatter plots, résidus, et feature importance — voir
#  generer_graphes_agent_xgboost.py)
PREDICTIONS_DIR_AGENT = Path("predictions_agent_xgboost")
IMPORTANCES_DIR_AGENT = Path("importances_agent_xgboost")
PREDICTIONS_DIR_AGENT.mkdir(exist_ok=True)
IMPORTANCES_DIR_AGENT.mkdir(exist_ok=True)
MAX_SAMPLES_SAUVES_AGENT = 5000


def sauvegarder_predictions_agent(target, y_true, y_pred, type_):
    """Sauvegarde y_true/y_pred pour une target donnée (modèle XGBoost unique)."""
    n = len(y_true)
    if n > MAX_SAMPLES_SAUVES_AGENT:
        rng = np.random.RandomState(RANDOM_STATE)
        idx = rng.choice(n, MAX_SAMPLES_SAUVES_AGENT, replace=False)
        y_true_s = np.asarray(y_true)[idx]
        y_pred_s = np.asarray(y_pred)[idx]
    else:
        y_true_s = np.asarray(y_true)
        y_pred_s = np.asarray(y_pred)

    df_out = pd.DataFrame({"y_true": y_true_s, "y_pred": y_pred_s})
    if type_ == "regression":
        df_out["residu"] = df_out["y_true"] - df_out["y_pred"]

    safe_target = str(target).replace("/", "_")
    df_out.to_csv(PREDICTIONS_DIR_AGENT / f"{safe_target}__XGBoost.csv",
                   index=False, encoding="utf-8-sig")


def sauvegarder_importance_agent(target, model, feature_names):
    """Sauvegarde l'importance des variables pour une target donnée."""
    try:
        importances = model.feature_importances_
    except AttributeError:
        return
    df_imp = pd.DataFrame({
        "feature": feature_names,
        "importance": importances,
    }).sort_values("importance", ascending=False).reset_index(drop=True)
    safe_target = str(target).replace("/", "_")
    df_imp.to_csv(IMPORTANCES_DIR_AGENT / f"{safe_target}__XGBoost.csv",
                   index=False, encoding="utf-8-sig")
RANDOM_STATE = 42

# Paramètres physiques fixes (rapport Azura)
EC_TO_ENGR       = 0.1        # 1 g/L ≈ 0.1 dS/m
IE_GOUTTE        = 0.92       # efficience goutte-à-goutte NetaJet 4G
DEBIT_GOUTT_CC_MIN = 1000/60  # cc/min (1 L/h)

# Canaux NetaJet 4G — ratios par stade
RATIOS_CANAUX = {
    "Végétatif":    (0.45, 0.30, 0.15, 0.10),
    "Développement":(0.43, 0.31, 0.15, 0.11),
    "Floraison":    (0.42, 0.33, 0.15, 0.10),
    "Grossissement":(0.40, 0.33, 0.16, 0.11),
    "Maturation":   (0.35, 0.28, 0.17, 0.20),
}

# ════════════════════════════════════════════════════════════════
# FEATURES
# ════════════════════════════════════════════════════════════════

# ── Modèle 1 : Matin ──────────────────────────────────────────
FEATURES_MATIN = [
    "meteo_T_max_C", "meteo_T_min_C", "meteo_T_mean_C",
    "meteo_HR_max_pct", "meteo_HR_min_pct", "meteo_HR_mean_pct",
    "meteo_VPD_max_kPa", "meteo_ET0_mm_jour",
    "meteo_shortwave_radiation_sum", "meteo_pluie_mm_jour",
    "meteo_vent_max_kmh", "meteo_rs_wm2_max_jour",
    "opt_Kc", "opt_jours_depuis_plantation", "opt_FL",
    "ec_bassin", "moy_pct_drainage", "ec_cumul_drainage",
    "alerte_chergui", "alerte_pluie", "alerte_brouillard", "alerte_vpd_stress",
]

# Targets ML Matin (classification)
TARGETS_MATIN_CLF = {
    "opt_heure_demarrage": "1. Heure démarrage",
    "scenario_meteo":      "8d. Scénario météo",
    "opt_alerte_chergui":  "8a. Alerte Chergui",
    "opt_alerte_pluie":    "8b. Alerte pluie",
    "opt_alerte_brouillard":"8c. Alerte brouillard",
}

# Targets ML Matin (régression)
TARGETS_MATIN_REG = {
    "opt_nb_cycles":       "2. Nombre de cycles",
    "opt_apport_total_mm": "1. Quantité eau (mm/jour)",
    "opt_ET0_mm_jour":     "ET0 (intermédiaire)",
    "opt_ETc_mm_jour":     "ETc (intermédiaire)",
    "opt_EC_cible_dSm":    "3. EC à programmer",
    "opt_pH_cible":        "4. pH cible",
    "opt_duree_tour1_min": "Durée TOUR 1 (avant drainage)",
}

# ── Modèle 2 : Tour/tour ──────────────────────────────────────
FEATURES_TOUR = [
    "pct_drainage", "ec_drainage", "ph_drainage",
    "num_tour", "v_apport",
    "_pct_drain_prev",
    "pct_drainage_lag1", "pct_drainage_lag2", "pct_drainage_lag3",
    "ec_drainage_lag1", "ec_drainage_lag2",
    "opt_vol_cumule_L", "opt_vol_jour_cible_L",
    "opt_vol_ratio",          # NOUVEAU: ratio volume cumule / cible (0-1+)
    "opt_vol_restant_L",      # NOUVEAU: volume restant a apporter (L/goutt)
    "opt_EC_drain_cible_dSm", "opt_nb_cycles", "opt_max_cycles_stade",
    # v7.x: météo TEMPS RÉEL au moment "datetime_fin" du tour (au lieu des agrégats journaliers)
    "meteo_actuel_temperature_2m", "meteo_actuel_vapour_pressure_deficit",
    "meteo_actuel_relative_humidity_2m", "meteo_actuel_windspeed_10m",
    "meteo_rs_wm2_actuel", "meteo_pression_actuelle_kPa",
    "alerte_chergui_actuel", "alerte_pluie_actuel", "alerte_pluie_legere_actuel",
    "alerte_brouillard_actuel", "alerte_vpd_stress_actuel", "alerte_vent_actuel",
    "ec_bassin", "ec_apport", "ph_apport",
    "drain_zone",  # v5.7: zone drainage explicite (0=high→8min, 1=med→10min, 2=low→12min)
    "scenario_meteo",  # v5.7: scénario (contexte global du jour) pour cas spéciaux Chergui/Pluie
]

TARGETS_TOUR_CLF = {
    "opt_continuer":        "9. Continuer (1) ou STOP (0)",
    "opt_label_sequentiel": "9b. Raison STOP détaillée",
}

TARGETS_TOUR_REG = {
    "opt_duree_min": "3b. Durée tour suivant (float)",
}

# ── Modèle 2b : Repos (décision humaine) ──────────────────────
# v6.2: Modèle dédié au repos basé sur la décision humaine (temps_repos_min)
# v6.5: Corrigé — vrai_repos_reel = calcul système, temps_repos_min = décision humaine
#   L'opérateur décide du repos en fonction du PRT de drainage :
#   - Si le drainage atteint le pic → augmente le repos
#   - Si le drainage ne diminue pas → stop
#   Features: drainage du tour ACTUEL (ce que l'opérateur observe AVANT de décider)
#   + évolution du drainage (change, accel) + lag features
#   Label shifté par (date, bloc) pour avoir le repos APRÈS le tour actuel
FEATURES_REPOS = [
    # Mode de repos programmé (v6.3: target-encoded, très prédictif)
    "opt_repos_mode",
    # Drainage du tour ACTUEL (ce que l'opérateur observe)
    "pct_drainage", "ec_drainage", "ph_drainage", "v_drainage",
    "moy_pct_drainage", "moy_pct_drainage_jour",
    # Évolution du drainage (tour actuel vs précédent)
    "_pct_drain_prev",
    "drainage_change",       # pct_drainage - _pct_drain_prev
    "drainage_accel",        # pct_drainage - pct_drainage_lag1
    "ec_drain_change",       # ec_drainage - ec_drainage_lag1
    "ph_drain_change",       # ph_drainage - ph_drainage_lag1
    "v_drain_change",        # v_drainage - v_drainage_lag1
    # Lag features (historique)
    "pct_drainage_lag1", "pct_drainage_lag2", "pct_drainage_lag3",
    "ec_drainage_lag1", "ec_drainage_lag2",
    "opt_pct_drain_prev", "opt_pct_drain_recalcule",
    # Volume
    "opt_vol_cumule_L", "opt_vol_jour_cible_L", "opt_vol_ratio", "opt_vol_restant_L",
    # Programme
    "num_tour", "opt_nb_cycles", "opt_max_cycles_stade", "opt_continuer",
    # Qualité d'eau
    "ec_apport", "ph_apport", "ec_bassin",
    # Optimisation
    "opt_EC_drain_cible_dSm", "opt_drainage_cible_ajuste",
    "opt_score_ecart", "opt_alerte_drainage_ko", "opt_pH_cible",
    "opt_k_scenario_volume", "opt_ET0_mm_jour", "opt_ETc_mm_jour",
    # Météo TEMPS RÉEL (au moment "datetime_fin" du tour)
    "meteo_actuel_temperature_2m", "meteo_actuel_vapour_pressure_deficit",
    "meteo_rs_wm2_actuel", "meteo_pression_actuelle_kPa",
    # Alertes TEMPS RÉEL
    "alerte_chergui_actuel", "alerte_pluie_actuel", "alerte_brouillard_actuel",
    "alerte_vpd_stress_actuel", "alerte_vent_actuel",
    # Zone drainage
    "drain_zone",
    # v6.3: Features temporelles (converties en minutes depuis minuit)
    "heure_debut_min", "heure_soir_min", "heure_matin_min",
    # v6.3: Features cumulées EC
    "ec_cumul_apport", "ec_cumul_drainage",
    # v6.3: Durée
    "duree_min",
    # v6.4: Features d'interaction et position dans la journée
    "tours_par_jour", "ratio_tour_jour",
    "repos_mode_x_drainage", "repos_mode_x_num_tour", "repos_mode_x_heure",
]

# v6.5: Corrigé — vrai_repos_reel = repos calculé (pas humain), temps_repos_min = décision humaine
TARGET_REPOS = "temps_repos_min"  # Label: décision humaine (pas l'optimisation)


# ════════════════════════════════════════════════════════════════
# REPOS PATTERN TABLE (v6.9) — Basée sur les vrais patterns humains du CSV
# ════════════════════════════════════════════════════════════════
# Le ML (même en v6.8) donne des valeurs incohérentes car le signal est trop faible.
# Solution : extraire directement les patterns réels de temps_repos_min du CSV
# basés sur les 2 variables clés que l'opérateur utilise :
#   1. Le drainage du tour actuel (pct_drainage)
#   2. Le numéro de tour dans la journée (num_tour)

def _build_repos_pattern_table(input_file=INPUT_FILE):
    """
    Construit la table de correspondance des patterns de repos humain
    directement depuis le CSV d'historique.

    Returns:
        dict avec 'by_drain_and_tour', 'by_drain', 'by_tour', 'global_median'
    """
    df = pd.read_csv(input_file)
    repos = df[(df['temps_repos_min'] > 0) & (df['temps_repos_min'] <= 60)].copy()

    # Discretiser le drainage en zones
    repos['drain_bin'] = pd.cut(
        repos['pct_drainage'],
        bins=[0, 10, 20, 30, 50, 100],
        labels=['<10', '10-20', '20-30', '30-50', '>50'],
        right=False
    )

    # Limiter num_tour à 18 (au-delà, données trop peu fiables)
    repos = repos[repos['num_tour'] <= 18]

    # Table 2D précise: drain_bin x num_tour (médiane)
    table_2d = repos.pivot_table(
        values='temps_repos_min', index='drain_bin', columns='num_tour', aggfunc='median'
    )

    # Fallback 1D: par zone de drainage
    by_drain = repos.groupby('drain_bin')['temps_repos_min'].median().to_dict()

    # Fallback 1D: par num_tour
    by_tour = repos.groupby('num_tour')['temps_repos_min'].median().to_dict()

    # Médiane globale (fallback final)
    global_median = repos['temps_repos_min'].median()

    return {
        'by_drain_and_tour': table_2d,
        'by_drain': by_drain,
        'by_tour': by_tour,
        'global_median': global_median,
    }


def get_repos_pattern(pct_drainage, num_tour, patterns=None):
    """
    Retourne le repos humain basé sur les patterns réels du CSV.

    Args:
        pct_drainage: drainage mesuré du tour actuel (%)
        num_tour: numéro du tour actuel (1, 2, 3, ...)
        patterns: dict retourné par _build_repos_pattern_table()
                   Si None, utilise les valeurs par défaut

    Returns:
        repos en minutes (int)
    """
    if patterns is None:
        patterns = _build_repos_pattern_table()

    # Déterminer la zone de drainage
    if pct_drainage < 10:
        drain_bin = '<10'
    elif pct_drainage < 20:
        drain_bin = '10-20'
    elif pct_drainage < 30:
        drain_bin = '20-30'
    elif pct_drainage < 50:
        drain_bin = '30-50'
    else:
        drain_bin = '>50'

    # Clamper num_tour entre 2 et 18
    nt = max(2, min(18, int(num_tour)))

    # 1. Essayer table 2D (drain_bin x num_tour)
    table_2d = patterns['by_drain_and_tour']
    if drain_bin in table_2d.index and nt in table_2d.columns:
        val = table_2d.loc[drain_bin, nt]
        if not pd.isna(val):
            return int(round(val))

    # 2. Fallback: par zone de drainage seulement
    if drain_bin in patterns['by_drain']:
        return int(round(patterns['by_drain'][drain_bin]))

    # 3. Fallback: par num_tour seulement
    if nt in patterns['by_tour']:
        return int(round(patterns['by_tour'][nt]))

    # 4. Fallback final: médiane globale
    return int(round(patterns['global_median']))


# Construire les patterns au chargement du module
REPOS_PATTERNS = _build_repos_pattern_table()


# ════════════════════════════════════════════════════════════════
# UTILITAIRES
# ════════════════════════════════════════════════════════════════

def preparer_features(df, features_list, encoders=None, fit=True):
    """
    Sélectionne, encode et remplit les features.
    Si fit=True, crée les encodeurs. Si fit=False, utilise les encodeurs existants.
    ERREUR EXPLICITE si une feature obligatoire est absente du CSV.
    """
    # ── Vérification colonnes obligatoires ──────────────────────
    cols_manquantes = [c for c in features_list if c not in df.columns]
    if cols_manquantes:
        raise ValueError(
            f"\n{'═'*65}\n"
            f"  ❌ ERREUR — FEATURES MANQUANTES DANS LE CSV\n"
            f"{'═'*65}\n"
            f"  Les colonnes suivantes sont requises mais absentes :\n"
            + "".join(f"    ✗ {c}\n" for c in cols_manquantes) +
            f"\n  Vérifiez :\n"
            f"    1. Que 1_fusion_irrigation_meteo_complet.py a bien tourné\n"
            f"    2. Que 2_optimisation_irrigation_agadir.py a bien tourné\n"
            f"    3. Que le fichier CSV utilisé est bien 'irrigation_meteo_optimise.csv'\n"
            f"{'═'*65}"
        )

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
                def safe_transform(val):
                    val = str(val) if not pd.isna(val) else "INCONNU"
                    return le.transform([val])[0] if val in le.classes_ else -1
                X[col] = X[col].fillna("INCONNU").apply(safe_transform)
            else:
                X[col] = 0

    X = X[features_list]
    X = X.fillna(X.median(numeric_only=True))
    return X, encoders, cols_dispo


def split_temporel(df, test_ratio=0.20):
    """Split temporel — dernière saison = test."""
    df_sorted = df.sort_values("date").reset_index(drop=True)
    n_test = int(len(df_sorted) * test_ratio)
    return df_sorted.iloc[:-n_test].copy(), df_sorted.iloc[-n_test:].copy()


def afficher_score(nom, target, type_, score, metrique):
    flag = "🟢" if score >= 0.98 else ("🟡" if score >= 0.95 else ("🟠" if score >= 0.90 else "🔴"))
    print(f"    {nom:<12} {target:<30} {score:.4f}  {metrique}  {flag}")


# ════════════════════════════════════════════════════════════════
# CALCUL DÉTERMINISTE DES CANAUX NPK
# Formule physique directe — plus fiable que ML (R² 1.00)
# ════════════════════════════════════════════════════════════════

def calculer_canaux_npk(ec_cible, ec_bassin, volume_cycle_L, stade, facteur_npk=1.0):
    """
    Calcule les doses engrais par canal NetaJet 4G.
    Formule §5.3 rapport Azura : 1 g/L ≈ 0.1 dS/m
    """
    ec_ajouter  = max(0.0, ec_cible - ec_bassin)
    conc_gL     = (ec_ajouter / EC_TO_ENGR) * facteur_npk
    dose_totale = conc_gL * volume_cycle_L

    A, B, C, D  = RATIOS_CANAUX.get(stade, (0.42, 0.33, 0.15, 0.10))

    return {
        "EC_ajouter_dSm":   round(ec_ajouter, 2),
        "conc_engrais_gL":  round(conc_gL, 2),
        "dose_totale_g":    round(dose_totale, 1),
        "canal_A_KNO3_g":   round(dose_totale * A, 1),
        "canal_B_CaNO3_g":  round(dose_totale * B, 1),
        "canal_C_MgSO4_g":  round(dose_totale * C, 1),
        "canal_D_K2SO4_g":  round(dose_totale * D, 1),
    }


def calculer_correction_pH(pH_mesure, pH_cible, volume_m3):
    """
    Calcule la dose de correction pH.
    Formule §5.4 rapport Azura.
    """
    dose_acide = 0.0
    dose_base  = 0.0
    statut     = "OPTIMAL"

    if pH_mesure > pH_cible + 0.5:
        dose_acide = (pH_mesure - pH_cible) * 15.0 * volume_m3
        statut = f"ACIDIFIER — Ajouter {dose_acide:.0f} ml HNO3"
    elif pH_mesure < pH_cible - 0.5:
        dose_base = (pH_cible - pH_mesure) * 10.0 * volume_m3
        statut = f"BASIFIER — Ajouter {dose_base:.0f} ml KOH"

    return {"dose_acide_HNO3_ml": round(dose_acide, 1),
            "dose_base_KOH_ml":   round(dose_base, 1),
            "statut_pH":          statut}


# ════════════════════════════════════════════════════════════════
# ÉTAPE 1 — CHARGEMENT ET PRÉPARATION DES DONNÉES
# ════════════════════════════════════════════════════════════════

def charger_donnees(path=INPUT_FILE):
    print(f"\n{'═'*65}")
    print(f"  CHARGEMENT : {path}")
    print(f"{'═'*65}")

    df = pd.read_csv(path, low_memory=False, encoding="utf-8-sig")
    df["date"] = pd.to_datetime(df["date"], errors="coerce")
    df = df.dropna(subset=["date"]).reset_index(drop=True)
    print(f"  → {len(df):,} lignes | {df.shape[1]} colonnes")
    print(f"  → Période : {df['date'].min().date()} → {df['date'].max().date()}")

    # ── Features lag séquentielles pour Modèle 2
    GROUP = ["date", "bloc", "serre", "vanne"]
    df = df.sort_values(GROUP + ["num_tour"]).reset_index(drop=True)

    for lag in [1, 2, 3]:
        df[f"pct_drainage_lag{lag}"] = (
            df.groupby(GROUP)["pct_drainage"].shift(lag)
        )
    for lag in [1, 2]:
        df[f"ec_drainage_lag{lag}"] = (
            df.groupby(GROUP)["ec_drainage"].shift(lag)
        )

    # ── Durée tour 1 : opt_duree_min du tour 1 propagée à toute la journée ──
    # Le modèle matin prédit cette valeur (pas de drainage disponible au tour 1)
    # Le modèle tour/tour prend le relais à partir du tour 2 (drainage mesuré)
    df_tour1 = (
        df[df["num_tour"] == 1][["date", "bloc", "serre", "vanne", "opt_duree_min"]]
        .copy()
        .rename(columns={"opt_duree_min": "opt_duree_tour1_min"})
    )
    df = df.merge(df_tour1, on=["date", "bloc", "serre", "vanne"], how="left")
    n_tour1 = df["opt_duree_tour1_min"].notna().sum()
    print(f"  → opt_duree_tour1_min ajouté : {n_tour1:,} lignes renseignées")

    return df


# ════════════════════════════════════════════════════════════════
# ÉTAPE 2 — ENTRAÎNEMENT MODÈLE 1 (MATIN)
# ════════════════════════════════════════════════════════════════

def entrainer_modele_matin(df):
    print(f"\n{'═'*65}")
    print("  ENTRAÎNEMENT — MODÈLE 1 : RECOMMANDATION MATIN")
    print(f"{'═'*65}")

    # Dataset : un enregistrement par journée × vanne (tour 1 uniquement)
    df_m1 = df[df["num_tour"] == 1].copy()
    df_m1 = df_m1.dropna(subset=["opt_nb_cycles", "opt_EC_cible_dSm"]).reset_index(drop=True)
    print(f"  Dataset : {len(df_m1):,} journées × vannes")

    train, test = split_temporel(df_m1)
    print(f"  Train : {len(train):,} | Test : {len(test):,}")

    modeles = {}
    encoders_matin = {}
    scores = []

    # ── Régression ───────────────────────────────────────────
    print("\n  ── Régression ──")
    X_train, enc, feats = preparer_features(train, FEATURES_MATIN, fit=True)
    X_test,  _,   _    = preparer_features(test,  FEATURES_MATIN, encoders=enc, fit=False)
    encoders_matin["features"] = enc
    encoders_matin["feats_list"] = feats

    for target, label in TARGETS_MATIN_REG.items():
        if target not in df_m1.columns:
            continue

        y_train = train[target].fillna(train[target].median())
        y_test  = test[target].fillna(test[target].median())

        model = xgb.XGBRegressor(
            n_estimators=500, max_depth=6, learning_rate=0.04,
            subsample=0.85, colsample_bytree=0.85,
            min_child_weight=3, gamma=0.1,
            random_state=RANDOM_STATE, verbosity=0, n_jobs=-1
        )
        model.fit(
            X_train, y_train,
            eval_set=[(X_test, y_test)],
            verbose=False
        )

        y_pred = model.predict(X_test)
        r2   = r2_score(y_test, y_pred)
        mae  = mean_absolute_error(y_test, y_pred)
        rmse = float(np.sqrt(mean_squared_error(y_test, y_pred)))

        modeles[f"reg_{target}"] = model
        scores.append({"target": target, "label": label, "type": "R²",
                        "score": r2, "detail": f"MAE={mae:.3f}", "mae": mae, "rmse": rmse})
        afficher_score("XGBoost", label, "reg", r2, "R²")
        sauvegarder_predictions_agent(target, y_test, y_pred, "regression")
        sauvegarder_importance_agent(target, model, feats)

    # ── Classification ────────────────────────────────────────
    print("\n  ── Classification ──")
    encoders_cibles = {}

    for target, label in TARGETS_MATIN_CLF.items():
        if target not in df_m1.columns:
            continue

        le = LabelEncoder()
        y_all   = df_m1[target].fillna("INCONNU").astype(str)
        le.fit(y_all)
        y_train = le.transform(train[target].fillna("INCONNU").astype(str))
        y_test  = le.transform(test[target].fillna("INCONNU").astype(str))
        n_cls   = len(le.classes_)

        if n_cls <= 1:
            print(f"    ⚠ {target} : une seule classe → ignoré")
            continue

        xgb_params = dict(
            n_estimators=500, max_depth=6, learning_rate=0.04,
            subsample=0.85, colsample_bytree=0.85,
            min_child_weight=3,
            use_label_encoder=False,
            random_state=RANDOM_STATE, verbosity=0, n_jobs=-1
        )
        if n_cls > 2:
            xgb_params["num_class"]  = n_cls
            xgb_params["objective"]  = "multi:softprob"
            xgb_params["eval_metric"] = "mlogloss"
        else:
            xgb_params["objective"]  = "binary:logistic"
            xgb_params["eval_metric"] = "logloss"

        model = xgb.XGBClassifier(**xgb_params)
        model.fit(X_train, y_train, eval_set=[(X_test, y_test)], verbose=False)

        y_pred = model.predict(X_test)
        acc = accuracy_score(y_test, y_pred)
        f1  = f1_score(y_test, y_pred, average="weighted", zero_division=0)

        modeles[f"clf_{target}"] = model
        encoders_cibles[target]  = le
        scores.append({"target": target, "label": label, "type": "Accuracy",
                        "score": acc, "detail": f"F1={f1:.4f}"})
        afficher_score("XGBoost", label, "clf", acc, "Accuracy")
        y_test_labels = le.inverse_transform(y_test)
        y_pred_labels = le.inverse_transform(y_pred)
        sauvegarder_predictions_agent(target, y_test_labels, y_pred_labels, "classification")
        sauvegarder_importance_agent(target, model, feats)

    encoders_matin["cibles"] = encoders_cibles

    # Score moyen
    score_moy = np.mean([s["score"] for s in scores])
    flag = "🟢" if score_moy >= 0.97 else "🟡"
    print(f"\n  Score moyen Modèle 1 : {score_moy:.4f}  {flag}")

    return modeles, encoders_matin, scores


# ════════════════════════════════════════════════════════════════
# ÉTAPE 3 — ENTRAÎNEMENT MODÈLE 2 (TOUR/TOUR)
# ════════════════════════════════════════════════════════════════

def entrainer_modele_tour(df):
    print(f"\n{'═'*65}")
    print("  ENTRAÎNEMENT — MODÈLE 2 : DÉCISION TOUR PAR TOUR")
    print(f"{'═'*65}")

    # v6.4 : exclure explicitement les lignes sans météo "actuel" fiable
    # (générées par 2_optimisation_irrigation_agadir.py avec _exclu_dataset_ml=1,
    # opt_label_sequentiel="EXCLU_METEO_ACTUEL_MANQUANTE", opt_continuer=NaN).
    # Filtre explicite (plutôt que de compter uniquement sur le dropna ci-dessous)
    # pour rester robuste si la logique amont change.
    if "_exclu_dataset_ml" in df.columns:
        n_excl = int((df["_exclu_dataset_ml"] == 1).sum())
        if n_excl > 0:
            print(f"  ⚠️  {n_excl:,} lignes exclues (météo 'actuel' manquante, _exclu_dataset_ml=1)")
        df = df[df["_exclu_dataset_ml"] != 1].copy()

    df_m2 = df.dropna(subset=["pct_drainage", "opt_continuer"]).copy()
    df_m2 = df_m2[df_m2["v_drainage"] > 0].reset_index(drop=True)

    # Calculer les features derivees volume
    # v5.9: utiliser volume AVANT ce tour pour opt_vol_ratio (cohérent avec STOP_VOLUME à 95%)
    if "opt_vol_cumule_L" in df_m2.columns and "opt_vol_jour_cible_L" in df_m2.columns:
        vj = df_m2["opt_vol_jour_cible_L"].replace(0, np.nan)
        # Volume avant ce tour = cumul - volume du cycle en cours
        if "opt_volume_cycle_corrige_L" in df_m2.columns:
            vol_avant_tour = (df_m2["opt_vol_cumule_L"] - df_m2["opt_volume_cycle_corrige_L"]).clip(lower=0)
        else:
            vol_avant_tour = df_m2["opt_vol_cumule_L"]
        df_m2["opt_vol_ratio"]     = (vol_avant_tour / vj).clip(0, 2.0).fillna(0.0)
        df_m2["opt_vol_restant_L"] = (vj - vol_avant_tour).clip(lower=0).fillna(0.0)
        print(f"  Features volume derivees ajoutees: opt_vol_ratio, opt_vol_restant_L (vol_avant_tour)")

    # v6.3: Convertir les colonnes heure_* (string "HH:MM") en minutes depuis minuit
    def _time_to_min(series):
        s = series.fillna("00:00").astype(str)
        parts = s.str.split(":", expand=True)
        return (parts[0].astype(float) * 60 + parts[1].astype(float)).fillna(0)

    for _col in ["heure_debut", "heure_soir", "heure_matin"]:
        _min_col = f"{_col}_min"
        if _col in df_m2.columns:
            df_m2[_min_col] = _time_to_min(df_m2[_col])

    # v5.7: Feature engineering — zone drainage explicite (3 paliers comme duree_by_drainage)
    df_m2["drain_zone"] = 1.0  # défaut: zone médiane (10 min)
    df_m2.loc[df_m2["_pct_drain_prev"] <= 0, "drain_zone"] = 2.0   # low drain → 12 min
    df_m2.loc[df_m2["_pct_drain_prev"] > 25, "drain_zone"] = 0.0   # high drain → 8 min

    # v6.9: Décaler opt_duree_min vers la ligne précédente (même logique que temps_repos_min)
    #   Dans le CSV, opt_duree_min à la ligne N (tour N) a été calculé à partir du
    #   drainage du tour N-1 (_pct_drain_prev de la ligne N) → déjà dans les features
    #   de la ligne N, donc cible redondante/non prédictive.
    #   On veut prédire la DURÉE DU TOUR SUIVANT à partir du drainage du tour ACTUEL
    #   (pct_drainage de la ligne N) → cible = opt_duree_min de la ligne N+1
    #   (même vanne/serre/bloc/date, num_tour suivant).
    GROUP_VANNE = ["date", "bloc", "serre", "vanne"]
    if all(c in df_m2.columns for c in GROUP_VANNE) and "opt_duree_min" in df_m2.columns:
        if "heure_debut" in df_m2.columns:
            df_m2 = df_m2.sort_values(GROUP_VANNE + ["num_tour"] if "num_tour" in df_m2.columns
                                       else GROUP_VANNE + ["heure_debut"]).reset_index(drop=True)
        df_m2["opt_duree_min_shifted"] = (
            df_m2.groupby(GROUP_VANNE)["opt_duree_min"].shift(-1)
        )
        n_shift_d = df_m2["opt_duree_min_shifted"].notna().sum()
        print(f"  Label durée optimisé décalé (date, bloc, serre, vanne) : {n_shift_d:,} valides "
              f"(dernier tour de chaque journée exclu)")

    # v6.1: Décaler le label temps_repos_min d'une ligne vers le haut
    #   Dans le CSV, temps_repos_min à la ligne N = repos APRÈS le tour N-1
    #   On veut prédire le repos APRÈS le tour N → label = valeur de la ligne N+1
    # v6.2: Shift par (date, num_tour) car les 2 blocs sont irrigués en même temps
    #   et ont le même repos. Le shift par date seul traverse les blocs → FAUX.
    group_col = "date"
    if group_col in df_m2.columns and "temps_repos_min" in df_m2.columns:
        if "heure_debut" in df_m2.columns:
            df_m2 = df_m2.sort_values(["date", "heure_debut"]).reset_index(drop=True)
        # Shift par (date, num_tour) pour ne pas traverser les blocs
        df_m2["temps_repos_min_shifted"] = df_m2.groupby(["date", "num_tour"])["temps_repos_min"].shift(-1)
        n_shifted = df_m2["temps_repos_min_shifted"].notna().sum()
        n_orig = df_m2["temps_repos_min"].notna().sum()
        print(f"  Label repos optimisé décalé (date, num_tour) : {n_shifted:,} valides (vs {n_orig:,} original)")

    print(f"  Dataset : {len(df_m2):,} tours avec drainage mesuré")
    print(f"  CONTINUER={df_m2['opt_continuer'].mean()*100:.1f}% | STOP={100-df_m2['opt_continuer'].mean()*100:.1f}%")

    train, test = split_temporel(df_m2)
    print(f"  Train : {len(train):,} | Test : {len(test):,}")

    modeles   = {}
    encoders_tour = {}
    scores    = []

    X_train, enc, feats = preparer_features(train, FEATURES_TOUR, fit=True)
    X_test,  _,   _    = preparer_features(test,  FEATURES_TOUR, encoders=enc, fit=False)
    encoders_tour["features"] = enc
    encoders_tour["feats_list"] = feats

    # ── Sauvegarder les médianes des lags pour le bootstrap à l'inférence ──
    # Tours 1/2/3 ont des lags NaN → fillna(médiane) à l'entraînement.
    # On sauvegarde ces médianes pour reproduire le même comportement en inférence
    # au lieu de passer 0.0 (qui n'a jamais été vu pendant l'entraînement).
    LAG_COLS = [
        "pct_drainage_lag1", "pct_drainage_lag2", "pct_drainage_lag3",
        "ec_drainage_lag1",  "ec_drainage_lag2",
    ]
    lag_medians = {}
    for col in LAG_COLS:
        if col in df_m2.columns:
            med = df_m2[col].median()
            lag_medians[col] = float(med) if not np.isnan(med) else 0.0
    encoders_tour["lag_medians"] = lag_medians
    print(f"  Médianes lags sauvegardées : { {k: round(v, 2) for k, v in lag_medians.items()} }")

    # ── opt_continuer — binaire ───────────────────────────────
    print("\n  ── Classification : opt_continuer (CONTINUER / STOP) ──")
    y_tr_c = train["opt_continuer"].fillna(0).astype(int)
    y_te_c = test["opt_continuer"].fillna(0).astype(int)
    scale  = (1 - y_tr_c.mean()) / max(y_tr_c.mean(), 0.01)

    model_cont = xgb.XGBClassifier(
        n_estimators=500, max_depth=7, learning_rate=0.04,
        subsample=0.85, colsample_bytree=0.85, min_child_weight=3,
        scale_pos_weight=scale, objective="binary:logistic",
        use_label_encoder=False,
        random_state=RANDOM_STATE, verbosity=0, n_jobs=-1, eval_metric="logloss"
    )
    model_cont.fit(X_train, y_tr_c, eval_set=[(X_test, y_te_c)], verbose=False)

    y_pred_c = model_cont.predict(X_test)
    acc_c = accuracy_score(y_te_c, y_pred_c)
    f1_c  = f1_score(y_te_c, y_pred_c, average="weighted", zero_division=0)
    modeles["clf_opt_continuer"] = model_cont
    scores.append({"target": "opt_continuer", "label": "9. Continuer/STOP",
                    "type": "Accuracy", "score": acc_c, "detail": f"F1={f1_c:.4f}"})
    afficher_score("XGBoost", "9. Continuer/STOP", "clf", acc_c, "Accuracy")
    sauvegarder_predictions_agent("opt_continuer", y_te_c, y_pred_c, "classification")
    sauvegarder_importance_agent("opt_continuer", model_cont, feats)

    # ── opt_label_sequentiel — multiclasse ────────────────────
    print("\n  ── Classification : opt_label_sequentiel (raison STOP) ──")
    le_seq = LabelEncoder()
    y_all_s  = df_m2["opt_label_sequentiel"].fillna("CONTINUER").astype(str)
    le_seq.fit(y_all_s)
    y_tr_s = le_seq.transform(train["opt_label_sequentiel"].fillna("CONTINUER").astype(str))
    y_te_s = le_seq.transform(test["opt_label_sequentiel"].fillna("CONTINUER").astype(str))
    n_cls_s = len(le_seq.classes_)
    print(f"  Classes : {list(le_seq.classes_)}")

    model_seq = xgb.XGBClassifier(
        n_estimators=500, max_depth=7, learning_rate=0.04,
        subsample=0.85, colsample_bytree=0.85, min_child_weight=3,
        num_class=n_cls_s, objective="multi:softprob",
        use_label_encoder=False,
        random_state=RANDOM_STATE, verbosity=0, n_jobs=-1, eval_metric="mlogloss"
    )
    model_seq.fit(X_train, y_tr_s, eval_set=[(X_test, y_te_s)], verbose=False)

    y_pred_s = model_seq.predict(X_test)
    acc_s = accuracy_score(y_te_s, y_pred_s)
    f1_s  = f1_score(y_te_s, y_pred_s, average="weighted", zero_division=0)
    modeles["clf_opt_label_sequentiel"] = model_seq
    encoders_tour["opt_label_sequentiel"] = le_seq
    scores.append({"target": "opt_label_sequentiel", "label": "9b. Raison STOP",
                    "type": "Accuracy", "score": acc_s, "detail": f"F1={f1_s:.4f}"})
    afficher_score("XGBoost", "9b. Raison STOP", "clf", acc_s, "Accuracy")
    y_te_s_labels = le_seq.inverse_transform(y_te_s)
    y_pred_s_labels = le_seq.inverse_transform(y_pred_s)
    sauvegarder_predictions_agent("opt_label_sequentiel", y_te_s_labels, y_pred_s_labels, "classification")
    sauvegarder_importance_agent("opt_label_sequentiel", model_seq, feats)

    # ── opt_duree_min — régression (cible décalée = durée du tour SUIVANT) ──
    print("\n  ── Régression : opt_duree_min_shifted (durée tour suivant) ──")
    target_duree = "opt_duree_min_shifted" if "opt_duree_min_shifted" in train.columns else "opt_duree_min"
    # v5.7: Drop NaN au lieu de fillna(median) — supprime le bruit d'entraînement
    # (le dernier tour de chaque journée n'a pas de "tour suivant" → NaN, exclu ici)
    mask_tr = train[target_duree].notna()
    mask_te = test[target_duree].notna()
    y_tr_d = train.loc[mask_tr, target_duree]
    y_te_d = test.loc[mask_te, target_duree]
    X_train_d = X_train[mask_tr]
    X_test_d = X_test[mask_te]

    # v5.7: Modèle plus simple (max_depth=3) — moins de surapprentissage sur fonction en escalier
    model_dur = xgb.XGBRegressor(
        n_estimators=400, max_depth=3, learning_rate=0.05,
        subsample=0.85, colsample_bytree=0.85, min_child_weight=5,
        reg_alpha=0.1, reg_lambda=1.0,
        random_state=RANDOM_STATE, verbosity=0, n_jobs=-1
    )
    model_dur.fit(X_train_d, y_tr_d, eval_set=[(X_test_d, y_te_d)], verbose=False)

    y_pred_d = model_dur.predict(X_test_d)
    r2_d   = r2_score(y_te_d, y_pred_d)
    mae_d  = mean_absolute_error(y_te_d, y_pred_d)
    rmse_d = float(np.sqrt(mean_squared_error(y_te_d, y_pred_d)))
    modeles["reg_opt_duree_min"] = model_dur
    scores.append({"target": target_duree, "label": "3b. Durée tour suivant",
                    "type": "R²", "score": r2_d, "detail": f"MAE={mae_d:.3f}",
                    "mae": mae_d, "rmse": rmse_d})
    afficher_score("XGBoost", "3b. Durée tour suivant", "reg", r2_d, "R²")
    sauvegarder_predictions_agent(target_duree, y_te_d, y_pred_d, "regression")
    sauvegarder_importance_agent(target_duree, model_dur, feats)

    # ── v6.8: Classification + Regression fine pour REPOS HUMAIN ──
    print("\n  ── Repos humain : Classification + Regression fine [v6.8] ──")
    # Ameliorations vs v6.7:
    #   1. Classes recentrees sur les pics reels (12/15/17/20/22/25/27/30/35)
    #   2. Sample weights pour equilibrer les classes majoritaires
    #   3. Temperature scaling sur softmax pour diversifier les predictions
    from sklearn.metrics import confusion_matrix

    # Features derivees drainage
    df_m2["drainage_change"] = df_m2["pct_drainage"] - df_m2["_pct_drain_prev"]
    df_m2["drainage_accel"]  = df_m2["pct_drainage"] - df_m2["pct_drainage_lag1"]
    df_m2["ec_drain_change"] = df_m2["ec_drainage"] - df_m2["ec_drainage_lag1"]
    df_m2["ph_drain_change"] = df_m2["ph_drainage"] - df_m2.groupby(["date", "bloc"])["ph_drainage"].shift(1)
    df_m2["v_drain_change"]  = df_m2["v_drainage"]  - df_m2.groupby(["date", "bloc"])["v_drainage"].shift(1)

    if "drain_zone" not in df_m2.columns:
        df_m2["drain_zone"] = 1.0
        df_m2.loc[df_m2["_pct_drain_prev"] <= 0, "drain_zone"] = 2.0
        df_m2.loc[df_m2["_pct_drain_prev"] > 25, "drain_zone"] = 0.0

    # ── v6.9: Repos humain = pattern-based (pas de ML) ──
    # Le ML (v6.5-v6.8) donnait des valeurs incohérentes (toujours 15-17 min).
    # v6.9 utilise directement les patterns réels du CSV via get_repos_pattern().
    # Basé sur : drainage du tour actuel + numéro de tour dans la journée.
    print(f"\n  ── Repos humain : Pattern-based v6.9 (pas de ML) ──")
    print(f"  Patterns chargés depuis CSV: {len(REPOS_PATTERNS['by_drain'])} zones drainage × {len(REPOS_PATTERNS['by_tour'])} tours")
    print(f"  Médiane globale (fallback): {REPOS_PATTERNS['global_median']:.0f} min")
    # Plus de modèles ML repos — on utilise get_repos_pattern() en inference

    score_moy = np.mean([s["score"] for s in scores])
    flag = "🟢" if score_moy >= 0.97 else "🟡"
    print(f"\n  Score moyen Modèle 2 : {score_moy:.4f}  {flag}")

    return modeles, encoders_tour, scores


# ════════════════════════════════════════════════════════════════
# ÉTAPE 4 — SAUVEGARDE DES MODÈLES
# ════════════════════════════════════════════════════════════════

def sauvegarder_modeles(modeles_matin, enc_matin, modeles_tour, enc_tour, scores_all):
    MODELS_DIR.mkdir(exist_ok=True)

    joblib.dump(modeles_matin, MODELS_DIR / "xgb_matin_modeles.pkl")
    joblib.dump(enc_matin,     MODELS_DIR / "xgb_matin_encoders.pkl")
    joblib.dump(modeles_tour,  MODELS_DIR / "xgb_tour_modeles.pkl")
    joblib.dump(enc_tour,      MODELS_DIR / "xgb_tour_encoders.pkl")

    # Résumé scores
    df_scores = pd.DataFrame(scores_all)
    df_scores.to_csv(MODELS_DIR / "scores_comparaison.csv", index=False, encoding="utf-8-sig")

    print(f"\n  ✅ Modèles sauvegardés dans : {MODELS_DIR}/")
    print(f"     xgb_matin_modeles.pkl")
    print(f"     xgb_matin_encoders.pkl")
    print(f"     xgb_tour_modeles.pkl")
    print(f"     xgb_tour_encoders.pkl")
    print(f"     scores_comparaison.csv")
    print(f"  💾 Prédictions individuelles (y_true/y_pred) : {PREDICTIONS_DIR_AGENT}/")
    print(f"  💾 Importances des variables                 : {IMPORTANCES_DIR_AGENT}/")
    print(f"\n  ➡  Lancez maintenant generer_graphes_agent_xgboost.py pour produire")
    print(f"     les figures (PNG) et tableaux du Chapitre 3 (agent XGBoost).")


# ════════════════════════════════════════════════════════════════
# ÉTAPE 5 — PRÉDICTION MATIN (9 CONSIGNES)
# ════════════════════════════════════════════════════════════════

def predict_matin(donnees: dict,
                  modeles_matin: dict,
                  enc_matin: dict,
                  ec_bassin: float = 0.9,
                  volume_cycle_L: float = 1.33,
                  stade: str = "Floraison",
                  ph_bassin: float = 7.2,
                  volume_m3: float = 0.133) -> dict:
    """
    Génère les 7 consignes opérationnelles du matin.

    Paramètres
    ----------
    donnees       : dict avec les données météo + agronomiques du jour
                    (clés = FEATURES_MATIN)
    ec_bassin     : EC eau brute du bassin (dS/m)
    volume_cycle_L: volume par cycle mesuré (L)
    stade         : stade phénologique actuel
    ph_bassin     : pH eau du bassin (pour calcul correction)
    volume_m3     : volume cycle en m³ (= volume_cycle_L / 1000)

    Retourne
    --------
    dict avec 7 consignes :
      quantite_eau_mm       — mm/jour à apporter (float, 1 décimale)
      nbr_tour              — nombre de cycles entiers (int)
      ec_cible_dSm          — EC à programmer sur NetaJet (float, 2 décimales)
      ph_cible              — pH à programmer sur NetaJet (float, 1 décimale)
      heure_debut_optimale  — heure de démarrage (str "HH:MM")
      scenario_meteo        — scénario météo du jour (str)
      alerte                — alerte : NORMAL / CHERGUI / PLUIE_STOP / BROUILLARD
    """
    # Construire le DataFrame d'entrée
    df_pred = pd.DataFrame([donnees])
    for col in FEATURES_MATIN:
        if col not in df_pred.columns:
            df_pred[col] = 0.0

    X, _, _ = preparer_features(df_pred, FEATURES_MATIN,
                                 encoders=enc_matin.get("features", {}), fit=False)

    resultats = {}

    # ── Régression : nb_cycles, EC, pH, ET0, ETc, apport ─────
    for target in TARGETS_MATIN_REG:
        key = f"reg_{target}"
        if key in modeles_matin:
            val = float(modeles_matin[key].predict(X)[0])
            resultats[target] = val

    # ── Classification : heure, scénario, alertes ─────────────
    enc_cibles = enc_matin.get("cibles", {})
    for target in TARGETS_MATIN_CLF:
        key = f"clf_{target}"
        if key in modeles_matin and target in enc_cibles:
            idx = int(modeles_matin[key].predict(X)[0])
            resultats[target] = enc_cibles[target].classes_[idx]

    # ── Durée tour 1 pour NetaJet (avant tout drainage mesuré) ──
    duree_float  = resultats.get("opt_duree_tour1_min", 10.0)
    duree_int    = int(round(max(4.0, min(14.0, duree_float))))

    # ── Scénario météo ────────────────────────────────────────
    scenario = resultats.get("scenario_meteo", "2_ENSOLEILLE")

    # ── Alerte ────────────────────────────────────────────────
    alerte_chergui    = resultats.get("opt_alerte_chergui", 0)
    alerte_pluie      = resultats.get("opt_alerte_pluie", 0)
    alerte_brouillard = resultats.get("opt_alerte_brouillard", 0)

    if alerte_chergui == 1 or alerte_chergui == "1":
        alerte = "CHERGUI"
    elif alerte_pluie == 1 or alerte_pluie == "1":
        alerte = "PLUIE_STOP"
    elif alerte_brouillard == 1 or alerte_brouillard == "1":
        alerte = "BROUILLARD"
    else:
        alerte = "NORMAL"

    # ── Assemblage des 9 consignes journalières (NetaJet 4G) ──
    apport_mm = round(resultats.get("opt_apport_total_mm", 3.5), 1)
    duree_ml  = int(round(max(4.0, min(14.0, resultats.get("opt_duree_tour1_min", 10.0)))))
    consignes = {
        "ec_cible_dSm":         round(resultats.get("opt_EC_cible_dSm", 2.3), 1),
        "ph_cible":             round(float(resultats.get("opt_pH_cible", 6.0)), 1),
        "nbr_tour":             max(1, int(round(resultats.get("opt_nb_cycles", 5)))),
        "heure_debut_optimale": resultats.get("opt_heure_demarrage", "08:00"),
        "scenario_meteo":       scenario,
        "alerte":               alerte,
        "quantite_eau_mm":      apport_mm,
        "volume_total_Lha":     round(apport_mm * 10_000, 0),  # mm × 10000 = L/ha
        "duree_tour1_min":      duree_ml,   # durée tour 1 (avant drainage) pour NetaJet
    }

    return consignes


# ════════════════════════════════════════════════════════════════
# ÉTAPE 6 — PRÉDICTION TOUR PAR TOUR
# ════════════════════════════════════════════════════════════════

def predict_tour(donnees: dict,
                 modeles_tour: dict,
                 enc_tour: dict) -> dict:
    """
    Après chaque cycle d'irrigation : continuer ou stopper ?

    Paramètres
    ----------
    donnees : dict avec l'état substrat après CE tour
              Clés obligatoires : pct_drainage, ec_drainage, num_tour,
                                  pct_drainage_lag1, opt_vol_cumule_L,
                                  opt_vol_jour_cible_L, opt_EC_drain_cible_dSm

    Retourne
    --------
    dict avec décision, raison, durée tour suivant
    """
    # Calculer les features derivees volume si les colonnes de base sont presentes
    # v5.9: utiliser volume AVANT ce tour pour opt_vol_ratio (cohérent avec STOP_VOLUME à 95%)
    if 'opt_vol_cumule_L' in donnees and 'opt_vol_jour_cible_L' in donnees:
        vc = donnees['opt_vol_cumule_L']
        vj = donnees['opt_vol_jour_cible_L']
        if vj > 0:
            # Volume avant ce tour = cumul - volume du cycle en cours
            vol_cycle = donnees.get('opt_volume_cycle_corrige_L', donnees.get('opt_volume_cycle_L', 0.0)) or 0.0
            vol_avant_tour = max(0.0, vc - vol_cycle)
            donnees['opt_vol_ratio'] = vol_avant_tour / vj
            donnees['opt_vol_restant_L'] = max(0.0, vj - vol_avant_tour)
        else:
            donnees['opt_vol_ratio'] = 0.0
            donnees['opt_vol_restant_L'] = 0.0

    # v5.7: Calculer drain_zone pour la prédiction (même logique que l'entraînement)
    if "drain_zone" not in donnees:
        drain_prev = float(donnees.get("_pct_drain_prev", donnees.get("pct_drainage_lag1", 0.0)) or 0.0)
        if drain_prev <= 0:
            donnees["drain_zone"] = 2.0
        elif drain_prev <= 25.0:
            donnees["drain_zone"] = 1.0
        else:
            donnees["drain_zone"] = 0.0

    # v6.3: Convertir heure_* (string "HH:MM") → minutes depuis minuit
    for _col in ["heure_debut", "heure_soir", "heure_matin"]:
        _min_col = f"{_col}_min"
        if _col in donnees and _min_col not in donnees:
            try:
                parts = str(donnees[_col]).split(":")
                donnees[_min_col] = int(parts[0]) * 60 + int(parts[1])
            except (ValueError, IndexError):
                donnees[_min_col] = 0

    df_pred = pd.DataFrame([donnees])
    for col in FEATURES_TOUR:
        if col not in df_pred.columns:
            df_pred[col] = 0.0

    X, _, _ = preparer_features(df_pred, FEATURES_TOUR,
                                 encoders=enc_tour.get("features", {}), fit=False)

    # ── Continuer / STOP (binaire) ────────────────────────────
    continuer = int(modeles_tour["clf_opt_continuer"].predict(X)[0])

    # ── Raison détaillée (multiclasse) ───────────────────────
    le_seq   = enc_tour.get("opt_label_sequentiel")
    idx_seq  = int(modeles_tour["clf_opt_label_sequentiel"].predict(X)[0])
    raison   = le_seq.classes_[idx_seq] if le_seq else "INCONNU"

    # ── Durée tour suivant ────────────────────────────────────
    # v5.9: ML prédit durée déjà contrainte (label = calc_opt_duree_v2).
    #   Le label d'entraînement intègre déjà :
    #     - table drainage (12/10/8), facteur par tour, Gieling, bornes [4,14],
    #       et décroissance obligatoire.
    #   On ne garde ici que le filet de sécurité minimal :
    #     1. Bornes absolues [4, 14] (sécurité terrain)
    #     2. Décroissance obligatoire (contrainte temps réel non vue par le ML)
    duree_float = float(modeles_tour["reg_opt_duree_min"].predict(X)[0])
    duree_int   = int(round(max(4.0, min(14.0, duree_float))))

    # v5.9: Décroissance obligatoire — filet de sécurité temps réel.
    #   Le ML n'a pas accès à la durée réellement programmée au tour précédent
    #   (elle peut avoir été modifiée par l'opérateur ou le contrôleur).
    duree_tour_precedent = int(donnees.get("duree_tour_precedent_min", 0) or 0)
    if duree_tour_precedent > 0 and duree_int > duree_tour_precedent:
        duree_int = duree_tour_precedent

    # ── Repos entre tours ─────────────────────────────────────
    # v6.9: Pattern-based — pas de ML. Basé sur les vrais patterns humains du CSV.
    #   Déterminé par : drainage du tour actuel + numéro de tour dans la journée.
    repos_int = get_repos_pattern(
        pct_drainage = donnees.get("pct_drainage", 20.0),
        num_tour     = int(donnees.get("num_tour", 1)),
        patterns     = REPOS_PATTERNS,
    )

    # ── Message opérateur ─────────────────────────────────────
    if continuer == 1:
        decision_msg = "▶  CONTINUER — lancer le tour suivant"
    else:
        messages = {
            "STOP_OPTIMAL":    "✅ STOP OPTIMAL — objectif drainage atteint",
            "STOP_VOLUME":     "✅ STOP VOLUME — volume journalier cible atteint",
            "STOP_HEURE":      "🕐 STOP HEURE — heure limite journalière atteinte",
            "STOP_PLUIE":      "🌧 STOP PLUIE — irrigation suspendue",
            "STOP_BROUILLARD": "🌫 STOP BROUILLARD — HR > 90%, asphyxie racinaire",
            "STOP_EC_URGENCE": "🔴 STOP URGENCE — accumulation sels, réduire NPK -20%",
            "STOP_EXCES":      "⚠  STOP EXCÈS — drainage > seuil, réduire volume -20%",
            "STOP_CHERGUI_MAX": "🔴 STOP CHERGUI MAX — plafond tours dépassé sous Chergui, volume cible atteint",
        }
        decision_msg = messages.get(raison, f"STOP — {raison}")

    return {
        "decision":              "CONTINUER" if continuer == 1 else "STOP",
        "continuer":             continuer,
        "raison":                raison,
        "message_operateur":     decision_msg,
        "duree_tour_suivant_min": duree_int,
        "repos_min":             repos_int,
        "_duree_float":          round(duree_float, 2),
        "_repos_float":          float(repos_int),
    }


# ════════════════════════════════════════════════════════════════
# AFFICHAGE FORMATÉ — CONSOLE OPÉRATEUR
# ════════════════════════════════════════════════════════════════

def afficher_consignes_matin(consignes: dict, date_str: str = None):
    date_str = date_str or datetime.now().strftime("%Y-%m-%d")

    # Alerte flag
    alerte = consignes.get("alerte", "NORMAL")
    scenario = consignes.get("scenario_meteo", "")
    if alerte == "CHERGUI":
        alerte_ligne = "🔴 CHERGUI — démarrer tot, brumisation"
    elif alerte == "PLUIE_STOP":
        alerte_ligne = "🌧 PLUIE — STOP irrigation"
    elif alerte == "BROUILLARD":
        alerte_ligne = "🌫 BROUILLARD — attendre HR < 90%"
    else:
        alerte_ligne = f"✅ NORMAL — {scenario}"

    print(f"""
╔══════════════════════════════════════════════════════════════════╗
║  RECOMMANDATION MATIN — {date_str:<38}║
║  Groupe Azura — Tomate Cerise — Agadir                          ║
╠══════════════════════════════════════════════════════════════════╣
║           ── CONSIGNES NETAJET 4G (programmer) ──                ║
║  1. EC cible          : {str(consignes['ec_cible_dSm']) + ' dS/m':<41}║
║  2. pH cible          : {str(consignes['ph_cible']):<41}║
║  3. Nombre de tours   : {str(consignes['nbr_tour']) + ' cycles':<41}║
║  4. Heure début       : {consignes['heure_debut_optimale']:<41}║
╠══════════════════════════════════════════════════════════════════╣
║           ── VOLUME JOURNALIER ──                                 ║
║  5. Quantité eau      : {str(consignes['quantite_eau_mm']) + ' mm/jour':<41}║
║  6. Volume total      : {str(int(consignes['volume_total_Lha'])) + ' L/ha':<41}║
╠══════════════════════════════════════════════════════════════════╣
║  7. Scénario météo    : {scenario:<41}║
║  8. Alerte            : {alerte_ligne:<41}║
╚══════════════════════════════════════════════════════════════════╝""")


def afficher_decision_tour(decision: dict, num_tour: int):
    flag = "▶ " if decision["continuer"] == 1 else "■ "
    print(f"""
  ┌─── Tour {num_tour} terminé ──────────────────────────────────────┐
  │  Décision        : {flag}{decision['decision']:<42}│
  │  Raison          : {decision['raison']:<44}│
  │  Message         : {decision['message_operateur']:<44}│
  │  Durée suivant   : {str(decision['duree_tour_suivant_min']) + ' min':<44}│
  └────────────────────────────────────────────────────────────┘""")


# ════════════════════════════════════════════════════════════════
# DÉMONSTRATION — SIMULATION D'UNE JOURNÉE COMPLÈTE
# ════════════════════════════════════════════════════════════════

def demo_journee_complete(modeles_matin, enc_matin, modeles_tour, enc_tour):
    print(f"\n{'═'*65}")
    print("  DÉMO — SIMULATION JOURNÉE COMPLÈTE")
    print(f"{'═'*65}")

    # ── Scénario : journée ensoleillée, stade Floraison ───────
    donnees_matin = {
        "meteo_T_max_C":                 28.5,
        "meteo_T_min_C":                 16.0,
        "meteo_T_mean_C":                22.0,
        "meteo_HR_max_pct":              75,
        "meteo_HR_min_pct":              45,
        "meteo_HR_mean_pct":             62.0,
        "meteo_VPD_max_kPa":             1.8,
        "meteo_ET0_mm_jour":             5.5,
        "meteo_shortwave_radiation_sum": 18.5,
        "meteo_pluie_mm_jour":           0.0,
        "meteo_vent_max_kmh":            25.0,
        "meteo_rs_wm2_max_jour":         720.0,
        "opt_Kc":                        1.125,
        "opt_jours_depuis_plantation":   75,
        "opt_FL":                        0.20,
        "ec_bassin":                     0.9,
        "moy_pct_drainage":              22.0,
        "ec_cumul_drainage":             2.8,
        "alerte_chergui":                0,
        "alerte_pluie":                  0,
        "alerte_brouillard":             0,
        "alerte_vpd_stress":             1,
    }

    # ── Prédiction matin (5 consignes) ────────────────────────
    consignes = predict_matin(
        donnees        = donnees_matin,
        modeles_matin  = modeles_matin,
        enc_matin      = enc_matin,
        ec_bassin      = 0.9,
        volume_cycle_L = 1.33,
        stade          = "Floraison",
        ph_bassin      = 7.2,
        volume_m3      = 0.00133,
    )
    afficher_consignes_matin(consignes, "2025-07-24")

    # Affichage simple des 8 valeurs journalières
    print("  → Recommandation du matin (8 consignes NetaJet 4G) :")
    print(f"     ec_cible_dSm         = {consignes['ec_cible_dSm']} dS/m")
    print(f"     ph_cible             = {consignes['ph_cible']}")
    print(f"     nbr_tour             = {consignes['nbr_tour']} cycles")
    print(f"     heure_debut_optimale = {consignes['heure_debut_optimale']}")
    print(f"     scenario_meteo       = {consignes['scenario_meteo']}")
    print(f"     alerte               = {consignes['alerte']}")
    print(f"     quantite_eau_mm      = {consignes['quantite_eau_mm']} mm/jour")
    print(f"     volume_total_Lha     = {int(consignes['volume_total_Lha'])} L/ha")

    # ── Simulation 4 tours consécutifs ────────────────────────
    print(f"\n  Simulation décisions tour par tour :")
    tours_simulation = [
        # Tour 1 — début, substrat sec
        {"pct_drainage": 5.0,  "ec_drainage": 2.1, "ph_drainage": 6.0,
         "num_tour": 1, "v_apport": 166, "_pct_drain_prev": 0.0,
         "pct_drainage_lag1": 0.0, "pct_drainage_lag2": 0.0, "pct_drainage_lag3": 0.0,
         "ec_drainage_lag1": 0.0, "ec_drainage_lag2": 0.0,
         "opt_vol_cumule_L": 1.33, "opt_vol_jour_cible_L": 14.63,
         "opt_EC_drain_cible_dSm": 3.8, "opt_nb_cycles": 11, "opt_max_cycles_stade": 14,
         "meteo_actuel_temperature_2m": 19.0, "meteo_actuel_vapour_pressure_deficit": 0.6,
         "meteo_actuel_relative_humidity_2m": 78, "meteo_actuel_windspeed_10m": 8.0,
         "meteo_rs_wm2_actuel": 250.0, "meteo_pression_actuelle_kPa": 10.08,
         "alerte_chergui_actuel": 0, "alerte_pluie_actuel": 0, "alerte_pluie_legere_actuel": 0,
         "alerte_brouillard_actuel": 0, "alerte_vpd_stress_actuel": 0, "alerte_vent_actuel": 0,
         "scenario_meteo": "2_ENSOLEILLE",
         "ec_bassin": 0.9, "ec_apport": 2.3, "ph_apport": 6.0},
        # Tour 4 — drainage en montée
        {"pct_drainage": 18.0, "ec_drainage": 2.5, "ph_drainage": 6.1,
         "num_tour": 4, "v_apport": 166, "_pct_drain_prev": 12.0,
         "pct_drainage_lag1": 12.0, "pct_drainage_lag2": 8.0, "pct_drainage_lag3": 5.0,
         "ec_drainage_lag1": 2.3, "ec_drainage_lag2": 2.2,
         "opt_vol_cumule_L": 5.32, "opt_vol_jour_cible_L": 14.63,
         "opt_EC_drain_cible_dSm": 3.8, "opt_nb_cycles": 11, "opt_max_cycles_stade": 14,
         "meteo_actuel_temperature_2m": 23.5, "meteo_actuel_vapour_pressure_deficit": 1.2,
         "meteo_actuel_relative_humidity_2m": 65, "meteo_actuel_windspeed_10m": 12.0,
         "meteo_rs_wm2_actuel": 550.0, "meteo_pression_actuelle_kPa": 10.06,
         "alerte_chergui_actuel": 0, "alerte_pluie_actuel": 0, "alerte_pluie_legere_actuel": 0,
         "alerte_brouillard_actuel": 0, "alerte_vpd_stress_actuel": 0, "alerte_vent_actuel": 0,
         "scenario_meteo": "2_ENSOLEILLE",
         "ec_bassin": 0.9, "ec_apport": 2.3, "ph_apport": 6.0},
        # Tour 8 — drainage optimal, légère baisse
        {"pct_drainage": 32.0, "ec_drainage": 2.9, "ph_drainage": 6.2,
         "num_tour": 8, "v_apport": 166, "_pct_drain_prev": 35.0,
         "pct_drainage_lag1": 35.0, "pct_drainage_lag2": 28.0, "pct_drainage_lag3": 22.0,
         "ec_drainage_lag1": 3.0, "ec_drainage_lag2": 2.8,
         "opt_vol_cumule_L": 10.64, "opt_vol_jour_cible_L": 14.63,
         "opt_EC_drain_cible_dSm": 3.8, "opt_nb_cycles": 11, "opt_max_cycles_stade": 14,
         "meteo_actuel_temperature_2m": 28.5, "meteo_actuel_vapour_pressure_deficit": 1.8,
         "meteo_actuel_relative_humidity_2m": 50, "meteo_actuel_windspeed_10m": 18.0,
         "meteo_rs_wm2_actuel": 800.0, "meteo_pression_actuelle_kPa": 10.03,
         "alerte_chergui_actuel": 0, "alerte_pluie_actuel": 0, "alerte_pluie_legere_actuel": 0,
         "alerte_brouillard_actuel": 0, "alerte_vpd_stress_actuel": 1, "alerte_vent_actuel": 1,
         "scenario_meteo": "2_ENSOLEILLE",
         "ec_bassin": 0.9, "ec_apport": 2.3, "ph_apport": 6.0},
        # Tour 11 — volume atteint
        {"pct_drainage": 28.0, "ec_drainage": 3.1, "ph_drainage": 6.2,
         "num_tour": 11, "v_apport": 166, "_pct_drain_prev": 30.0,
         "pct_drainage_lag1": 30.0, "pct_drainage_lag2": 32.0, "pct_drainage_lag3": 35.0,
         "ec_drainage_lag1": 3.0, "ec_drainage_lag2": 2.9,
         "opt_vol_cumule_L": 14.63, "opt_vol_jour_cible_L": 14.63,
         "opt_EC_drain_cible_dSm": 3.8, "opt_nb_cycles": 11, "opt_max_cycles_stade": 14,
         "meteo_actuel_temperature_2m": 26.0, "meteo_actuel_vapour_pressure_deficit": 1.5,
         "meteo_actuel_relative_humidity_2m": 55, "meteo_actuel_windspeed_10m": 15.0,
         "meteo_rs_wm2_actuel": 600.0, "meteo_pression_actuelle_kPa": 10.04,
         "alerte_chergui_actuel": 0, "alerte_pluie_actuel": 0, "alerte_pluie_legere_actuel": 0,
         "alerte_brouillard_actuel": 0, "alerte_vpd_stress_actuel": 0, "alerte_vent_actuel": 1,
         "scenario_meteo": "2_ENSOLEILLE",
         "ec_bassin": 0.9, "ec_apport": 2.3, "ph_apport": 6.0},
    ]

    for donnees_tour in tours_simulation:
        num = donnees_tour["num_tour"]
        decision = predict_tour(donnees_tour, modeles_tour, enc_tour)
        afficher_decision_tour(decision, num)

    # ── Scénario Chergui ──────────────────────────────────────
    print(f"\n  {'─'*60}")
    print(f"  SCÉNARIO CHERGUI (T=38°C, VPD=3.2 kPa)")
    print(f"  {'─'*60}")

    donnees_chergui = donnees_matin.copy()
    donnees_chergui.update({
        "meteo_T_max_C":     38.0,
        "meteo_VPD_max_kPa": 3.2,
        "meteo_ET0_mm_jour": 8.0,
        "alerte_chergui":    1,
        "alerte_vpd_stress": 1,
    })

    consignes_chergui = predict_matin(
        donnees        = donnees_chergui,
        modeles_matin  = modeles_matin,
        enc_matin      = enc_matin,
        ec_bassin      = 0.9,
        volume_cycle_L = 1.33,
        stade          = "Floraison",
        ph_bassin      = 7.2,
        volume_m3      = 0.00133,
    )
    afficher_consignes_matin(consignes_chergui, "2025-07-24 [CHERGUI]")

    print("  → Recommandation CHERGUI :")
    print(f"     ec_cible_dSm         = {consignes_chergui['ec_cible_dSm']} dS/m")
    print(f"     ph_cible             = {consignes_chergui['ph_cible']}")
    print(f"     nbr_tour             = {consignes_chergui['nbr_tour']} cycles")
    print(f"     heure_debut_optimale = {consignes_chergui['heure_debut_optimale']}")
    print(f"     scenario_meteo       = {consignes_chergui['scenario_meteo']}")
    print(f"     alerte               = {consignes_chergui['alerte']}")
    print(f"     quantite_eau_mm      = {consignes_chergui['quantite_eau_mm']} mm/jour")
    print(f"     volume_total_Lha     = {int(consignes_chergui['volume_total_Lha'])} L/ha")


# ════════════════════════════════════════════════════════════════
# RÉSUMÉ FINAL DES SCORES
# ════════════════════════════════════════════════════════════════

def afficher_resume_scores(scores_m1, scores_m2):
    all_scores = scores_m1 + scores_m2

    print(f"\n{'═'*65}")
    print("  RÉSUMÉ FINAL — SCORES PAR CONSIGNE")
    print(f"{'═'*65}")
    print(f"  {'Consigne':<35} {'Score':>8} {'Métrique':<10} {'Statut'}")
    print(f"  {'-'*65}")

    for s in all_scores:
        flag = "🟢" if s["score"] >= 0.98 else ("🟡" if s["score"] >= 0.95 else ("🟠" if s["score"] >= 0.90 else "🔴"))
        print(f"  {s['label']:<35} {s['score']:>8.4f} {s['type']:<10} {flag}  {s['detail']}")

    score_moy = np.mean([s["score"] for s in all_scores])
    flag_moy  = "🟢" if score_moy >= 0.98 else "🟡"
    print(f"\n  {'─'*65}")
    print(f"  Score global moyen : {score_moy:.4f}  {flag_moy}")
    print(f"  {'═'*65}")


# ════════════════════════════════════════════════════════════════
# MAIN
# ════════════════════════════════════════════════════════════════

def main():
    parser = argparse.ArgumentParser(description="Agent IA Irrigation Azura")
    parser.add_argument("--train",   action="store_true", help="Entraîner les modèles")
    parser.add_argument("--predict", action="store_true", help="Démo prédiction")
    parser.add_argument("--input",   default=INPUT_FILE,  help="Fichier CSV entrée")
    args = parser.parse_args()

    # Par défaut : train + predict
    do_train   = args.train   or (not args.train and not args.predict)
    do_predict = args.predict or (not args.train and not args.predict)

    modeles_matin = enc_matin = modeles_tour = enc_tour = None

    if do_train:
        print("╔" + "═"*63 + "╗")
        print("║   AGENT IA IRRIGATION — ENTRAÎNEMENT 2 × XGBoost            ║")
        print("║   Groupe Azura — Tomate Cerise — Agadir / Souss-Massa        ║")
        print("╚" + "═"*63 + "╝")

        # Charger données
        df = charger_donnees(args.input)

        # Entraîner Modèle 1 (Matin)
        modeles_matin, enc_matin, scores_m1 = entrainer_modele_matin(df)

        # Entraîner Modèle 2 (Tour/tour)
        modeles_tour, enc_tour, scores_m2 = entrainer_modele_tour(df)

        # Sauvegarder
        sauvegarder_modeles(modeles_matin, enc_matin, modeles_tour, enc_tour,
                             scores_m1 + scores_m2)

        # Résumé scores
        afficher_resume_scores(scores_m1, scores_m2)

    if do_predict:
        # Charger modèles si pas encore en mémoire
        if modeles_matin is None:
            if not (MODELS_DIR / "xgb_matin_modeles.pkl").exists():
                print("  ⚠ Modèles non trouvés — lancez d'abord --train")
                return
            print(f"\n  Chargement modèles depuis {MODELS_DIR}/...")
            modeles_matin = joblib.load(MODELS_DIR / "xgb_matin_modeles.pkl")
            enc_matin     = joblib.load(MODELS_DIR / "xgb_matin_encoders.pkl")
            modeles_tour  = joblib.load(MODELS_DIR / "xgb_tour_modeles.pkl")
            enc_tour      = joblib.load(MODELS_DIR / "xgb_tour_encoders.pkl")
            print("  ✅ Modèles chargés")

        demo_journee_complete(modeles_matin, enc_matin, modeles_tour, enc_tour)

    print(f"\n  ✅ Agent IA Irrigation prêt.")
    print(f"  Usage en production :")
    print(f"    from agent_irrigation_xgboost import predict_matin, predict_tour")
    print(f"    consignes = predict_matin(donnees_meteo, modeles_matin, enc_matin, ...)")
    print(f"    decision  = predict_tour(etat_substrat, modeles_tour, enc_tour)")


if __name__ == "__main__":
    main()