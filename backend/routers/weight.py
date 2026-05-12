from fastapi import APIRouter, Depends, HTTPException, Header, Query
from sqlalchemy.orm import Session
from sqlalchemy import desc
from datetime import datetime
from typing import Optional
import os

from core.database import get_db
from core.security import require_any
from models.weight_model import WeightReading

router = APIRouter(prefix="/api/weight", tags=["Capteurs Poids"])

SENSOR_API_KEY = os.getenv("SENSOR_API_KEY")

def verify_api_key(x_api_key: Optional[str] = Header(None)):
    if x_api_key != SENSOR_API_KEY:
        raise HTTPException(status_code=403, detail="Clé API invalide")
    return x_api_key

@router.post("/ingest")
def ingest_weight(
    payload: dict,
    db: Session = Depends(get_db),
    api_key: str = Depends(verify_api_key),
):
    if payload.get("status") != "ok":
        return {"status": "skipped", "reason": "status != ok"}

    try:
        ts = datetime.fromisoformat(payload["timestamp"].replace("Z", "+00:00"))
        ts = ts.replace(tzinfo=None)
    except Exception:
        raise HTTPException(400, "Format timestamp invalide")

    # Doublon
    existing = db.query(WeightReading).filter(
        WeightReading.capteur_id == payload["capteur_id"],
        WeightReading.timestamp  == ts,
    ).first()
    if existing:
        return {"status": "duplicate"}

    row = WeightReading(
        farm_name  = payload.get("farm_name", ""),
        capteur_id = payload.get("capteur_id", ""),
        poids_kg   = payload.get("poids_kg"),
        rssi       = payload.get("rssi"),
        timestamp  = ts,
    )
    db.add(row)
    db.commit()
    return {"status": "success", "id": row.id}


@router.get("/{farm_name}/latest")
def get_latest_weight(
    farm_name: str,
    db: Session = Depends(get_db),
    user = Depends(require_any),
):
    row = (
        db.query(WeightReading)
        .filter(WeightReading.farm_name == farm_name)
        .order_by(desc(WeightReading.timestamp))
        .first()
    )
    if not row:
        raise HTTPException(404, "Aucune donnée poids")
    return row.to_dict()


@router.get("/{farm_name}/history")
def get_weight_history(
    farm_name: str,
    date_from: Optional[str] = Query(None),
    date_to:   Optional[str] = Query(None),
    page:      int = Query(1, ge=1),
    per_page:  int = Query(50, ge=10, le=500),
    db: Session = Depends(get_db),
    user = Depends(require_any),
):
    from datetime import date
    if not date_from:
        date_from = date.today().isoformat()
    if not date_to:
        date_to = date.today().isoformat()

    dt_from = datetime.strptime(date_from, "%Y-%m-%d")
    dt_to   = datetime.strptime(date_to, "%Y-%m-%d").replace(hour=23, minute=59, second=59)

    q = (
        db.query(WeightReading)
        .filter(
            WeightReading.farm_name  == farm_name,
            WeightReading.timestamp  >= dt_from,
            WeightReading.timestamp  <= dt_to,
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