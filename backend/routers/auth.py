# ============================================================
# backend/routers/auth.py
# ============================================================

import re
from fastapi import APIRouter, HTTPException, Depends, Request, status
from fastapi.responses import StreamingResponse, JSONResponse
from fastapi.security import OAuth2PasswordRequestForm
from pydantic import BaseModel, Field, field_validator, EmailStr
from typing import Optional
from sqlalchemy.orm import Session
from loguru import logger

import os

from slowapi import Limiter
from slowapi.util import get_remote_address
limiter = Limiter(key_func=get_remote_address)

from core.database import get_db
from core.security import (
    verify_password, create_access_token, create_refresh_token,
    decode_token, get_current_user, require_admin, require_any,
    valider_mot_de_passe, Role, est_revoque, revoquer_refresh_token
)
from services.user_service import (
    get_user, get_all_users, create_user, update_user,
    update_user_role, toggle_user_actif, update_last_login,
    get_audit_logs, export_users_excel, log_action
)

router = APIRouter(prefix="/api/auth", tags=["Authentification"])

_USERNAME_RE = re.compile(r'^[a-zA-Z0-9_.-]{1,50}$')
_VALID_ROLES  = {Role.ADMIN, Role.AGRONOME, Role.OPERATEUR, Role.AUDITEUR}


# ── Schemas ───────────────────────────────────────────────────

class TokenResponse(BaseModel):
    access_token : str
    token_type   : str = "bearer"
    role         : str
    username     : str
    farm_names   : list = []
    # refresh_token retiré du body → envoyé en cookie HttpOnly


class RefreshRequest(BaseModel):
    refresh_token: str = Field(..., max_length=2048)


class CreateUserRequest(BaseModel):
    username   : str            = Field(..., min_length=3, max_length=50)
    password   : str            = Field(..., min_length=8, max_length=128)
    role       : str            = Field(..., max_length=20)
    nom        : str            = Field(..., min_length=1, max_length=100)
    email      : Optional[str]  = Field(None, max_length=254)
    farm_names : Optional[list] = Field(default_factory=list)

    @field_validator('farm_names')
    @classmethod
    def farm_names_valide(cls, v):
        if v is None:
            return []
        if not isinstance(v, list) or len(v) > 50:
            raise ValueError('farm_names invalide')
        _farm_re = re.compile(r'^[a-zA-Z0-9_\- ]{1,50}$')
        for farm in v:
            if not isinstance(farm, str) or not _farm_re.match(farm):
                raise ValueError(f'Nom de ferme invalide : {farm!r}')
        return v

    @field_validator('username')
    @classmethod
    def username_valide(cls, v: str) -> str:
        if not _USERNAME_RE.match(v):
            raise ValueError('Username invalide (lettres, chiffres, _ . - uniquement)')
        return v.lower()

    @field_validator('role')
    @classmethod
    def role_valide(cls, v: str) -> str:
        if v not in _VALID_ROLES:
            raise ValueError(f'Rôle invalide. Valeurs acceptées : {list(_VALID_ROLES)}')
        return v

    @field_validator('nom')
    @classmethod
    def nom_valide(cls, v: str) -> str:
        v = v.strip()
        if not re.match(r'^[a-zA-ZÀ-ÿ0-9 _\-]{1,100}$', v):
            raise ValueError('Nom invalide')
        return v


class UpdateUserRequest(BaseModel):
    nom        : Optional[str]  = Field(None, min_length=1, max_length=100)
    email      : Optional[str]  = Field(None, max_length=254)
    password   : Optional[str]  = Field(None, min_length=8, max_length=128)
    farm_names : Optional[list] = Field(None, max_length=50)

    @field_validator('nom')
    @classmethod
    def nom_valide(cls, v):
        if v is None:
            return v
        v = v.strip()
        if not re.match(r'^[a-zA-ZÀ-ÿ0-9 _\-]{1,100}$', v):
            raise ValueError('Nom invalide')
        return v

    @field_validator('farm_names')
    @classmethod
    def farm_names_valide(cls, v):
        if v is None:
            return v
        if not isinstance(v, list):
            raise ValueError('farm_names doit être une liste')
        if len(v) > 50:
            raise ValueError('Trop de fermes (max 50)')
        _farm_re = re.compile(r'^[a-zA-Z0-9_\- ]{1,50}$')
        for farm in v:
            if not isinstance(farm, str) or not _farm_re.match(farm):
                raise ValueError(f'Nom de ferme invalide : {farm!r}')
        return v


class UpdateRoleRequest(BaseModel):
    new_role: str = Field(..., max_length=20)

    @field_validator('new_role')
    @classmethod
    def role_valide(cls, v: str) -> str:
        if v not in _VALID_ROLES:
            raise ValueError(f'Rôle invalide. Valeurs acceptées : {list(_VALID_ROLES)}')
        return v


