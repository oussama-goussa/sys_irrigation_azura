"""
╔══════════════════════════════════════════════════════════════════════════════╗
║   FUSION CSV IRRIGATION + DONNÉES MÉTÉO COMPLÈTES — BELFAA / AGADIR          ║
║   Groupe Azura — Tomate Cerise sous Serre — Souss-Massa, Maroc               ║
╠══════════════════════════════════════════════════════════════════════════════╣
║  API : Open-Meteo Historical Archive (GRATUITE — sans clé API)               ║
║  Station : Belfaa/Agadir  Lat=30.40°N  Lon=-9.57°E  Alt=15m                  ║
╠══════════════════════════════════════════════════════════════════════════════╣
║  SCÉNARIOS MÉTÉO Agadir/Belfaa (v7.0 — réalistes pour la région) :           ║
║    1. Très ensoleillé   (Rs > 800 W/m²) — été, soleil tôt                    ║
║    2. Ensoleillé        (Rs > 400 W/m²) — normal, brouillard brûle vite     ║
║    3. Brouillard matin  (HR > 90% matin) — hiver, soleil après 10-11h       ║
║    4. CHERGUI URGENT    (T > 35°C ET VPD > 2.5 kPa)                         ║
║    (+) Pluie STOP       (> 1.5mm + 1h pluie)                                ║
║    (+) Pluie légère     (bruine 0.5-5mm)                                    ║
║  NOTE: 3_NUAGEUX et 4_TRES_NUAGEUX supprimés — n'existent pas à Agadir      ║
╠══════════════════════════════════════════════════════════════════════════════╣
║  COLONNES MÉTÉO AJOUTÉES :                                                   ║
║  Température, Humidité, Rayonnement, Précipitations, Vent, ET0 FAO-56,       ║
║  VPD, Couverture nuageuse, Évaporation, Pression, Point de rosée             ║
╠══════════════════════════════════════════════════════════════════════════════╣
║  Usage :                                                                     ║
║    pip install pandas requests tqdm                                          ║
║    python fusion_irrigation_meteo_complet.py                                 ║
║  Sortie : irrigation_meteo_complet.csv                                       ║
╚══════════════════════════════════════════════════════════════════════════════╝
"""

import sys
import io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

import pandas as pd
import requests
import time
import math
from pathlib import Path
from tqdm import tqdm

# ═══════════════════════════════════════════════════════════════
# CONFIGURATION
# ═══════════════════════════════════════════════════════════════

CSV_FILES = [
    "tour_irrigation_2021_2022.csv",
    "tour_irrigation_2022_2023.csv",
    "tour_irrigation_2023_2024.csv",
    "tour_irrigation_2024_2025.csv",
]

OUTPUT_FILE = "irrigation_meteo_complet.csv"

# Coordonnées Inchaden, Belfaa — Agadir, Souss-Massa
LAT      = 30.105
LON      = -9.564
TIMEZONE = "Africa/Casablanca"

# ─── Variables météo HORAIRES (pour brouillard + VPD précis matin/soir) ───
HOURLY_VARS = [
    "temperature_2m",               # °C — température horaire
    "relative_humidity_2m",         # % — HR horaire
    "apparent_temperature",         # °C — température ressentie
    "precipitation",                # mm — précipitations horaires
    "rain",                         # mm — pluie horaire (hors neige)
    "cloudcover",                   # % — couverture nuageuse
    "windspeed_10m",                # km/h — vitesse vent
    "winddirection_10m",            # ° — direction vent
    "shortwave_radiation",          # W/m² — rayonnement solaire horaire
    "direct_radiation",             # W/m² — rayonnement direct
    "diffuse_radiation",            # W/m² — rayonnement diffus
    "vapour_pressure_deficit",      # kPa — VPD horaire (Chergui)
    "dewpoint_2m",                  # °C — point de rosée
    "surface_pressure",             # hPa — pression atmosphérique
    "et0_fao_evapotranspiration",   # mm — ET0 FAO-56 horaire
    "soil_temperature_0cm",         # °C — température sol surface
    "soil_moisture_0_to_1cm",       # m³/m³ — humidité sol surface
]

# ─── Variables météo JOURNALIÈRES ───
DAILY_VARS = [
    "temperature_2m_max",               # °C — T max journalière
    "temperature_2m_min",               # °C — T min journalière
    "temperature_2m_mean",              # °C — T moyenne journalière
    "apparent_temperature_max",         # °C — T ressentie max
    "apparent_temperature_min",         # °C — T ressentie min
    "precipitation_sum",                # mm — précipitations totales journalières
    "rain_sum",                         # mm — pluie totale journalière
    "precipitation_hours",             # h — nb heures avec précipitations
    "windspeed_10m_max",               # km/h — vent max journalier
    "windgusts_10m_max",               # km/h — rafales max
    "winddirection_10m_dominant",      # ° — direction dominante du vent
    "shortwave_radiation_sum",          # MJ/m² — rayonnement solaire total journalier
    "et0_fao_evapotranspiration",       # mm — ET0 FAO-56 journalière
    "sunrise",                          # ISO — heure lever soleil
    "sunset",                           # ISO — heure coucher soleil
    "daylight_duration",                # s — durée ensoleillement
    "sunshine_duration",                # s — durée soleil effectif
    "relative_humidity_2m_max",         # % — HR max
    "relative_humidity_2m_min",         # % — HR min
    "relative_humidity_2m_mean",        # % — HR moyenne
    "vapour_pressure_deficit_max",      # kPa — VPD max (alerte Chergui)
    "dewpoint_2m_min",                  # °C — point rosée minimum
    "surface_pressure_max",             # hPa — pression max
    "surface_pressure_min",             # hPa — pression min
    "cloudcover_mean",                  # % — couverture nuageuse moyenne
    "soil_temperature_0_to_7cm_mean",   # °C — température sol 0-7cm
    "soil_moisture_0_to_7cm_mean",      # m³/m³ — humidité sol 0-7cm
]


