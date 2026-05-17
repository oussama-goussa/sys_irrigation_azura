# ============================================================
# backend/core/database.py — Connexion PostgreSQL
# ============================================================

import os
from sqlalchemy import create_engine
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker

DATABASE_URL = os.getenv(
    "DATABASE_URL",
    "postgresql://azura_user:azura_test_2026@db:5432/azura_irrigation"
)

engine = create_engine(
    DATABASE_URL,
    pool_pre_ping=True,  # Vérifie la connexion avant chaque requête
    pool_recycle=3600    # Recyle les connexions toutes les heures
)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base = declarative_base()

# ── Dependency pour FastAPI ───────────────────────────────────
def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
