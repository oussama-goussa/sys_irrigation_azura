# ============================================================
# backend/models/saisie_model.py
# Modèles SQLAlchemy — Saisie journalière
# Projet Azura Irrigation IA — GOUSSA Oussama
# ============================================================

from sqlalchemy import (
    Column, String, Boolean, Float, Integer,
    DateTime, BigInteger, ForeignKey, Date, UniqueConstraint
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.sql import func
from core.database import Base


# ── TABLE : saisie_journaliere ────────────────────────────────
class SaisieJournaliere(Base):
    __tablename__ = "saisie_journaliere"

    id              = Column(BigInteger, primary_key=True, autoincrement=True)

    # Identification
    farm_name       = Column(String(50),  nullable=False)
    station         = Column(String(20),  nullable=True)   # house / bloc
    serre           = Column(String(20),  nullable=True)
    vanne           = Column(String(20),  nullable=True)
    date            = Column(Date,        nullable=False)
    created_by      = Column(String(50),  nullable=True)   # username

    # Constantes & Substrat
    nbr_bras        = Column(Integer,     nullable=True)
    nbr_goutteurs   = Column(Integer,     nullable=True)
    poids_matin     = Column(Float,       nullable=True)
    heure_matin     = Column(String(5),   nullable=True)   # HH:MM
    poids_soir      = Column(Float,       nullable=True)
    heure_soir      = Column(String(5),   nullable=True)   # HH:MM
    bassin_ec       = Column(Float,       nullable=True)
    pct_ressuyage   = Column(Float,       nullable=True)   # calculé

    # Bilan global (calculé côté frontend, stocké pour historique)
    nbr_tours       = Column(Integer,     nullable=True)
    duree_totale    = Column(String(8),   nullable=True)   # HH:MM:SS
    total_v_apport  = Column(Float,       nullable=True)
    total_v_drain   = Column(Float,       nullable=True)
    ec_moy_apport   = Column(Float,       nullable=True)
    ph_moy_apport   = Column(Float,       nullable=True)
    ec_moy_drain    = Column(Float,       nullable=True)
    ph_moy_drain    = Column(Float,       nullable=True)
    moy_drain_finale = Column(Float,      nullable=True)   # %
    cc_bras         = Column(Float,       nullable=True)   # cc/bras

    created_at      = Column(DateTime(timezone=True), server_default=func.now())
    updated_at      = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    def to_dict(self):
        return {
            "id"              : self.id,
            "farm_name"       : self.farm_name,
            "station"         : self.station,
            "serre"           : self.serre,
            "vanne"           : self.vanne,
            "date"            : str(self.date),
            "created_by"      : self.created_by,
            "nbr_bras"        : self.nbr_bras,
            "nbr_goutteurs"   : self.nbr_goutteurs,
            "poids_matin"     : self.poids_matin,
            "heure_matin"     : self.heure_matin,
            "poids_soir"      : self.poids_soir,
            "heure_soir"      : self.heure_soir,
            "bassin_ec"       : self.bassin_ec,
            "pct_ressuyage"   : self.pct_ressuyage,
            "nbr_tours"       : self.nbr_tours,
            "duree_totale"    : self.duree_totale,
            "total_v_apport"  : self.total_v_apport,
            "total_v_drain"   : self.total_v_drain,
            "ec_moy_apport"   : self.ec_moy_apport,
            "ph_moy_apport"   : self.ph_moy_apport,
            "ec_moy_drain"    : self.ec_moy_drain,
            "ph_moy_drain"    : self.ph_moy_drain,
            "moy_drain_finale": self.moy_drain_finale,
            "cc_bras"         : self.cc_bras,
            "created_at"      : str(self.created_at),
            "updated_at"      : str(self.updated_at) if self.updated_at else None,
        }


# ── TABLE : saisie_tours ──────────────────────────────────────
class SaisieTour(Base):
    __tablename__ = "saisie_tours"

    id              = Column(BigInteger, primary_key=True, autoincrement=True)
    saisie_id       = Column(BigInteger, ForeignKey("saisie_journaliere.id", ondelete="CASCADE"), nullable=False)

    num_tour        = Column(Integer,    nullable=False)   # 1, 2, 3...
    rad             = Column(Float,      nullable=True)    # radiation saisie
    cumul_rad       = Column(Float,      nullable=True)    # calculé
    heure           = Column(String(5),  nullable=True)    # HH:MM début
    duree_min       = Column(Float,      nullable=True)    # minutes
    temps_repos     = Column(Float,      nullable=True)    # calculé minutes

    v_apport        = Column(Float,      nullable=True)
    ec_apport       = Column(Float,      nullable=True)
    ph_apport       = Column(Float,      nullable=True)
    v_drain         = Column(Float,      nullable=True)
    ec_drain        = Column(Float,      nullable=True)
    ph_drain        = Column(Float,      nullable=True)
    pct_drain       = Column(Float,      nullable=True)    # calculé %
    moy_pct_drain   = Column(Float,      nullable=True)    # calculé %

    def to_dict(self):
        return {
            "id"           : self.id,
            "saisie_id"    : self.saisie_id,
            "num_tour"     : self.num_tour,
            "rad"          : self.rad,
            "cumul_rad"    : self.cumul_rad,
            "heure"        : self.heure,
            "duree_min"    : self.duree_min,
            "temps_repos"  : self.temps_repos,
            "v_apport"     : self.v_apport,
            "ec_apport"    : self.ec_apport,
            "ph_apport"    : self.ph_apport,
            "v_drain"      : self.v_drain,
            "ec_drain"     : self.ec_drain,
            "ph_drain"     : self.ph_drain,
            "pct_drain"    : self.pct_drain,
            "moy_pct_drain": self.moy_pct_drain,
        }