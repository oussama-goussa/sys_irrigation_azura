# ============================================================
# backend/routers/saisie.py
# Endpoints Saisie journalière — POST, GET, DELETE
# Projet Azura Irrigation IA — GOUSSA Oussama
# ============================================================

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from typing import Optional, List
from sqlalchemy.orm import Session
from sqlalchemy import desc
from datetime import date as date_type
from loguru import logger

from core.database import get_db
from core.security import get_current_user, require_operateur, require_any
from models.saisie_model import SaisieJournaliere, SaisieTour

router = APIRouter(prefix="/api/saisie", tags=["Saisie journalière"])


# ── Schemas Pydantic ──────────────────────────────────────────

class TourIn(BaseModel):
    num_tour     : int
    rad          : Optional[float] = None
    cumul_rad    : Optional[float] = None
    heure        : Optional[str]   = None
    duree_min    : Optional[float] = None
    temps_repos  : Optional[float] = None
    v_apport     : Optional[float] = None
    ec_apport    : Optional[float] = None
    ph_apport    : Optional[float] = None
    v_drain      : Optional[float] = None
    ec_drain     : Optional[float] = None
    ph_drain     : Optional[float] = None
    pct_drain    : Optional[float] = None
    moy_pct_drain: Optional[float] = None


class ConstantesIn(BaseModel):
    nbrBras       : Optional[float] = None
    nbrGoutteurs  : Optional[float] = None
    poidsMatin    : Optional[float] = None
    heureMatin    : Optional[str]   = None
    poidsSoir     : Optional[float] = None
    heureSoir     : Optional[str]   = None
    bassinEC      : Optional[float] = None
    pctRessuyage  : Optional[float] = None


class BilanIn(BaseModel):
    nbrTours       : Optional[int]   = None
    dureeTotal     : Optional[float] = None
    totalVApport   : Optional[float] = None
    totalVDrain    : Optional[float] = None
    ecMoyApport    : Optional[float] = None
    phMoyApport    : Optional[float] = None
    ecMoyDrain     : Optional[float] = None
    phMoyDrain     : Optional[float] = None
    moyDrainFinale : Optional[float] = None
    ccBras         : Optional[float] = None


class SaisieIn(BaseModel):
    ferme      : str
    station    : Optional[str] = None
    serre      : Optional[str] = None
    vanne      : Optional[str] = None
    date       : str                    # YYYY-MM-DD
    constantes : Optional[ConstantesIn] = None
    tours      : List[TourIn] = []
    bilan      : Optional[BilanIn]      = None


# ── POST /api/saisie — Créer une saisie ──────────────────────
@router.post("")
def create_saisie(
    body        : SaisieIn,
    db          : Session = Depends(get_db),
    user        : dict    = Depends(require_operateur),
):
    """
    Enregistre une saisie journalière complète avec tous ses tours.
    """
    try:
        date_obj = date_type.fromisoformat(body.date)
    except ValueError:
        raise HTTPException(status_code=400, detail="Format date invalide (YYYY-MM-DD)")

    c = body.constantes or ConstantesIn()
    b = body.bilan      or BilanIn()

    # ── Créer la saisie principale ────────────────────────────
    saisie = SaisieJournaliere(
        farm_name       = body.ferme,
        station         = body.station,
        serre           = body.serre,
        vanne           = body.vanne,
        date            = date_obj,
        created_by      = user["username"],

        nbr_bras        = int(c.nbrBras)      if c.nbrBras      else None,
        nbr_goutteurs   = int(c.nbrGoutteurs) if c.nbrGoutteurs else None,
        poids_matin     = c.poidsMatin,
        heure_matin     = c.heureMatin,
        poids_soir      = c.poidsSoir,
        heure_soir      = c.heureSoir,
        bassin_ec       = c.bassinEC,
        pct_ressuyage   = float(c.pctRessuyage) if c.pctRessuyage else None,

        nbr_tours       = b.nbrTours,
        duree_totale    = b.dureeTotal,   # already HH:MM:SS string from frontend
        total_v_apport  = b.totalVApport,
        total_v_drain   = b.totalVDrain,
        ec_moy_apport   = b.ecMoyApport,
        ph_moy_apport   = b.phMoyApport,
        ec_moy_drain    = b.ecMoyDrain,
        ph_moy_drain    = b.phMoyDrain,
        moy_drain_finale= b.moyDrainFinale,
        cc_bras         = b.ccBras,
    )
    db.add(saisie)
    db.flush()  # obtenir l'ID sans commit

    # ── Créer les tours ───────────────────────────────────────
    for t in body.tours:
        tour = SaisieTour(
            saisie_id    = saisie.id,
            num_tour     = t.num_tour,
            rad          = t.rad,
            cumul_rad    = t.cumul_rad,
            heure        = t.heure,
            duree_min    = t.duree_min,
            temps_repos  = t.temps_repos,
            v_apport     = t.v_apport,
            ec_apport    = t.ec_apport,
            ph_apport    = t.ph_apport,
            v_drain      = t.v_drain,
            ec_drain     = t.ec_drain,
            ph_drain     = t.ph_drain,
            pct_drain    = t.pct_drain,
            moy_pct_drain= t.moy_pct_drain,
        )
        db.add(tour)

    db.commit()
    db.refresh(saisie)

    logger.success(
        f"Saisie enregistrée : {body.ferme} {body.date} "
        f"— {len(body.tours)} tours — par {user['username']}"
    )

    return {
        "message"  : "Saisie enregistrée ✅",
        "saisie_id": saisie.id,
        "saisie"   : saisie.to_dict(),
    }


