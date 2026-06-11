# ============================================================
# backend/routers/ai_agent.py
# Router FastAPI — Agent IA Irrigation
# Projet Azura Irrigation IA — GOUSSA Oussama
# ============================================================
#
# Endpoints :
#   GET  /api/ai/recommandations          → tous les devices
#   GET  /api/ai/recommandations/{id}     → 1 device
#   GET  /api/ai/recommandations/{id}/historique
#   POST /api/ai/recommandations/{id}/approve
#   POST /api/ai/decision-tour            → décision tour/tour
#   GET  /api/ai/comparaison/{id}         → humain vs IA
#   GET  /api/ai/config/{id}              → config device
#   PUT  /api/ai/config/{id}              → mise à jour config
# ============================================================

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import Optional
from datetime import date
from loguru import logger

from core.database import get_db
from core.security import require_any, require_operateur
from models.sensor_model import Device
from models.ai_recommendation_model import AIRecommandation, AIConfigDevice
from services.ai_service import (
    generer_recommandation_matin,
    generer_recommandation_tous_devices,
    generer_recommandation_historique_device,
    generer_recommandation_historique_tous_devices,
    generer_decision_tour,
    sauvegarder_recommandation,
    comparer_humain_vs_ia,
    get_or_create_config,
    detecter_heure_matin_et_debut_tour,
    calculer_prt_decision,
    PRT_SEUILS,
    DEFAULT_LAT,
    DEFAULT_LON,
)

router = APIRouter(prefix="/api/ai", tags=["AI Agent"])


# ════════════════════════════════════════════════════════════════
# HELPERS — Sécurité & Filtrage
# ════════════════════════════════════════════════════════════════

def _check_device_access(device: Device, user: dict):
    """Lève 403 si l'utilisateur n'a pas accès à ce device (même logique que devices.py)."""
    if user["role"] == "admin":
        return
    allowed = user.get("farm_names", [])
    if device.farm_name not in allowed:
        raise HTTPException(status_code=403, detail="Accès refusé à ce device")


def _filter_devices_by_farm_names(query, user: dict):
    """Filtre une query de devices par les farm_names de l'utilisateur (sauf admin)."""
    if user["role"] != "admin":
        allowed = user.get("farm_names", [])
        if allowed:
            query = query.join(Device).filter(Device.farm_name.in_(allowed))
        else:
            # Aucune ferme assignée → aucun résultat
            query = query.filter(Device.id == -1)
    return query


# ════════════════════════════════════════════════════════════════
# SCHÉMAS PYDANTIC
# ════════════════════════════════════════════════════════════════

class ApproveRequest(BaseModel):
    statut: str          # "approved" ou "rejected"
    feedback: Optional[str] = None


class BackfillRequest(BaseModel):
    device_id: Optional[int] = None   # null = tous les devices
    date_debut: Optional[str] = None  # null = created_at du device
    date_fin: Optional[str] = None    # null = aujourd'hui


class DecisionTourRequest(BaseModel):
    device_id: int
    num_tour: int
    date_str: Optional[str] = None              # Date cible (YYYY-MM-DD), défaut = aujourd'hui
    v_drainage: Optional[float] = None          # Volume drainage saisi (cc)
    pct_drainage: Optional[float] = None        # % drainage (calculé auto si v_drainage fourni)
    ec_drainage: Optional[float] = None
    ph_drainage: Optional[float] = None
    donnees_supplementaires: Optional[dict] = {}


class ConfigUpdateRequest(BaseModel):
    ec_eau_brute: Optional[float] = None
    date_plantation: Optional[str] = None
    methode_decision: Optional[str] = None
    drainage_dispo: Optional[bool] = None
    actif: Optional[bool] = None
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    nbr_goutteurs: Optional[int] = None


# ════════════════════════════════════════════════════════════════
# ENDPOINTS
# ════════════════════════════════════════════════════════════════

