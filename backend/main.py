# ============================================================
# backend/main.py — FastAPI Application complète
# ============================================================

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text
from loguru import logger
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from routers.auth import limiter

from core.database import Base, engine, SessionLocal
from models.user_model import User, AuditLog
from services.user_service import init_default_users
from routers.auth import router as auth_router
from routers.recommendations import router as rec_router
from routers.sensors import router as sensors_router
from routers.devices import router as devices_router
from routers.saisie       import router as saisie_router
from routers.export_saisie import router as export_router
from models.ai_recommendation_model import AIRecommandation, AIConfigDevice
from routers.ai_agent import router as ai_router
from routers.weight import router as weight_router

from models.sensor_model import (
    Device, SensorReading, IrrigationCycle,
    FertigationState, Alert, AlertThreshold,
    IrrigationTour
)

# ── Migrations automatiques AVANT create_all ─────────────────
def run_migrations():
    """
    Ajoute les colonnes manquantes avant que SQLAlchemy
    lise le schéma. ADD COLUMN IF NOT EXISTS = safe.
    """
    try:
        with engine.connect() as conn:
            conn.execute(text("""
                ALTER TABLE users
                ADD COLUMN IF NOT EXISTS farm_names JSONB DEFAULT '[]'::jsonb
            """))
            conn.execute(text("""
                ALTER TABLE users
                ADD COLUMN IF NOT EXISTS last_login TIMESTAMPTZ
            """))
            conn.execute(text("""
                ALTER TABLE users
                ADD COLUMN IF NOT EXISTS email VARCHAR
            """))
            conn.execute(text("""
                ALTER TABLE irrigation_tours
                ADD COLUMN IF NOT EXISTS radiation_sum FLOAT
            """))
            conn.execute(text("""
                ALTER TABLE irrigation_tours
                ADD COLUMN IF NOT EXISTS cumul_radiation FLOAT
            """))
            conn.execute(text("""
                CREATE TABLE IF NOT EXISTS ai_config_devices (
                    id               BIGSERIAL PRIMARY KEY,
                    device_id        INTEGER NOT NULL REFERENCES devices(id) UNIQUE,
                    date_plantation  DATE,
                    ec_eau_brute     FLOAT  DEFAULT 0.8,
                    methode_decision VARCHAR(20) DEFAULT 'hybride',
                    actif            BOOLEAN DEFAULT TRUE,
                    created_at       TIMESTAMPTZ DEFAULT NOW(),
                    updated_at       TIMESTAMPTZ DEFAULT NOW()
                )
            """))
            conn.execute(text("""
                CREATE TABLE IF NOT EXISTS weight_readings (
                    id          BIGSERIAL PRIMARY KEY,
                    farm_name   VARCHAR(50) NOT NULL,
                    capteur_id  VARCHAR(50) NOT NULL,
                    poids_kg    FLOAT,
                    rssi        INTEGER,
                    timestamp   TIMESTAMP NOT NULL,
                    created_at  TIMESTAMP DEFAULT NOW()
                )
            """))
            conn.execute(text("""
                CREATE TABLE IF NOT EXISTS ai_recommandations (
                    id                 BIGSERIAL PRIMARY KEY,
                    device_id          INTEGER NOT NULL REFERENCES devices(id),
                    date               DATE NOT NULL,
                    radiation_jcm2     FLOAT,
                    t_max FLOAT, t_min FLOAT, t_moy FLOAT,
                    hr_moy FLOAT, vpd_kpa FLOAT,
                    pluie_mm           FLOAT DEFAULT 0,
                    scenario_meteo     VARCHAR(30),
                    stade              VARCHAR(30),
                    j_plantation       INTEGER,
                    ec_bassin          FLOAT,
                    pct_ressuyage      FLOAT,
                    et0_mm FLOAT, etc_mm FLOAT,
                    fraction_lessivage FLOAT,
                    volume_total_l_ha  FLOAT,
                    ec_cible_dSm       FLOAT,
                    nb_tours_prevu     INTEGER,
                    heure_debut        VARCHAR(5),
                    duree_t12_min      INTEGER,
                    duree_t3p_min      INTEGER,
                    repos_initial_min  INTEGER,
                    seuil_drainage_pct FLOAT,
                    doses_npk          JSONB,
                    correction_ph      JSONB,
                    nb_tours_reel      INTEGER DEFAULT 0,
                    statut             VARCHAR(20) DEFAULT 'en_cours',
                    ajustements        JSONB DEFAULT '[]'::jsonb,
                    methode_decision   VARCHAR(20) DEFAULT 'hybride',
                    created_at         TIMESTAMPTZ DEFAULT NOW(),
                    updated_at         TIMESTAMPTZ DEFAULT NOW(),
                    CONSTRAINT uq_ai_rec UNIQUE (device_id, date)
                )
            """))
            conn.commit()
        logger.success("Migrations appliquées ✅")
    except Exception as e:
        logger.warning(f"Migrations ignorées (table absente au premier boot) : {e}")

run_migrations()

# ── Créer les tables PostgreSQL ───────────────────────────────
Base.metadata.create_all(bind=engine)

# ── Application ───────────────────────────────────────────────
app = FastAPI(
    title       = "Azura Irrigation IA",
    description = """
## Système intelligent d'aide à la décision — Azura Group

### Authentification
Utilisez `/api/auth/login` pour obtenir un token JWT.
Cliquez sur **Authorize** 🔒 et entrez : `Bearer <votre_token>`

### Comptes de test
| Username | Password | Role |
|---|---|---|
| admin | Admin@2026 | Admin |
| operateur | Operateur@2026 | Opérateur |
    """,
    version = "1.0.0",
)
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

# ── CORS ──────────────────────────────────────────────────────
app.add_middleware(
    CORSMiddleware,
    allow_origins     = ["http://localhost:5173", "http://localhost:3000", "*"],
    allow_credentials = True,
    allow_methods     = ["*"],
    allow_headers     = ["*"],
)

# ── Startup ───────────────────────────────────────────────────
@app.on_event("startup")
def startup():
    db = SessionLocal()
    try:
        init_default_users(db)
        try:
            from core.celery_app import task_historique_tours, task_tours_jour_en_cours
            task_historique_tours.delay()
            task_tours_jour_en_cours.delay()
        except Exception as e:
            logger.warning(f"Celery non disponible au démarrage : {e}")
        logger.success("Application Azura démarrée ✅")
    finally:
        db.close()

# ── Routers ───────────────────────────────────────────────────
app.include_router(auth_router)
app.include_router(rec_router)
app.include_router(sensors_router)
app.include_router(devices_router)
app.include_router(saisie_router)
app.include_router(export_router)
app.include_router(ai_router)
app.include_router(weight_router)

# ── Endpoints publics ─────────────────────────────────────────
@app.get("/", tags=["General"])
def root():
    return {
        "message": "Azura Irrigation IA ✅",
        "version": "1.0.0",
        "docs"   : "/docs",
        "endpoints": {
            "auth"           : "/api/auth/login",
            "recommandation" : "/api/recommendations/journee",
            "meteo"          : "/api/recommendations/meteo",
            "dashboard"      : "/api/devices/dashboard",
            "device_latest"  : "/api/devices/{id}/latest",
            "device_history" : "/api/devices/{id}/history",
        }
    }

@app.get("/health", tags=["General"])
def health():
    return {"statut": "ok", "service": "azura-backend"}