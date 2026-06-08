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
import urllib.parse

_redis_password = os.getenv("REDIS_PASSWORD", "")
if _redis_password:
    _pwd = urllib.parse.quote(_redis_password, safe="")
    REDIS_URL = os.getenv("REDIS_URL", f"redis://:{_pwd}@redis:6379/0")
else:
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
    "calcul-historique-tours": {
        "task"    : "core.celery_app.task_historique_tours",
        "schedule": crontab(hour=0, minute=5),  # chaque nuit à 00h05
    },

    # Tours — jour en cours toutes les 5 min
    "calcul-tours-jour-en-cours": {
        "task"    : "core.celery_app.task_tours_jour_en_cours",
        "schedule": crontab(minute="*/5"),
    },

    # Recommandations IA générées chaque matin à 06h00
    "generer-recommandations-matin": {
        "task"    : "core.celery_app.task_generer_recommandations_matin",
        "schedule": crontab(hour=6, minute=0),
    },
 
    # Ajustements inter-tours toutes les 5 min (combiné avec tours_jour_en_cours)
    "ajustement-inter-tours": {
        "task"    : "core.celery_app.task_ajustement_inter_tours",
        "schedule": crontab(minute="*/5"),
    },

    "check-offline-stations": {
        "task"    : "core.celery_app.task_check_offline_stations",
        "schedule": crontab(minute="*/10"),
    },
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

# ── TÂCHE : Générer recommandations matin (toutes les houses) ─
@app.task(name="core.celery_app.task_generer_recommandations_matin")
def task_generer_recommandations_matin():
    """
    Génère les recommandations IA du matin pour tous les devices actifs.
    Planifiée à 06h00 chaque matin.
    Utilise generer_recommandation_tous_devices() pour la boucle auto-discovery.
    """
    try:
        from services.ai_service import generer_recommandation_tous_devices, sauvegarder_recommandation
        from core.database import SessionLocal
        from models.ai_recommandation_model import AIRecommandation
        from datetime import date

        today = date.today().isoformat()

        # Vérifier si déjà générées aujourd'hui
        db = SessionLocal()
        try:
            existing_count = db.query(AIRecommandation).filter(
                AIRecommandation.date == today
            ).count()
            if existing_count > 0:
                logger.info(f"Recommandations déjà générées aujourd'hui ({existing_count}) — skip")
                return {"statut": "ok", "generated": 0, "message": "Déjà générées"}
        finally:
            db.close()

        # Générer pour tous les devices
        resultat = generer_recommandation_tous_devices(today)

        # Sauvegarder en BDD
        db = SessionLocal()
        try:
            generated = 0
            for r in resultat.get("recommandations", []):
                try:
                    sauvegarder_recommandation(db, r)
                    generated += 1
                except Exception as e:
                    logger.error(f"Erreur sauvegarde recommandation : {e}")

            logger.success(f"Recommandations générées : {generated} devices")
            return {"statut": "ok", "generated": generated, "total": resultat.get("total_devices", 0)}
        finally:
            db.close()

    except Exception as e:
        logger.error(f"Erreur tâche recommandations matin : {e}")
        return {"statut": "erreur", "message": str(e)}


# ── TÂCHE : Backfill historique des recommandations ───────────
@app.task(name="core.celery_app.task_backfill_recommandations", bind=True)
def task_backfill_recommandations(self, device_id: int = None):
    """
    Tâche Celery pour générer les recommandations historiques.
    Non planifiée automatiquement — à appeler manuellement.
    Appel: task_backfill_recommandations.delay() ou .delay(device_id=1)
    """
    try:
        from services.ai_service import (
            generer_recommandation_historique_tous_devices,
            generer_recommandation_historique_device,
        )
        from core.database import SessionLocal
        from models.sensor_model import Device
        from datetime import date

        if device_id:
            db = SessionLocal()
            try:
                device = db.query(Device).filter(Device.id == device_id).first()
                if device is None:
                    return {"statut": "erreur", "message": f"Device {device_id} introuvable"}
                date_debut = device.created_at.date().isoformat() if device.created_at else date.today().isoformat()
                date_fin = date.today().isoformat()
            finally:
                db.close()

            resultat = generer_recommandation_historique_device(device_id, date_debut, date_fin)
        else:
            resultat = generer_recommandation_historique_tous_devices()

        return {"statut": "ok", **resultat}

    except Exception as e:
        logger.error(f"Erreur backfill historique : {e}")
        return {"statut": "erreur", "message": str(e)}


