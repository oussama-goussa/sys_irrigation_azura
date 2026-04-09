# ============================================================
# backend/services/user_service.py
# ============================================================

import uuid
import csv
import io
from datetime import datetime, timezone
from sqlalchemy.orm import Session
from loguru import logger

from models.user_model import User, AuditLog
from core.security import hash_password, Role


# ── Audit log helper ──────────────────────────────────────────
def log_action(db: Session, username: str, action: str, detail: str = None, ip: str = None):
    entry = AuditLog(
        id       = str(uuid.uuid4()),
        username = username,
        action   = action,
        detail   = detail,
        ip       = ip,
    )
    db.add(entry)
    db.commit()


# ── User CRUD ─────────────────────────────────────────────────
def get_user(db: Session, username: str) -> User | None:
    return db.query(User).filter(User.username == username).first()


def get_all_users(db: Session) -> list:
    return [u.to_dict() for u in db.query(User).all()]


def create_user(
    db: Session, username: str, password: str,
    role: str, nom: str, email: str = None,
    farm_names=None
) -> User:
    user = User(
        username = username,
        password = hash_password(password),
        role     = role,
        nom      = nom,
        email    = email,
        farm_names = farm_names or [],
        actif    = True,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    logger.success(f"User créé : {username} ({role})")
    return user


def update_user(
    db: Session, username: str,
    nom: str = None, email: str = None, password: str = None
) -> User | None:
    user = get_user(db, username)
    if not user:
        return None
    if nom is not None:
        user.nom = nom
    if email is not None:
        user.email = email
    if password is not None:
        user.password = hash_password(password)
    db.commit()
    db.refresh(user)
    logger.info(f"User mis à jour : {username}")
    return user


def update_user_role(db: Session, username: str, new_role: str) -> User | None:
    user = get_user(db, username)
    if not user:
        return None
    user.role = new_role
    db.commit()
    db.refresh(user)
    return user


def toggle_user_actif(db: Session, username: str) -> User | None:
    user = get_user(db, username)
    if not user:
        return None
    user.actif = not user.actif
    db.commit()
    db.refresh(user)
    return user


def update_last_login(db: Session, username: str):
    user = get_user(db, username)
    if user:
        user.last_login = datetime.now(timezone.utc)
        db.commit()


# ── Audit logs ────────────────────────────────────────────────
def get_audit_logs(db: Session, username: str = None, limit: int = 100) -> list:
    query = db.query(AuditLog).order_by(AuditLog.created_at.desc())
    if username:
        query = query.filter(AuditLog.username == username)
    return [log.to_dict() for log in query.limit(limit).all()]


# ── Export CSV ────────────────────────────────────────────────
def export_users_csv(db: Session) -> str:
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(["username", "nom", "email", "role", "actif", "last_login", "created_at"])
    for u in db.query(User).all():
        writer.writerow([
            u.username, u.nom, u.email or "", u.role,
            "oui" if u.actif else "non",
            str(u.last_login) if u.last_login else "",
            str(u.created_at),
        ])
    return output.getvalue()


# ── Init default users ────────────────────────────────────────
def init_default_users(db: Session):
    if db.query(User).count() > 0:
        logger.info("Users déjà initialisés")
        return
    for u in [
        {"username": "admin",     "password": "Admin@2026",     "role": Role.ADMIN,     "nom": "Administrateur Azura"},
        {"username": "operateur", "password": "Operateur@2026", "role": Role.OPERATEUR, "nom": "Opérateur Terrain Azura"},
    ]:
        create_user(db, u["username"], u["password"], u["role"], u["nom"])
    logger.success("Users par défaut créés ✅")