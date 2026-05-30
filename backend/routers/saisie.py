# ============================================================
# backend/routers/saisie.py
# Endpoints Saisie journalière — POST, GET, DELETE
# Projet Azura Irrigation IA — GOUSSA Oussama
# ============================================================

from fastapi import APIRouter, Depends, HTTPException, Query
from typing import Optional, List
from sqlalchemy.orm import Session
from sqlalchemy import desc, String
from datetime import date as date_type
from loguru import logger
from services.user_service import get_user

from core.database import get_db
from core.security import get_current_user, require_operateur, require_any
from models.saisie_model import SaisieJournaliere, SaisieTour

from services.user_service import log_action

from pydantic import BaseModel, Field, field_validator, model_validator
from typing import Optional, List, Annotated
import re as _re
from datetime import date as date_type, timedelta

router = APIRouter(prefix="/api/saisie", tags=["Saisie journalière"])

_FARM_NAME_RE = _re.compile(r'^[a-zA-Z0-9_\- ]{1,50}$')

# ── Schemas Pydantic ──────────────────────────────────────────

class TourIn(BaseModel):
    num_tour     : int = Field(..., ge=1, le=50)
    rad          : Optional[float] = Field(None, ge=0, le=5000)
    cumul_rad    : Optional[float] = Field(None, ge=0, le=99999)
    heure        : Optional[str]   = Field(None, pattern=r'^\d{2}:\d{2}$')
    duree_min    : Optional[float] = Field(None, ge=0, le=1440)
    temps_repos  : Optional[float] = Field(None, ge=0, le=1440)
    v_apport     : Optional[float] = Field(None, ge=0, le=100000)
    ec_apport    : Optional[float] = Field(None, ge=0, le=20)
    ph_apport    : Optional[float] = Field(None, ge=0, le=14)
    v_drain      : Optional[float] = Field(None, ge=0, le=100000)
    ec_drain     : Optional[float] = Field(None, ge=0, le=20)
    ph_drain     : Optional[float] = Field(None, ge=0, le=14)
    pct_drain    : Optional[float] = Field(None, ge=0, le=100)
    moy_pct_drain: Optional[float] = Field(None, ge=0, le=100)


class ConstantesIn(BaseModel):
    nbrBras       : Optional[float] = Field(None, ge=0, le=10000)
    nbrGoutteurs  : Optional[float] = Field(None, ge=0, le=100000)
    poidsMatin    : Optional[float] = Field(None, ge=0, le=10000)
    heureMatin    : Optional[str]   = Field(None, pattern=r'^\d{2}:\d{2}$')
    poidsSoir     : Optional[float] = Field(None, ge=0, le=10000)
    heureSoir     : Optional[str]   = Field(None, pattern=r'^\d{2}:\d{2}$')
    bassinEC      : Optional[float] = Field(None, ge=0, le=20)
    pctRessuyage  : Optional[float] = Field(None, ge=0, le=100)


class BilanIn(BaseModel):
    nbrTours       : Optional[int]   = Field(None, ge=0, le=50)
    dureeTotal     : Optional[str]   = Field(None, pattern=r'^\d{2}:\d{2}:\d{2}$')
    totalVApport   : Optional[float] = Field(None, ge=0, le=10_000_000)
    totalVDrain    : Optional[float] = Field(None, ge=0, le=10_000_000)
    ecMoyApport    : Optional[float] = Field(None, ge=0, le=20)
    phMoyApport    : Optional[float] = Field(None, ge=0, le=14)
    ecMoyDrain     : Optional[float] = Field(None, ge=0, le=20)
    phMoyDrain     : Optional[float] = Field(None, ge=0, le=14)
    moyDrainFinale : Optional[float] = Field(None, ge=0, le=100)
    ccBras         : Optional[float] = Field(None, ge=0, le=100_000)


