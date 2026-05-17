# ============================================================
# backend/routers/ai_agent.py
# Endpoints Agent IA Irrigation — Azura Group
# GET /api/ai/recommandation/{device_id}       → recommandation du jour
# POST /api/ai/recommandation/{device_id}/generer → générer/régénérer
# POST /api/ai/recommandation/{device_id}/ajuster → ajustement après tour
# GET /api/ai/config/{device_id}               → config IA du device
# PUT /api/ai/config/{device_id}               → mettre à jour config
# GET /api/ai/resume/{device_id}               → résumé fin journée
# ============================================================

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from typing import Optional, List
from sqlalchemy.orm import Session
from sqlalchemy import desc
from datetime import date as date_type, timedelta
import datetime as _dt_module
from loguru import logger

from core.database import get_db
from core.security import get_current_user, require_any, require_agronome, require_operateur
from models.ai_recommendation_model import AIRecommandation, AIConfigDevice
from models.sensor_model import Device, IrrigationTour
from services.ai_service import (
    generer_recommandation_matin,
    ajuster_apres_tour,
)

router = APIRouter(prefix="/api/ai", tags=["Agent IA Irrigation"])


# ── Schemas ───────────────────────────────────────────────────

class GenererRequest(BaseModel):
    date           : Optional[str]   = None     # YYYY-MM-DD, défaut aujourd'hui
    ec_bassin      : Optional[float] = None     # écrase la valeur de AIConfigDevice
    pct_ressuyage  : Optional[float] = None     # si capteur disponible
    methode        : Optional[str]   = "hybride"


class AjusterRequest(BaseModel):
    num_tour       : int
    drainage_reel  : Optional[float] = None     # None si capteur absent
    tours_restants : Optional[int]   = 1


class ConfigRequest(BaseModel):
    date_plantation : Optional[str]   = None
    ec_eau_brute    : Optional[float] = None
    methode_decision: Optional[str]   = None
    actif           : Optional[bool]  = None


# ── Helpers ───────────────────────────────────────────────────

def _get_or_create_config(db: Session, device_id: int) -> AIConfigDevice:
    cfg = db.query(AIConfigDevice).filter(AIConfigDevice.device_id == device_id).first()
    if not cfg:
        cfg = AIConfigDevice(device_id=device_id, ec_eau_brute=0.8, methode_decision="hybride", actif=True)
        db.add(cfg)
        db.commit()
        db.refresh(cfg)
    return cfg


def _get_device(db: Session, device_id: int) -> Device:
    device = db.query(Device).filter(Device.id == device_id, Device.is_active == True).first()
    if not device:
        raise HTTPException(404, f"Device {device_id} non trouvé")
    return device


# ── GET /api/ai/recommandation/{device_id} ────────────────────
# REMPLACER tout le bloc get_recommandation par :

@router.get("/recommandation/{device_id}")
def get_recommandation(
    device_id  : int,
    date       : Optional[str] = Query(None, description="YYYY-MM-DD"),
    db         : Session = Depends(get_db),
    user       : dict    = Depends(require_any),
):
    import datetime as _dt
    _get_device(db, device_id)
    target_date = date or _dt.datetime.utcnow().date().isoformat()

    rec = (
        db.query(AIRecommandation)
        .filter(
            AIRecommandation.device_id == device_id,
            AIRecommandation.date      == target_date,
        )
        .first()
    )

    # ── Supprimer si heure_debut avant 06:00 UTC (bug ancien code) ──
    if rec and rec.heure_debut:
        try:
            h, m = map(int, rec.heure_debut.split(":"))
            if h < 6:
                logger.warning(f"Suppression recommandation invalide device {device_id} (heure={rec.heure_debut})")
                db.delete(rec)
                db.commit()
                rec = None
        except Exception:
            pass

    # ── Auto-génération si absente ──
    if not rec:
        cfg = _get_or_create_config(db, device_id)
        if not cfg.actif:
            raise HTTPException(404, "Agent IA désactivé pour ce device")
        try:
            result = generer_recommandation_matin(
                device_id       = device_id,
                date_str        = target_date,
                db              = db,
                ec_bassin       = cfg.ec_eau_brute or 0.8,
                date_plantation = str(cfg.date_plantation) if cfg.date_plantation else None,
                methode         = cfg.methode_decision or "hybride",
            )
            # Ne pas sauvegarder si PRT pas encore atteint
            if result.get("statut") == "en_attente_prt":
                return result
            if result.get("statut") == "en_attente_radiation":
                return result
            rec = _sauvegarder_recommandation(db, result)
        except Exception as e:
            logger.error(f"Auto-génération échouée device {device_id} : {e}")
            import traceback
            logger.error(traceback.format_exc())
            raise HTTPException(500, f"Erreur génération recommandation : {str(e)}")

    # ── Sync nb_tours_reel depuis irrigation_tours ──        ← ICI
    from models.sensor_model import IrrigationTour
    tours_count = (
        db.query(IrrigationTour)
        .filter(
            IrrigationTour.device_id == device_id,
            IrrigationTour.date      == target_date,
        )
        .count()
    )
    if tours_count != (rec.nb_tours_reel or 0):
        rec.nb_tours_reel = tours_count
        db.commit()
        db.refresh(rec)

    return rec.to_dict()              # ← FIN

