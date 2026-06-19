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
import pytz as _pytz

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
    recuperer_meteo_open_meteo,
    recuperer_meteo_open_meteo_horaire,   # ← NOUVEAU
    _calculer_max_cycles_stade,
    PRT_SEUILS,
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

# APRÈS
@router.get("/recommandations", summary="Recommandations du jour pour TOUS les devices")
def get_recommandations_tous(
    date_str: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    user: dict = Depends(require_any),
):
    from datetime import datetime as dt
    today = date_str or date.today().isoformat()
    is_today = (date_str is None or date_str == date.today().isoformat())

    query = db.query(AIRecommandation).filter(AIRecommandation.date == today)
    query = _filter_devices_by_farm_names(query, user)
    existing = query.all()

    if existing:
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

    # Bloquer la génération avant 06h00 pour aujourd'hui
    if is_today and dt.now().hour < 6:
        return {
            "date"           : today,
            "total_devices"  : 0,
            "recommandations": [],
            "source"         : "not_ready",
            "message"        : "Recommandations disponibles à partir de 06h00",
        }

    # Date passée ou après 06h00 → générer
    resultat = generer_recommandation_tous_devices(today)

    if "erreur" in resultat and resultat.get("generated", 0) == 0:
        raise HTTPException(status_code=500, detail=resultat["erreur"])

    recommandations = []
    for r in resultat.get("recommandations", []):
        try:
            rec_db = sauvegarder_recommandation(db, r)
            d = rec_db.to_dict()
            d["farm_name"]    = r.get("farm_name")
            d["house_number"] = r.get("house_number")
            recommandations.append(d)
        except Exception as e:
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
    date_str: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    user: dict = Depends(require_any),
):
    from datetime import datetime as dt
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
        # ── Recalcul PRT à la volée pour dates historiques sans heure_debut_prt ──
        from datetime import date as _date
        is_historique = (existing.date < _date.today())
        if is_historique and existing.heure_debut_prt is None:
            try:
                from services.ai_service import (
                    detecter_heure_matin_et_debut_tour, PRT_SEUILS
                )
                scenario   = existing.scenario_meteo or "default"
                prt_result = detecter_heure_matin_et_debut_tour(
                    db, device_id, today, scenario
                )
                heure_prt   = prt_result.get("heure_debut_tour1")
                prt_pct     = prt_result.get("prt_pct")
                decision    = prt_result.get("decision")
                heure_matin = prt_result.get("heure_matin")
                poids_soir  = prt_result.get("poids_soir_kg")
                poids_matin = prt_result.get("poids_matin_kg")
                source      = prt_result.get("source", "ml")

                if poids_soir  is not None: existing.poids_soir_kg  = poids_soir
                if poids_matin is not None: existing.poids_matin_kg = poids_matin
                if prt_pct     is not None: existing.ptr_pct        = prt_pct
                if decision    is not None: existing.ptr_decision    = decision
                if heure_matin is not None: existing.heure_matin     = heure_matin
                existing.ptr_seuil_bas  = PRT_SEUILS.get(scenario, PRT_SEUILS["default"])[0]
                existing.ptr_seuil_haut = PRT_SEUILS.get(scenario, PRT_SEUILS["default"])[1]

                if heure_prt is not None:
                    existing.heure_debut_prt = heure_prt
                    logger.info(
                        f"PRT recalculé (historique) device {device_id} "
                        f"{today} → {heure_prt} [src={source}]"
                    )
                db.commit()
                db.refresh(existing)

            except Exception as e:
                logger.warning(
                    f"PRT recalcul historique device {device_id} {today} : {e}"
                )

        d = existing.to_dict()
        d["farm_name"]    = device.farm_name
        d["house_number"] = device.house_number
        return {"source": "cache", "recommandation": d}

    # Bloquer la génération avant 06h00 pour aujourd'hui
    is_today = (date_str is None or date_str == date.today().isoformat())
    if is_today and dt.now().hour < 6:
        raise HTTPException(
            status_code=404,
            detail="Recommandation disponible à partir de 06h00"
        )

    # Tenter la génération — si les modèles ML ne sont pas dispo → 404
    try:
        cfg = get_or_create_config(db, device_id)
        resultat = generer_recommandation_matin(
            device_id       = device_id,
            date_str        = today,
            ec_bassin       = cfg.ec_eau_brute,
            date_plantation = str(cfg.date_plantation) if cfg.date_plantation else None,
            lat             = cfg.latitude,
            lon             = cfg.longitude,
        )

        if "erreur" in resultat:
            if resultat["erreur"] == "CONFIG_MANQUANTE":
                raise HTTPException(
                    status_code=422,
                    detail={
                        "code"   : "CONFIG_MANQUANTE",
                        "codes"  : [c for c in resultat.get("codes", []) if c],
                        "message": resultat.get("message"),
                    }
                )
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

    # ── Vérifier nbr_goutteurs configuré ──
    if not cfg.nbr_goutteurs:
        raise HTTPException(
            status_code=422,
            detail={
                "code"   : "NBR_GOUTTEURS_MANQUANT",
                "message": f"Veuillez configurer le nombre de goutteurs pour {device.farm_name} Station {device.house_number}",
            }
        )
    
    # ── Vérifier date_plantation configurée ──
    # Si absente → fallback silencieux à 75 jours (stade Floraison).
    # C'est acceptable en Floraison (max=14) mais DANGEREUX en Végétatif
    # (le vrai max est 4-6, pas 14 — risque asphyxie racinaire + botrytis).
    avertissements = []
    if not cfg.date_plantation:
        avertissements.append({
            "code"   : "DATE_PLANTATION_MANQUANTE",
            "niveau" : "warning",
            "message": (
                f"Date de plantation non configurée pour {device.farm_name} "
                f"Station {device.house_number}. "
                f"Fallback : 75 jours (stade Floraison, max_cycles=14). "
                f"Si le plant est en stade Végétatif, ce plafond est incorrect — "
                f"veuillez configurer la date de plantation."
            ),
        })
        logger.warning(
            f"[DATE_PLANTATION_MANQUANTE] device={body.device_id} "
            f"({device.farm_name} H{device.house_number}) — "
            f"fallback 75j (Floraison). Configurer cfg.date_plantation !"
        )

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

    nb_tours_cible = rec.nb_tours
    ec_cible       = rec.ec_cible

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
    vol_cumule = sum(t.v_apport or 0.0 for t in tours_passes) if tours_passes else 0.0

    vol_jour_cible = 0.0
    if rec and rec.quantite_eau_mm:
        # mm → cc/goutteur : 1 mm = 150 cc/goutteur (formule Azura)
        vol_jour_cible = rec.quantite_eau_mm * 150.0
    
    features_matin = (rec.features_utilises or {}) if rec else {}
    t_max_reel   = features_matin.get("meteo_T_max_C")
    vpd_max_reel = features_matin.get("meteo_VPD_max_kPa")
    et0_reel     = features_matin.get("meteo_ET0_mm_jour")  

    # ── Détection pluie en temps réel (Open-Meteo) ───────────────────────────
    # La recommandation matin est calculée à 06h00 avec la météo prévue.
    # Si la pluie arrive plus tard dans la journée, alerte_pluie resterait
    # à 0 en ne lisant que la BDD. On re-consulte Open-Meteo maintenant
    # pour capturer toute pluie surprise apparue après 06h00.
    lat = cfg.latitude
    lon = cfg.longitude
    date_str_aujourd_hui = today.isoformat()

    # ── Calcul jours depuis plantation → max cycles du stade réel ────────────
    if cfg.date_plantation:
        try:
            from datetime import datetime as _dtt
            dp = cfg.date_plantation if hasattr(cfg.date_plantation, "year") \
                 else _dtt.strptime(str(cfg.date_plantation), "%Y-%m-%d").date()
            jours_depuis_plantation = (today - dp).days
        except (ValueError, TypeError):
            jours_depuis_plantation = 75  # fallback : Floraison (J61-J90)
    else:
        jours_depuis_plantation = 75

    max_cycles_stade = _calculer_max_cycles_stade(jours_depuis_plantation)

    alerte_pluie_matin = 1 if rec and rec.alerte == "PLUIE_STOP" else 0
    try:
        meteo_temps_reel = recuperer_meteo_open_meteo(lat, lon, today.isoformat())
        pluie_temps_reel = meteo_temps_reel.get("meteo_pluie_mm_jour", 0.0) or 0.0
        alerte_pluie_reel = 1 if pluie_temps_reel > 0.5 else 0
        if alerte_pluie_reel and not alerte_pluie_matin:
            logger.warning(
                f"[PLUIE SURPRISE] device={body.device_id} tour={body.num_tour} "
                f"pluie={pluie_temps_reel:.1f}mm détectée en temps réel (non prévue ce matin)"
            )
    except Exception as _e:
        logger.warning(f"[METEO TEMPS RÉEL] Échec Open-Meteo → fallback BDD : {_e}")
        alerte_pluie_reel = alerte_pluie_matin  # fallback : valeur du matin

    # L'alerte finale pluie surprise
    alerte_pluie_finale = alerte_pluie_reel 

    # ── Chergui temps réel ────────────────────────────────────────────────────
    alerte_chergui_matin = 1 if rec and rec.alerte == "CHERGUI" else 0
    try:
        t_max_reel_chergui  = meteo_temps_reel.get("meteo_T_max_C")   or 0.0
        vpd_max_reel_chergui = meteo_temps_reel.get("meteo_VPD_max_kPa") or 0.0
        alerte_chergui_reel  = 1 if (t_max_reel_chergui > 35 and vpd_max_reel_chergui > 2.5) else 0
        if alerte_chergui_reel and not alerte_chergui_matin:
            logger.warning(
                f"[CHERGUI SURPRISE] device={body.device_id} tour={body.num_tour} "
                f"T={t_max_reel_chergui:.1f}°C VPD={vpd_max_reel_chergui:.2f}kPa "
                f"détecté en temps réel (non prévu ce matin)"
            )
    except Exception as _e:
        logger.warning(f"[CHERGUI TEMPS RÉEL] Échec → fallback BDD : {_e}")
        alerte_chergui_reel = alerte_chergui_matin

    alerte_chergui_finale = alerte_chergui_reel

    # ── Brouillard temps réel ─────────────────────────────────────────────────
    alerte_brouillard_matin = 1 if rec and rec.alerte == "BROUILLARD" else 0
    try:
        hr_max_reel = meteo_temps_reel.get("meteo_HR_max_pct") or 0.0
        # Brouillard réel : uniquement si HR encore élevée (pas de condition d'heure)
        alerte_brouillard_reel = 1 if hr_max_reel > 88 else 0
        if alerte_brouillard_matin and not alerte_brouillard_reel:
            logger.info(
                f"[BROUILLARD LEVÉ] device={body.device_id} tour={body.num_tour} "
                f"HR={hr_max_reel:.1f}% → alerte annulée (HR redescendue sous 88%)"
            )
        if alerte_brouillard_reel and not alerte_brouillard_matin:
            logger.warning(
                f"[BROUILLARD SURPRISE] device={body.device_id} tour={body.num_tour} "
                f"HR={hr_max_reel:.1f}% détectée en temps réel (non prévue ce matin)"
            )
    except Exception as _e:
        logger.warning(f"[BROUILLARD TEMPS RÉEL] Échec → fallback BDD : {_e}")
        alerte_brouillard_reel = alerte_brouillard_matin
    # Brouillard final : détection HR temps réel
    alerte_brouillard_finale = alerte_brouillard_reel

    # ── Météo "ACTUELLE" au moment de la fin du tour ────────
    # Le modèle Tour/Tour n'utilise plus les agrégats journaliers
    # (meteo_T_max_C, meteo_VPD_max_kPa, ...) mais la météo horaire RÉELLE
    # au moment "heure_fin" du tour actuel (ex: fin tour = 09:48 → 09:00).
    #
    # TIMEZONE : tour_netafim.fin est stocké en UTC dans la BDD.
    # Open-Meteo avec timezone="Africa/Casablanca" retourne les données
    # en heure locale marocaine. Il faut donc convertir UTC → heure locale
    # avant d'appeler Open-Meteo horaire.
    # Maroc = Africa/Casablanca = UTC+1 permanent (depuis 2018).
    # Si le Maroc revient à UTC+0 (pas de DST), aucun décalage nécessaire.
    try:
        _tz_casablanca = _pytz.timezone("Africa/Casablanca")
        if tour_netafim and tour_netafim.fin:
            # tour_netafim.fin est en UTC (naive) → localiser puis convertir
            _fin_utc = tour_netafim.fin if tour_netafim.fin.tzinfo else \
                    _pytz.utc.localize(tour_netafim.fin)
            _fin_local = _fin_utc.astimezone(_tz_casablanca)
            heure_fin_tour_str = _fin_local.strftime("%H:%M")
        else:
            # Fallback : heure locale actuelle via pytz
            heure_fin_tour_str = datetime.now(_tz_casablanca).strftime("%H:%M")
    except Exception:
        # Si pytz non dispo → fallback UTC (comportement précédent)
        if tour_netafim and tour_netafim.fin:
            heure_fin_tour_str = tour_netafim.fin.strftime("%H:%M")
        else:
            heure_fin_tour_str = datetime.now().strftime("%H:%M")

    try:
        meteo_actuel = recuperer_meteo_open_meteo_horaire(
            lat, lon, date_str_aujourd_hui, heure_fin_tour_str
        )
    except Exception as _e:
        logger.warning(f"[METEO ACTUELLE] Échec → valeurs par défaut : {_e}")
        meteo_actuel = {}

    # ── Capteurs externes : rs, outside_temp, outside_humidity ───────────────
    # Même logique pour les 3 : lecture la plus récente <= heure_fin du tour
    _rs_capteur       = None
    _t_outside        = None
    _hr_outside       = None
    try:
        from models.sensor_model import SensorReading as _SR
        from datetime import datetime as _dtt2

        _heure_fin_dt_ext = None
        if tour_netafim and tour_netafim.fin:
            _heure_fin_dt_ext = tour_netafim.fin if isinstance(tour_netafim.fin, _dtt2) \
                else _dtt2.combine(today, tour_netafim.fin.time())

        # Une seule requête — prend la lecture la plus récente <= heure_fin
        # qui a au moins un des 3 champs renseigné
        _q_ext = db.query(_SR).filter(
            _SR.device_id == body.device_id,
        )
        if _heure_fin_dt_ext:
            _q_ext = _q_ext.filter(_SR.timestamp <= _heure_fin_dt_ext)

        _lecture_ext = _q_ext.order_by(_SR.timestamp.desc()).first()

        if _lecture_ext:
            _heure_lue = _lecture_ext.timestamp.strftime('%H:%M')

            if _lecture_ext.radiation is not None and float(_lecture_ext.radiation) > 0:
                _rs_capteur = float(_lecture_ext.radiation)

            if _lecture_ext.outside_temp is not None and float(_lecture_ext.outside_temp) > 0:
                _t_outside = float(_lecture_ext.outside_temp)

            if _lecture_ext.outside_humidity is not None and float(_lecture_ext.outside_humidity) > 0:
                _hr_outside = float(_lecture_ext.outside_humidity)

            logger.info(
                f"[CAPTEUR EXT] device={body.device_id} "
                f"heure_fin={heure_fin_tour_str} → lecture={_heure_lue} | "
                f"rs={_rs_capteur} W/m² | "
                f"T_ext={_t_outside}°C | "
                f"HR_ext={_hr_outside}%"
            )
    except Exception as _e:
        logger.warning(f"[CAPTEUR EXT] Échec lecture capteurs externes : {_e}")

    # Valeurs par défaut si l'appel API échoue
    meteo_actuel.setdefault("meteo_pression_actuelle_kPa")
    meteo_actuel.setdefault("meteo_actuel_windspeed_10m")

    # Température extérieure : capteur si dispo, sinon Open-Meteo
    if _t_outside is not None:
        meteo_actuel["meteo_actuel_temperature_2m"] = _t_outside
    else:
        meteo_actuel.setdefault("meteo_actuel_temperature_2m", t_max_reel)

    # Humidité extérieure : capteur si dispo, sinon Open-Meteo
    # Recalcul VPD externe depuis capteurs si les deux sont dispo
    if _hr_outside is not None:
        meteo_actuel["meteo_actuel_relative_humidity_2m"] = _hr_outside
        if _t_outside is not None:
            from services.ai_service import calculer_vpd_interne as _calc_vpd
            _vpd_ext = _calc_vpd(_t_outside, _hr_outside)
            meteo_actuel["meteo_actuel_vapour_pressure_deficit"] = _vpd_ext
            logger.info(f"[CAPTEUR EXT] VPD recalculé depuis capteurs : {_vpd_ext:.3f} kPa")
        else:
            meteo_actuel.setdefault("meteo_actuel_vapour_pressure_deficit", vpd_max_reel)
    else:
        meteo_actuel.setdefault("meteo_actuel_relative_humidity_2m", hr_max_reel)
        meteo_actuel.setdefault("meteo_actuel_vapour_pressure_deficit", vpd_max_reel)

    # Rayonnement : capteur si dispo, sinon Open-Meteo
    if _rs_capteur is not None:
        meteo_actuel["meteo_rs_wm2_actuel"] = _rs_capteur
    else:
        meteo_actuel.setdefault("meteo_rs_wm2_actuel")

    # ── Recalcul alertes _actuel depuis valeurs finales (capteurs > Open-Meteo) ──
    _t_final    = meteo_actuel.get("meteo_actuel_temperature_2m")
    _hr_final   = meteo_actuel.get("meteo_actuel_relative_humidity_2m")
    _vpd_final  = meteo_actuel.get("meteo_actuel_vapour_pressure_deficit")
    _rs_final   = meteo_actuel.get("meteo_rs_wm2_actuel")
    _vent_final = meteo_actuel.get("meteo_actuel_windspeed_10m")

    # Alertes recalculées depuis valeurs finales (capteur si dispo, sinon Open-Meteo)
    meteo_actuel["alerte_chergui_actuel"]      = 1 if (_t_final > 35 and _vpd_final > 2.5) else 0
    meteo_actuel["alerte_brouillard_actuel"]   = 1 if (_hr_final > 90 and _rs_final < 300) else 0
    meteo_actuel["alerte_vpd_stress_actuel"]   = 1 if _vpd_final > 1.5 else 0
    meteo_actuel["alerte_vent_actuel"]         = 1 if _vent_final > 10.8 else 0

    # Pluie : Open-Meteo uniquement (pas de capteur pluie) — garder valeur existante
    meteo_actuel.setdefault("alerte_pluie_actuel")
    meteo_actuel.setdefault("alerte_pluie_legere_actuel")

    logger.info(
        f"[ALERTES ACTUEL] T={_t_final}°C HR={_hr_final}% "
        f"VPD={_vpd_final:.3f}kPa RS={_rs_final:.0f}W/m² vent={_vent_final:.1f}km/h → "
        f"chergui={meteo_actuel['alerte_chergui_actuel']} "
        f"brouillard={meteo_actuel['alerte_brouillard_actuel']} "
        f"vpd_stress={meteo_actuel['alerte_vpd_stress_actuel']} "
        f"vent={meteo_actuel['alerte_vent_actuel']} "
        f"pluie={meteo_actuel['alerte_pluie_actuel']}"
    )

    from services.ai_service import EC_DRAIN_RATIO_STADE, _calculer_stade_et_kc
    _stade_actuel, _ = _calculer_stade_et_kc(jours_depuis_plantation)
    _ratio_drain = EC_DRAIN_RATIO_STADE.get(_stade_actuel, 1.65)

    donnees_tour = {
        "pct_drainage"          : pct_drainage,
        "ec_drainage"           : body.ec_drainage,
        "ph_drainage"           : body.ph_drainage,
        "num_tour"              : body.num_tour,
        "v_apport"              : v_apport,
        "_pct_drain_prev"       : pct_lag1 or 0.0,
        "pct_drainage_lag1"     : pct_lag1 or 0.0,
        "pct_drainage_lag2"     : pct_lag2 or 0.0,
        "pct_drainage_lag3"     : pct_lag3 or 0.0,
        "ec_drainage_lag1"      : ec_lag1 or 0.0,
        "ec_drainage_lag2"      : ec_lag2 or 0.0,
        "opt_vol_cumule_L"      : vol_cumule,
        "opt_vol_jour_cible_L"  : vol_jour_cible,
        "opt_EC_drain_cible_dSm": ec_cible * _ratio_drain,
        "opt_nb_cycles"         : nb_tours_cible,
        "opt_max_cycles_stade"  : max_cycles_stade,
        "ec_bassin"             : cfg.ec_eau_brute,
        "ec_apport"             : tour_netafim.ec_apport,
        "ph_apport"             : tour_netafim.ph_apport,

        # Alertes "matin" — utilisées uniquement par les garde-fous déterministes
        "alerte_chergui"        : alerte_chergui_finale,
        "alerte_pluie"          : alerte_pluie_finale,
        "alerte_brouillard"     : alerte_brouillard_finale,

        "scenario_meteo"        : rec.scenario_meteo if rec else "2_ENSOLEILLE",
        "mois"                  : today.month,
        "heure_debut"           : body.donnees_supplementaires.get("heure_debut"),

        # ── Météo "ACTUELLE" (heure de fin du tour) + alertes _actuel — modèle ML v7.x ──
        **meteo_actuel,

        **body.donnees_supplementaires,
    }

    resultat = generer_decision_tour(body.device_id, donnees_tour, date_cible=today)

    if "erreur" in resultat and "disponible" not in resultat:
        raise HTTPException(status_code=500, detail=resultat["erreur"])

    # ── Upsert en BDD (créer ou mettre à jour) ──
    existing = db.query(AIDecisionTour).filter(
        AIDecisionTour.device_id == body.device_id,
        AIDecisionTour.date      == today,
        AIDecisionTour.num_tour  == body.num_tour,
    ).first()

    decision_ml = resultat.get("decision", {}) if isinstance(resultat.get("decision"), dict) else resultat

    # Calculer heure_debut_tour_suivante = heure_fin_tour + repos_predicte
    heure_debut_tour_suivante = None
    if tour_netafim and tour_netafim.fin:
        repos = decision_ml.get("repos_min") or 0
        from datetime import timedelta
        heure_fin_dt = tour_netafim.fin
        heure_suivante_dt = heure_fin_dt + timedelta(minutes=repos)
        heure_debut_tour_suivante = heure_suivante_dt.strftime("%H:%M")

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
            "action"             : decision_ml.get("decision", "CONTINUER"),
            "raison"             : decision_ml.get("raison", ""),
            "raison_detail"      : decision_ml.get("raison_detail"),
            "source_decision"    : decision_ml.get("source_decision"),
            "duree_suivant"      : decision_ml.get("duree_tour_suivant_min"),
            "repos_min"          : decision_ml.get("repos_min"),
            "message"            : decision_ml.get("message_operateur") or decision_ml.get("raison_detail") or "",
            "heure_debut_tour_suivante": heure_debut_tour_suivante,
            "stade_info"         : {
                "jours_depuis_plantation": jours_depuis_plantation,
                "max_cycles_stade"       : max_cycles_stade,
            },
            "avertissements": avertissements,
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

    # ── Bilan volume du jour : réalisé (Netafim) vs cible (reco matin) ──
    v_apport_total_jour = sum(t.v_apport or 0.0 for t in tours_netafim)

    rec_matin = db.query(AIRecommandation).filter(
        AIRecommandation.device_id == device_id,
        AIRecommandation.date      == target_date,
    ).first()

    volume_cc_cible       = rec_matin.volume_cc_goutteur if rec_matin else None
    quantite_eau_mm_cible = rec_matin.quantite_eau_mm    if rec_matin else None

    taux_realisation_pct = None
    if volume_cc_cible and volume_cc_cible > 0:
        taux_realisation_pct = round((v_apport_total_jour / volume_cc_cible) * 100, 1)

    return {
        "device_id"   : device_id,
        "farm_name"   : device.farm_name,
        "house_number": device.house_number,
        "date"        : target_date,
        "decisions"   : result,
        "tours_netafim": tours_sans_decision,
        "bilan_volume_jour": {
            "v_apport_total_cc"    : round(v_apport_total_jour),
            "volume_cible_cc"      : volume_cc_cible,
            "quantite_eau_mm_cible": quantite_eau_mm_cible,
            "taux_realisation_pct" : taux_realisation_pct,
            "nb_tours_realises"    : len(tours_netafim),
        },
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
                ec_bassin       = cfg.ec_eau_brute,
                date_plantation = str(cfg.date_plantation) if cfg.date_plantation else None,
                lat             = cfg.latitude,
                lon             = cfg.longitude,
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