@router.get("/recommandations", summary="Recommandations du jour pour TOUS les devices")
def get_recommandations_tous(
    date_str: Optional[str] = Query(None, description="Date (YYYY-MM-DD), défaut = aujourd'hui"),
    db: Session = Depends(get_db),
    user: dict = Depends(require_any),
):
    """
    Retourne les recommandations IA du matin pour les devices actifs.
    Filtré par farm_names de l'utilisateur (sauf admin).
    Si aucune recommandation n'existe, la génère automatiquement.
    """
    today = date_str or date.today().isoformat()

    # Filtrer les recommandations par farm_names (même logique que devices.py)
    query = db.query(AIRecommandation).filter(AIRecommandation.date == today)
    query = _filter_devices_by_farm_names(query, user)
    existing = query.all()

    if existing:
        # Enrichir avec farm_name et house_number
        results = []
        for rec in existing:
            device = db.query(Device).filter(Device.id == rec.device_id).first()
            d = rec.to_dict()
            d["farm_name"]    = device.farm_name    if device else None
            d["house_number"] = device.house_number if device else None
            results.append(d)
        return {
            "date"           : today,
            "total_devices"  : len(results),
            "recommandations": results,
            "source"         : "cache",
        }

    # Générer automatiquement
    resultat = generer_recommandation_tous_devices(today)

    if "erreur" in resultat and resultat.get("generated", 0) == 0:
        raise HTTPException(status_code=500, detail=resultat["erreur"])

    # Sauvegarder en BDD et formater
    recommandations = []
    for r in resultat.get("recommandations", []):
        try:
            rec_db = sauvegarder_recommandation(db, r)
            d = rec_db.to_dict()
            d["farm_name"]    = r.get("farm_name")
            d["house_number"] = r.get("house_number")
            recommandations.append(d)
        except Exception as e:
            # Si sauvegarde échoue, retourner quand même le résultat
            r["farm_name"]    = r.get("farm_name")
            r["house_number"] = r.get("house_number")
            recommandations.append(r)

    return {
        "date"           : today,
        "total_devices"  : resultat.get("total_devices", 0),
        "generated"      : resultat.get("generated", 0),
        "errors"         : resultat.get("errors", 0),
        "recommandations": recommandations,
        "source"         : "generated",
    }


@router.post("/recommandations/backfill", summary="Backfill historique des recommandations")
def backfill_recommandations(
    body: BackfillRequest,
    db: Session = Depends(get_db),
    user: dict = Depends(require_operateur),
):
    """
    Génère les recommandations IA pour les jours passés.

    - Sans `device_id` : backfill pour TOUS les devices actifs (depuis `created_at` jusqu'à aujourd'hui)
    - Avec `device_id` : backfill pour ce device uniquement
    - Les jours ayant déjà une recommandation sont ignorés (idempotent)
    """
    if body.device_id:
        # Backfill pour 1 device
        device = db.query(Device).filter(Device.id == body.device_id).first()
        if device is None:
            raise HTTPException(status_code=404, detail=f"Device {body.device_id} introuvable")

        date_debut = body.date_debut or (device.created_at.date().isoformat() if device.created_at else date.today().isoformat())
        date_fin   = body.date_fin or date.today().isoformat()

        resultat = generer_recommandation_historique_device(
            device_id  = body.device_id,
            date_debut = date_debut,
            date_fin   = date_fin,
        )

        if "erreur" in resultat:
            raise HTTPException(status_code=500, detail=resultat["erreur"])

        return {"message": "Backfill terminé ✅", "resultat": resultat}
    else:
        # Backfill pour tous les devices
        resultat = generer_recommandation_historique_tous_devices()

        if "erreur" in resultat:
            raise HTTPException(status_code=500, detail=resultat["erreur"])

        return {"message": "Backfill historique terminé ✅", "resultat": resultat}