# ── GET /api/saisie — Liste des saisies ──────────────────────
@router.get("")
def list_saisies(
    farm_name   : Optional[str] = Query(None),
    date_from   : Optional[str] = Query(None),
    date_to     : Optional[str] = Query(None),
    page        : int           = Query(1, ge=1),
    per_page    : int           = Query(20, ge=1, le=100),
    db          : Session       = Depends(get_db),
    user        : dict          = Depends(require_any),
):
    """
    Liste les saisies journalières avec filtres optionnels.
    """
    q = db.query(SaisieJournaliere).order_by(desc(SaisieJournaliere.date), desc(SaisieJournaliere.created_at))

    if farm_name:
        q = q.filter(SaisieJournaliere.farm_name == farm_name)
    if date_from:
        q = q.filter(SaisieJournaliere.date >= date_type.fromisoformat(date_from))
    if date_to:
        q = q.filter(SaisieJournaliere.date <= date_type.fromisoformat(date_to))

    total = q.count()
    items = q.offset((page - 1) * per_page).limit(per_page).all()

    return {
        "total"   : total,
        "page"    : page,
        "per_page": per_page,
        "pages"   : max(1, (total + per_page - 1) // per_page),
        "data"    : [s.to_dict() for s in items],
    }


# ── GET /api/saisie/{id} — Détail d'une saisie ───────────────
@router.get("/{saisie_id}")
def get_saisie(
    saisie_id : int,
    db        : Session = Depends(get_db),
    user      : dict    = Depends(require_any),
):
    """
    Retourne une saisie avec tous ses tours.
    """
    saisie = db.query(SaisieJournaliere).filter(SaisieJournaliere.id == saisie_id).first()
    if not saisie:
        raise HTTPException(status_code=404, detail="Saisie non trouvée")

    tours = (
        db.query(SaisieTour)
        .filter(SaisieTour.saisie_id == saisie_id)
        .order_by(SaisieTour.num_tour)
        .all()
    )

    return {
        **saisie.to_dict(),
        "tours": [t.to_dict() for t in tours],
    }


# ── DELETE /api/saisie/{id} — Supprimer une saisie ───────────
@router.delete("/{saisie_id}")
def delete_saisie(
    saisie_id : int,
    db        : Session = Depends(get_db),
    user      : dict    = Depends(require_operateur),
):
    """
    Supprime une saisie et tous ses tours (CASCADE).
    """
    saisie = db.query(SaisieJournaliere).filter(SaisieJournaliere.id == saisie_id).first()
    if not saisie:
        raise HTTPException(status_code=404, detail="Saisie non trouvée")

    db.delete(saisie)
    db.commit()

    logger.info(f"Saisie {saisie_id} supprimée par {user['username']}")
    return {"message": f"Saisie {saisie_id} supprimée ✅"}