# ============================================================
# core/celery_app.py — Configuration Celery + Taches
# Projet Azura Irrigation — GOUSSA Oussama
# ============================================================

import os
import requests
from celery import Celery
from celery.schedules import crontab
from loguru import logger

from services.tour_service import calculer_historique_complet
from models.sensor_model import Device

from models.sensor_model import (
    Device, SensorReading, IrrigationCycle,
    FertigationState, Alert, AlertThreshold,
    IrrigationTour
)

# ── Configuration Celery ─────────────────────────────────────
REDIS_URL = os.getenv("REDIS_URL", "redis://redis:6379/0")

app = Celery(
    "azura_tasks",
    broker=REDIS_URL,
    backend=REDIS_URL,
    include=["core.celery_app"]
)

app.conf.update(
    task_serializer       = "json",
    accept_content        = ["json"],
    result_serializer     = "json",
    timezone              = "Africa/Casablanca",
    enable_utc            = True,
    task_track_started    = True,
    worker_max_tasks_per_child = 50
)

# ── Taches planifiees automatiquement ────────────────────────
app.conf.beat_schedule = {

    # Meteo toutes les heures
    "collecter-meteo-horaire": {
        "task"    : "core.celery_app.task_collecter_meteo",
        "schedule": crontab(minute=0)  # toutes les heures
    },

    # Re-entrainement ML chaque dimanche 02h00
    "reentrainer-modele-hebdo": {
        "task"    : "core.celery_app.task_reentrainer_ml",
        "schedule": crontab(hour=2, minute=0, day_of_week=0)
    },

    # Backup base de donnees chaque nuit 03h00
    "backup-quotidien": {
        "task"    : "core.celery_app.task_backup_bdd",
        "schedule": crontab(hour=3, minute=0)
    },

    # Health check toutes les 5 minutes
    "health-check": {
        "task"    : "core.celery_app.task_health_check",
        "schedule": crontab(minute="*/5")
    },

    # Tours — historique au démarrage
    #"calcul-historique-tours": {
    #    "task"    : "core.celery_app.task_historique_tours",
    #    "schedule": crontab(hour=0, minute=5),  # chaque nuit à 00h05
    #},

    # Tours — jour en cours toutes les 5 min
    #"calcul-tours-jour-en-cours": {
    #    "task"    : "core.celery_app.task_tours_jour_en_cours",
    #    "schedule": crontab(minute="*/5"),
    #},
}


# ── TACHE 1 : Collecte meteo Open-Meteo ──────────────────────
@app.task(name="core.celery_app.task_collecter_meteo", bind=True, max_retries=3)
def task_collecter_meteo(self):
    """
    Collecte les previsions Open-Meteo pour Agadir
    Toutes les heures
    """
    try:
        lat = os.getenv("OPEN_METEO_LAT", "30.4202")
        lon = os.getenv("OPEN_METEO_LON", "-9.5981")

        url = "https://api.open-meteo.com/v1/forecast"
        params = {
            "latitude" : lat,
            "longitude": lon,
            "hourly"   : [
                "temperature_2m",
                "relative_humidity_2m",
                "shortwave_radiation",
                "precipitation",
                "wind_speed_10m",
                "vapor_pressure_deficit"
            ],
            "timezone" : "Africa/Casablanca",
            "forecast_days": 1
        }

        response = requests.get(url, params=params, timeout=10)
        response.raise_for_status()
        data = response.json()

        logger.success(f"Meteo collectee : {len(data['hourly']['time'])} heures")

        # TODO : Sauvegarder dans TimescaleDB
        # sauvegarder_meteo(data)

        return {"statut": "ok", "heures": len(data["hourly"]["time"])}

    except Exception as e:
        logger.error(f"Erreur collecte meteo : {e}")
        # Retry automatique apres 60 secondes
        raise self.retry(exc=e, countdown=60)


# ── TACHE 2 : Re-entrainement ML ─────────────────────────────
@app.task(name="core.celery_app.task_reentrainer_ml", bind=True)
def task_reentrainer_ml(self):
    """
    Re-entraine le modele Random Forest chaque dimanche 02h00
    Sur toutes les donnees historiques + nouvelles donnees
    """
    try:
        import pandas as pd
        from services.ml_pipeline import entrainer_modele

        logger.info("Demarrage re-entrainement hebdomadaire ML...")

        # TODO : Charger donnees depuis TimescaleDB
        # df = charger_donnees_historiques()
        # Pour test : donnees simulees
        import numpy as np
        n = 200
        df = pd.DataFrame({
            "rs_wm2"             : np.random.normal(500, 150, n),
            "temperature"        : np.random.normal(25, 5, n),
            "humidite_air"       : np.random.normal(65, 10, n),
            "ec_drain_avant"     : np.random.normal(3.0, 0.8, n),
            "ph_drain_avant"     : np.random.normal(6.5, 0.4, n),
            "pct_drainage_avant" : np.random.normal(22, 8, n),
            "jours_plantation"   : np.random.randint(0, 150, n),
            "stade"              : np.random.choice(
                ["vegetatif", "floraison", "recolte"], n
            ),
            "ec_drain_reel"      : np.random.normal(3.2, 0.9, n)
        })

        resultats = entrainer_modele(df)

        logger.info(f"Re-entrainement termine : {resultats}")
        return resultats

    except Exception as e:
        logger.error(f"Erreur re-entrainement ML : {e}")
        return {"statut": "erreur", "message": str(e)}