@router.get("/recommandations/{device_id}", summary="Recommandation du jour pour 1 device")
def get_recommandation_device(
    device_id: int,
    date_str: Optional[str] = Query(None, description="Date (YYYY-MM-DD), défaut = aujourd'hui"),
    db: Session = Depends(get_db),
    user: dict = Depends(require_any),
):
    today = date_str or date.today().isoformat()

    device = db.query(Device).filter(Device.id == device_id).first()
    if device is None:
        raise HTTPException(status_code=404, detail=f"Device {device_id} introuvable")
    _check_device_access(device, user)

    # Vérifier si déjà en BDD
    existing = db.query(AIRecommandation).filter(
        AIRecommandation.device_id == device_id,
        AIRecommandation.date == today,
    ).first()

    if existing:
        d = existing.to_dict()
        d["farm_name"]    = device.farm_name
        d["house_number"] = device.house_number
        return {"source": "cache", "recommandation": d}

    # Tenter la génération — si les modèles ML ne sont pas dispo → 404
    try:
        cfg = get_or_create_config(db, device_id)
        resultat = generer_recommandation_matin(
            device_id       = device_id,
            date_str        = today,
            ec_bassin       = cfg.ec_eau_brute or 0.8,
            date_plantation = str(cfg.date_plantation) if cfg.date_plantation else None,
            lat             = cfg.latitude or 30.4202,
            lon             = cfg.longitude or -9.5981,
        )

        if "erreur" in resultat:
            # Modèles ML non disponibles → retourner 404 proprement
            raise HTTPException(status_code=404, detail="Aucune recommandation disponible")

        rec_db = sauvegarder_recommandation(db, resultat)
        d = rec_db.to_dict()
        d["farm_name"]    = resultat.get("farm_name")
        d["house_number"] = resultat.get("house_number")
        return {"source": "generated", "recommandation": d}

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Erreur génération recommandation device {device_id}: {e}")
        raise HTTPException(status_code=404, detail="Aucune recommandation disponible")

@router.get("/recommandations/{device_id}/historique", summary="Historique des recommandations")
def get_historique_recommandations(
    device_id: int,
    limit: int = Query(30, ge=1, le=365),
    db: Session = Depends(get_db),
    user: dict = Depends(require_any),
):
    """
    Retourne l'historique des recommandations IA pour un device.
    Filtrage par farm_names (sauf admin).
    """
    # Vérifier accès au device
    device = db.query(Device).filter(Device.id == device_id).first()
    if device is None:
        raise HTTPException(status_code=404, detail=f"Device {device_id} introuvable")
    _check_device_access(device, user)

    recs = (
        db.query(AIRecommandation)
        .filter(AIRecommandation.device_id == device_id)
        .order_by(AIRecommandation.date.desc())
        .limit(limit)
        .all()
    )

    return {
        "device_id"    : device_id,
        "farm_name"    : device.farm_name if device else None,
        "house_number" : device.house_number if device else None,
        "total"        : len(recs),
        "historique"   : [r.to_dict() for r in recs],
    }


@router.post("/recommandations/{rec_id}/approve", summary="Approuver ou rejeter une recommandation")
def approve_recommandation(
    rec_id: int,
    body: ApproveRequest,
    db: Session = Depends(get_db),
    user: dict = Depends(require_operateur),
):
    """
    Permet à l'opérateur d'approuver ou de rejeter une recommandation.
    """
    if body.statut not in ("approved", "rejected"):
        raise HTTPException(status_code=400, detail="statut doit être 'approved' ou 'rejected'")

    rec = db.query(AIRecommandation).filter(AIRecommandation.id == rec_id).first()
    if rec is None:
        raise HTTPException(status_code=404, detail=f"Recommandation {rec_id} introuvable")

    # Vérifier accès au device associé
    device = db.query(Device).filter(Device.id == rec.device_id).first()
    if device:
        _check_device_access(device, user)

    rec.statut = body.statut
    rec.feedback_operateur = body.feedback
    db.commit()
    db.refresh(rec)

    return {"message": f"Recommandation {rec_id} → {body.statut}", "data": rec.to_dict()}