# ═══════════════════════════════════════════════════════════════
# 1. FUSION DES 4 CSV
# ═══════════════════════════════════════════════════════════════

def fusionner_csv(fichiers):
    print("\n" + "─" * 60)
    print("  ÉTAPE 1 : Fusion des CSV irrigation")
    print("─" * 60)

    dfs = []
    for f in fichiers:
        path = Path(f)
        if not path.exists():
            print(f"  ⚠ Introuvable : {f} — ignoré")
            continue
        df = pd.read_csv(f, low_memory=False, encoding="utf-8-sig")
        df["saison"] = path.stem.replace("tour_irrigation_", "")
        dfs.append(df)
        print(f"  ✓ {f:<40} {len(df):>6} lignes")

    fusionne = pd.concat(dfs, ignore_index=True)
    fusionne["date"] = pd.to_datetime(fusionne["date"], errors="coerce", dayfirst=False)
    cols_tri = ["date"] + [c for c in ["bloc", "serre", "num_tour"] if c in fusionne.columns]
    fusionne = fusionne.dropna(subset=["date"]).sort_values(cols_tri).reset_index(drop=True)

    # ═════════════════════════════════════════════════════════════════
    # LOGIQUE NETAJET : CALCUL DE L'HEURE DE FIN RÉELLE (x2)
    # ═════════════════════════════════════════════════════════════════
    print("\n  [IA] Calcul des horaires de fin de tour (Logique NetaJet x2)...")
    
    try:
        # 1. Crée un format combiné Date + Heure de Début
        fusionne['datetime_debut'] = pd.to_datetime(
            fusionne['date'].dt.strftime('%Y-%m-%d') + ' ' + fusionne['heure_debut'].astype(str),
            errors='coerce'
        )
        
        # 2. Ajoute (duree_min * 2) minutes pour obtenir l'heure de fin réelle du cycle complet
        # Note : Modifiez 'duree_min' par le nom exact de votre colonne si nécessaire
        fusionne['datetime_fin'] = fusionne['datetime_debut'] + pd.to_timedelta(fusionne['duree_min'] * 2, unit='m')
        
        # 3. Extraction en texte "HH:MM" pour affichage ou vérification rapide
        fusionne['heure_fin'] = fusionne['datetime_fin'].dt.strftime('%H:%M')
        
        print("  ✅ Colonnes 'datetime_debut', 'datetime_fin' et 'heure_fin' générées.")
    except Exception as e:
        print(f"  ⚠ Erreur lors du calcul de heure_fin : {e}")
        print("  Assurez-vous que les colonnes 'heure_debut' et 'duree_min' existent dans vos CSV.")
    # ═════════════════════════════════════════════════════════════════

    print(f"\n  → Total fusionné : {len(fusionne):,} lignes")
    print(f"  → Période        : {fusionne['date'].min().date()} → {fusionne['date'].max().date()}")
    print(f"  → Colonnes       : {fusionne.shape[1]}")
    return fusionne


# ═══════════════════════════════════════════════════════════════
# 2. TÉLÉCHARGEMENT MÉTÉO — OPEN-METEO API
# ═══════════════════════════════════════════════════════════════

def appel_api(url, params, tentatives=5):
    for i in range(tentatives):
        try:
            r = requests.get(url, params=params, timeout=45)
            r.raise_for_status()
            return r.json()
        except Exception as e:
            if i == tentatives - 1:
                print(f"\n  ✗ Erreur API après {tentatives} tentatives : {e}")
                return None
            wait = 5 * (i + 1)   # attente progressive : 5s, 10s, 15s...
            print(f"\n  ⚠ Tentative {i+1} échouée — attente {wait}s...")
            time.sleep(wait)


def telecharger_meteo_journaliere(date_debut, date_fin):
    """Récupère les données météo journalières (Open-Meteo Archive)."""
    print("\n  [Daily] Téléchargement données journalières...")
    url = "https://archive-api.open-meteo.com/v1/archive"

    # Découpage par tranches de 1 an
    periodes = []
    start = pd.Timestamp(date_debut)
    end   = pd.Timestamp(date_fin)
    while start <= end:
        chunk_end = min(start + pd.DateOffset(days=180), end)
        periodes.append((start.strftime("%Y-%m-%d"), chunk_end.strftime("%Y-%m-%d")))
        start = chunk_end + pd.Timedelta(days=1)

    all_chunks = []
    for d_start, d_end in tqdm(periodes, desc="  Daily API"):
        params = {
            "latitude":   LAT,
            "longitude":  LON,
            "start_date": d_start,
            "end_date":   d_end,
            "daily":      ",".join(DAILY_VARS),
            "timezone":   TIMEZONE,
        }
        data = appel_api(url, params)
        if data and "daily" in data:
            df = pd.DataFrame(data["daily"])
            df["date"] = pd.to_datetime(df["time"])
            df = df.drop(columns=["time"])
            all_chunks.append(df)
        time.sleep(0.5)

    if not all_chunks:
        return pd.DataFrame()

    meteo_daily = pd.concat(all_chunks, ignore_index=True)
    meteo_daily = meteo_daily.drop_duplicates(subset="date").sort_values("date")

    # Préfixe pour éviter conflits avec colonnes irrigation
    cols_rename = {c: f"meteo_{c}" for c in meteo_daily.columns if c != "date"}
    meteo_daily = meteo_daily.rename(columns=cols_rename)

    print(f"  → {len(meteo_daily)} jours téléchargés — {len(meteo_daily.columns)-1} variables daily")
    return meteo_daily