# ── POST /api/auth/login ──────────────────────────────────────
@router.post("/login", response_model=TokenResponse)
@limiter.limit("5/minute")
def login(
    request : Request,
    form    : OAuth2PasswordRequestForm = Depends(),
    db      : Session = Depends(get_db)
):
    # 1. Valider taille et format AVANT toute requête BDD
    if len(form.username) > 50 or len(form.password) > 128:
        raise HTTPException(status_code=401, detail="Identifiants incorrects")

    if not _USERNAME_RE.match(form.username):
        raise HTTPException(status_code=401, detail="Identifiants incorrects")

    # 2. Vérifier les credentials
    user = get_user(db, form.username.lower())
    if not user or not verify_password(form.password, user.password):
        log_action(db, form.username[:50], "LOGIN_FAILED", ip=request.client.host)
        raise HTTPException(status_code=401, detail="Identifiants incorrects")

    if not user.actif:
        log_action(db, user.username, "LOGIN_BLOCKED", ip=request.client.host)
        raise HTTPException(status_code=401, detail="Identifiants incorrects")

    # 3. Générer les tokens
    update_last_login(db, user.username)
    log_action(db, user.username, "LOGIN", ip=request.client.host)

    token_data    = {"sub": user.username, "role": user.role, "farm_names": user.farm_names or []}
    access_token  = create_access_token(token_data)
    refresh_token = create_refresh_token(token_data)

    logger.success(f"Connexion : {user.username} ({user.role})")

    # 4. Refresh token → cookie HttpOnly (non accessible par JS)
    #    Access token → body JSON (lu par le frontend)
    response = JSONResponse(content=TokenResponse(
        access_token = access_token,
        role         = user.role,
        username     = user.username,
        farm_names   = user.farm_names or [],
    ).model_dump())

    _is_production = os.getenv("ENVIRONMENT", "production") == "production"
    _use_https     = os.getenv("USE_HTTPS", "false").lower() == "true"

    response.set_cookie(
        key      = "refresh_token",
        value    = refresh_token,        
        httponly = True,                 # inaccessible depuis JS → bloque XSS
        secure   = _is_production and _use_https,  # False si HTTP en prod temporaire
        samesite = "lax" if not (_is_production and _use_https) else "strict",      # bloque CSRF cross-origin
        max_age  = 7 * 24 * 3600,        # 7 jours
        path     = "/",  # cookie envoyé sur tous les paths
    )    

    return response


# ── POST /api/auth/refresh ────────────────────────────────────
@router.post("/refresh")
@limiter.limit("60/minute")
async def refresh(request: Request, db: Session = Depends(get_db)):
    """
    Lit le refresh_token depuis le cookie HttpOnly (pas du body).
    Si le cookie est absent, accepte le body pour la compatibilité
    avec les clients qui n'utilisent pas encore les cookies.
    """
    # Lire depuis le cookie en priorité
    token = request.cookies.get("refresh_token")

    # Fallback : body JSON (compatibilité frontend existant)
    if not token:
        try:
            body  = await request.json()
            token = body.get("refresh_token", "")
        except Exception:
            token = ""

    if not token or len(token) > 2048:
        raise HTTPException(status_code=401, detail="Token manquant ou invalide")

    if est_revoque(token):
        raise HTTPException(status_code=401, detail="Token révoqué")

    payload = decode_token(token)

    if payload.get("type") != "refresh":
        raise HTTPException(status_code=401, detail="Token invalide")

    new_access = create_access_token({
        "sub"       : payload["sub"],
        "role"      : payload["role"],
        "farm_names": payload.get("farm_names", []),
    })

    return {"access_token": new_access, "token_type": "bearer"}


# ── GET /api/auth/me ──────────────────────────────────────────
@router.get("/me")
@limiter.limit("30/minute")
def get_me(
    request      : Request,
    current_user = Depends(get_current_user),
    db           = Depends(get_db)
):
    user = get_user(db, current_user["username"])
    if not user:
        raise HTTPException(status_code=404, detail="Utilisateur non trouvé")
    return user.to_dict()


# ── GET /api/auth/users ───────────────────────────────────────
@router.get("/users")
def list_users(
    current_user: dict    = Depends(require_admin),
    db          : Session = Depends(get_db)
):
    return get_all_users(db)


# ── POST /api/auth/users ──────────────────────────────────────
@router.post("/users", status_code=status.HTTP_201_CREATED)
def create_new_user(
    body        : CreateUserRequest,
    req         : Request,
    current_user: dict    = Depends(require_admin),
    db          : Session = Depends(get_db)
):
    # role déjà validé par le schema
    if get_user(db, body.username):
        raise HTTPException(status_code=409, detail=f"L'identifiant '{body.username}' existe déjà")

    valider_mot_de_passe(body.password)
    
    user = create_user(
        db, body.username, body.password, body.role, body.nom,
        email=body.email,
        farm_names=body.farm_names or [],
    )

    log_action(db, current_user["username"], "CREATE_USER",
               detail=f"Créé : {body.username} ({body.role})", ip=req.client.host)

    return {"message": f"Utilisateur '{user.username}' créé ✅", "user": user.to_dict()}