@router.post("/decision-tour", summary="Saisie drainage + Décision tour/tour")
def post_decision_tour(
    body: DecisionTourRequest,
    db: Session = Depends(get_db),
    user: dict = Depends(require_operateur),
):
    """
    Reçoit la saisie drainage de l'opérateur après chaque tour.
    Calcule le % drainage automatiquement depuis V apport du tour (irrigation_tours).
    Lance predict_tour() et retourne la décision ML.
    """
    from models.ai_recommendation_model import AIDecisionTour
    from models.sensor_model import IrrigationTour
    from datetime import date, datetime

    device = db.query(Device).filter(Device.id == body.device_id).first()
    if device is None:
        raise HTTPException(status_code=404, detail=f"Device {body.device_id} introuvable")
    _check_device_access(device, user)

    if body.date_str:
        try:
            today = datetime.strptime(body.date_str, "%Y-%m-%d").date()
        except ValueError:
            raise HTTPException(status_code=400, detail="date_str invalide (format attendu YYYY-MM-DD)")
    else:
        today = date.today()

    # ── Récupérer le tour depuis irrigation_tours pour avoir v_apport ──
    tour_netafim = db.query(IrrigationTour).filter(
        IrrigationTour.device_id == body.device_id,
        IrrigationTour.date      == today,
        IrrigationTour.tour_num  == body.num_tour,
    ).first()

    v_apport = tour_netafim.v_apport if tour_netafim and tour_netafim.v_apport else None

    cfg = get_or_create_config(db, body.device_id)

    # ── Calculer % drainage (même logique que SaisiePage) ──
    pct_drainage = None
    if body.pct_drainage:
        pct_drainage = body.pct_drainage  # fourni directement
    elif body.v_drainage and v_apport and v_apport > 0:
        nbr_goutteurs = cfg.nbr_goutteurs or 1
        pct_drainage = (body.v_drainage / nbr_goutteurs / v_apport) * 100

    # ── Récupérer la recommandation matin pour context ──
    rec = db.query(AIRecommandation).filter(
        AIRecommandation.device_id == body.device_id,
        AIRecommandation.date      == today,
    ).first()

    nb_tours_cible = rec.nb_tours if rec else 10
    ec_cible       = rec.ec_cible if rec else 2.3

    # ── Construire les données pour predict_tour ──
    # Récupérer décisions précédentes pour les lags
    decisions_prev = (
        db.query(AIDecisionTour)
        .filter(
            AIDecisionTour.device_id == body.device_id,
            AIDecisionTour.date      == today,
            AIDecisionTour.num_tour  < body.num_tour,
        )
        .order_by(AIDecisionTour.num_tour.desc())
        .limit(3)
        .all()
    )

    pct_lag1 = decisions_prev[0].pct_drainage if len(decisions_prev) > 0 else 0.0
    pct_lag2 = decisions_prev[1].pct_drainage if len(decisions_prev) > 1 else 0.0
    pct_lag3 = decisions_prev[2].pct_drainage if len(decisions_prev) > 2 else 0.0
    ec_lag1  = decisions_prev[0].ec_drainage  if len(decisions_prev) > 0 else 0.0
    ec_lag2  = decisions_prev[1].ec_drainage  if len(decisions_prev) > 1 else 0.0

    # Volume cumulé apporté jusqu'à ce tour
    tours_passes = db.query(IrrigationTour).filter(
        IrrigationTour.device_id == body.device_id,
        IrrigationTour.date      == today,
        IrrigationTour.tour_num  <= body.num_tour,
    ).all()
    vol_cumule = sum(t.v_apport for t in tours_passes if t.v_apport) if tours_passes else 0.0

    # Volume journalier cible depuis recommandation matin
    vol_jour_cible = 0.0
    if rec and rec.quantite_eau_mm:
        # mm → cc/goutteur : 1mm = 150cc/goutteur (formule Azura)
        vol_jour_cible = rec.quantite_eau_mm * 150.0

    donnees_tour = {
        "pct_drainage"          : pct_drainage or 0.0,
        "ec_drainage"           : body.ec_drainage or 0.0,
        "ph_drainage"           : body.ph_drainage or 0.0,
        "num_tour"              : body.num_tour,
        "v_apport"              : v_apport or 0.0,
        "_pct_drain_prev"       : pct_lag1 or 0.0,
        "pct_drainage_lag1"     : pct_lag1 or 0.0,
        "pct_drainage_lag2"     : pct_lag2 or 0.0,
        "pct_drainage_lag3"     : pct_lag3 or 0.0,
        "ec_drainage_lag1"      : ec_lag1 or 0.0,
        "ec_drainage_lag2"      : ec_lag2 or 0.0,
        "opt_vol_cumule_L"      : vol_cumule,
        "opt_vol_jour_cible_L"  : vol_jour_cible,
        "opt_EC_drain_cible_dSm": (ec_cible or 2.3) * 1.2,  # cible drain = EC apport * 1.2
        "opt_nb_cycles"         : nb_tours_cible or 10,
        "opt_max_cycles_stade"  : 14,
        "ec_bassin"             : cfg.ec_eau_brute or 0.8,
        "ec_apport"             : tour_netafim.ec_apport if tour_netafim else (ec_cible or 2.3),
        "ph_apport"             : tour_netafim.ph_apport if tour_netafim else 6.0,
        "meteo_T_max_C"         : 28.0,
        "meteo_VPD_max_kPa"     : 1.8,
        "meteo_ET0_mm_jour"     : 5.5,
        "alerte_chergui"        : 1 if rec and rec.alerte == "CHERGUI" else 0,
        "alerte_pluie"          : 1 if rec and rec.alerte == "PLUIE_STOP" else 0,
        "alerte_brouillard"     : 1 if rec and rec.alerte == "BROUILLARD" else 0,
        "scenario_meteo"        : rec.scenario_meteo if rec else "2_ENSOLEILLE",
        **body.donnees_supplementaires,
    }

    resultat = generer_decision_tour(body.device_id, donnees_tour, date_cible=today)

    # Calculer heure_debut_tour_suivante = heure_fin_tour + repos_predicte
    heure_debut_tour_suivante = None
    if tour_netafim and tour_netafim.fin:
        repos = decision_ml.get("repos_min") or 0
        from datetime import timedelta
        heure_fin_dt = tour_netafim.fin
        heure_suivante_dt = heure_fin_dt + timedelta(minutes=repos)
        heure_debut_tour_suivante = heure_suivante_dt.strftime("%H:%M")

    if "erreur" in resultat and "disponible" not in resultat:
        raise HTTPException(status_code=500, detail=resultat["erreur"])

    # ── Upsert en BDD (créer ou mettre à jour) ──
    existing = db.query(AIDecisionTour).filter(
        AIDecisionTour.device_id == body.device_id,
        AIDecisionTour.date      == today,
        AIDecisionTour.num_tour  == body.num_tour,
    ).first()

    decision_ml = resultat.get("decision", {}) if isinstance(resultat.get("decision"), dict) else resultat

    if existing:
        existing.v_drainage   = body.v_drainage
        existing.pct_drainage = pct_drainage
        existing.ec_drainage  = body.ec_drainage
        existing.ph_drainage  = body.ph_drainage
        existing.decision     = decision_ml.get("decision", "CONTINUER")
        existing.raison       = decision_ml.get("raison", "")
        existing.duree_suivant= decision_ml.get("duree_tour_suivant_min")
        existing.repos_suivant= decision_ml.get("repos_min")
        existing.heure_debut_tour_suivante = heure_debut_tour_suivante
        existing.donnees_entree = donnees_tour
        existing.disponible   = True
        db.commit()
        db.refresh(existing)
        saved = existing
    else:
        saved = AIDecisionTour(
            device_id     = body.device_id,
            date          = today,
            num_tour      = body.num_tour,
            v_drainage    = body.v_drainage,
            pct_drainage  = pct_drainage,
            ec_drainage   = body.ec_drainage,
            ph_drainage   = body.ph_drainage,
            decision      = decision_ml.get("decision", "CONTINUER"),
            raison        = decision_ml.get("raison", ""),
            duree_suivant = decision_ml.get("duree_tour_suivant_min"),
            repos_suivant = decision_ml.get("repos_min"),
            heure_debut_tour_suivante = heure_debut_tour_suivante,
            donnees_entree= donnees_tour,
            disponible    = True,
        )
        db.add(saved)
        db.commit()
        db.refresh(saved)

    return {
        "device_id"    : body.device_id,
        "farm_name"    : device.farm_name,
        "house_number" : device.house_number,
        "num_tour"     : body.num_tour,
        "v_apport"     : v_apport,
        "v_drainage"   : body.v_drainage,
        "pct_drainage" : pct_drainage,
        "ec_drainage"  : body.ec_drainage,
        "ph_drainage"  : body.ph_drainage,
        "decision"     : saved.to_dict(),
        "prediction"   : {
            "action"        : decision_ml.get("decision", "CONTINUER"),
            "raison"        : decision_ml.get("raison", ""),
            "duree_suivant" : decision_ml.get("duree_tour_suivant_min"),
            "repos_min"     : decision_ml.get("repos_min"),
            "message"       : decision_ml.get("message_operateur", ""),
            "heure_debut_tour_suivante": heure_debut_tour_suivante,
        },
    }