def telecharger_meteo_horaire(date_debut, date_fin):
    """
    Récupère les données horaires et les agrège par jour.
    Calcule les indicateurs spéciaux : brouillard matin, Rs en W/m², VPD matin.
    """
    print("\n  [Hourly] Téléchargement données horaires (agrégation journalière)...")
    url = "https://archive-api.open-meteo.com/v1/archive"

    # Découpage par tranches de 3 mois (données horaires = plus lourd)
    periodes = []
    start = pd.Timestamp(date_debut)
    end   = pd.Timestamp(date_fin)
    while start <= end:
        chunk_end = min(start + pd.DateOffset(days=89), end)
        periodes.append((start.strftime("%Y-%m-%d"), chunk_end.strftime("%Y-%m-%d")))
        start = chunk_end + pd.Timedelta(days=1)

    all_hourly = []
    for d_start, d_end in tqdm(periodes, desc="  Hourly API"):
        params = {
            "latitude":   LAT,
            "longitude":  LON,
            "start_date": d_start,
            "end_date":   d_end,
            "hourly":     ",".join(HOURLY_VARS),
            "timezone":   TIMEZONE,
        }
        data = appel_api(url, params)
        if data and "hourly" in data:
            df = pd.DataFrame(data["hourly"])
            df["datetime"] = pd.to_datetime(df["time"])
            df = df.drop(columns=["time"])
            all_hourly.append(df)
        time.sleep(0.5)

    if not all_hourly:
        print("  ⚠ Aucune donnée horaire récupérée.")
        return pd.DataFrame()

    hourly = pd.concat(all_hourly, ignore_index=True)
    hourly["date"] = hourly["datetime"].dt.normalize()
    hourly["heure"] = hourly["datetime"].dt.hour

    # ─── Agrégation journalière des données horaires ───
    agg = {}

    # Rayonnement solaire Rs en W/m² (max journalier — pour classification scénario)
    agg["rs_wm2_max_jour"]   = hourly.groupby("date")["shortwave_radiation"].max()
    agg["rs_wm2_mean_jour"]  = hourly.groupby("date")["shortwave_radiation"].mean()

    # VPD journalier
    agg["vpd_max_jour"]  = hourly.groupby("date")["vapour_pressure_deficit"].max()
    agg["vpd_mean_jour"] = hourly.groupby("date")["vapour_pressure_deficit"].mean()

    # Température (horaire → journalier)
    agg["t_max_horaire"]  = hourly.groupby("date")["temperature_2m"].max()
    agg["t_min_horaire"]  = hourly.groupby("date")["temperature_2m"].min()
    agg["t_mean_horaire"] = hourly.groupby("date")["temperature_2m"].mean()

    # Humidité relative
    agg["hr_max_horaire"]  = hourly.groupby("date")["relative_humidity_2m"].max()
    agg["hr_min_horaire"]  = hourly.groupby("date")["relative_humidity_2m"].min()
    agg["hr_mean_horaire"] = hourly.groupby("date")["relative_humidity_2m"].mean()

    # Brouillard matin : HR matin (6h-10h) > 90% (indicateur clé Agadir hiver)
    matin = hourly[hourly["heure"].between(6, 10)]
    agg["hr_matin_6h_10h_mean"] = matin.groupby("date")["relative_humidity_2m"].mean()
    agg["hr_matin_max"]         = matin.groupby("date")["relative_humidity_2m"].max()
    # Nombre d'heures matin avec HR > 90%
    matin_brouillard = matin[matin["relative_humidity_2m"] > 90]
    agg["nb_heures_brouillard_matin"] = matin_brouillard.groupby("date")["relative_humidity_2m"].count()

    agg["rs_wm2_matin_6h_10h_mean"] = matin.groupby("date")["shortwave_radiation"].mean()
    
    # Pluie horaire
    agg["pluie_max_horaire_mm"]     = hourly.groupby("date")["precipitation"].max()
    agg["nb_heures_pluie"]          = (hourly[hourly["precipitation"] > 0.5]
                                        .groupby("date")["precipitation"].count())

    # Vent sur la maison plastique (indicateur Chergui > 3 m/s = 10.8 km/h)
    agg["vent_max_kmh"]  = hourly.groupby("date")["windspeed_10m"].max()
    agg["vent_mean_kmh"] = hourly.groupby("date")["windspeed_10m"].mean()

    # ET0 horaire → somme journalière (mm/jour)
    agg["et0_horaire_sum"] = hourly.groupby("date")["et0_fao_evapotranspiration"].sum()

    # Couverture nuageuse
    agg["cloudcover_mean_horaire"] = hourly.groupby("date")["cloudcover"].mean()
    agg["cloudcover_max_horaire"]  = hourly.groupby("date")["cloudcover"].max()

    # Point de rosée
    agg["dewpoint_mean"] = hourly.groupby("date")["dewpoint_2m"].mean()
    agg["dewpoint_min"]  = hourly.groupby("date")["dewpoint_2m"].min()

    # Pression atmosphérique (kPa — pour Penman-Monteith ; Agadir ≈ 100.8 kPa)
    agg["pression_hpa_mean"] = hourly.groupby("date")["surface_pressure"].mean()

    # Humidité sol
    agg["humidite_sol_mean"] = hourly.groupby("date")["soil_moisture_0_to_1cm"].mean()

    # Compilation
    df_agg = pd.DataFrame(agg).reset_index()
    df_agg["date"] = pd.to_datetime(df_agg["date"])

    # Remplir NaN pour nb_heures_brouillard et nb_heures_pluie (= 0 si aucun)
    df_agg["nb_heures_brouillard_matin"] = df_agg["nb_heures_brouillard_matin"].fillna(0)
    df_agg["nb_heures_pluie"]            = df_agg["nb_heures_pluie"].fillna(0)

    # Préfixe
    cols_rename = {c: f"meteo_{c}" for c in df_agg.columns if c != "date"}
    df_agg = df_agg.rename(columns=cols_rename)

    print(f"  → {len(df_agg)} jours agrégés — {len(df_agg.columns)-1} variables horaires")

    # ─── Données horaires BRUTES (pour récupération météo au moment "datetime_fin") ───
    hourly_brut = hourly[["datetime"] + HOURLY_VARS].copy()
    cols_rename_brut = {c: f"meteo_actuel_{c}" for c in HOURLY_VARS}
    hourly_brut = hourly_brut.rename(columns=cols_rename_brut)
    print(f"  → {len(hourly_brut)} heures brutes conservées pour jointure 'datetime_fin'")

    return df_agg, hourly_brut