class SaisieIn(BaseModel):
    ferme      : str                    = Field(..., min_length=1, max_length=50)
    station    : Optional[str]          = Field(None, max_length=20)
    serre      : Optional[str]          = Field(None, max_length=20)
    vanne      : Optional[str]          = Field(None, max_length=20)
    date       : str                    = Field(..., pattern=r'^\d{4}-\d{2}-\d{2}$')
    constantes : Optional[ConstantesIn] = None
    tours      : List[TourIn]           = Field(default_factory=list, max_length=50)
    bilan      : Optional[BilanIn]      = None

    @field_validator('ferme')
    @classmethod
    def ferme_valide(cls, v: str) -> str:
        if not _FARM_NAME_RE.match(v):
            raise ValueError('Nom de ferme invalide (alphanumérique, tirets, espaces uniquement)')
        return v

    @field_validator('station', 'serre', 'vanne', mode='before')
    @classmethod
    def sanitize_short_strings(cls, v):
        if v is None:
            return v
        # Supprimer les caractères de contrôle
        v = str(v).strip()
        if not _re.match(r'^[a-zA-Z0-9_\- /]{0,20}$', v):
            raise ValueError('Caractères invalides dans le champ')
        return v

    @field_validator('date')
    @classmethod
    def date_valide(cls, v: str) -> str:
        try:
            d = date_type.fromisoformat(v)
        except ValueError:
            raise ValueError('Format date invalide (YYYY-MM-DD)')
        today = date_type.today()
        if d > today + timedelta(days=1):
            raise ValueError('Date dans le futur non autorisée')
        if d < today - timedelta(days=365 * 2):
            raise ValueError('Date trop ancienne (max 2 ans)')
        return v

    @model_validator(mode='after')
    def coherence_bilan_tours(self) -> 'SaisieIn':
        """Vérifier que le bilan est cohérent avec les tours."""
        if self.bilan and self.bilan.nbrTours is not None:
            if self.bilan.nbrTours != len(self.tours):
                raise ValueError(
                    f'bilan.nbrTours ({self.bilan.nbrTours}) '
                    f'ne correspond pas au nombre de tours ({len(self.tours)})'
                )
        return self


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

    log_action(db, user["username"], "CREATE_SAISIE",
            detail=f"Saisie {saisie.id} — {body.ferme} {body.date} — {len(body.tours)} tours")

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
def _escape_like(s: str) -> str:
    return s.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")

@router.get("")
def list_saisies(
    farm_name    : Optional[str] = Query(None),
    date_from    : Optional[str] = Query(None),
    date_to      : Optional[str]   = Query(None),
    station      : Optional[str] = Query(None, max_length=20),
    serre        : Optional[str] = Query(None, max_length=20),
    vanne        : Optional[str] = Query(None, max_length=20),
    nbr_bras     : Optional[str] = Query(None, max_length=6),
    nbr_goutteurs: Optional[str] = Query(None, max_length=8),
    poids_matin  : Optional[str] = Query(None, max_length=10),
    heure_matin  : Optional[str] = Query(None, max_length=5),
    poids_soir   : Optional[str] = Query(None, max_length=10),
    heure_soir   : Optional[str] = Query(None, max_length=5),
    bassin_ec    : Optional[str] = Query(None, max_length=8),
    page         : int             = Query(1, ge=1),
    per_page     : int           = Query(20, ge=1, le=100),
    db           : Session       = Depends(get_db),
    user         : dict          = Depends(require_any),
):
    q = db.query(SaisieJournaliere).order_by(desc(SaisieJournaliere.date), desc(SaisieJournaliere.created_at))

    # ── Filtrage par farm_names de l'utilisateur connecté ─────
    if user["role"] != "admin":
        user_db = get_user(db, user["username"])
        allowed = user_db.farm_names if user_db and user_db.farm_names else []

        if len(allowed) == 0:
            return {"total": 0, "page": page, "per_page": per_page, "pages": 1, "data": []}

        q = q.filter(SaisieJournaliere.farm_name.in_(allowed))

        # Si un filtre ferme explicite est demandé, vérifier qu'il est autorisé
        if farm_name:
            if farm_name not in allowed:
                return {"total": 0, "page": page, "per_page": per_page, "pages": 1, "data": []}
            q = q.filter(SaisieJournaliere.farm_name == farm_name)
    else:
        # Admin : filtre ferme sans restriction
        if farm_name:
            q = q.filter(SaisieJournaliere.farm_name == farm_name)

    if date_from:
        q = q.filter(SaisieJournaliere.date >= date_type.fromisoformat(date_from))
    if date_to:
        q = q.filter(SaisieJournaliere.date <= date_type.fromisoformat(date_to))
    if station:
        q = q.filter(SaisieJournaliere.station.ilike(f"%{_escape_like(station)}%"))
    if serre:
        q = q.filter(SaisieJournaliere.serre.ilike(f"%{_escape_like(serre)}%"))
    if vanne:
        q = q.filter(SaisieJournaliere.vanne.ilike(f"%{_escape_like(vanne)}%"))
    if nbr_bras:
        q = q.filter(SaisieJournaliere.nbr_bras == int(nbr_bras))
    if nbr_goutteurs:
        q = q.filter(SaisieJournaliere.nbr_goutteurs == int(nbr_goutteurs))
    if poids_matin:
        q = q.filter(SaisieJournaliere.poids_matin.cast(String).ilike(f"%{poids_matin}%"))
    if heure_matin:
        q = q.filter(SaisieJournaliere.heure_matin.ilike(f"%{_escape_like(heure_matin)}%"))
    if poids_soir:
        q = q.filter(SaisieJournaliere.poids_soir.cast(String).ilike(f"%{poids_soir}%"))
    if heure_soir:
        q = q.filter(SaisieJournaliere.heure_soir.ilike(f"%{_escape_like(heure_soir)}%"))
    if bassin_ec:
        q = q.filter(SaisieJournaliere.bassin_ec.cast(String).ilike(f"%{bassin_ec}%"))

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

    # vérification accès ferme
    if user["role"] != "admin":
        user_db = get_user(db, user["username"])
        allowed = user_db.farm_names if user_db and user_db.farm_names else []
        if saisie.farm_name not in allowed:
            raise HTTPException(status_code=403, detail="Accès refusé à cette saisie")

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
# ✅ APRÈS
@router.delete("/{saisie_id}")
def delete_saisie(
    saisie_id : int,
    db        : Session = Depends(get_db),
    user      : dict    = Depends(require_operateur),
):
    saisie = db.query(SaisieJournaliere).filter(SaisieJournaliere.id == saisie_id).first()
    if not saisie:
        raise HTTPException(404, "Saisie non trouvée")

    # ← AJOUTER : vérifier que l'user a accès à cette ferme
    if user["role"] != "admin":
        user_db = get_user(db, user["username"])
        allowed = user_db.farm_names if user_db and user_db.farm_names else []
        if saisie.farm_name not in allowed:
            raise HTTPException(403, "Accès refusé à cette saisie")

    db.delete(saisie)
    db.commit()
    log_action(db, user["username"], "DELETE_SAISIE",
               detail=f"Saisie {saisie_id} — {saisie.farm_name} {saisie.date}")
    return {"message": f"Saisie {saisie_id} supprimée ✅"}


