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
    pct_drainage: Optional[float] = None
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


@router.post("/decision-tour", summary="Décision tour/tour (CONTINUER/POST)")
def post_decision_tour(
    body: DecisionTourRequest,
    db: Session = Depends(get_db),
    user: dict = Depends(require_operateur),
):
    """
    Après chaque cycle d'irrigation, demande à l'IA si on continue ou on stoppe.
    **Actuellement indisponible** — les capteurs de drainage ne sont pas installés.
    Filtrage par farm_names (sauf admin).
    """
    device = db.query(Device).filter(Device.id == body.device_id).first()
    if device is None:
        raise HTTPException(status_code=404, detail=f"Device {body.device_id} introuvable")
    _check_device_access(device, user)

    donnees_tour = {
        "num_tour"     : body.num_tour,
        "pct_drainage" : body.pct_drainage or 0,
        "ec_drainage"  : body.ec_drainage or 0,
        "ph_drainage"  : body.ph_drainage or 0,
        **body.donnees_supplementaires,
    }

    resultat = generer_decision_tour(body.device_id, donnees_tour)

    if "erreur" in resultat:
        raise HTTPException(status_code=500, detail=resultat["erreur"])

    return resultat


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