# ═══════════════════════════════════════════════════════════════
# 3. COLONNES DÉRIVÉES AGRONOMIQUES (calculées après jointure)
# ═══════════════════════════════════════════════════════════════

def calculer_colonnes_derivees(df):
    """
    Calcule toutes les variables agronomiques dérivées :
    - Classification scénario météo (6 scénarios Azura)
    - Alertes Chergui, brouillard, pluie
    - Rayonnement converti W/m² → J/cm²
    - Nb cycles recommandé selon scénario
    - EC cible recommandée selon scénario
    """

    # ── Conversion rayonnement W/m² → J/cm² (pour déclenchement RadS)
    # Rs (W/m²) x 0.0036 = MJ/m²/h ; Rs (MJ/m²/j) x 10 000 / 10 000 = J/cm²
    # Formule : Rs_Jcm2 = Rs_Wm2_max * 3600 / 10000 (approximation pic journalier)
    if "meteo_rs_wm2_max_jour" in df.columns:
        df["meteo_rs_wm2_max_jour"] = df["meteo_rs_wm2_max_jour"].fillna(0)

    if "meteo_shortwave_radiation_sum" in df.columns:
        df["meteo_rs_total_Jcm2"] = df["meteo_shortwave_radiation_sum"] * 100
    elif "meteo_rs_wm2_max_jour" in df.columns:
        df["meteo_rs_total_Jcm2"] = df["meteo_rs_wm2_max_jour"] * 0.0864 * 10

    # ── Pression atmosphérique kPa (Agadir ≈ 100.8 kPa)
    if "meteo_pression_hpa_mean" in df.columns:
        df["meteo_pression_kPa"] = df["meteo_pression_hpa_mean"] / 10.0
    else:
        df["meteo_pression_kPa"] = 100.8

    # ── Pression atmosphérique ACTUELLE (au moment datetime_fin, hPa → kPa)
    if "meteo_actuel_surface_pressure" in df.columns:
        df["meteo_pression_actuelle_kPa"] = df["meteo_actuel_surface_pressure"] / 10.0
    else:
        df["meteo_pression_actuelle_kPa"] = float("nan")

    # ── Rayonnement solaire ACTUEL (Rs en W/m² au moment datetime_fin)
    if "meteo_actuel_shortwave_radiation" in df.columns:
        df["meteo_rs_wm2_actuel"] = df["meteo_actuel_shortwave_radiation"]
    else:
        df["meteo_rs_wm2_actuel"] = float("nan")

    # ── VPD consolidé (priorité données horaires > données daily)
    if "meteo_vpd_max_jour" in df.columns:
        df["meteo_VPD_max_kPa"] = df["meteo_vpd_max_jour"]
    elif "meteo_vapour_pressure_deficit_max" in df.columns:
        df["meteo_VPD_max_kPa"] = df["meteo_vapour_pressure_deficit_max"]
    else:
        df["meteo_VPD_max_kPa"] = float("nan")

    # ── T consolidée
    for src, dst in [
        ("meteo_t_max_horaire",   "meteo_T_max_C"),
        ("meteo_t_min_horaire",   "meteo_T_min_C"),
        ("meteo_t_mean_horaire",  "meteo_T_mean_C"),
    ]:
        fallback_map = {
            "meteo_T_max_C":  "meteo_temperature_2m_max",
            "meteo_T_min_C":  "meteo_temperature_2m_min",
            "meteo_T_mean_C": "meteo_temperature_2m_mean",
        }
        if src in df.columns:
            df[dst] = df[src]
        elif fallback_map[dst] in df.columns:
            df[dst] = df[fallback_map[dst]]

    # ── HR consolidée
    for src, dst in [
        ("meteo_hr_max_horaire",  "meteo_HR_max_pct"),
        ("meteo_hr_min_horaire",  "meteo_HR_min_pct"),
        ("meteo_hr_mean_horaire", "meteo_HR_mean_pct"),
    ]:
        fallback_map = {
            "meteo_HR_max_pct":  "meteo_relative_humidity_2m_max",
            "meteo_HR_min_pct":  "meteo_relative_humidity_2m_min",
            "meteo_HR_mean_pct": "meteo_relative_humidity_2m_mean",
        }
        if src in df.columns:
            df[dst] = df[src]
        elif fallback_map[dst] in df.columns:
            df[dst] = df[fallback_map[dst]]

    # ── Précipitations consolidées
    if "meteo_precipitation_sum" in df.columns:
        df["meteo_pluie_mm_jour"] = df["meteo_precipitation_sum"].fillna(0)
    elif "meteo_rain_sum" in df.columns:
        df["meteo_pluie_mm_jour"] = df["meteo_rain_sum"].fillna(0)
    else:
        df["meteo_pluie_mm_jour"] = 0.0

    # ── ET0 consolidée
    if "meteo_et0_horaire_sum" in df.columns:
        df["meteo_ET0_mm_jour"] = df["meteo_et0_horaire_sum"]
    elif "meteo_et0_fao_evapotranspiration" in df.columns:
        df["meteo_ET0_mm_jour"] = df["meteo_et0_fao_evapotranspiration"]

    # ════════════════════════════════════════════════════
    # CLASSIFICATION DES 6 SCÉNARIOS + PLUIE (Azura §4.2)
    # ════════════════════════════════════════════════════

    def classer_scenario(row):
        """
        Classifie la journée selon les 7 scénarios du rapport Azura
        (tableau 9 — §4.2 Volume journalier et nombre de cycles).
        Priorité : Chergui > Pluie > Brouillard > Ensoleillement
        """
        rs    = row.get("meteo_rs_wm2_max_jour",  row.get("meteo_shortwave_radiation_sum", 0) or 0)
        vpd   = row.get("meteo_VPD_max_kPa",       0) or 0
        t_max = row.get("meteo_T_max_C",           0) or 0
        pluie = row.get("meteo_pluie_mm_jour",     0) or 0
        hr_matin_max = row.get("meteo_hr_matin_max",
                               row.get("meteo_HR_max_pct", 0)) or 0

        # Si shortwave_radiation_sum (MJ/m²), convertir en W/m² approximatif
        if rs < 50 and "meteo_shortwave_radiation_sum" in row.index:
            rs_mj = row.get("meteo_shortwave_radiation_sum", 0) or 0
            rs = rs_mj * 1000 / 24 * 3.6   # approximation W/m² pic

        # Priorité 1 : Chergui (urgence absolue)
        if t_max > 35 and vpd > 2.5:
            return "6_CHERGUI_URGENT"

        # Priorité 2 : Pluie — 2 NIVEAUX (calibré terrain Azura 4 saisons)
        #
        # PROBLÈME IDENTIFIÉ : Open-Meteo agrège bruine/rosée/condensation.
        # Seuil 0.5mm → 90.9% de faux positifs (agents irriguent normalement).
        # Calibration terrain (88 jours PLUIE, 4 saisons 2021-2025) :
        #   Vrai stop irrigation = pluie > 1.5mm ET nb_heures_pluie >= 1
        #   Pluie légère (bruine) = pluie 0.5-5mm mais nb_heures = 0
        #   (source : meteo_nb_heures_pluie = heures avec >0.5mm/h horaire)
        #
        nb_heures_pluie = row.get("meteo_nb_heures_pluie", 0) or 0
        pluie_max_h     = row.get("meteo_pluie_max_horaire_mm", 0) or 0

        # Pluie RÉELLE (forte) : précipitation journalière > 5mm OU pic horaire > 1mm
        # → Agents stoppent réellement l'irrigation
        if pluie > 12.0 or (pluie > 1.5 and nb_heures_pluie >= 1):
            return "7_PLUIE_STOP"

        # Pluie LÉGÈRE (bruine/rosée Agadir) : 0.5-5mm sans heure franche
        # → Agents continuent d'irriguer (réduit EC, alerte seulement)
        if pluie > 0.5:
            return "7b_PLUIE_LEGERE"

        # Priorité 3 : Brouillard matinal (HR matin > 90%) — 5 sous-types
        if hr_matin_max > 90:
            cloud = row.get("meteo_cloudcover_mean_horaire", 30) or 30

            rs_matin = row.get("meteo_rs_wm2_matin_6h_10h_mean", 0) or 0
            if rs_matin > 300:  # Rs matin (6h-10h) > 300 W/m² = brouillard déjà dissipé
                pass  # → va vers la classification ensoleillement
            # FOG_CHAUD_VPD_ELEVE : brouillard + chaleur + VPD fort
            # → dissipe vite mais stress hydrique fort l'après-midi (quasi-Chergui)
            elif t_max > 26 and vpd > 1.5 and rs > 800:
                return "5b_FOG_CHAUD_VPD"
            # FOG_CHAUD_RS_FORT : brouillard matinal + soleil fort après levée
            # → se lève vers 09h-10h, journée ensoleillée ensuite
            elif t_max > 22 and rs > 850:
                return "5c_FOG_CHAUD_RS"
            # FOG_RADIATION : brouillard de radiation, ciel dégagé, Rs perce tôt
            # → se lève très vite (<09h), peu de nuages
            elif t_max <= 23 and cloud < 20 and rs > 800:
                return "5d_FOG_RADIATION"
            # FOG_FROID_PERSISTANT : T basse + HR très haute + couvert nuageux
            # → brouillard persiste parfois jusqu'à 12h, risque fongique élevé
            elif t_max <= 20 and hr_matin_max > 92 and cloud > 50:
                return "5e_FOG_FROID"
            # FOG_STANDARD : brouillard classique Agadir hiver (déc-mars)
            else:
                return "5_BROUILLARD_MATIN"

        # Priorité 3b : Nuageux chaud — Rs modéré MAIS T élevée + VPD fort
        # 86 jours terrain, comportement ≠ journée ensoleillée standard
        # Opérateur : 9 tours (vs 11), EC 2.6 (vs 2.0) — à ne pas confondre avec 2_ENSOLEILLE
        if 400 < rs <= 700 and t_max > 27 and vpd > 2.0:
            return "8_NUAGEUX_CHAUD"

        # Priorité 3c : Nuit froide + journée ensoleillée
        # Racines froides le matin → absorption lente → ET0 réelle faible malgré le soleil
        # 43 jours terrain : 7 tours, EC 3.0, ET0 médiane 2.77 mm/j
        if t_max > 18 and rs > 500 and row.get("meteo_T_min_C", 15) < 8:
            return "9_NUIT_FROIDE_SOL"

         # Priorité 4 : Ensoleillement
        # v7.0: Suppression 3_NUAGEUX et 4_TRES_NUAGEUX — n'existent pas à Agadir/Belfaa
        #   Agadir a 2 saisons réalistes: brouillard matin (hiver) ou soleil (été)
        #   Les jours rs 400-600 W/m² sont classés 2_ENSOLEILLE (comportement identique: ~10-11 tours)
        #   Les jours rs < 400 W/m² sont rarissimes (< 1%) et traités comme Brouillard persiste
        if rs > 800:
            return "1_TRES_ENSOLEILLE"
        elif rs > 400:
            return "2_ENSOLEILLE"
        else:
            # rs <= 400 W/m² : jour très couvert, souvent lié à brouillard persistant ou nuages épais
            # Classé comme BROUILLARD_MATIN car comportement similaire (peu de tours, EC élevée)
            return "5_BROUILLARD_MATIN"

    print("\n  Calcul des scénarios météo et colonnes agronomiques...")
    df["scenario_meteo"] = df.apply(classer_scenario, axis=1)

    # ── Nb cycles recommandé (tableau 9 Azura)
    # v7.0: Suppression 3_NUAGEUX et 4_TRES_NUAGEUX
    scenario_cycles = {
        "1_TRES_ENSOLEILLE":  "12-14",
        "2_ENSOLEILLE":       "10-12",
        "5_BROUILLARD_MATIN":  "2-4",
        "5b_FOG_CHAUD_VPD":   "9-11",
        "5c_FOG_CHAUD_RS":    "8-10",
        "5d_FOG_RADIATION":   "9-11",
        "5e_FOG_FROID":        "3-5",
        "6_CHERGUI_URGENT":   "14-16",
        "7_PLUIE_STOP":        "0 (STOP)",
        "7b_PLUIE_LEGERE":    "4-6 (alerte)",
        "8_NUAGEUX_CHAUD":     "8-10",
        "9_NUIT_FROIDE_SOL":   "6-8",
    }
    df["nb_cycles_recommande"] = df["scenario_meteo"].map(scenario_cycles)

    # ── EC cible recommandée selon scénario (dS/m)
    scenario_ec = {
        "1_TRES_ENSOLEILLE":  "2.0-2.5",
        "2_ENSOLEILLE":       "2.2-2.8",
        "5_BROUILLARD_MATIN": "2.8-3.2",
        "5b_FOG_CHAUD_VPD":   "2.2-2.8",
        "5c_FOG_CHAUD_RS":    "2.3-2.9",
        "5d_FOG_RADIATION":   "2.3-2.9",
        "5e_FOG_FROID":       "3.0-3.5",
        "6_CHERGUI_URGENT":   "1.8-2.2",
        "7_PLUIE_STOP":       "—",
        "7b_PLUIE_LEGERE":    "2.5-3.0",
        "8_NUAGEUX_CHAUD":    "2.6-3.1",
        "9_NUIT_FROIDE_SOL":  "2.8-3.2",
    }
    df["ec_cible_recommandee_dSm"] = df["scenario_meteo"].map(scenario_ec)

    # ── Heure démarrage recommandée
    scenario_heure = {
        "1_TRES_ENSOLEILLE":  "07:00",
        "2_ENSOLEILLE":       "08:00",
        "5_BROUILLARD_MATIN": "10:30-11:00",
        "5b_FOG_CHAUD_VPD":   "09:00",
        "5c_FOG_CHAUD_RS":    "09:20",
        "5d_FOG_RADIATION":   "08:40",
        "5e_FOG_FROID":       "11:00-11:30",
        "6_CHERGUI_URGENT":   "07:00 ALERTE",
        "7_PLUIE_STOP":       "STOP - reprise +2h",
        "7b_PLUIE_LEGERE":    "09:00 (alerte bruine)",
        "8_NUAGEUX_CHAUD":    "08:30",
        "9_NUIT_FROIDE_SOL":  "09:30",
    }
    df["heure_demarrage_recommandee"] = df["scenario_meteo"].map(scenario_heure)

    # ── Alertes binaires (0/1)
    df["alerte_chergui"]       = (df["scenario_meteo"] == "6_CHERGUI_URGENT").astype(int)
    df["alerte_pluie"]         = (df["scenario_meteo"] == "7_PLUIE_STOP").astype(int)
    df["alerte_pluie_legere"]  = (df["scenario_meteo"] == "7b_PLUIE_LEGERE").astype(int)
    FOG_ALL = {"5_BROUILLARD_MATIN","5b_FOG_CHAUD_VPD","5c_FOG_CHAUD_RS","5d_FOG_RADIATION","5e_FOG_FROID"}
    df["alerte_brouillard"] = df["scenario_meteo"].isin(FOG_ALL).astype(int)
    df["alerte_vpd_stress"]    = (df["meteo_VPD_max_kPa"].fillna(0) > 1.5).astype(int)
    df["alerte_vent"]    = (df.get("meteo_vent_max_kmh",
                                          df.get("meteo_windspeed_10m_max", 0)).fillna(0) > 10.8).astype(int)

    # ── Alertes ACTUELLES (0/1) — basées sur la météo RÉELLE au moment "datetime_fin"
    # Important : le scénario du jour (calculé sur max/moyenne journalière) peut différer
    # de la situation réelle à l'heure de fin du tour.
    # Ex : matin = brouillard (ضباب), mais le tour se termine après 12h → soleil normal.
    if "meteo_actuel_temperature_2m" in df.columns:
        t_act    = df["meteo_actuel_temperature_2m"]
        vpd_act  = df.get("meteo_actuel_vapour_pressure_deficit", pd.Series(0, index=df.index)).fillna(0)
        hr_act   = df.get("meteo_actuel_relative_humidity_2m",    pd.Series(0, index=df.index)).fillna(0)
        rs_act   = df.get("meteo_rs_wm2_actuel",                  pd.Series(0, index=df.index)).fillna(0)
        pluie_act = df.get("meteo_actuel_precipitation",          pd.Series(0, index=df.index)).fillna(0)
        vent_act  = df.get("meteo_actuel_windspeed_10m",          pd.Series(0, index=df.index)).fillna(0)

        # 1. Chergui actuel : T > 35°C ET VPD > 2.5 kPa à l'heure de fin
        df["alerte_chergui_actuel"] = ((t_act.fillna(0) > 35) & (vpd_act > 2.5)).astype(int)

        # 2. Pluie STOP actuelle : précipitation horaire > 1.5 mm
        df["alerte_pluie_actuel"] = (pluie_act > 1.5).astype(int)

        # 3. Pluie légère actuelle : bruine 0.1-1.5 mm
        df["alerte_pluie_legere_actuel"] = ((pluie_act > 0.1) & (pluie_act <= 1.5)).astype(int)

        # 4. Brouillard actuel : HR > 90% ET Rs encore faible (soleil pas encore levé/sorti)
        df["alerte_brouillard_actuel"] = ((hr_act > 90) & (rs_act < 300)).astype(int)

        # 5. Stress VPD actuel : VPD > 1.5 kPa à l'heure de fin
        df["alerte_vpd_stress_actuel"] = (vpd_act > 1.5).astype(int)

        # 6. Vent maison plastique actuel : vent > 10.8 km/h (3 m/s) à l'heure de fin
        # NB : tomates cerises sous maison plastique (tunnel film) — plus sensible au vent qu'une serre rigide
        df["alerte_vent_actuel"] = (vent_act > 10.8).astype(int)
    else:
        for c in ["alerte_chergui_actuel", "alerte_pluie_actuel", "alerte_pluie_legere_actuel",
                  "alerte_brouillard_actuel", "alerte_vpd_stress_actuel", "alerte_vent_actuel"]:
            df[c] = pd.NA


    # ── Seuil RadS par cycle (J/cm²) selon scénario
    # RadS_seuil = Rs_total_Jcm2 / Nb_cycles
    if "meteo_rs_total_Jcm2" in df.columns:
        nb_cycles_mid = {
            "1_TRES_ENSOLEILLE":  13,
            "2_ENSOLEILLE":       11,
            "5_BROUILLARD_MATIN":  8,
            "5b_FOG_CHAUD_VPD":   10,
            "5c_FOG_CHAUD_RS":     9,
            "5d_FOG_RADIATION":   10,
            "5e_FOG_FROID":        4,
            "6_CHERGUI_URGENT":   15,
            "7_PLUIE_STOP":        0,
            "7b_PLUIE_LEGERE":     5,
            "8_NUAGEUX_CHAUD":     9,
            "9_NUIT_FROIDE_SOL":   7,
        }
        df["_nb_cycles_mid"] = df["scenario_meteo"].map(nb_cycles_mid)
        df["meteo_RadS_seuil_Jcm2"] = df.apply(
            lambda r: round(r["meteo_rs_total_Jcm2"] / r["_nb_cycles_mid"], 1)
                      if r["_nb_cycles_mid"] > 0 else 0,
            axis=1
        )
        df = df.drop(columns=["_nb_cycles_mid"])

    # ── Fraction lessivage recommandée (tableau 8 Azura)
    if "ec_bassin" in df.columns:
        def fl_recommandee(ec):
            if pd.isna(ec): return float("nan")
            if ec < 0.5:   return 0.15
            if ec < 2.0:   return 0.20
            if ec < 3.0:   return 0.25
            return 0.30
        df["FL_recommandee"] = df["ec_bassin"].apply(fl_recommandee)

    # ── Ratio EC drainage / EC apport (indicateur boucle adaptative §6.2)
    if "ec_drainage" in df.columns and "ec_apport" in df.columns:
        df["ratio_EC_drain_apport"] = (
            df["ec_drainage"] / df["ec_apport"].replace(0, float("nan"))
        ).round(3)

    return df


