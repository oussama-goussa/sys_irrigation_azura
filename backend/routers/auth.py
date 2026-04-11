# ============================================================
# backend/routers/auth.py
# ============================================================

from fastapi import APIRouter, HTTPException, Depends, Request, status
from fastapi.responses import StreamingResponse
from fastapi.security import OAuth2PasswordRequestForm
from pydantic import BaseModel
from typing import Optional
from sqlalchemy.orm import Session
from loguru import logger
import io

from slowapi import Limiter
from slowapi.util import get_remote_address
limiter = Limiter(key_func=get_remote_address)

from core.database import get_db
from core.security import (
    verify_password, create_access_token, create_refresh_token,
    decode_token, get_current_user, require_admin, require_any,
    valider_mot_de_passe, Role
)
from services.user_service import (
    get_user, get_all_users, create_user, update_user,
    update_user_role, toggle_user_actif, update_last_login,
    get_audit_logs, export_users_csv, log_action
)

router = APIRouter(prefix="/api/auth", tags=["Authentification"])


# ── Schemas ───────────────────────────────────────────────────
class TokenResponse(BaseModel):
    access_token : str
    refresh_token: str
    token_type   : str = "bearer"
    role         : str
    username     : str
    farm_names   : list = []

class RefreshRequest(BaseModel):
    refresh_token: str

class CreateUserRequest(BaseModel):
    username : str
    password : str
    role     : str
    nom      : str
    email    : Optional[str] = None

class UpdateUserRequest(BaseModel):
    nom      : Optional[str] = None
    email    : Optional[str] = None
    password : Optional[str] = None

class UpdateRoleRequest(BaseModel):
    new_role: str


# ── POST /api/auth/login ──────────────────────────────────────
@router.post("/login", response_model=TokenResponse)
@limiter.limit("5/minute")
def login(
    request: Request,
    form   : OAuth2PasswordRequestForm = Depends(),
    db     : Session = Depends(get_db)
):
    user = get_user(db, form.username)

    if not user or not verify_password(form.password, user.password):
        logger.warning(f"Connexion échouée : {form.username}")
        # Log tentative échouée
        log_action(db, form.username, "LOGIN_FAILED", ip=request.client.host)
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Identifiants incorrects")

    if not user.actif:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Compte désactivé")

    # Mettre à jour last_login + audit
    update_last_login(db, user.username)
    log_action(db, user.username, "LOGIN", ip=request.client.host)

    token_data    = {"sub": user.username, "role": user.role, "farm_names": user.farm_names or []}
    access_token  = create_access_token(token_data)
    refresh_token = create_refresh_token(token_data)

    logger.success(f"Connexion : {user.username} ({user.role})")
    return TokenResponse(
        access_token=access_token, refresh_token=refresh_token,
        role=user.role, username=user.username,
        farm_names=user.farm_names or []
    )


# ── POST /api/auth/refresh ────────────────────────────────────
@router.post("/refresh")
@limiter.limit("10/minute")
def refresh(request: Request, body: RefreshRequest):
    payload = decode_token(body.refresh_token)
    if payload.get("type") != "refresh":
        raise HTTPException(status_code=401, detail="Token invalide")
    new_access = create_access_token({"sub": payload["sub"], "role": payload["role"]})
    return {"access_token": new_access, "token_type": "bearer"}


# ── GET /api/auth/me ──────────────────────────────────────────
@router.get("/me")
def get_me(current_user: dict = Depends(get_current_user), db: Session = Depends(get_db)):
    user = get_user(db, current_user["username"])
    if not user:
        raise HTTPException(status_code=404, detail="Utilisateur non trouvé")
    return user.to_dict()


# ── GET /api/auth/users ───────────────────────────────────────
@router.get("/users")
def list_users(current_user: dict = Depends(require_admin), db: Session = Depends(get_db)):
    return get_all_users(db)


# ── POST /api/auth/users ──────────────────────────────────────
@router.post("/users")
def create_new_user(
    request     : CreateUserRequest,
    req         : Request,
    current_user: dict = Depends(require_admin),
    db          : Session = Depends(get_db)
):
    valid_roles = [Role.ADMIN, Role.AGRONOME, Role.OPERATEUR, Role.AUDITEUR]
    if request.role not in valid_roles:
        raise HTTPException(status_code=400, detail=f"Rôle invalide : {valid_roles}")
    if get_user(db, request.username):
        raise HTTPException(status_code=400, detail=f"L'identifiant '{request.username}' existe déjà")

    valider_mot_de_passe(request.password)

    user = create_user(db, request.username, request.password, request.role, request.nom, request.email)
    log_action(db, current_user["username"], "CREATE_USER",
               detail=f"Créé : {request.username} ({request.role})", ip=req.client.host)

    return {"message": f"Utilisateur '{user.username}' créé ✅", "user": user.to_dict()}


# ── PUT /api/auth/users/{username} — Modifier nom/email/mdp ───
@router.put("/users/{username}")
def edit_user(
    username    : str,
    request     : UpdateUserRequest,
    req         : Request,
    current_user: dict = Depends(require_admin),
    db          : Session = Depends(get_db)
):
    if request.password:
        valider_mot_de_passe(request.password)

    user = update_user(db, username, nom=request.nom, email=request.email, password=request.password)
    if not user:
        raise HTTPException(status_code=404, detail="Utilisateur non trouvé")

    log_action(db, current_user["username"], "UPDATE_USER",
               detail=f"Modifié : {username}", ip=req.client.host)
    return {"message": f"Utilisateur '{username}' mis à jour ✅", "user": user.to_dict()}


# ── PUT /api/auth/users/{username}/role ───────────────────────
@router.put("/users/{username}/role")
def change_role(
    username    : str,
    request     : UpdateRoleRequest,
    req         : Request,
    current_user: dict = Depends(require_admin),
    db          : Session = Depends(get_db)
):
    user = update_user_role(db, username, request.new_role)
    if not user:
        raise HTTPException(status_code=404, detail="Utilisateur non trouvé")
    log_action(db, current_user["username"], "CHANGE_ROLE",
               detail=f"{username} → {request.new_role}", ip=req.client.host)
    return {"message": f"Rôle de '{username}' → {request.new_role} ✅"}


# ── PUT /api/auth/users/{username}/toggle ─────────────────────
@router.put("/users/{username}/toggle")
def toggle_actif(
    username    : str,
    req         : Request,
    current_user: dict = Depends(require_admin),
    db          : Session = Depends(get_db)
):
    user = toggle_user_actif(db, username)
    if not user:
        raise HTTPException(status_code=404, detail="Utilisateur non trouvé")
    statut = "activé" if user.actif else "désactivé"
    log_action(db, current_user["username"], "TOGGLE_USER",
               detail=f"{username} {statut}", ip=req.client.host)
    return {"message": f"Utilisateur '{username}' {statut} ✅"}


# ── GET /api/auth/logs — Historique actions ───────────────────
@router.get("/logs")
def audit_logs(
    username    : Optional[str] = None,
    limit       : int = 100,
    current_user: dict = Depends(require_admin),
    db          : Session = Depends(get_db)
):
    return get_audit_logs(db, username=username, limit=limit)


# ── GET /api/auth/users/export — Export CSV ───────────────────
@router.get("/users/export")
def export_csv(
    req         : Request,
    current_user: dict = Depends(require_admin),
    db          : Session = Depends(get_db)
):
    csv_data = export_users_csv(db)
    log_action(db, current_user["username"], "EXPORT_CSV", ip=req.client.host)
    return StreamingResponse(
        io.StringIO(csv_data),
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=azura_users.csv"}
    )