# ── PUT /api/saisie/{id} — Modifier une saisie ───────────────
@router.put("/{saisie_id}")
def update_saisie(
    saisie_id : int,
    body      : SaisieIn,
    db        : Session = Depends(get_db),
    user      : dict    = Depends(require_operateur),
):
    """
    Met à jour une saisie existante et remplace tous ses tours.
    """
    saisie = db.query(SaisieJournaliere).filter(SaisieJournaliere.id == saisie_id).first()
    if not saisie:
        raise HTTPException(status_code=404, detail="Saisie non trouvée")

    # Vérification accès ferme (même logique que DELETE)
    if user["role"] != "admin":
        user_db = get_user(db, user["username"])
        allowed = user_db.farm_names if user_db and user_db.farm_names else []
        if saisie.farm_name not in allowed:
            raise HTTPException(status_code=403, detail="Accès refusé à cette saisie")

    try:
        date_obj = date_type.fromisoformat(body.date)
    except ValueError:
        raise HTTPException(status_code=400, detail="Format date invalide (YYYY-MM-DD)")

    c = body.constantes or ConstantesIn()
    b = body.bilan      or BilanIn()

    # Mettre à jour la saisie principale
    saisie.farm_name       = body.ferme
    saisie.station         = body.station
    saisie.serre           = body.serre
    saisie.vanne           = body.vanne
    saisie.date            = date_obj
    saisie.nbr_bras        = int(c.nbrBras)      if c.nbrBras      else None
    saisie.nbr_goutteurs   = int(c.nbrGoutteurs) if c.nbrGoutteurs else None
    saisie.poids_matin     = c.poidsMatin
    saisie.heure_matin     = c.heureMatin
    saisie.poids_soir      = c.poidsSoir
    saisie.heure_soir      = c.heureSoir
    saisie.bassin_ec       = c.bassinEC
    saisie.pct_ressuyage   = float(c.pctRessuyage) if c.pctRessuyage else None
    saisie.nbr_tours       = b.nbrTours
    saisie.duree_totale    = b.dureeTotal
    saisie.total_v_apport  = b.totalVApport
    saisie.total_v_drain   = b.totalVDrain
    saisie.ec_moy_apport   = b.ecMoyApport
    saisie.ph_moy_apport   = b.phMoyApport
    saisie.ec_moy_drain    = b.ecMoyDrain
    saisie.ph_moy_drain    = b.phMoyDrain
    saisie.moy_drain_finale= b.moyDrainFinale
    saisie.cc_bras         = b.ccBras

    # Supprimer les anciens tours et recréer
    db.query(SaisieTour).filter(SaisieTour.saisie_id == saisie_id).delete()

    for t in body.tours:
        tour = SaisieTour(
            saisie_id    = saisie_id,
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

    log_action(db, user["username"], "UPDATE_SAISIE",
            detail=f"Saisie {saisie_id} — {saisie.farm_name} {saisie.date} — {len(body.tours)} tours")
    return {
        "message"  : f"Saisie {saisie_id} mise à jour ✅",
        "saisie_id": saisie.id,
        "saisie"   : saisie.to_dict(),
    }