# ═══════════════════════════════════════════════════════════════
# 4. JOINTURE ET SAUVEGARDE FINALE
# ═══════════════════════════════════════════════════════════════

def joindre_et_sauvegarder(df_irrig, df_daily, df_hourly_agg, df_hourly_brut=None):
    print("\n  Jointure irrigation + météo daily + météo horaire...")

    # ── Fallback : si API complètement indisponible, continuer sans météo
    if df_daily.empty and df_hourly_agg.empty:
        print("  ⚠ ATTENTION : aucune donnée météo téléchargée (API indisponible)")
        print("  ⚠ Poursuite avec données irrigation uniquement")
        print("  ⚠ Colonnes météo seront NaN — relancer quand API disponible")
        df_final = calculer_colonnes_derivees(df_irrig)
        df_final.to_csv(OUTPUT_FILE, index=False, encoding="utf-8-sig")
        return df_final

    df_irrig["_date_join"] = df_irrig["date"].dt.normalize()

    # Jointure données daily
    if not df_daily.empty:
        df_daily["_date_join"] = df_daily["date"].dt.normalize()
        df_irrig = df_irrig.merge(
            df_daily.drop(columns=["date"]),
            on="_date_join", how="left"
        )

    # Jointure données horaires agrégées
    if not df_hourly_agg.empty:
        df_hourly_agg["_date_join"] = df_hourly_agg["date"].dt.normalize()
        df_irrig = df_irrig.merge(
            df_hourly_agg.drop(columns=["date"]),
            on="_date_join", how="left"
        )

    df_irrig = df_irrig.drop(columns=["_date_join"])

    # ─── Jointure météo au moment précis "datetime_fin" (heure réelle de fin de tour) ───
    if df_hourly_brut is not None and not df_hourly_brut.empty and "datetime_fin" in df_irrig.columns:
        print("  Jointure météo horaire au moment 'datetime_fin' (fin réelle du tour)...")
        df_irrig["_dt_actuel_h"] = df_irrig["datetime_fin"].dt.floor("h")
        df_irrig = df_irrig.merge(
            df_hourly_brut.rename(columns={"datetime": "_dt_actuel_h"}),
            on="_dt_actuel_h", how="left"
        )
        df_irrig = df_irrig.drop(columns=["_dt_actuel_h"])
        n_cols_actuel = sum(c.startswith("meteo_actuel_") for c in df_irrig.columns)
        pct_actuel = df_irrig["meteo_actuel_temperature_2m"].notna().mean() * 100 if "meteo_actuel_temperature_2m" in df_irrig.columns else 0
        print(f"    → {n_cols_actuel} colonnes 'meteo_actuel_*' ajoutées — {pct_actuel:.1f}% couvert")

    # Calcul colonnes dérivées (scénarios, alertes, ratios)
    df_final = calculer_colonnes_derivees(df_irrig)

    # ── Statistiques de couverture
    print("\n  Couverture météo par colonne clé :")
    cols_cles = [
        "meteo_ET0_mm_jour", "meteo_T_max_C", "meteo_HR_max_pct",
        "meteo_VPD_max_kPa", "meteo_pluie_mm_jour", "scenario_meteo"
    ]
    for col in cols_cles:
        if col in df_final.columns:
            pct = df_final[col].notna().mean() * 100
            print(f"    {col:<40} {pct:>6.1f}% couvert")

    # Sauvegarde
    df_final.to_csv(OUTPUT_FILE, index=False, encoding="utf-8-sig")

    return df_final