@router.get("/decision-tour/{device_id}", summary="Décisions tour/tour du jour")
def get_decisions_tour_jour(
    device_id: int,
    date_str: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    user: dict = Depends(require_any),
):
    """
    Retourne toutes les décisions tour/tour d'un device pour une journée.
    Enrichi avec les tours Netafim (v_apport).
    """
    from models.ai_recommendation_model import AIDecisionTour
    from models.sensor_model import IrrigationTour
    from datetime import date

    device = db.query(Device).filter(Device.id == device_id).first()
    if device is None:
        raise HTTPException(status_code=404, detail=f"Device {device_id} introuvable")
    _check_device_access(device, user)

    target_date = date_str or date.today().isoformat()

    decisions = (
        db.query(AIDecisionTour)
        .filter(
            AIDecisionTour.device_id == device_id,
            AIDecisionTour.date      == target_date,
        )
        .order_by(AIDecisionTour.num_tour.asc())
        .all()
    )

    # Enrichir avec les tours Netafim
    tours_netafim = (
        db.query(IrrigationTour)
        .filter(
            IrrigationTour.device_id == device_id,
            IrrigationTour.date      == target_date,
        )
        .order_by(IrrigationTour.tour_num.asc())
        .all()
    )

    tours_map = {t.tour_num: t for t in tours_netafim}

    result = []
    for d in decisions:
        tour = tours_map.get(d.num_tour)
        item = d.to_dict()
        item["v_apport"]  = tour.v_apport  if tour else None
        item["ec_apport"] = tour.ec_apport if tour else None
        item["ph_apport"] = tour.ph_apport if tour else None
        item["debut"]     = tour.debut.strftime("%H:%M") if tour and tour.debut else None
        item["fin"]       = tour.fin.strftime("%H:%M")   if tour and tour.fin   else None
        result.append(item)

    # Aussi retourner les tours Netafim sans décision (pour affichage)
    tours_sans_decision = [
        {
            "num_tour"    : t.tour_num,
            "v_apport"    : t.v_apport,
            "ec_apport"   : t.ec_apport,
            "ph_apport"   : t.ph_apport,
            "debut"       : t.debut.strftime("%H:%M") if t.debut else None,
            "fin"         : t.fin.strftime("%H:%M")   if t.fin   else None,
            "has_decision": t.tour_num in {d.num_tour for d in decisions},
        }
        for t in tours_netafim
    ]

    return {
        "device_id"   : device_id,
        "farm_name"   : device.farm_name,
        "house_number": device.house_number,
        "date"        : target_date,
        "decisions"   : result,
        "tours_netafim": tours_sans_decision,
    }