# ── PUT /api/auth/users/{username} ────────────────────────────
@router.put("/users/{username}")
def edit_user(
    username    : str,
    body        : UpdateUserRequest,
    req         : Request,
    current_user: dict    = Depends(require_admin),
    db          : Session = Depends(get_db)
):
    # Valider le username dans l'URL
    if not _USERNAME_RE.match(username):
        raise HTTPException(status_code=400, detail="Username invalide")

    if body.password:
        valider_mot_de_passe(body.password)

    user = update_user(
        db, username,
        nom        = body.nom,
        email      = body.email,
        password   = body.password,
        farm_names = body.farm_names,
    )
    if not user:
        raise HTTPException(status_code=404, detail="Utilisateur non trouvé")

    log_action(db, current_user["username"], "UPDATE_USER",
               detail=f"Modifié : {username}", ip=req.client.host)
    return {"message": f"Utilisateur '{username}' mis à jour ✅", "user": user.to_dict()}


# ── PUT /api/auth/users/{username}/role ───────────────────────
@router.put("/users/{username}/role")
def change_role(
    username    : str,
    body        : UpdateRoleRequest,
    req         : Request,
    current_user: dict    = Depends(require_admin),
    db          : Session = Depends(get_db)
):
    if not _USERNAME_RE.match(username):
        raise HTTPException(status_code=400, detail="Username invalide")

    # Empêcher un admin de se rétrograder lui-même
    if username == current_user["username"]:
        raise HTTPException(status_code=400, detail="Vous ne pouvez pas modifier votre propre rôle")

    user = update_user_role(db, username, body.new_role)
    if not user:
        raise HTTPException(status_code=404, detail="Utilisateur non trouvé")

    log_action(db, current_user["username"], "CHANGE_ROLE",
               detail=f"{username} → {body.new_role}", ip=req.client.host)
    return {"message": f"Rôle de '{username}' → {body.new_role} ✅"}


# ── PUT /api/auth/users/{username}/toggle ─────────────────────
@router.put("/users/{username}/toggle")
def toggle_actif(
    username    : str,
    req         : Request,
    current_user: dict    = Depends(require_admin),
    db          : Session = Depends(get_db)
):
    if not _USERNAME_RE.match(username):
        raise HTTPException(status_code=400, detail="Username invalide")

    # Empêcher un admin de se désactiver lui-même
    if username == current_user["username"]:
        raise HTTPException(status_code=400, detail="Vous ne pouvez pas vous désactiver vous-même")

    user = toggle_user_actif(db, username)
    if not user:
        raise HTTPException(status_code=404, detail="Utilisateur non trouvé")

    statut = "activé" if user.actif else "désactivé"
    log_action(db, current_user["username"], "TOGGLE_USER",
               detail=f"{username} {statut}", ip=req.client.host)
    return {"message": f"Utilisateur '{username}' {statut} ✅"}


# ── GET /api/auth/logs ────────────────────────────────────────
@router.get("/logs")
def audit_logs(
    username    : Optional[str] = None,
    limit       : int           = 100,
    current_user: dict          = Depends(require_admin),
    db          : Session       = Depends(get_db)
):
    # Valider les paramètres de query
    if username and not _USERNAME_RE.match(username):
        raise HTTPException(status_code=400, detail="Username invalide")
    if limit < 1 or limit > 1000:
        raise HTTPException(status_code=400, detail="limit doit être entre 1 et 1000")

    return get_audit_logs(db, username=username, limit=limit)


# ── GET /api/auth/users/export ────────────────────────────────
@router.get("/users/export")
def export_csv(
    req         : Request,
    current_user: dict    = Depends(require_admin),
    db          : Session = Depends(get_db)
):
    from io import BytesIO
    data = export_users_excel(db)
    log_action(db, current_user["username"], "EXPORT_CSV", ip=req.client.host)
    return StreamingResponse(
        BytesIO(data),
        media_type = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers    = {"Content-Disposition": "attachment; filename=liste_utilisateurs.xlsx"}
    )


# ── POST /api/auth/logout ─────────────────────────────────────
@router.post("/logout")
@limiter.limit("20/minute")
async def logout(
    request      : Request,
    current_user = Depends(get_current_user),
    db           : Session = Depends(get_db),
):
    # Révoquer le refresh token (cookie)
    token = request.cookies.get("refresh_token")
    if not token:
        try:
            body  = await request.json()
            token = body.get("refresh_token", "")
        except Exception:
            token = ""

    if token and len(token) <= 2048:
        try:
            payload = decode_token(token)
            if payload.get("sub") != current_user["username"]:
                raise HTTPException(status_code=403, detail="Token ne vous appartient pas")
        except HTTPException:
            raise
        except Exception:
            pass
        revoquer_refresh_token(token)

    # ← AJOUTER : révoquer aussi l'access token courant
    raw_access = request.headers.get("Authorization", "").removeprefix("Bearer ").strip()
    if raw_access:
        from core.security import revoquer_access_token
        revoquer_access_token(raw_access)

    log_action(db, current_user["username"], "LOGOUT", ip=request.client.host)

    response = JSONResponse(content={"message": "Déconnecté ✅"})
    response.delete_cookie(
        key="refresh_token", path="/api/auth/refresh",
        httponly=True, secure=True, samesite="strict",
    )
    return response