# ═══════════════════════════════════════════════════════════════
# 5. RÉSUMÉ FINAL
# ═══════════════════════════════════════════════════════════════

def afficher_resume(df):
    print("\n" + "═" * 60)
    print("  RÉSUMÉ DU FICHIER FINAL")
    print("═" * 60)
    print(f"  Fichier       : {OUTPUT_FILE}")
    print(f"  Lignes        : {len(df):,}")
    print(f"  Colonnes      : {df.shape[1]}")
    print(f"  Période       : {df['date'].min().date()} → {df['date'].max().date()}")

    if "scenario_meteo" in df.columns:
        print("\n  Distribution des scénarios météo :")
        dist = df.groupby("scenario_meteo")["date"].count().sort_index()
        # Obtenir les dates uniques par scénario
        dist_jours = df.drop_duplicates("date").groupby("scenario_meteo")["date"].count().sort_index()
        for sc, nb in dist_jours.items():
            label = {
                "1_TRES_ENSOLEILLE":  "☀☀ Très ensoleillé",
                "2_ENSOLEILLE":       "☀  Ensoleillé",
                "5_BROUILLARD_MATIN": "🌫  Brouillard matin",
                "6_CHERGUI_URGENT":   "🔴 CHERGUI URGENT",
                "7_PLUIE_STOP":       "🌧  Pluie forte — STOP irrigation",
                "7b_PLUIE_LEGERE":    "🌦  Pluie légère — ALERTE bruine",
            }.get(sc, sc)
            print(f"    {label:<35} {nb:>4} jours")

    meteo_cols = [c for c in df.columns if c.startswith("meteo_") or c.startswith("alerte_")]
    print(f"\n  Colonnes météo ajoutées  : {len(meteo_cols)}")
    print(f"  Colonnes irrigation orig : {df.shape[1] - len(meteo_cols)}")

    print("\n" + "═" * 60)
    print(f"  ✅ Fichier sauvegardé : {OUTPUT_FILE}")
    print("═" * 60)