@router.get("/comparaison/{device_id}", summary="Comparaison humain vs IA")
def get_comparaison(
    device_id: int,
    date_str: Optional[str] = Query(None, description="Date (YYYY-MM-DD), défaut = aujourd'hui"),
    db: Session = Depends(get_db),
    user: dict = Depends(require_any),
):
    """
    Compare la saisie opérateur vs la recommandation IA pour un device et une date.
    Filtrage par farm_names (sauf admin).
    """
    device = db.query(Device).filter(Device.id == device_id).first()
    if device is None:
        raise HTTPException(status_code=404, detail=f"Device {device_id} introuvable")
    _check_device_access(device, user)

    today = date_str or date.today().isoformat()
    return comparer_humain_vs_ia(device_id, today)


@router.get("/config/{device_id}", summary="Configuration IA d'un device")
def get_config(
    device_id: int,
    db: Session = Depends(get_db),
    user: dict = Depends(require_any),
):
    """
    Retourne la configuration IA d'un device.
    Filtrage par farm_names (sauf admin).
    """
    device = db.query(Device).filter(Device.id == device_id).first()
    if device is None:
        raise HTTPException(status_code=404, detail=f"Device {device_id} introuvable")
    _check_device_access(device, user)

    cfg = get_or_create_config(db, device_id)
    return {
        "device_id"       : cfg.device_id,
        "ec_eau_brute"    : cfg.ec_eau_brute,
        "date_plantation" : str(cfg.date_plantation) if cfg.date_plantation else None,
        "methode_decision": cfg.methode_decision,
        "drainage_dispo"  : cfg.drainage_dispo,
        "actif"           : cfg.actif,
        "latitude"        : cfg.latitude,
        "longitude"       : cfg.longitude,
        "nbr_goutteurs"   : cfg.nbr_goutteurs,
    }


