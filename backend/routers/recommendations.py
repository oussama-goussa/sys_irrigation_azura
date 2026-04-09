# ============================================================
# backend/routers/recommendations.py — API Recommandations
# ============================================================

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from typing import Optional
from loguru import logger
from core.utils import filter_by_farm

from core.security import require_operateur, require_any
from services.recommendation_engine import generer_recommandation_complete
from services.meteo_service import get_meteo_journee
from services.ec_ph import ajuster_cycle_suivant

router = APIRouter(prefix="/api/recommendations", tags=["Recommandations IA"])


# ── Schemas ───────────────────────────────────────────────────
class CycleSuivantRequest(BaseModel):
    ec_drain_reel    : float = 3.5
    pct_drainage_reel: float = 18.0
    volume_actuel_l  : float = 150.0
    ec_drain_cible   : float = 2.5


# ── GET /api/recommendations/journee ─────────────────────────
@router.get("/journee")
def recommandation_journee(
    # Paramètres agronomiques
    stade            : Optional[str]   = Query("floraison", description="Stade phenologique"),
    date_plantation  : Optional[str]   = Query(None,        description="Date plantation YYYY-MM-DD"),
    ec_eau_brute     : float           = Query(0.8,         description="EC eau brute dS/m"),
    # Paramètres manuels optionnels (si pas Open-Meteo)
    temperature      : Optional[float] = Query(None),
    humidite         : Optional[float] = Query(None),
    rs_wm2           : Optional[float] = Query(None),
    vent             : Optional[float] = Query(None),
    pluie_mm         : Optional[float] = Query(None),
    vpd              : Optional[float] = Query(None),
    # Forcer les paramètres manuels (ignorer Open-Meteo)
    manuel           : bool            = Query(False, description="Forcer parametres manuels"),
    # Auth
    user = Depends(require_operateur)
):
    """
    Génère la recommandation complète d'irrigation pour la journée.

    **Par défaut** : utilise Open-Meteo automatiquement (coordonnées Agadir Azura).

    **Avec manuel=true** : utilise les paramètres fournis (température, Rs, etc.).

    Retourne : heure démarrage, nb cycles, durée, pause, volumes, NPK canaux Netafim.
    """
    logger.info(f"Recommandation demandee par {user['username']} | stade={stade} | manuel={manuel}")

    result = generer_recommandation_complete(
        stade                = stade,
        date_plantation      = date_plantation,
        ec_eau_brute         = ec_eau_brute,
        temperature          = temperature,
        humidite             = humidite,
        rs_wm2               = rs_wm2,
        vent                 = vent,
        pluie_mm             = pluie_mm,
        vpd                  = vpd,
        forcer_meteo_manuelle= manuel,
    )

    result["demande_par"] = user["username"]
    result["role"]        = user["role"]
    return result


# ── GET /api/recommendations/meteo ───────────────────────────
@router.get("/meteo")
def meteo_actuelle(
    force: bool = Query(False, description="Forcer rechargement Open-Meteo"),
    user = Depends(require_any)
):
    """
    Retourne les données météo actuelles depuis Open-Meteo.
    Utile pour afficher la météo temps réel sur le dashboard.
    """
    meteo = get_meteo_journee(force_refresh=force)
    return meteo


# ── POST /api/recommendations/cycle-suivant ───────────────────
@router.post("/cycle-suivant")
def cycle_suivant(
    request: CycleSuivantRequest,
    user = Depends(require_operateur)
):
    """
    Calcule les ajustements pour le cycle suivant.

    Basé sur les mesures réelles du cycle précédent :
    EC drain, % drainage, volume donné.

    Retourne : volume ajusté, facteur NPK, décision continuer/arrêter.
    """
    result = ajuster_cycle_suivant(
        ec_drain_reel      = request.ec_drain_reel,
        pct_drainage_reel  = request.pct_drainage_reel,
        volume_actuel_l    = request.volume_actuel_l,
        ec_drain_cible     = request.ec_drain_cible,
    )
    result["calcule_par"] = user["username"]
    return result


# ── GET /api/recommendations/scenarios ───────────────────────
@router.get("/scenarios")
def liste_scenarios(user = Depends(require_any)):
    """
    Retourne la description des 7 scénarios météo supportés.
    Utile pour la documentation et le dashboard.
    """
    return {
        "scenarios": [
            {
                "id"         : "ensoleille",
                "description": "Journée très ensoleillée",
                "conditions" : "Rs > 600 W/m², T > 22°C",
                "cycles"     : "10 à 14",
                "ec_cible"   : "2.0 - 2.5 dS/m",
                "demarrage"  : "08:00 - 08:30",
            },
            {
                "id"         : "nuageux",
                "description": "Journée nuageuse",
                "conditions" : "Rs 300-600 W/m²",
                "cycles"     : "5 à 9",
                "ec_cible"   : "2.5 - 3.0 dS/m",
                "demarrage"  : "09:00 - 09:30",
            },
            {
                "id"         : "brouillard",
                "description": "Brouillard matinal",
                "conditions" : "HR > 90%, Rs < 50 W/m² à 06h",
                "cycles"     : "2 à 4",
                "ec_cible"   : "3.2 - 3.5 dS/m",
                "demarrage"  : "10:30 - 11:00 (retardé)",
            },
            {
                "id"         : "hiver_clair",
                "description": "Hiver clair",
                "conditions" : "T < 15°C matin, Rs moyen",
                "cycles"     : "4 à 7",
                "ec_cible"   : "2.8 - 3.2 dS/m",
                "demarrage"  : "09:30 - 10:30",
            },
            {
                "id"         : "hiver_nuageux",
                "description": "Hiver nuageux (critique)",
                "conditions" : "T < 15°C ET Rs < 200 W/m²",
                "cycles"     : "2 à 4",
                "ec_cible"   : "3.5 dS/m",
                "demarrage"  : "11:00 - 12:00",
            },
            {
                "id"         : "chergui",
                "description": "Vent chaud Chergui",
                "conditions" : "T > 35°C ET VPD > 2.5 kPa",
                "cycles"     : "12 à 16 (URGENT)",
                "ec_cible"   : "1.8 - 2.2 dS/m",
                "demarrage"  : "07:00 (immédiat)",
            },
            {
                "id"         : "pluie",
                "description": "Pluie détectée",
                "conditions" : "Pluviomètre > 0.5 mm/h",
                "cycles"     : "STOP",
                "ec_cible"   : "—",
                "demarrage"  : "Reprise 2h après arrêt pluie",
            },
        ]
    }


# ── GET /api/recommendations/stades ──────────────────────────
@router.get("/stades")
def liste_stades(user = Depends(require_any)):
    """
    Retourne les coefficients Kc et paramètres par stade phénologique.
    Source : INRA Maroc — Tomate cerise sous serre Agadir.
    """
    return {
        "stades": [
            { "id": "vegetatif",     "jours": "0-30",    "kc": 0.45, "ec_drain_cible": 2.0, "ratio_kn": 0.42 },
            { "id": "developpement", "jours": "31-60",   "kc": 0.80, "ec_drain_cible": 2.3, "ratio_kn": 0.60 },
            { "id": "floraison",     "jours": "61-90",   "kc": 1.15, "ec_drain_cible": 2.5, "ratio_kn": 0.80 },
            { "id": "grossissement", "jours": "91-120",  "kc": 1.10, "ec_drain_cible": 2.8, "ratio_kn": 1.20 },
            { "id": "recolte",       "jours": "121-150+","kc": 0.85, "ec_drain_cible": 3.2, "ratio_kn": 2.00 },
        ]
    }