# ============================================================
# alembic/env.py — Configuration environnement Alembic
# Projet Azura Irrigation IA — GOUSSA Oussama
# ============================================================

import os
import sys
from logging.config import fileConfig
from sqlalchemy import engine_from_config, pool
from alembic import context

# ── Ajouter le dossier backend au path ───────────────────────
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# ── Importer TOUS les modèles ─────────────────────────────────
# Important : tous les modèles doivent être importés ici
# pour qu'Alembic les détecte automatiquement
from core.database import Base

from models.user_model import User, AuditLog
from models.sensor_model import (
    Device,
    SensorReading,
    IrrigationCycle,
    FertigationState,
    Alert,
    AlertThreshold,
)

# ── Configuration Alembic ─────────────────────────────────────
config = context.config

# Lire la config logging depuis alembic.ini
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

# Metadata pour autogenerate
target_metadata = Base.metadata

# ── URL de la DB depuis variable d'environnement ──────────────
def get_url():
    return os.getenv(
        "DATABASE_URL",
        "postgresql://azura_user:azura_test_2026@db:5432/azura_irrigation"
    )


# ── Migration OFFLINE (sans connexion DB) ─────────────────────
def run_migrations_offline() -> None:
    url = get_url()
    context.configure(
        url                      = url,
        target_metadata          = target_metadata,
        literal_binds            = True,
        dialect_opts             = {"paramstyle": "named"},
        compare_type             = True,
        compare_server_default   = True,
    )
    with context.begin_transaction():
        context.run_migrations()


# ── Migration ONLINE (avec connexion DB) ──────────────────────
def run_migrations_online() -> None:
    configuration = config.get_section(config.config_ini_section)
    configuration["sqlalchemy.url"] = get_url()

    connectable = engine_from_config(
        configuration,
        prefix        = "sqlalchemy.",
        poolclass     = pool.NullPool,
    )

    with connectable.connect() as connection:
        context.configure(
            connection             = connection,
            target_metadata        = target_metadata,
            compare_type           = True,
            compare_server_default = True,
        )
        with context.begin_transaction():
            context.run_migrations()


# ── Lancer selon le mode ──────────────────────────────────────
if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()