@router.put("/config/{device_id}", summary="Mettre à jour la configuration IA")
def update_config(
    device_id: int,
    body: ConfigUpdateRequest,
    db: Session = Depends(get_db),
    user: dict = Depends(require_operateur),
):
    """
    Met à jour la configuration IA d'un device.
    Filtrage par farm_names (sauf admin).
    """
    device = db.query(Device).filter(Device.id == device_id).first()
    if device is None:
        raise HTTPException(status_code=404, detail=f"Device {device_id} introuvable")
    _check_device_access(device, user)

    cfg = get_or_create_config(db, device_id)

    update_data = body.dict(exclude_unset=True)
    for key, value in update_data.items():
        if key == "date_plantation" and value:
            from datetime import datetime
            value = datetime.strptime(value, "%Y-%m-%d").date()
        setattr(cfg, key, value)

    db.commit()
    db.refresh(cfg)

    return {
        "message": "Configuration mise à jour ✅",
        "config": {
            "device_id"       : cfg.device_id,
            "ec_eau_brute"    : cfg.ec_eau_brute,
            "date_plantation" : str(cfg.date_plantation) if cfg.date_plantation else None,
            "methode_decision": cfg.methode_decision,
            "drainage_dispo"  : cfg.drainage_dispo,
            "actif"           : cfg.actif,
            "latitude"        : cfg.latitude,
            "longitude"       : cfg.longitude,
            "nbr_goutteurs"   : cfg.nbr_goutteurs,
        },
    }


# ════════════════════════════════════════════════════════════════
# ENDPOINTS PRT (Poids-Readings Tour)
# ════════════════════════════════════════════════════════════════

@router.get("/prt/{device_id}", summary="Simulation PRT complète pour un device")
def get_prt_device(
    device_id: int,
    scenario: Optional[str] = Query(None, description="Scénario météo (ex: 5_BROUILLARD_MATIN). Si null → auto-détection via ML"),
    date_str: Optional[str] = Query(None, description="Date (YYYY-MM-DD), défaut = aujourd'hui"),
    db: Session = Depends(get_db),
    user: dict = Depends(require_any),
):
    """
    Simule le système PRT complet pour un device :
      1. Récupère poids_soir (veille 13h-16h)
      2. Récupère tous les poids du matin (06h-11h)
      3. Calcule PRT_pct en continu pour chaque poids
      4. Détecte le premier DECLENCHER
      5. Calcule heure_debut_tour1 = heure_matin + 10 min

    Si scenario est null, le détecter automatiquement via le ML.
    """
    date_str = date_str or date.today().isoformat()

    device = db.query(Device).filter(Device.id == device_id).first()
    if device is None:
        raise HTTPException(status_code=404, detail=f"Device {device_id} introuvable")
    _check_device_access(device, user)

    resultat_ml = None

    # Si scenario non fourni → auto-détection via ML
    if scenario is None:
        try:
            cfg = get_or_create_config(db, device_id)
            resultat_ml = generer_recommandation_matin(
                device_id       = device_id,
                date_str        = date_str,
                ec_bassin       = cfg.ec_eau_brute or 0.8,
                date_plantation = str(cfg.date_plantation) if cfg.date_plantation else None,
                lat             = cfg.latitude or DEFAULT_LAT,
                lon             = cfg.longitude or DEFAULT_LON,
            )
            scenario = resultat_ml.get("consignes", {}).get("scenario_meteo", "default")
        except Exception as e:
            logger.warning(f"Auto-détection scénario échouée : {e} → default")
            scenario = "default"

    prt_result = detecter_heure_matin_et_debut_tour(
        db, device_id, date_str, scenario
    )

    # Heure ML pour comparaison
    heure_ml = None
    if resultat_ml and "consignes" in resultat_ml:
        heure_ml = resultat_ml["consignes"].get("heure_debut_ml")

    return {
        "device_id"         : device_id,
        "farm_name"         : device.farm_name,
        "house_number"      : device.house_number,
        "date"              : date_str,
        "scenario_meteo"    : scenario,
        # ── Heures séparées ML vs PRT ──
        "heure_debut_ml"    : heure_ml,                          # Heure ML originale
        "heure_debut_prt"   : prt_result.get("heure_debut_tour1"),  # Heure PRT détectée (ou None)
        # ── Détails PRT ──
        "heure_matin"       : prt_result.get("heure_matin"),     # Heure détection seuil
        "prt_pct"           : prt_result.get("prt_pct"),
        "prt_decision"      : prt_result.get("decision"),
        "poids_soir_kg"     : prt_result.get("poids_soir_kg"),
        "poids_matin_kg"    : prt_result.get("poids_matin_kg"),
        "seuils"            : PRT_SEUILS.get(scenario, PRT_SEUILS["default"]),
    }