# ── POST /api/ai/recommandation/{device_id}/generer ───────────
@router.post("/recommandation/{device_id}/generer")
def generer_recommandation_endpoint(
    device_id : int,
    body      : GenererRequest,
    db        : Session = Depends(get_db),
    user      : dict    = Depends(require_operateur),
):
    """
    Génère (ou régénère) la recommandation du matin.
    Accessible aux agronomes et admins.
    Ecrase l'ancienne recommandation si elle existe déjà.
    """
    _get_device(db, device_id)
    cfg = _get_or_create_config(db, device_id)
    target_date = body.date or date_type.today().isoformat()

    ec_bassin = body.ec_bassin or cfg.ec_eau_brute or 0.8
    methode   = body.methode   or cfg.methode_decision or "hybride"

    try:
        result = generer_recommandation_matin(
            device_id      = device_id,
            date_str       = target_date,
            ec_bassin      = ec_bassin,
            date_plantation= str(cfg.date_plantation) if cfg.date_plantation else None,
            pct_ressuyage  = body.pct_ressuyage,
            methode        = methode,
        )
    except Exception as e:
        logger.error(f"Erreur génération device {device_id} : {e}")
        raise HTTPException(500, str(e))

    # Supprimer l'ancienne si présente
    db.query(AIRecommandation).filter(
        AIRecommandation.device_id == device_id,
        AIRecommandation.date      == target_date,
    ).delete()

    rec = _sauvegarder_recommandation(db, result)
    logger.success(
        f"✅ Recommandation IA device {result['device_id']} : "
        f"début 1er tour = {result.get('heure_debut')} UTC "
        f"(décision IA)"
    )


# ── POST /api/ai/recommandation/{device_id}/ajuster ──────────
@router.post("/recommandation/{device_id}/ajuster")
def ajuster_tour(
    device_id : int,
    body      : AjusterRequest,
    db        : Session = Depends(get_db),
    user      : dict    = Depends(require_any),
):
    """
    Calcule et enregistre l'ajustement après un tour.
    Appelé pendant le temps de repos, affiché dans la table Tours.
    """
    target_date = date_type.today().isoformat()

    rec = (
        db.query(AIRecommandation)
        .filter(
            AIRecommandation.device_id == device_id,
            AIRecommandation.date      == target_date,
        )
        .first()
    )
    if not rec:
        raise HTTPException(404, "Aucune recommandation trouvée pour aujourd'hui. Générez-la d'abord.")

    if rec.statut == "arrete":
        return {"message": "Irrigation déjà arrêtée pour aujourd'hui", "stop": True}

    # Reconstruire le contexte pour l'ajustement
    # L'état est stocké dans le dernier ajustement
    ajustements = rec.ajustements or []
    etat_precedent = {}
    if ajustements:
        last = ajustements[-1]
        etat_precedent = last.get("nouveau_etat", {})

    recommandation_dict = rec.to_dict()
    recommandation_dict["_etat"] = etat_precedent if etat_precedent else {
        "repos_courant_min"  : rec.repos_initial_min or 8,
        "duree_t3p_courant"  : rec.duree_t3p_min or 8,
        "surveillance"       : False,
        "depassement_reel"   : False,
        "dernier_drainage"   : 0.0,
    }

    ajustement = ajuster_apres_tour(
        recommandation = recommandation_dict,
        drainage_reel  = body.drainage_reel,
        num_tour       = body.num_tour,
        tours_restants = body.tours_restants,
    )

    # Mettre à jour la BDD
    nouveaux_ajustements = ajustements + [ajustement]
    rec.ajustements  = nouveaux_ajustements
    rec.nb_tours_reel = body.num_tour

    if ajustement["stop"]:
        rec.statut = "arrete"
    else:
        # Évaluer la performance globale
        drainages = [a["drainage_reel"] for a in nouveaux_ajustements if a["drainage_reel"] is not None]
        if drainages:
            moy = sum(drainages) / len(drainages)
            seuil = rec.seuil_drainage_pct or 40
            rec.statut = "optimal" if moy <= seuil else "a_ajuster"

    db.commit()
    db.refresh(rec)

    logger.info(
        f"Ajustement device {device_id} tour {body.num_tour} → "
        f"{ajustement['action']} (drain={body.drainage_reel})"
    )

    return {
        "ajustement"      : {
            "tour"              : ajustement["tour"],
            "action"            : ajustement["action"],
            "raison"            : ajustement["raison"],
            "repos_suivant_min" : ajustement["repos_suivant_min"],
            "duree_suivant_min" : ajustement["duree_suivant_min"],
            "stop"              : ajustement["stop"],
        },
        "recommandation_mise_a_jour": rec.to_dict(),
    }

