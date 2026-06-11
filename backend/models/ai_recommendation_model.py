# ============================================================
# backend/models/ai_recommendation_model.py
# Modèles SQLAlchemy — Tables Agent IA Irrigation
# Projet Azura Irrigation IA — GOUSSA Oussama
# ============================================================

from sqlalchemy import (
    Column, String, Boolean, Float, Integer,
    DateTime, BigInteger, ForeignKey, Text, Date,
    UniqueConstraint
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.sql import func
from core.database import Base


# ── TABLE 1 : ai_recommandations ──────────────────────────────
class AIRecommandation(Base):
    __tablename__ = "ai_recommandations"

    id                = Column(BigInteger, primary_key=True, autoincrement=True)
    device_id         = Column(Integer, ForeignKey("devices.id"), nullable=False)
    date              = Column(Date, nullable=False)

    # 8 consignes du modèle Matin
    ec_cible          = Column(Float)
    ph_cible          = Column(Float)
    nb_tours          = Column(Integer)
    scenario_meteo    = Column(String(50))
    alerte            = Column(String(50))
    quantite_eau_mm    = Column(Float)
    volume_cc_goutteur = Column(Float)   # Volume en cc/goutteur
    duree_min          = Column(Integer)

    # ── Système PRT (Poids-Readings Tour) ──
    # Heures de début
    heure_debut_ml        = Column(String(10), nullable=True)  # Heure recommandée par le ML (ex: "09:30")
    heure_debut_prt       = Column(String(10), nullable=True)  # Heure détectée par PRT (ex: "08:40")

    # Données poids
    poids_soir_kg         = Column(Float, nullable=True)   # Poids soir 20min après dernier tour (kg)
    poids_matin_kg        = Column(Float, nullable=True)   # Poids matin au déclenchement (kg)
    heure_soir            = Column(String(10), nullable=True)  # Heure lecture soir "HH:MM"
    heure_matin           = Column(String(10), nullable=True)  # Heure lecture matin (détection seuil) "HH:MM"
    fin_tour_soir         = Column(String(10), nullable=True)  # Heure fin du dernier tour hier "HH:MM"

    # Résultat PRT
    ptr_pct               = Column(Float, nullable=True)   # % perte de poids ressuyage (PRT)
    ptr_decision          = Column(String(50), nullable=True)  # ATTENDRE / DECLENCHER / STRESS_HYDRIQUE / PLUIE_STOP / FALLBACK_RECOMMANDATION
    ptr_seuil_bas         = Column(Float, nullable=True)   # Seuil bas du scénario (%)
    ptr_seuil_haut        = Column(Float, nullable=True)   # Seuil haut du scénario (%)

    # Métadonnées
    statut            = Column(String(20), default="pending")  # pending / approved / rejected
    features_utilises = Column(JSONB)
    feedback_operateur = Column(Text)
    created_at        = Column(DateTime(timezone=True), server_default=func.now())
    updated_at        = Column(DateTime(timezone=True), onupdate=func.now())

    def to_dict(self):
        return {
            "id"                     : self.id,
            "device_id"              : self.device_id,
            "date"                   : str(self.date),

            # ── Consignes ML (modèle XGBoost) ──
            "ec_cible_dSm"           : self.ec_cible,
            "ph_cible"               : self.ph_cible,
            "nbr_tour"               : self.nb_tours,
            "heure_debut_ml"         : self.heure_debut_ml,          # Heure ML originale (jamais modifiée)
            "heure_debut_prt"        : self.heure_debut_prt,         # Heure PRT détectée (ou None si pas de poids)
            "scenario_meteo"         : self.scenario_meteo,
            "alerte"                 : self.alerte,
            "quantite_eau_mm"       : self.quantite_eau_mm,
            "volume_cc_goutteur"    : self.volume_cc_goutteur,
            "duree_min"              : self.duree_min,

            # ── Système PRT (Poids-Readings Tour) ──
            "prt"                    : {
                "heure_debut_prt"    : self.heure_debut_prt,        # Heure détectée par PRT (ou None)
                "heure_matin"        : self.heure_matin,            # Heure détection seuil PRT
                "fin_tour_soir"      : self.fin_tour_soir,          # Heure fin dernier tour hier
                "poids_soir_kg"      : self.poids_soir_kg,          # Poids soir (kg)
                "poids_matin_kg"     : self.poids_matin_kg,         # Poids matin au déclenchement (kg)
                "heure_soir"         : self.heure_soir,             # Heure lecture poids soir
                "ptr_pct"            : self.ptr_pct,                # % ressuyage (PRT)
                "ptr_decision"       : self.ptr_decision,           # ATTENDRE / DECLENCHER / STRESS_HYDRIQUE / ...
                "ptr_seuil_bas"      : self.ptr_seuil_bas,          # Seuil bas du scénario (%)
                "ptr_seuil_haut"     : self.ptr_seuil_haut,         # Seuil haut du scénario (%)
            },

            # ── Métadonnées ──
            "statut"                 : self.statut,
            "features_utilises"      : self.features_utilises,
            "feedback_operateur"     : self.feedback_operateur,
        }


# ── TABLE 2 : ai_config_device ────────────────────────────────
class AIConfigDevice(Base):
    __tablename__ = "ai_config_device"

    id                = Column(Integer, primary_key=True, autoincrement=True)
    device_id         = Column(Integer, ForeignKey("devices.id"), unique=True, nullable=False)
    ec_eau_brute      = Column(Float, default=0.8)
    date_plantation   = Column(Date, nullable=True)
    methode_decision  = Column(String(20), default="ml")   # ml / hybride / manuel
    drainage_dispo    = Column(Boolean, default=False)
    actif             = Column(Boolean, default=True)
    latitude          = Column(Float, default=30.4202)     # Agadir par défaut
    longitude         = Column(Float, default=-9.5981)
    nbr_goutteurs     = Column(Integer, nullable=True)
    created_at        = Column(DateTime(timezone=True), server_default=func.now())
    updated_at        = Column(DateTime(timezone=True), onupdate=func.now())


# ── TABLE 3 : ai_decision_tour ────────────────────────────────
class AIDecisionTour(Base):
    __tablename__ = "ai_decision_tour"

    id                = Column(BigInteger, primary_key=True, autoincrement=True)
    device_id         = Column(Integer, ForeignKey("devices.id"), nullable=False)
    date              = Column(Date, nullable=False)
    num_tour          = Column(Integer, nullable=False)

    # ── Saisie drainage opérateur (manuelle, après chaque tour) ──
    v_drainage        = Column(Float, nullable=True)    # Volume drainage saisi (cc ou mL)
    pct_drainage      = Column(Float, nullable=True)    # % drainage calculé automatiquement
    ec_drainage       = Column(Float, nullable=True)    # EC drainage saisi (dS/m)
    ph_drainage       = Column(Float, nullable=True)    # pH drainage saisi

    # ── Décision ML ──
    decision          = Column(String(20))   # CONTINUER / STOP
    raison            = Column(String(100))
    duree_suivant     = Column(Integer)
    repos_suivant     = Column(Integer)      # Temps repos avant tour suivant (min)

    heure_debut_tour_suivante = Column(String(10), nullable=True)

    donnees_entree    = Column(JSONB)
    disponible        = Column(Boolean, default=True)
    created_at        = Column(DateTime(timezone=True), server_default=func.now())
    updated_at        = Column(DateTime(timezone=True), onupdate=func.now())

    __table_args__ = (
        UniqueConstraint('device_id', 'date', 'num_tour', name='uq_decision_tour'),
    )

    def to_dict(self):
        return {
            "id"           : self.id,
            "device_id"    : self.device_id,
            "date"         : str(self.date),
            "num_tour"     : self.num_tour,
            "v_drainage"   : self.v_drainage,
            "pct_drainage" : self.pct_drainage,
            "ec_drainage"  : self.ec_drainage,
            "ph_drainage"  : self.ph_drainage,
            "decision"     : self.decision,
            "raison"       : self.raison,
            "duree_suivant": self.duree_suivant,
            "repos_suivant": self.repos_suivant,
            "disponible"   : self.disponible,
            "heure_debut_tour_suivante": self.heure_debut_tour_suivante,
        }