@router.get("/prt/{device_id}/detail", summary="Détail calcul PRT poids par poids")
def get_prt_detail(
    device_id: int,
    scenario: str = Query(..., description="Scénario météo (ex: 5_BROUILLARD_MATIN)"),
    date_str: Optional[str] = Query(None, description="Date (YYYY-MM-DD), défaut = aujourd'hui"),
    db: Session = Depends(get_db),
    user: dict = Depends(require_any),
):
    """
    Retourne le détail du calcul PRT pour chaque poids du matin.
    Montre l'évolution de PRT_pct et la décision à chaque lecture.
    Utile pour debug / calibration.
    """
    from services.ai_service import _recuperer_poids_soir, _recuperer_poids_matins

    date_str = date_str or date.today().isoformat()

    device = db.query(Device).filter(Device.id == device_id).first()
    if device is None:
        raise HTTPException(status_code=404, detail=f"Device {device_id} introuvable")
    _check_device_access(device, user)

    ps_data = _recuperer_poids_soir(db, device_id, date_str)
    ps = ps_data["poids_soir_kg"]
    poids_matins = _recuperer_poids_matins(db, device_id, date_str)

    seuils = PRT_SEUILS.get(scenario, PRT_SEUILS["default"])

    details = []
    for lecture in poids_matins:
        result = calculer_prt_decision(ps, lecture["poids_kg"], scenario)
        details.append({
            "heure"      : lecture["heure"],
            "poids_kg"   : lecture["poids_kg"],
            "prt_pct"    : result["prt_pct"],
            "decision"   : result["decision"],
            "seuil_bas"  : result["seuil_bas"],
            "seuil_haut" : result["seuil_haut"],
        })

    return {
        "device_id"     : device_id,
        "farm_name"     : device.farm_name,
        "house_number"  : device.house_number,
        "date"          : date_str,
        "scenario_meteo": scenario,
        "poids_soir_kg" : ps,
        "poids_soir_heure": ps_data.get("heure_soir"),
        "seuils"        : {"bas": seuils[0], "haut": seuils[1]},
        "lectures"      : details,
    }


@router.get("/prt/seuils", summary="Seuils PRT par scénario météo")
def get_prt_seuils(
    user: dict = Depends(require_any),
):
    """
    Retourne les seuils PRT configurés pour les 13 scénarios météo.
    Format: {scenario: {seuil_bas, seuil_haut, zone, heure_recommandee}}
    """
    zones = {}
    for s, (bas, haut) in PRT_SEUILS.items():
        if bas == 0 and haut == 0:
            zone = "PLUIE_STOP"
        elif bas < 9.0:
            zone = "CHERGUI"
        elif bas >= 10.0:
            zone = "BROUILLARD_NUAGEUX"
        else:
            zone = "STANDARD"
        zones[s] = {
            "seuil_bas"         : bas,
            "seuil_haut"        : haut,
            "zone"              : zone,
            "heure_recommandee" : None,
        }
    return zones