# ═══════════════════════════════════════════════════════════════
# MAIN
# ═══════════════════════════════════════════════════════════════

def main():
    print("╔" + "═" * 58 + "╗")
    print("║   FUSION IRRIGATION + MÉTÉO COMPLÈTE — AGADIR/BELFAA    ║")
    print("║   Open-Meteo API  |  Lat=30.40°N  Lon=-9.57°E           ║")
    print("╚" + "═" * 58 + "╝")

    # 1. Fusion CSV
    df_irrig = fusionner_csv(CSV_FILES)

    date_debut = df_irrig["date"].min().strftime("%Y-%m-%d")
    date_fin   = df_irrig["date"].max().strftime("%Y-%m-%d")
    print(f"\n  Plage détectée : {date_debut} → {date_fin}")

    # 2. Météo journalière
    print("\n" + "─" * 60)
    print("  ÉTAPE 2 : Données météo journalières (Open-Meteo)")
    print("─" * 60)
    df_daily = telecharger_meteo_journaliere(date_debut, date_fin)

    # 3. Météo horaire → agrégée
    print("\n" + "─" * 60)
    print("  ÉTAPE 3 : Données météo horaires → agrégation journalière")
    print("─" * 60)
    df_hourly, df_hourly_brut = telecharger_meteo_horaire(date_debut, date_fin)

    # 4. Jointure + colonnes dérivées + sauvegarde
    print("\n" + "─" * 60)
    print("  ÉTAPE 4 : Jointure + colonnes agronomiques dérivées")
    print("─" * 60)
    df_final = joindre_et_sauvegarder(df_irrig, df_daily, df_hourly, df_hourly_brut)

    # 5. Résumé
    afficher_resume(df_final)


if __name__ == "__main__":
    main()