@router.get("/poids-soir/{device_id}")
def get_poids_soir(
    device_id : int,
    db        : Session = Depends(get_db),
    user      : dict    = Depends(require_any),
):
    """
    Retourne le poids soir = première lecture poids 
    20 min après la fin du dernier tour complété hier.
    """
    from models.weight_model import WeightReading
    import datetime as _dt

    today_utc   = _dt.datetime.utcnow().date()
    date_veille = today_utc - timedelta(days=1)

    # Dernier tour complété hier
    last_tour = (
        db.query(IrrigationTour)
        .filter(
            IrrigationTour.device_id   == device_id,
            IrrigationTour.date        == date_veille,
            IrrigationTour.is_complete == True,
        )
        .order_by(desc(IrrigationTour.tour_num))
        .first()
    )

    if not last_tour or not last_tour.fin:
        return {"poids_soir": None, "timestamp": None, "message": "Pas de tour complété hier"}

    # Poids 20 min après fin du dernier tour
    evening_time = last_tour.fin + timedelta(minutes=20)

    poids = (
        db.query(WeightReading)
        .filter(
            WeightReading.timestamp >= evening_time,
            WeightReading.timestamp <= _dt.datetime.combine(date_veille, _dt.time(22, 59)),
        )
        .order_by(WeightReading.timestamp)
        .first()
    )

    # Fallback : dernier poids après 17h UTC hier
    if not poids:
        poids = (
            db.query(WeightReading)
            .filter(
                WeightReading.timestamp >= _dt.datetime.combine(date_veille, _dt.time(17, 0)),
                WeightReading.timestamp <= _dt.datetime.combine(date_veille, _dt.time(22, 59)),
            )
            .order_by(desc(WeightReading.timestamp))
            .first()
        )

    if not poids:
        return {
            "poids_soir" : None,
            "timestamp"  : None,
            "message"    : f"Pas de poids trouvé après {evening_time.strftime('%H:%M')} UTC",
            "fin_tour"   : last_tour.fin.strftime("%H:%M"),
        }

    return {
        "poids_soir" : poids.poids_kg,
        "timestamp"  : str(poids.timestamp),
        "capteur_id" : poids.capteur_id,
        "fin_tour"   : last_tour.fin.strftime("%H:%M"),
        "message"    : f"Poids 20min après fin tour {last_tour.tour_num} ({last_tour.fin.strftime('%H:%M')} UTC)",
    }

