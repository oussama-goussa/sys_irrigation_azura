# ============================================================
# services/ml_pipeline.py — Pipeline ML Random Forest
# Projet Azura Irrigation — GOUSSA Oussama
# ============================================================

import os
import numpy as np
import pandas as pd
import joblib
from loguru import logger

from sklearn.ensemble import RandomForestRegressor
from sklearn.model_selection import train_test_split
from sklearn.preprocessing import StandardScaler, LabelEncoder
from sklearn.metrics import r2_score, mean_absolute_error

# Chemin ou sauvegarder les modeles
MODEL_PATH = os.getenv("MODEL_PATH", "/app/models/rf_production.joblib")
SCALER_PATH = os.getenv("SCALER_PATH", "/app/models/scaler.joblib")

# Seuil R2 minimum pour activer un nouveau modele
R2_MINIMUM = 0.80


def preparer_features(df: pd.DataFrame) -> pd.DataFrame:
    """
    Prepare les features pour le modele Random Forest
    """
    # Encoder le stade phenologique en numerique
    encoder = LabelEncoder()
    df = df.copy()
    df["stade_encoded"] = encoder.fit_transform(df["stade"].fillna("floraison"))

    features = df[[
        "rs_wm2",            # rayonnement solaire
        "temperature",       # temperature air
        "humidite_air",      # humidite air
        "ec_drain_avant",    # EC drain avant cycle
        "ph_drain_avant",    # pH drain avant cycle
        "pct_drainage_avant",# % drainage avant cycle
        "jours_plantation",  # age de la plante
        "stade_encoded"      # stade phenologique encode
    ]].fillna(0)

    return features


def entrainer_modele(df: pd.DataFrame) -> dict:
    """
    Entraine le Random Forest sur les donnees historiques
    Labels = resultats reels Netafim (EC drain, drainage)
    Si pas de donnees reelles → FAO-56 comme proxy
    """
    logger.info(f"Debut entrainement sur {len(df)} cycles")

    if len(df) < 50:
        logger.warning("Pas assez de donnees pour ML → Utiliser FAO-56")
        return {"statut": "insuffisant", "r2": 0.0}

    # Features
    X = preparer_features(df)

    # Labels — resultats reels Netafim si disponibles
    if "ec_drain_reel" in df.columns:
        y = df["ec_drain_reel"].fillna(df["ec_drain_avant"])
        logger.info("Labels : EC drain reel Netafim ✓")
    else:
        # Fallback : FAO-56 comme proxy
        y = df["ec_cible_fao56"].fillna(2.5)
        logger.info("Labels : EC cible FAO-56 (proxy)")

    # Split train / test 80% / 20%
    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=0.20, random_state=42
    )

    # Normalisation
    scaler = StandardScaler()
    X_train_scaled = scaler.fit_transform(X_train)
    X_test_scaled  = scaler.transform(X_test)

    # Entrainement Random Forest
    modele = RandomForestRegressor(
        n_estimators = 100,
        max_depth    = 10,
        random_state = 42,
        n_jobs       = -1
    )
    modele.fit(X_train_scaled, y_train)

    # Evaluation
    y_pred = modele.predict(X_test_scaled)
    r2  = r2_score(y_test, y_pred)
    mae = mean_absolute_error(y_test, y_pred)

    logger.info(f"Resultats : R2={r2:.3f} | MAE={mae:.3f}")

    # Sauvegarder seulement si R2 suffisant
    if r2 >= R2_MINIMUM:
        os.makedirs(os.path.dirname(MODEL_PATH), exist_ok=True)
        joblib.dump(modele, MODEL_PATH)
        joblib.dump(scaler, SCALER_PATH)
        logger.success(f"Nouveau modele active ! R2={r2:.3f}")
        statut = "active"
    else:
        logger.warning(f"Modele rejete R2={r2:.3f} < {R2_MINIMUM} → Ancien modele conserve")
        statut = "rejete"

    return {
        "statut"          : statut,
        "r2"              : round(r2, 3),
        "mae"             : round(mae, 3),
        "nb_cycles_train" : len(X_train),
        "nb_cycles_test"  : len(X_test)
    }


def predire(donnees: dict) -> dict:
    """
    Fait une prediction ML
    Si modele indisponible ou R2 faible → fallback FAO-56
    """
    try:
        # Charger le modele
        if not os.path.exists(MODEL_PATH):
            raise FileNotFoundError("Modele ML non trouve")

        modele = joblib.load(MODEL_PATH)
        scaler = joblib.load(SCALER_PATH)

        # Preparer les features
        X = pd.DataFrame([{
            "rs_wm2"             : donnees.get("rs_wm2", 500),
            "temperature"        : donnees.get("temperature", 25),
            "humidite_air"       : donnees.get("humidite_air", 65),
            "ec_drain_avant"     : donnees.get("ec_drain_avant", 2.5),
            "ph_drain_avant"     : donnees.get("ph_drain_avant", 6.5),
            "pct_drainage_avant" : donnees.get("pct_drainage_avant", 20),
            "jours_plantation"   : donnees.get("jours_plantation", 60),
            "stade_encoded"      : donnees.get("stade_encoded", 2)
        }])

        X_scaled = scaler.transform(X)
        prediction = modele.predict(X_scaled)[0]

        # Feature importance pour explicabilite
        importances = dict(zip(X.columns, modele.feature_importances_))
        top_features = sorted(importances.items(), key=lambda x: x[1], reverse=True)[:3]

        logger.info(f"Prediction ML : {prediction:.2f} | Top features : {top_features}")

        return {
            "source"      : "ML_Random_Forest",
            "prediction"  : round(prediction, 2),
            "top_features": top_features,
            "fiable"      : True
        }

    except Exception as e:
        # Fallback FAO-56 si ML indisponible
        logger.warning(f"ML indisponible ({e}) → Fallback FAO-56")
        return {
            "source"     : "FAO56_fallback",
            "prediction" : donnees.get("ec_cible_fao56", 2.5),
            "fiable"     : False,
            "raison"     : str(e)
        }
