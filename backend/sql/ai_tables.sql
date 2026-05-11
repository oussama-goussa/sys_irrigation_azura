-- ============================================================
-- backend/sql/ai_tables.sql
-- Tables Agent IA — Azura Irrigation
-- À exécuter UNE SEULE FOIS (ou ajouter dans init.sql)
-- ============================================================

-- ── TABLE 1 : ai_config_devices ──────────────────────────────
CREATE TABLE IF NOT EXISTS ai_config_devices (
    id               BIGSERIAL PRIMARY KEY,
    device_id        INTEGER NOT NULL REFERENCES devices(id) UNIQUE,
    date_plantation  DATE,
    ec_eau_brute     FLOAT  DEFAULT 0.8,
    methode_decision VARCHAR(20) DEFAULT 'hybride',
    actif            BOOLEAN DEFAULT TRUE,
    created_at       TIMESTAMPTZ DEFAULT NOW(),
    updated_at       TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ai_config_device
ON ai_config_devices (device_id);

-- ── TABLE 2 : ai_recommandations ─────────────────────────────
CREATE TABLE IF NOT EXISTS ai_recommandations (
    id                 BIGSERIAL PRIMARY KEY,
    device_id          INTEGER NOT NULL REFERENCES devices(id),
    date               DATE    NOT NULL,

    -- Météo
    radiation_jcm2     FLOAT,
    t_max              FLOAT,
    t_min              FLOAT,
    t_moy              FLOAT,
    hr_moy             FLOAT,
    vpd_kpa            FLOAT,
    pluie_mm           FLOAT  DEFAULT 0,
    scenario_meteo     VARCHAR(30),

    -- Agronomie
    stade              VARCHAR(30),
    j_plantation       INTEGER,
    ec_bassin          FLOAT,
    pct_ressuyage      FLOAT,

    -- FAO-56
    et0_mm             FLOAT,
    etc_mm             FLOAT,
    fraction_lessivage FLOAT,
    volume_total_l_ha  FLOAT,
    ec_cible_dSm       FLOAT,

    -- Plan journée
    nb_tours_prevu     INTEGER,
    heure_debut        VARCHAR(5),
    duree_t12_min      INTEGER,
    duree_t3p_min      INTEGER,
    repos_initial_min  INTEGER,
    seuil_drainage_pct FLOAT,

    -- NPK (JSONB)
    doses_npk          JSONB,
    correction_ph      JSONB,

    -- Temps réel
    nb_tours_reel      INTEGER DEFAULT 0,
    statut             VARCHAR(20) DEFAULT 'en_cours',
    ajustements        JSONB  DEFAULT '[]'::jsonb,
    methode_decision   VARCHAR(20) DEFAULT 'hybride',

    created_at         TIMESTAMPTZ DEFAULT NOW(),
    updated_at         TIMESTAMPTZ DEFAULT NOW(),

    CONSTRAINT uq_ai_rec UNIQUE (device_id, date)
);

CREATE INDEX IF NOT EXISTS idx_ai_rec_device_date
ON ai_recommandations (device_id, date DESC);

-- Trigger updated_at
CREATE OR REPLACE FUNCTION update_ai_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER trg_ai_recommandations_updated_at
    BEFORE UPDATE ON ai_recommandations
    FOR EACH ROW EXECUTE FUNCTION update_ai_updated_at();

CREATE OR REPLACE TRIGGER trg_ai_config_updated_at
    BEFORE UPDATE ON ai_config_devices
    FOR EACH ROW EXECUTE FUNCTION update_ai_updated_at();