# ── TACHE 3 : Backup base de donnees ─────────────────────────
@app.task(name="core.celery_app.task_backup_bdd")
def task_backup_bdd():
    """
    Backup quotidien PostgreSQL/TimescaleDB
    Chaque nuit a 03h00
    """
    try:
        import subprocess
        from datetime import datetime

        date_str = datetime.now().strftime("%Y%m%d")
        backup_file = f"/app/backups/azura_backup_{date_str}.sql"

        os.makedirs("/app/backups", exist_ok=True)

        db_url = os.getenv("DATABASE_URL", "")
        # TODO : Executer pg_dump
        # subprocess.run(["pg_dump", db_url, "-f", backup_file])

        logger.success(f"Backup simule : {backup_file}")
        return {"statut": "ok", "fichier": backup_file}

    except Exception as e:
        logger.error(f"Erreur backup : {e}")
        return {"statut": "erreur", "message": str(e)}


# ── TACHE 4 : Health check systeme ───────────────────────────
@app.task(name="core.celery_app.task_health_check")
def task_health_check():
    """
    Verifie que tous les composants fonctionnent
    Toutes les 5 minutes
    """
    statuts = {}

    # Verifier Redis
    try:
        import redis
        r = redis.from_url(REDIS_URL)
        r.ping()
        statuts["redis"] = "ok"
    except Exception as e:
        statuts["redis"] = f"erreur: {e}"
        logger.error(f"Redis indisponible : {e}")

    # Verifier BDD
    try:
        # TODO : Verifier connexion PostgreSQL
        statuts["database"] = "ok"
    except Exception as e:
        statuts["database"] = f"erreur: {e}"

    # Verifier Open-Meteo
    try:
        r = requests.get("https://api.open-meteo.com", timeout=5)
        statuts["open_meteo"] = "ok" if r.status_code == 200 else "erreur"
    except Exception:
        statuts["open_meteo"] = "indisponible"
        logger.warning("Open-Meteo indisponible → Fallback donnees cache")

    logger.info(f"Health check : {statuts}")
    return statuts


# ── TACHE 5 : Calcul cycle suivant (appelee apres chaque cycle)
@app.task(name="core.celery_app.task_calcul_cycle_suivant", time_limit=25)
def task_calcul_cycle_suivant(donnees_cycle: dict) -> dict:
    """
    Calcule les parametres du prochain cycle
    Appelee automatiquement apres chaque cycle termine
    Timeout : 25 secondes (fallback FAO-56 si depasse)
    """
    try:
        from services.ec_ph import ajuster_cycle_suivant
        from services.fao56 import get_ec_cible_stade

        ec_drain_reel  = donnees_cycle.get("ec_drain_reel", 2.5)
        pct_drainage   = donnees_cycle.get("pct_drainage", 20)
        volume_actuel  = donnees_cycle.get("volume_l", 150)
        stade          = donnees_cycle.get("stade", "floraison")
        ec_drain_cible = get_ec_cible_stade(stade)

        ajustement = ajuster_cycle_suivant(
            ec_drain_reel  = ec_drain_reel,
            pct_drainage_reel = pct_drainage,
            volume_actuel_l   = volume_actuel,
            ec_drain_cible    = ec_drain_cible
        )

        logger.info(f"Cycle suivant calcule : {ajustement}")
        return ajustement

    except Exception as e:
        logger.error(f"Erreur calcul cycle suivant : {e} → Fallback FAO-56")
        return {
            "continuer"       : True,
            "facteur_volume"  : 1.0,
            "facteur_npk"     : 1.0,
            "nouveau_volume_l": donnees_cycle.get("volume_l", 150),
            "source"          : "FAO56_fallback",
            "erreur"          : str(e)
        }

# ── TACHE : Historique complet des tours ──────────────────────
@app.task(name="core.celery_app.task_historique_tours", bind=True)
def task_historique_tours(self):
    """
    Calcule les tours manquants pour tous les jours passés.
    Tourne chaque nuit à 00h05.
    """
    try:
        from core.database import SessionLocal
        from services.tour_service import calculer_historique_complet
        from models.sensor_model import Device

        db = SessionLocal()
        try:
            devices = db.query(Device).filter(Device.is_active == True).all()
            logger.info(f"Historique tours : {len(devices)} devices")
            for device in devices:
                calculer_historique_complet(db, device)
        finally:
            db.close()

        return {"statut": "ok"}
    except Exception as e:
        logger.error(f"Erreur historique tours : {e}")
        return {"statut": "erreur", "message": str(e)}


# ── TACHE : Tours jour en cours (toutes les 5 min) ────────────
@app.task(name="core.celery_app.task_tours_jour_en_cours")
def task_tours_jour_en_cours():
    """
    Recalcule les tours du jour en cours pour tous les devices.
    Tourne toutes les 5 minutes.
    """
    try:
        from core.database import SessionLocal
        from services.tour_service import calculer_jour_en_cours
        from models.sensor_model import Device

        db = SessionLocal()
        try:
            devices = db.query(Device).filter(Device.is_active == True).all()
            for device in devices:
                calculer_jour_en_cours(db, device)
        finally:
            db.close()

        return {"statut": "ok"}
    except Exception as e:
        logger.error(f"Erreur tours jour en cours : {e}")
        return {"statut": "erreur", "message": str(e)}