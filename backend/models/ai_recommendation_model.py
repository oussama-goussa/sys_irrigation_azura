# ============================================================
# backend/models/ai_recommendation_model.py
# Modèle SQLAlchemy — Recommandations IA Agent Irrigation
# Projet Azura Irrigation IA — GOUSSA Oussama
# ============================================================

from sqlalchemy import (
    Column, String, Boolean, Float, Integer,
    DateTime, BigInteger, ForeignKey, Date, Text
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.sql import func
from core.database import Base


class AIRecommandation(Base):
    """
    Stocke la recommandation IA générale du matin pour une house + date.
    Mise à jour après chaque tour (champ 'ajustements').
    """
    __tablename__ = "ai_recommandations"

    id               = Column(BigInteger, primary_key=True, autoincrement=True)
    device_id        = Column(Integer, ForeignKey("devices.id"), nullable=False)
    date             = Column(Date, nullable=False)

    # ── Contexte météo ────────────────────────────────────────
    radiation_jcm2   = Column(Float, nullable=True)   # J/cm² sous serre
    t_max            = Column(Float, nullable=True)
    t_min            = Column(Float, nullable=True)
    t_moy            = Column(Float, nullable=True)
    hr_moy           = Column(Float, nullable=True)
    vpd_kpa          = Column(Float, nullable=True)
    pluie_mm         = Column(Float, nullable=True, default=0.0)
    scenario_meteo   = Column(String(30), nullable=True)  # ensoleille/nuageux/chergui/...

    # ── Contexte agronomique ──────────────────────────────────
    stade            = Column(String(30), nullable=True)   # vegetatif/floraison/...
    j_plantation     = Column(Integer, nullable=True)
    ec_bassin        = Column(Float, nullable=True)
    pct_ressuyage    = Column(Float, nullable=True)   # NULL si capteur absent

    # ── Recommandation FAO-56 calculée ────────────────────────
    et0_mm           = Column(Float, nullable=True)
    etc_mm           = Column(Float, nullable=True)
    fraction_lessivage = Column(Float, nullable=True)
    volume_total_l_ha = Column(Float, nullable=True)
    ec_cible_dSm     = Column(Float, nullable=True)

    # ── Plan de la journée ────────────────────────────────────
    nb_tours_prevu   = Column(Integer, nullable=True)
    heure_debut      = Column(String(5), nullable=True)   # HH:MM
    duree_t12_min    = Column(Integer, nullable=True)
    duree_t3p_min    = Column(Integer, nullable=True)
    repos_initial_min = Column(Integer, nullable=True)
    seuil_drainage_pct = Column(Float, nullable=True)

    # ── NPK doses (JSONB) ─────────────────────────────────────
    # {"canal_A": 120, "canal_B": 80, "canal_C": 30, "canal_D": 20}
    doses_npk        = Column(JSONB, nullable=True)
    correction_ph    = Column(JSONB, nullable=True)

    # ── Résultats temps réel (mis à jour) ─────────────────────
    nb_tours_reel    = Column(Integer, nullable=True, default=0)
    statut           = Column(String(20), nullable=True, default="en_cours")
    # en_cours / optimal / a_ajuster / arrete / pluie

    # ── Ajustements tour par tour (JSONB list) ────────────────
    # [{"tour": 1, "action": "CONTINUER", "raison": "...", "drainage": 0, "repos_suivant": 8}, ...]
    ajustements      = Column(JSONB, nullable=True, default=list)

    # ── Source de décision ────────────────────────────────────
    methode_decision = Column(String(20), nullable=True, default="hybride")
    # hybride / regles / ml_seul

    created_at       = Column(DateTime(timezone=True), server_default=func.now())
    updated_at       = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    def to_dict(self):
        return {
            "id"                : self.id,
            "device_id"         : self.device_id,
            "date"              : str(self.date),
            "radiation_jcm2"    : self.radiation_jcm2,
            "t_max"             : self.t_max,
            "t_min"             : self.t_min,
            "t_moy"             : self.t_moy,
            "hr_moy"            : self.hr_moy,
            "vpd_kpa"           : self.vpd_kpa,
            "pluie_mm"          : self.pluie_mm,
            "scenario_meteo"    : self.scenario_meteo,
            "stade"             : self.stade,
            "j_plantation"      : self.j_plantation,
            "ec_bassin"         : self.ec_bassin,
            "pct_ressuyage"     : self.pct_ressuyage,
            "et0_mm"            : self.et0_mm,
            "etc_mm"            : self.etc_mm,
            "fraction_lessivage": self.fraction_lessivage,
            "volume_total_l_ha" : self.volume_total_l_ha,
            "ec_cible_dSm"      : self.ec_cible_dSm,
            "nb_tours_prevu"    : self.nb_tours_prevu,
            "heure_debut"       : self.heure_debut,
            "duree_t12_min"     : self.duree_t12_min,
            "duree_t3p_min"     : self.duree_t3p_min,
            "repos_initial_min" : self.repos_initial_min,
            "seuil_drainage_pct": self.seuil_drainage_pct,
            "doses_npk"         : self.doses_npk,
            "correction_ph"     : self.correction_ph,
            "nb_tours_reel"     : self.nb_tours_reel,
            "statut"            : self.statut,
            "ajustements"       : self.ajustements or [],
            "methode_decision"  : self.methode_decision,
            "created_at"        : str(self.created_at),
            "updated_at"        : str(self.updated_at) if self.updated_at else None,
        }


class AIConfigDevice(Base):
    """
    Configuration IA par device (date plantation, EC eau brute, etc.)
    Remplie par l'agronome via le dashboard.
    """
    __tablename__ = "ai_config_devices"

    id               = Column(BigInteger, primary_key=True, autoincrement=True)
    device_id        = Column(Integer, ForeignKey("devices.id"), nullable=False, unique=True)

    date_plantation  = Column(Date, nullable=True)        # pour calcul j_plantation
    ec_eau_brute     = Column(Float, nullable=True, default=0.8)   # EC bassin par défaut
    methode_decision = Column(String(20), nullable=True, default="hybride")
    actif            = Column(Boolean, default=True)      # activer/désactiver l'IA pour ce device

    created_at       = Column(DateTime(timezone=True), server_default=func.now())
    updated_at       = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    def to_dict(self):
        return {
            "id"              : self.id,
            "device_id"       : self.device_id,
            "date_plantation" : str(self.date_plantation) if self.date_plantation else None,
            "ec_eau_brute"    : self.ec_eau_brute,
            "methode_decision": self.methode_decision,
            "actif"           : self.actif,
        }