# ── GET /api/ai/resume/{device_id} ───────────────────────────
@router.get("/resume/{device_id}")
def get_resume_journee(
    device_id : int,
    date      : Optional[str] = Query(None),
    db        : Session = Depends(get_db),
    user      : dict    = Depends(require_any),
):
    """
    Résumé fin de journée : comparaison recommandation vs réel.
    """
    target_date = date or date_type.today().isoformat()
    rec = (
        db.query(AIRecommandation)
        .filter(
            AIRecommandation.device_id == device_id,
            AIRecommandation.date      == target_date,
        )
        .first()
    )
    if not rec:
        raise HTTPException(404, "Aucune recommandation pour cette date")

    ajustements = rec.ajustements or []
    drainages = [a["drainage_reel"] for a in ajustements if a.get("drainage_reel") is not None]
    drainage_moy = sum(drainages) / len(drainages) if drainages else None
    actions = [a["action"] for a in ajustements]

    # Comparer avec les tours réels en BDD (irrigation_tours)
    device = _get_device(db, device_id)
    tours_bdd = (
        db.query(IrrigationTour)
        .filter(
            IrrigationTour.device_id == device_id,
            IrrigationTour.date      == target_date,
        )
        .all()
    )

    return {
        "date"               : target_date,
        "device_id"          : device_id,
        "recommandation"     : {
            "nb_tours_prevu"    : rec.nb_tours_prevu,
            "heure_debut"       : rec.heure_debut,
            "duree_t12_min"     : rec.duree_t12_min,
            "duree_t3p_min"     : rec.duree_t3p_min,
            "repos_initial_min" : rec.repos_initial_min,
            "seuil_drainage_pct": rec.seuil_drainage_pct,
            "scenario_meteo"    : rec.scenario_meteo,
            "stade"             : rec.stade,
            "ec_cible_dSm"      : rec.ec_cible_dSm,
            "doses_npk"         : rec.doses_npk,
        },
        "reel"               : {
            "nb_tours_reel"     : rec.nb_tours_reel or len(tours_bdd),
            "drainage_moy_pct"  : round(drainage_moy, 1) if drainage_moy else None,
            "statut"            : rec.statut,
            "actions_utilisees" : list(set(actions)),
        },
        "ecart_tours"        : (rec.nb_tours_reel or 0) - (rec.nb_tours_prevu or 0),
        "performance"        : _evaluer_performance(drainage_moy, rec.seuil_drainage_pct),
        "ajustements"        : ajustements,
        "tours_bdd"          : [
            {
                "tour_num"       : t.tour_num,
                "debut"          : t.debut.strftime("%H:%M") if t.debut else None,
                "fin"            : t.fin.strftime("%H:%M") if t.fin else None,
                "duree_min"      : t.duree_min,
                "ec_apport"      : t.ec_apport,
                "radiation_sum"  : t.radiation_sum,
                "cumul_radiation": t.cumul_radiation,
            }
            for t in sorted(tours_bdd, key=lambda x: x.tour_num)
        ],
    }


