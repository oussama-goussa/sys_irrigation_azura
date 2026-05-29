# ============================================================
# backend/core/security.py — JWT + bcrypt + RBAC
# Production-hardened
# ============================================================

import os
import re
import redis as _redis_module
from redis.exceptions import ConnectionError as RedisConnectionError
from loguru import logger
from datetime import datetime, timedelta, timezone
from jose import JWTError, jwt
from passlib.context import CryptContext
from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer

import uuid

# ── Configuration ─────────────────────────────────────────────
SECRET_KEY = os.getenv("SECRET_KEY")
ALGORITHM  = os.getenv("ALGORITHM", "HS256")
ACCESS_TOKEN_EXPIRE_MINUTES = int(os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES", 30))
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
    expire = datetime.now(timezone.utc) + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    to_encode.update({"exp": expire, "type": "access", "jti": str(uuid.uuid4())})
    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)

def create_refresh_token(data: dict) -> str:
    to_encode = data.copy()
    expire = datetime.now(timezone.utc) + timedelta(days=REFRESH_TOKEN_EXPIRE_DAYS)
    jti = str(uuid.uuid4())
    to_encode.update({"exp": expire, "type": "refresh", "jti": jti})
    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)

def decode_token(token: str) -> dict:
    try:
        return jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
    except JWTError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token invalide ou expiré"
        )

# ── Révocation (définies AVANT get_current_user) ──────────────
def est_revoque(token: str) -> bool:
    """Vérifie si le JTI du token est dans la blacklist Redis."""
    if _redis is None:
        return False   # fail-open : Redis mort → ne pas bloquer tous les utilisateurs
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM],
                             options={"verify_exp": False})
        jti = payload.get("jti")
        if not jti:
            return True  # token sans JTI = toujours révoqué
        return _redis.exists(f"revoked:jti:{jti}") > 0
    except Exception:
        return True  # token illisible = considéré révoqué

# ── Get current user from token ───────────────────────────────
VALID_ROLES = {"admin", "agronome", "operateur", "auditeur"}

def get_current_user(token: str = Depends(oauth2_scheme)) -> dict:
    payload = decode_token(token)

    if payload.get("type") != "access":
        raise HTTPException(status_code=401, detail="Token invalide")

    # ← AJOUTER : vérifier si l'access token a été révoqué
    if est_revoque(token):
        raise HTTPException(status_code=401, detail="Token révoqué")

    username = payload.get("sub")
    role     = payload.get("role")
    farm_names = payload.get("farm_names", [])

    if not username or not isinstance(username, str):
        raise HTTPException(status_code=401, detail="Token invalide")
    if role not in VALID_ROLES:
        raise HTTPException(status_code=401, detail="Rôle invalide dans le token")
    if not isinstance(farm_names, list):
        farm_names = []
    farm_names = [f for f in farm_names if isinstance(f, str)]

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

def _get_redis_client():
    try:
        redis_url = os.getenv("REDIS_URL", "redis://redis:6379/0")
        # Injecter le mot de passe si défini séparément
        redis_password = os.getenv("REDIS_PASSWORD")
        client = _redis_module.from_url(
            redis_url,
            password=redis_password,  # ← ajouter
            socket_connect_timeout=3,
            socket_timeout=3,
            retry_on_timeout=True,
            decode_responses=True,
        )
        client.ping()
        return client
    except Exception as e:
        logger.warning(f"Redis indisponible : {e}")
        return None

_redis = _get_redis_client()

def revoquer_token(token: str, expire_seconds: int):
    """Révoque n'importe quel token (access ou refresh) par son JTI."""
    if _redis is None:
        logger.error("Impossible de révoquer le token : Redis indisponible")
        return
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM],
                             options={"verify_exp": False})
        jti = payload.get("jti")
        if jti:
            _redis.setex(f"revoked:jti:{jti}", expire_seconds, "1")
    except Exception as e:
        logger.error(f"Erreur révocation token : {e}")

def revoquer_refresh_token(token: str):
    revoquer_token(token, REFRESH_TOKEN_EXPIRE_DAYS * 24 * 3600)

def revoquer_access_token(token: str):
    revoquer_token(token, ACCESS_TOKEN_EXPIRE_MINUTES * 60)

# ── Shortcuts pour les routes ─────────────────────────────────
require_admin     = require_role(Role.ADMIN)
require_agronome  = require_role(Role.ADMIN, Role.AGRONOME)
require_operateur = require_role(Role.ADMIN, Role.AGRONOME, Role.OPERATEUR)
require_any       = require_role(Role.ADMIN, Role.AGRONOME, Role.OPERATEUR, Role.AUDITEUR)