-- ============================================================
-- backend/sql/saisie_tables.sql
-- Tables saisie journalière — Azura Irrigation IA
-- À exécuter UNE SEULE FOIS sur la base de données
-- OU inclure dans init.sql si base fraîche
-- ============================================================

-- ── TABLE 1 : saisie_journaliere ─────────────────────────────
CREATE TABLE IF NOT EXISTS saisie_journaliere (
    id              BIGSERIAL PRIMARY KEY,

    -- Identification
    farm_name       VARCHAR(50)   NOT NULL,
    station         VARCHAR(20),
    serre           VARCHAR(20),
    vanne           VARCHAR(20),
    date            DATE          NOT NULL,
    created_by      VARCHAR(50),

    -- Constantes & Substrat
    nbr_bras        INTEGER,
    nbr_goutteurs   INTEGER,
    poids_matin     FLOAT,
    heure_matin     VARCHAR(5),    -- HH:MM
    poids_soir      FLOAT,
    heure_soir      VARCHAR(5),    -- HH:MM
    bassin_ec       FLOAT,
    pct_ressuyage   FLOAT,         -- calculé

    -- Bilan global
    nbr_tours       INTEGER,
    duree_totale    VARCHAR(8),     -- HH:MM:SS
    total_v_apport  FLOAT,
    total_v_drain   FLOAT,
    ec_moy_apport   FLOAT,
    ph_moy_apport   FLOAT,
    ec_moy_drain    FLOAT,
    ph_moy_drain    FLOAT,
    moy_drain_finale FLOAT,        -- % drainage moyen final
    cc_bras         FLOAT,         -- cc/bras consommé

    created_at      TIMESTAMP DEFAULT NOW(),
    updated_at      TIMESTAMP DEFAULT NOW()
);

-- Trigger pour mettre à jour updated_at automatiquement
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER trg_saisie_journaliere_updated_at
    BEFORE UPDATE ON saisie_journaliere
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE INDEX IF NOT EXISTS idx_saisie_farm_date
ON saisie_journaliere (farm_name, date DESC);

CREATE INDEX IF NOT EXISTS idx_saisie_created_by
ON saisie_journaliere (created_by);


-- ── TABLE 2 : saisie_tours ────────────────────────────────────
CREATE TABLE IF NOT EXISTS saisie_tours (
    id              BIGSERIAL PRIMARY KEY,
    saisie_id       BIGINT        NOT NULL REFERENCES saisie_journaliere(id) ON DELETE CASCADE,

    num_tour        INTEGER       NOT NULL,
    rad             FLOAT,         -- radiation saisie
    cumul_rad       FLOAT,         -- calculé
    heure           VARCHAR(5),    -- HH:MM début
    duree_min       FLOAT,         -- minutes
    temps_repos     FLOAT,         -- calculé minutes

    v_apport        FLOAT,
    ec_apport       FLOAT,
    ph_apport       FLOAT,
    v_drain         FLOAT,
    ec_drain        FLOAT,
    ph_drain        FLOAT,
    pct_drain       FLOAT,         -- calculé %
    moy_pct_drain   FLOAT          -- calculé %
);

CREATE INDEX IF NOT EXISTS idx_saisie_tours_saisie_id
ON saisie_tours (saisie_id, num_tour);