# ── TÂCHE : Ajustement automatique pendant repos inter-tour ───
@app.task(name="core.celery_app.task_ajustement_inter_tours")
def task_ajustement_inter_tours():
    """
    Déclenché toutes les 5 minutes pendant la journée.
    Détecte les tours qui viennent de se terminer dans irrigation_tours
    et génère automatiquement l'ajustement IA pour le prochain.
    Mode dégradé : sans données drainage → règles simples.
    """
    try:
        from core.database import SessionLocal
        from models.sensor_model import Device, IrrigationTour
        from models.ai_recommendation_model import AIRecommandation, AIDecisionTour
        from services.ai_service import ajuster_apres_tour
        from datetime import date, datetime, timedelta

        db = SessionLocal()
        try:
            today = date.today()
            # Tours complétés dans les 10 dernières minutes
            cutoff = datetime.utcnow() - timedelta(minutes=10)

            tours_recents = (
                db.query(IrrigationTour)
                .filter(
                    IrrigationTour.date        == today,
                    IrrigationTour.is_complete == True,
                    IrrigationTour.fin         >= cutoff,
                )
                .all()
            )

            for tour in tours_recents:
                rec = db.query(AIRecommandation).filter(
                    AIRecommandation.device_id == tour.device_id,
                    AIRecommandation.date      == today,
                ).first()

                if not rec or rec.statut in ("rejected",):
                    continue

                # Vérifier si cet ajustement a déjà été fait
                deja_fait = db.query(AIDecisionTour).filter(
                    AIDecisionTour.device_id == tour.device_id,
                    AIDecisionTour.date      == today,
                    AIDecisionTour.num_tour  == tour.tour_num,
                ).first()

                if deja_fait:
                    continue

                # Mode dégradé : pas de drainage → règles simples
                recommandation_dict = {
                    "_etat": {
                        "duree_t3p_courant": rec.duree_min or 8,
                        "dernier_drainage"  : 0.0,
                    }
                }

                ajustement = ajuster_apres_tour(
                    recommandation = recommandation_dict,
                    drainage_reel  = None,
                    num_tour       = tour.tour_num,
                    tours_restants = max(1, (rec.nb_tours or 10) - tour.tour_num),
                )

                # Sauvegarder l'ajustement
                decision = AIDecisionTour(
                    device_id     = tour.device_id,
                    date          = today,
                    num_tour      = tour.tour_num,
                    decision      = ajustement.get("action", "CONTINUER"),
                    raison        = ajustement.get("raison", "CONTINUER"),
                    duree_suivant = ajustement.get("duree_suivant"),
                    donnees_entree= ajustement,
                    disponible    = False,  # mode dégradé
                )
                db.add(decision)

                # Mettre à jour le statut si STOP
                if ajustement.get("stop"):
                    rec.statut = "approved"  # l'IA a décidé de s'arrêter

                db.commit()
                logger.info(
                    f"Ajustement auto : device {tour.device_id} "
                    f"tour {tour.tour_num} → {ajustement.get('action', 'CONTINUER')}"
                )

            return {"statut": "ok"}
        finally:
            db.close()
    except Exception as e:
        logger.error(f"Erreur ajustement inter-tours : {e}")
        return {"statut": "erreur", "message": str(e)}


# ── Ajouter dans beat_schedule existant :
# "generer-recommandations-matin": {
#     "task"    : "core.celery_app.task_generer_recommandations_matin",
#     "schedule": crontab(hour=6, minute=0),   # 06h00 chaque matin
# },
# "ajustement-inter-tours": {
#     "task"    : "core.celery_app.task_ajustement_inter_tours",
#     "schedule": crontab(minute="*/5"),        # toutes les 5 min (déjà comme tours_jour_en_cours)
# },


# ── TÂCHE : Vérifier les stations hors ligne ──────────────────
@app.task(name="core.celery_app.task_check_offline_stations")
def task_check_offline_stations():
    """
    Toutes les 10 min : alerte si une station n'a pas envoyé de données
    depuis plus de 20 minutes.
    """
    try:
        from core.database import SessionLocal
        from models.sensor_model import Device, SensorReading, Alert
        from sqlalchemy import func
        from datetime import datetime, timedelta

        db = SessionLocal()
        try:
            cutoff_offline = datetime.utcnow() - timedelta(minutes=20)
            cutoff_alert   = datetime.utcnow() - timedelta(minutes=30)
            devices = db.query(Device).filter(Device.is_active == True).all()

            for device in devices:
                last = (
                    db.query(SensorReading)
                    .filter(SensorReading.device_id == device.id)
                    .order_by(SensorReading.timestamp.desc())
                    .first()
                )
                if not last or last.timestamp < cutoff_offline:
                    existing = db.query(Alert).filter(
                        Alert.device_id  == device.id,
                        Alert.alert_type == "OFFLINE",
                        Alert.resolved_at == None,
                        Alert.timestamp  >= cutoff_alert,
                    ).first()
                    if not existing:
                        if last is not None:
                            minutes_ago = int((datetime.utcnow() - last.timestamp).total_seconds() / 60)
                            d, h, m = minutes_ago // 1440, (minutes_ago % 1440) // 60, minutes_ago % 60
                            if d > 0:
                                duration_str = f"{d}j {h}h" if h else f"{d}j"
                            elif h > 0:
                                duration_str = f"{h}h {m}min" if m else f"{h}h"
                            else:
                                duration_str = f"{minutes_ago} min"
                            msg = f"Station hors ligne depuis {duration_str} — {device.farm_name} Station {device.house_number}"
                        else:
                            minutes_ago = None
                            msg = f"Station jamais connectée — {device.farm_name} Station {device.house_number}"
                        
                        alert = Alert(
                            device_id      = device.id,
                            timestamp      = datetime.utcnow(),
                            alert_type     = "OFFLINE",
                            value_detected = float(minutes_ago) if minutes_ago is not None else None,
                            severity       = "CRITICAL",
                            message        = msg,
                        )
                        db.add(alert)
                        logger.warning(f"⚠️ OFFLINE : {msg}")                
                else:
                    # Station revenue en ligne → résoudre les alertes OFFLINE
                    db.query(Alert).filter(
                        Alert.device_id  == device.id,
                        Alert.alert_type == "OFFLINE",
                        Alert.resolved_at == None,
                    ).update({"resolved_at": datetime.utcnow(), "resolved_by": "auto"})

            db.commit()
            return {"statut": "ok"}
        finally:
            db.close()
    except Exception as e:
        logger.error(f"Erreur check offline : {e}")
        return {"statut": "erreur", "message": str(e)}