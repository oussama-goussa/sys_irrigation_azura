# ============================================================
# backend/routers/weight.py
# ============================================================

import re
import os
import hmac
from datetime import datetime, date
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Header, Query
from pydantic import BaseModel, Field, field_validator
from sqlalchemy.orm import Session
from sqlalchemy import desc
from loguru import logger

from core.database import get_db
from core.security import require_any
from models.weight_model import WeightReading

router = APIRouter(prefix="/api/weight", tags=["Capteurs Poids"])

SENSOR_API_KEY = os.getenv("SENSOR_API_KEY")

_FARM_RE = re.compile(r'^[a-zA-Z0-9_\- ]{1,50}$')
_CAPTEUR_RE = re.compile(r'^[a-zA-Z0-9_\- ]{1,50}$')


# ── Schéma strict Pydantic V2 ─────────────────────────────────

class WeightPayload(BaseModel):
    status     : str           = Field(..., max_length=10)
    farm_name  : str           = Field(..., min_length=1, max_length=50)
    capteur_id : str           = Field(..., min_length=1, max_length=50)
    poids_kg   : Optional[float] = Field(None, ge=0.0,  le=1000.0)
    rssi       : Optional[int]   = Field(None, ge=-150, le=0)
    timestamp  : str           = Field(..., min_length=10, max_length=32)

    @field_validator('farm_name')
    @classmethod
    def farm_name_valide(cls, v: str) -> str:
        if not _FARM_RE.match(v):
            raise ValueError('farm_name invalide (alphanumérique, _ et - uniquement)')
        return v

    @field_validator('capteur_id')
    @classmethod
    def capteur_id_valide(cls, v: str) -> str:
        if not _CAPTEUR_RE.match(v):
            raise ValueError('capteur_id invalide (alphanumérique, _ et - uniquement)')
        return v

    @field_validator('timestamp')
    @classmethod
    def timestamp_valide(cls, v: str) -> str:
        # Accepter ISO 8601 avec ou sans Z
        try:
            datetime.fromisoformat(v.replace('Z', '+00:00'))
        except ValueError:
            raise ValueError('Format timestamp invalide (ISO 8601 attendu)')
        return v

    @field_validator('status')
    @classmethod
    def status_valide(cls, v: str) -> str:
        if v not in ('ok', 'error', 'test'):
            raise ValueError('status invalide (valeurs acceptées : ok, error, test)')
        return v


# ── Auth ──────────────────────────────────────────────────────

def verify_api_key(x_api_key: Optional[str] = Header(None)) -> str:
    if not SENSOR_API_KEY:
        raise HTTPException(status_code=500, detail="SENSOR_API_KEY non configurée")
    if not x_api_key:
        raise HTTPException(status_code=403, detail="Clé API manquante")
    if not hmac.compare_digest(x_api_key.encode(), SENSOR_API_KEY.encode()):
        logger.warning("Tentative accès /weight/ingest avec clé invalide")
        raise HTTPException(status_code=403, detail="Clé API invalide")
    return x_api_key


# ── POST /api/weight/ingest ───────────────────────────────────

@router.post("/ingest")
def ingest_weight(
    payload: WeightPayload,
    db     : Session = Depends(get_db),
    api_key: str     = Depends(verify_api_key),
):
    if payload.status != "ok":
        return {"status": "skipped", "reason": f"status={payload.status}"}

    # Parser le timestamp (déjà validé par le schema)
    try:
        ts = datetime.fromisoformat(payload.timestamp.replace('Z', '+00:00'))
        ts = ts.replace(tzinfo=None)  # stocker en UTC naïf
    except ValueError:
        raise HTTPException(status_code=400, detail="Format timestamp invalide")

    # Vérifier doublon
    existing = db.query(WeightReading).filter(
        WeightReading.capteur_id == payload.capteur_id,
        WeightReading.timestamp  == ts,
    ).first()
    if existing:
        return {"status": "duplicate"}

    row = WeightReading(
        farm_name  = payload.farm_name,
        capteur_id = payload.capteur_id,
        poids_kg   = payload.poids_kg,
        rssi       = payload.rssi,
        timestamp  = ts,
    )
    db.add(row)
    db.commit()
    logger.success(f"Poids ingéré : {payload.farm_name} / {payload.capteur_id} = {payload.poids_kg} kg")
    return {"status": "success", "id": row.id}


# ── GET /api/weight/{farm_name}/latest ───────────────────────

@router.get("/{farm_name}/latest")
def get_latest_weight(
    farm_name: str,
    db       : Session = Depends(get_db),
    user               = Depends(require_any),
):
    if not _FARM_RE.match(farm_name):
        raise HTTPException(status_code=400, detail="Nom de ferme invalide")

    row = (
        db.query(WeightReading)
        .filter(WeightReading.farm_name == farm_name)
        .order_by(desc(WeightReading.timestamp))
        .first()
    )
    if not row:
        raise HTTPException(status_code=404, detail="Aucune donnée poids")
    return row.to_dict()


# ── GET /api/weight/{farm_name}/history ──────────────────────

@router.get("/{farm_name}/history")
def get_weight_history(
    farm_name: str,
    date_from: Optional[str] = Query(None, pattern=r'^\d{4}-\d{2}-\d{2}$'),
    date_to  : Optional[str] = Query(None, pattern=r'^\d{4}-\d{2}-\d{2}$'),
    page     : int  = Query(1,  ge=1,  le=1000),
    per_page : int  = Query(50, ge=10, le=500),
    db       : Session = Depends(get_db),
    user               = Depends(require_any),
):
    if not _FARM_RE.match(farm_name):
        raise HTTPException(status_code=400, detail="Nom de ferme invalide")

    if not date_from:
        date_from = date.today().isoformat()
    if not date_to:
        date_to = date.today().isoformat()

    try:
        dt_from = datetime.strptime(date_from, "%Y-%m-%d")
        dt_to   = datetime.strptime(date_to,   "%Y-%m-%d").replace(hour=23, minute=59, second=59)
    except ValueError:
        raise HTTPException(status_code=400, detail="Format date invalide (YYYY-MM-DD)")

    if (dt_to - dt_from).days > 366:
        raise HTTPException(status_code=400, detail="Plage limitée à 1 an")

    if dt_from > dt_to:
        raise HTTPException(status_code=400, detail="date_from doit être avant date_to")

    q = (
        db.query(WeightReading)
        .filter(
            WeightReading.farm_name == farm_name,
            WeightReading.timestamp >= dt_from,
            WeightReading.timestamp <= dt_to,
        )
        .order_by(desc(WeightReading.timestamp))
    )

    total = q.count()
    rows  = q.offset((page - 1) * per_page).limit(per_page).all()

    return {
        "total"   : total,
        "page"    : page,
        "pages"   : max(1, (total + per_page - 1) // per_page),
        "data"    : [r.to_dict() for r in rows],
    }