# ── GET /api/ai/historique/{device_id} ───────────────────────
@router.get("/historique/{device_id}")
def get_historique(
    device_id : int,
    page      : int = Query(1, ge=1),
    per_page  : int = Query(10, ge=1, le=50),
    db        : Session = Depends(get_db),
    user      : dict    = Depends(require_any),
):
    """Historique paginé des recommandations IA pour un device."""
    _get_device(db, device_id)
    q = (
        db.query(AIRecommandation)
        .filter(AIRecommandation.device_id == device_id)
        .order_by(desc(AIRecommandation.date))
    )
    total = q.count()
    items = q.offset((page - 1) * per_page).limit(per_page).all()
    return {
        "total"   : total,
        "page"    : page,
        "per_page": per_page,
        "pages"   : max(1, (total + per_page - 1) // per_page),
        "data"    : [r.to_dict() for r in items],
    }


# ── GET /api/ai/config/{device_id} ───────────────────────────
@router.get("/config/{device_id}")
def get_config(
    device_id : int,
    db        : Session = Depends(get_db),
    user      : dict    = Depends(require_any),
):
    _get_device(db, device_id)
    cfg = _get_or_create_config(db, device_id)
    return cfg.to_dict()


# ── PUT /api/ai/config/{device_id} ───────────────────────────
@router.put("/config/{device_id}")
def update_config(
    device_id : int,
    body      : ConfigRequest,
    db        : Session = Depends(get_db),
    user      : dict    = Depends(require_operateur),
):
    _get_device(db, device_id)
    cfg = _get_or_create_config(db, device_id)

    if body.date_plantation is not None:
        try:
            cfg.date_plantation = _dt_module.datetime.strptime(body.date_plantation, "%Y-%m-%d").date()
        except ValueError:
            raise HTTPException(400, "Format date_plantation invalide (YYYY-MM-DD)")
    if body.ec_eau_brute is not None:
        cfg.ec_eau_brute = body.ec_eau_brute
    if body.methode_decision is not None:
        if body.methode_decision not in ("hybride", "regles", "ml_seul"):
            raise HTTPException(400, "methode_decision invalide")
        cfg.methode_decision = body.methode_decision
    if body.actif is not None:
        cfg.actif = body.actif

    db.commit()
    db.refresh(cfg)
    return {"message": "Configuration mise à jour ✅", "config": cfg.to_dict()}


# ── GET /api/ai/dashboard — toutes les houses du jour ─────────
@router.get("/dashboard")
def get_ai_dashboard(
    date : Optional[str] = Query(None),
    db   : Session = Depends(get_db),
    user : dict    = Depends(require_any),
):
    """
    Retourne le statut IA de toutes les houses pour la date donnée.
    Utilisé par le dashboard global pour afficher les badges IA.
    """
    target_date = date or date_type.today().isoformat()
    recs = (
        db.query(AIRecommandation)
        .filter(AIRecommandation.date == target_date)
        .all()
    )

    # Filtrer par fermes autorisées (non-admin)
    if user["role"] != "admin":
        allowed_farms = user.get("farm_names", [])
        device_ids_allowed = [
            d.id for d in db.query(Device).filter(Device.farm_name.in_(allowed_farms)).all()
        ]
        recs = [r for r in recs if r.device_id in device_ids_allowed]

    return {
        "date": target_date,
        "recommandations": [
            {
                "device_id"      : r.device_id,
                "statut"         : r.statut,
                "nb_tours_prevu" : r.nb_tours_prevu,
                "nb_tours_reel"  : r.nb_tours_reel,
                "heure_debut"    : r.heure_debut,
                "scenario_meteo" : r.scenario_meteo,
                "stade"          : r.stade,
                "action_courante": (r.ajustements or [{}])[-1].get("action") if r.ajustements else None,
            }
            for r in recs
        ],
    }


# ── Helpers internes ──────────────────────────────────────────

def _sauvegarder_recommandation(db: Session, result: dict) -> AIRecommandation:
    meteo = result.get("meteo", {})
    rec = AIRecommandation(
        device_id          = result["device_id"],
        date               = result["date"],
        radiation_jcm2     = result.get("radiation_jcm2"),
        t_max              = result.get("t_max"),
        t_min              = result.get("t_min"),
        t_moy              = result.get("t_moy"),
        hr_moy             = result.get("hr_moy"),
        vpd_kpa            = result.get("vpd_kpa"),
        pluie_mm           = result.get("pluie_mm", 0),
        scenario_meteo     = result.get("scenario_meteo"),
        stade              = result.get("stade"),
        j_plantation       = result.get("j_plantation"),
        ec_bassin          = result.get("ec_cible_dSm"),
        pct_ressuyage      = result.get("pct_ressuyage"),
        et0_mm             = result.get("et0_mm"),
        etc_mm             = result.get("etc_mm"),
        fraction_lessivage = result.get("fraction_lessivage"),
        volume_total_l_ha  = result.get("volume_total_l_ha"),
        ec_cible_dsm       = result.get("ec_cible_dSm"),
        nb_tours_prevu     = result.get("nb_tours_prevu"),
        heure_debut        = result.get("heure_debut"),
        duree_t12_min      = result.get("duree_t12_min"),
        duree_t3p_min      = result.get("duree_t3p_min"),
        repos_initial_min  = result.get("repos_initial_min"),
        seuil_drainage_pct = result.get("seuil_drainage_pct"),
        doses_npk          = result.get("doses_npk"),
        correction_ph      = result.get("correction_ph"),
        methode_decision   = result.get("methode_decision", "hybride"),
        statut             = "en_cours",
        nb_tours_reel      = 0,
        ajustements        = [],
    )
    db.add(rec)
    db.commit()
    db.refresh(rec)
    return rec


def _evaluer_performance(drainage_moy: Optional[float], seuil: Optional[float]) -> str:
    if drainage_moy is None:
        return "non_disponible"
    if not seuil:
        seuil = 40
    ratio = drainage_moy / seuil
    if ratio <= 0.5:   return "sous_irrigation"
    if ratio <= 0.8:   return "correct"
    if ratio <= 1.0:   return "optimal"
    if ratio <= 1.2:   return "limite"
    return "excessif"