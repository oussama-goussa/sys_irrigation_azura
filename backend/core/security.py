# ============================================================
# backend/core/security.py — JWT + bcrypt + RBAC
# Production-hardened
# ============================================================

import os
import re
from datetime import datetime, timedelta
from jose import JWTError, jwt
from passlib.context import CryptContext
from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
import redis

# ── Configuration ─────────────────────────────────────────────
SECRET_KEY = os.getenv("SECRET_KEY")
ALGORITHM  = os.getenv("ALGORITHM", "HS256")
ACCESS_TOKEN_EXPIRE_MINUTES = int(os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES", 15))
REFRESH_TOKEN_EXPIRE_DAYS   = int(os.getenv("REFRESH_TOKEN_EXPIRE_DAYS", 7))

# ── MODIFICATION 1 : Bloquer le démarrage si SECRET_KEY absente ou faible ──
if not SECRET_KEY:
    raise RuntimeError(
        "SECRET_KEY manquante dans .env — "
        "Générer avec : python -c \"import secrets; print(secrets.token_hex(32))\""
    )

if SECRET_KEY in ("azura_secret_key_test", "azura_secret_key_test_changer_en_production"):
    raise RuntimeError(
        "SECRET_KEY est encore la valeur de test — "
        "Remplacer par une clé générée avec secrets.token_hex(32)"
    )

if len(SECRET_KEY) < 32:
    raise RuntimeError(
        f"SECRET_KEY trop courte ({len(SECRET_KEY)} chars) — minimum 32 caractères requis"
    )

# ── Bcrypt password hashing ───────────────────────────────────
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

# ── OAuth2 scheme ─────────────────────────────────────────────
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/login")

# ── 4 Roles RBAC ──────────────────────────────────────────────
class Role:
    ADMIN     = "admin"
    AGRONOME  = "agronome"
    OPERATEUR = "operateur"
    AUDITEUR  = "auditeur"

ROLE_PERMISSIONS = {
    Role.ADMIN    : ["read", "write", "delete", "admin", "params"],
    Role.AGRONOME : ["read", "params"],
    Role.OPERATEUR: ["read", "validate"],
    Role.AUDITEUR : ["read"]
}

# ── Password functions ────────────────────────────────────────
def hash_password(password: str) -> str:
    return pwd_context.hash(password)

def verify_password(plain: str, hashed: str) -> bool:
    return pwd_context.verify(plain, hashed)

# ── MODIFICATION 2 : Validation mot de passe ─────────────────
def valider_mot_de_passe(password: str) -> None:
    """
    Valide la force du mot de passe.
    Lève HTTPException 400 si non conforme.
    Règles : 8+ chars, 1 majuscule, 1 chiffre, 1 caractère spécial
    """
    erreurs = []

    if len(password) < 8:
        erreurs.append("minimum 8 caractères")

    if not re.search(r"[A-Z]", password):
        erreurs.append("au moins 1 majuscule")

    if not re.search(r"[0-9]", password):
        erreurs.append("au moins 1 chiffre")

    if not re.search(r"[!@#$%^&*()_+\-=\[\]{};':\"\\|,.<>\/?]", password):
        erreurs.append("au moins 1 caractère spécial (!@#$...)")

    if erreurs:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Mot de passe invalide : {', '.join(erreurs)}"
        )

# ── JWT Token functions ───────────────────────────────────────
def create_access_token(data: dict) -> str:
    to_encode = data.copy()
    expire = datetime.utcnow() + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    to_encode.update({"exp": expire, "type": "access"})
    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)

def create_refresh_token(data: dict) -> str:
    to_encode = data.copy()
    expire = datetime.utcnow() + timedelta(days=REFRESH_TOKEN_EXPIRE_DAYS)
    to_encode.update({"exp": expire, "type": "refresh"})
    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)

def decode_token(token: str) -> dict:
    try:
        return jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
    except JWTError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token invalide ou expiré"
        )

# ── Get current user from token ───────────────────────────────
def get_current_user(token: str = Depends(oauth2_scheme)) -> dict:
    payload = decode_token(token)
    username = payload.get("sub")
    role     = payload.get("role")
    farm_names = payload.get("farm_names", [])   # ← liste
    if not username:
        raise HTTPException(status_code=401, detail="Token invalide")
    return {"username": username, "role": role, "farm_names": farm_names}

# ── Role checker ──────────────────────────────────────────────
def require_role(*allowed_roles):
    def checker(user: dict = Depends(get_current_user)):
        if user["role"] not in allowed_roles:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Accès refusé — rôle requis : {list(allowed_roles)}"
            )
        return user
    return checker

# ── Shortcuts pour les routes ─────────────────────────────────
require_admin     = require_role(Role.ADMIN)
require_agronome  = require_role(Role.ADMIN, Role.AGRONOME)
require_operateur = require_role(Role.ADMIN, Role.AGRONOME, Role.OPERATEUR)
require_any       = require_role(Role.ADMIN, Role.AGRONOME, Role.OPERATEUR, Role.AUDITEUR)

_redis = redis.from_url(os.getenv("REDIS_URL", "redis://redis:6379/0"))

def revoquer_refresh_token(token: str):
    # Stocker pendant 7 jours (durée du refresh token)
    _redis.setex(f"revoked:{token}", 7 * 24 * 3600, "1")

def est_revoque(token: str) -> bool:
    return _redis.exists(f"revoked:{token}") > 0