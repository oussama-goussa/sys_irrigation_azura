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
from fastapi.responses import JSONResponse

import os

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

from routers.export_sensor import router as export_sensor_router 

from fastapi import Request
from starlette.middleware.base import BaseHTTPMiddleware

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
            conn.execute(text("""
                ALTER TABLE ai_recommandations
                ADD COLUMN IF NOT EXISTS radiation_sum_debut FLOAT
            """))
            conn.execute(text("""
                UPDATE alerts SET resolved_at = NOW(), resolved_by = 'migration-v2'
                WHERE alert_type IN ('RADIATION', 'VPD_LOW')
                AND resolved_at IS NULL
                AND value_detected < 1200
            """))
            conn.execute(text("""
                UPDATE alerts SET threshold_max = 2000
                WHERE alert_type = 'RADIATION_SUM' AND severity = 'WARNING'
                AND threshold_max IS NULL
            """))
            conn.execute(text("""
                UPDATE alerts SET threshold_max = 3000
                WHERE alert_type = 'RADIATION_SUM' AND severity = 'CRITICAL'
                AND threshold_max IS NULL
            """))
            conn.execute(text("""
                UPDATE alerts SET threshold_max = 900
                WHERE alert_type = 'RADIATION' AND severity = 'WARNING'
                AND threshold_max IS NULL
            """))
            conn.execute(text("""
                UPDATE alerts SET threshold_max = 700
                WHERE alert_type = 'RADIATION' AND severity = 'INFO'
                AND threshold_max IS NULL
            """))
            conn.commit()
        logger.success("Migrations appliquées ✅")
    except Exception as e:
        logger.warning(f"Migrations ignorées (table absente au premier boot) : {e}")

run_migrations()

# ── Créer les tables PostgreSQL ───────────────────────────────
Base.metadata.create_all(bind=engine)

# ── Application ───────────────────────────────────────────────
import os
_ENV = os.getenv("ENVIRONMENT", "production")

app = FastAPI(
    title       = "Azura Irrigation IA",
    description = "Système intelligent d'aide à la décision — Azura Group",
    version     = "1.0.0",
    # Désactiver Swagger/ReDoc en production
    docs_url    = "/docs" if _ENV != "production" else None,
    redoc_url   = "/redoc" if _ENV != "production" else None,
    openapi_url = "/openapi.json" if _ENV != "production" else None,
)
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

# ── CORS ──────────────────────────────────────────────────────
ALLOWED_ORIGINS_RAW = os.getenv("ALLOWED_ORIGINS", "")
# Filtrer les valeurs vides issues d'un split sur chaîne vide
ALLOWED_ORIGINS = [o.strip() for o in ALLOWED_ORIGINS_RAW.split(",") if o.strip()]

if not ALLOWED_ORIGINS:
    _ENV = os.getenv("ENVIRONMENT", "production")
    if _ENV == "production":
        raise RuntimeError(
            "ALLOWED_ORIGINS doit être défini en production. "
            "Exemple : ALLOWED_ORIGINS=https://votre-domaine.com"
        )
    else:
        ALLOWED_ORIGINS = ["http://localhost:5173", "http://localhost:5174"]
        logger.warning(f"CORS dev : {ALLOWED_ORIGINS}")

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE"],
    allow_headers=["Authorization", "Content-Type"],
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

class LimitRequestSizeMiddleware:
    """Middleware ASGI pur — compatible avec le body form-data."""
    MAX_SIZE = 5 * 1024 * 1024  # 5 MB

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        headers = dict(scope.get("headers", []))
        cl = headers.get(b"content-length")
        if cl:
            try:
                if int(cl) > self.MAX_SIZE:
                    from fastapi.responses import JSONResponse
                    response = JSONResponse({"detail": "Requete trop volumineuse"}, status_code=413)
                    await response(scope, receive, send)
                    return
            except (ValueError, TypeError):
                pass

        body = b""
        more_body = True
        while more_body:
            message = await receive()
            body += message.get("body", b"")
            more_body = message.get("more_body", False)
            if len(body) > self.MAX_SIZE:
                from fastapi.responses import JSONResponse
                response = JSONResponse({"detail": "Requete trop volumineuse"}, status_code=413)
                await response(scope, receive, send)
                return

        async def receive_buffered():
            return {"type": "http.request", "body": body, "more_body": False}

        await self.app(scope, receive_buffered, send)
app.add_middleware(LimitRequestSizeMiddleware)

class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request, call_next):
        response = await call_next(request)
        
        # Ne pas appliquer les headers restrictifs sur les exports
        is_export = "/export" in request.url.path
        
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["X-XSS-Protection"] = "1; mode=block"
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        response.headers["Permissions-Policy"] = "geolocation=(), microphone=()"
        
        if not is_export:
            response.headers["X-Content-Type-Options"] = "nosniff"
            response.headers["Content-Security-Policy"] = (
                "default-src 'self'; "
                "script-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com; "
                "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; "
                "font-src 'self' https://fonts.gstatic.com data:; "
                "img-src 'self' data: blob:; "
                "connect-src 'self'; "
                "frame-ancestors 'none';"
            )
        return response  

app.add_middleware(SecurityHeadersMiddleware)

# ── Routers ───────────────────────────────────────────────────
app.include_router(auth_router)
app.include_router(rec_router)
app.include_router(sensors_router)
app.include_router(devices_router)
app.include_router(saisie_router)
app.include_router(export_router)
app.include_router(ai_router)
app.include_router(weight_router)

app.include_router(export_sensor_router) 

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
async def health():
    return {"statut": "ok", "service": "azura-backend"}

@app.get("/ping")
async def ping():
    return {"ping": "pong"}