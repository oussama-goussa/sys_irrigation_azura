-- ============================================================
-- backend/sql/init.sql
-- Script d'initialisation automatique PostgreSQL + TimescaleDB
-- Projet Azura Irrigation IA — GOUSSA Oussama
-- ============================================================

-- Créer l'utilisateur azura_user s'il n'existe pas
DO $$
BEGIN
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'azura_user') THEN
        CREATE USER azura_user WITH PASSWORD 'azura_test_2026';
    END IF;
END
$$;

-- Donner tous les droits sur la base de données
GRANT ALL PRIVILEGES ON DATABASE azura_irrigation TO azura_user;
GRANT ALL ON SCHEMA public TO azura_user;

ALTER DEFAULT PRIVILEGES IN SCHEMA public
    GRANT ALL ON TABLES TO azura_user;

ALTER DEFAULT PRIVILEGES IN SCHEMA public
    GRANT ALL ON SEQUENCES TO azura_user;

-- ============================================================
-- Extension TimescaleDB
-- ============================================================
CREATE EXTENSION IF NOT EXISTS timescaledb CASCADE;

-- ============================================================
-- TABLE 1 : devices
-- Référence des équipements Netafim par ferme/serre
-- ============================================================
CREATE TABLE IF NOT EXISTS devices (
    id                   SERIAL PRIMARY KEY,
    farm_name            VARCHAR(50)  NOT NULL,
    house_number         VARCHAR(10)  NOT NULL,
    room_number          VARCHAR(10)  DEFAULT '0',
    controller_type      VARCHAR(50),
    controller_version   VARCHAR(20),
    device_id            VARCHAR(50)  UNIQUE,
    mtech_device_id      VARCHAR(20),
    source               VARCHAR(100),
    controller_type_id   VARCHAR(10),
    export_data_version  VARCHAR(5),
    is_active            BOOLEAN      DEFAULT TRUE,
    created_at           TIMESTAMP    DEFAULT NOW(),
    updated_at           TIMESTAMP    DEFAULT NOW(),

    CONSTRAINT uq_device UNIQUE (farm_name, house_number, room_number)
);

-- ============================================================
-- TABLE 2 : sensor_readings (hypertable TimescaleDB)
-- EC, pH, température, humidité, météo, arrays historique
-- ============================================================
CREATE TABLE IF NOT EXISTS sensor_readings (
    id                   BIGSERIAL,
    device_id            INTEGER      NOT NULL REFERENCES devices(id),
    timestamp            TIMESTAMP    NOT NULL,

    -- General
    alarm                INTEGER,
    time_local           VARCHAR(10),
    siren                BOOLEAN,
    house_connection     INTEGER,

    -- Environnement serre
    avg_temp             FLOAT,
    humidity             FLOAT,
    outside_temp         FLOAT,
    outside_humidity     FLOAT,

    -- Solution nutritive
    ec_actual            FLOAT,
    ph_actual            FLOAT,
    ec_prog              FLOAT,
    ph_prog              FLOAT,
    ec_pre_process       FLOAT,
    ec_pre_target        FLOAT,
    ec_pre_actual        FLOAT,
    ec_ph_status         VARCHAR(20),

    -- Débit
    flow                 FLOAT,
    flow_nominal         FLOAT,

    -- Station météo
    radiation            FLOAT,
    radiation_sum        FLOAT,
    wind_speed           FLOAT,
    wind_dir             INTEGER,
    rain_status          VARCHAR(20),
    rain_flow            FLOAT,
    daily_rain           FLOAT,
    vpd                  FLOAT,
    vpd_sum              FLOAT,

    -- Arrays historique 10 dernières valeurs
    ec_actual_array      JSONB,
    ph_actual_array      JSONB,
    ec_prg_array         JSONB,
    ph_prg_array         JSONB,
    flow_actual_array    JSONB,
    flow_prg_array       JSONB,

    CONSTRAINT uq_sensor UNIQUE (device_id, timestamp)
);

SELECT create_hypertable(
    'sensor_readings',
    'timestamp',
    chunk_time_interval => INTERVAL '7 days',
    if_not_exists => TRUE
);

CREATE INDEX IF NOT EXISTS idx_sensor_device_time
ON sensor_readings (device_id, timestamp DESC);

CREATE INDEX IF NOT EXISTS idx_sensor_ec
ON sensor_readings (device_id, ec_actual, timestamp DESC);

CREATE INDEX IF NOT EXISTS idx_sensor_ph
ON sensor_readings (device_id, ph_actual, timestamp DESC);

-- ============================================================
-- TABLE 3 : irrigation_cycles (hypertable TimescaleDB)
-- Pompes, vannes, eau, DigitalOut, programme irrigation
-- ============================================================
CREATE TABLE IF NOT EXISTS irrigation_cycles (
    id                   BIGSERIAL,
    device_id            INTEGER      NOT NULL REFERENCES devices(id),
    timestamp            TIMESTAMP    NOT NULL,

    -- Séquence
    sequence             INTEGER,
    cycle_prog           INTEGER,
    cycle_act            INTEGER,
    next_sequence        INTEGER,
    next_seq_time        VARCHAR(10),
    remaining_time       VARCHAR(20),
    active_order         INTEGER,
    dry_cont             INTEGER,

    -- Pompes (6 pompes)
    pump1                INTEGER,
    pump2                INTEGER,
    pump3                INTEGER,
    pump4                INTEGER,
    pump5                INTEGER,
    pump6                INTEGER,

    -- Vannes principales (6 vannes)
    main_valve1          INTEGER,
    main_valve2          INTEGER,
    main_valve3          INTEGER,
    main_valve4          INTEGER,
    main_valve5          INTEGER,
    main_valve6          INTEGER,

    -- Vannes zones (4 vannes)
    valve1               INTEGER,
    valve2               INTEGER,
    valve3               INTEGER,
    valve4               INTEGER,
    valves_in_irrig      INTEGER,

    -- Etat système
    valve_prog           INTEGER,
    fert_prog            INTEGER,
    manual_prog          INTEGER,
    pause                INTEGER,
    uncompressed_prog    INTEGER,

    -- DigitalOut
    irrigation_active    VARCHAR(10),
    fert_active          VARCHAR(10),
    booster_active       VARCHAR(10),
    misting_active       VARCHAR(10),
    cooling_active       VARCHAR(10),
    flushing_status      VARCHAR(10),
    flushing_active      VARCHAR(10),

    -- Eau programme
    water_mode           INTEGER,
    water_prg_qty        INTEGER,
    water_prg_time       VARCHAR(20),

    -- Eau actuelle
    water_act_qty        FLOAT,
    water_act_time       VARCHAR(20),
    water_left           VARCHAR(20),

    -- Fertigation programme
    fertilizer_qty       INTEGER,
    dosing_pump_type1    VARCHAR(20),
    dosing_pump_type2    VARCHAR(20),
    dosing_pump_type3    VARCHAR(20),
    dosing_pump_type4    VARCHAR(20),
    dosing_pump_type5    VARCHAR(20),
    dosing_pump_type6    VARCHAR(20),
    dosing_pump_type7    VARCHAR(20),
    dosing_pump_type8    VARCHAR(20),

    CONSTRAINT uq_cycle UNIQUE (device_id, timestamp)
);

SELECT create_hypertable(
    'irrigation_cycles',
    'timestamp',
    chunk_time_interval => INTERVAL '7 days',
    if_not_exists => TRUE
);

CREATE INDEX IF NOT EXISTS idx_cycle_device_time
ON irrigation_cycles (device_id, timestamp DESC);

-- ============================================================
-- TABLE 4 : fertigation_state (hypertable TimescaleDB)
-- Canaux engrais Netafim 1-8
-- ============================================================
CREATE TABLE IF NOT EXISTS fertigation_state (
    id           BIGSERIAL,
    device_id    INTEGER NOT NULL REFERENCES devices(id),
    timestamp    TIMESTAMP NOT NULL,

    -- Canal 1 (KNO3 - Nitrate potassium)
    fert_open1   FLOAT,
    fert_min1    FLOAT,
    fert_act1    FLOAT,
    fert_max1    FLOAT,
    fert_flow1   FLOAT,

    -- Canal 2 (Ca_NO3 - Nitrate calcium)
    fert_open2   FLOAT,
    fert_min2    FLOAT,
    fert_act2    FLOAT,
    fert_max2    FLOAT,
    fert_flow2   FLOAT,

    -- Canal 3 (MgSO4 - Sulfate magnesium)
    fert_open3   FLOAT,
    fert_min3    FLOAT,
    fert_act3    FLOAT,
    fert_max3    FLOAT,
    fert_flow3   FLOAT,

    -- Canal 4 (K2SO4 - Sulfate potassium)
    fert_open4   FLOAT,
    fert_min4    FLOAT,
    fert_act4    FLOAT,
    fert_max4    FLOAT,
    fert_flow4   FLOAT,

    -- Canal 5 (Acide/Base pH)
    fert_open5   FLOAT,
    fert_min5    FLOAT,
    fert_act5    FLOAT,
    fert_max5    FLOAT,
    fert_flow5   FLOAT,

    -- Canal 6
    fert_open6   FLOAT,
    fert_min6    FLOAT,
    fert_act6    FLOAT,
    fert_max6    FLOAT,
    fert_flow6   FLOAT,

    -- Canal 7
    fert_open7   FLOAT,
    fert_min7    FLOAT,
    fert_act7    FLOAT,
    fert_max7    FLOAT,
    fert_flow7   FLOAT,

    -- Canal 8
    fert_open8   FLOAT,
    fert_min8    FLOAT,
    fert_act8    FLOAT,
    fert_max8    FLOAT,
    fert_flow8   FLOAT,

    CONSTRAINT uq_fert UNIQUE (device_id, timestamp)
);

SELECT create_hypertable(
    'fertigation_state',
    'timestamp',
    chunk_time_interval => INTERVAL '7 days',
    if_not_exists => TRUE
);

CREATE INDEX IF NOT EXISTS idx_fert_device_time
ON fertigation_state (device_id, timestamp DESC);

-- ============================================================
-- TABLE 5 : alerts
-- Alertes générées automatiquement
-- ============================================================
CREATE TABLE IF NOT EXISTS alerts (
    id              BIGSERIAL PRIMARY KEY,
    device_id       INTEGER NOT NULL REFERENCES devices(id),
    timestamp       TIMESTAMP NOT NULL,
    alert_type      VARCHAR(50) NOT NULL,
    value_detected  FLOAT,
    threshold_min   FLOAT,
    threshold_max   FLOAT,
    severity        VARCHAR(20) DEFAULT 'WARNING',
    resolved_at     TIMESTAMP,
    resolved_by     VARCHAR(50),
    message         TEXT,
    created_at      TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_alerts_device_time
ON alerts (device_id, timestamp DESC);

CREATE INDEX IF NOT EXISTS idx_alerts_unresolved
ON alerts (device_id, resolved_at)
WHERE resolved_at IS NULL;

-- ============================================================
-- TABLE 6 : alert_thresholds
-- Seuils configurables par device
-- ============================================================
CREATE TABLE IF NOT EXISTS alert_thresholds (
    id            SERIAL PRIMARY KEY,
    device_id     INTEGER NOT NULL REFERENCES devices(id),
    parameter     VARCHAR(50) NOT NULL,
    threshold_min FLOAT,
    threshold_max FLOAT,
    severity      VARCHAR(20) DEFAULT 'WARNING',
    is_active     BOOLEAN DEFAULT TRUE,

    CONSTRAINT uq_threshold UNIQUE (device_id, parameter)
);

-- ============================================================
-- TABLE 7 : irrigation_tours
-- Tours d'irrigation calculés automatiquement par journée
-- ============================================================
CREATE TABLE IF NOT EXISTS irrigation_tours (
    id               BIGSERIAL PRIMARY KEY,
    device_id        INTEGER      NOT NULL REFERENCES devices(id),
    tour_num         INTEGER      NOT NULL,
    date             DATE         NOT NULL,
    debut            TIMESTAMP    NOT NULL,
    fin              TIMESTAMP,
    house_number     VARCHAR(10)  NOT NULL,
    duree_min        INTEGER,
    prg_time_min     INTEGER      NOT NULL,
    repos_apres_min  INTEGER,
    v_apport         FLOAT,
    ec_apport        FLOAT,
    ph_apport        FLOAT,
    radiation_sum    FLOAT,
    cumul_radiation  FLOAT,
    is_complete      BOOLEAN      DEFAULT FALSE,
    created_at       TIMESTAMP    DEFAULT NOW(),
    updated_at       TIMESTAMP    DEFAULT NOW(),

    CONSTRAINT uq_tour UNIQUE (device_id, date, tour_num)
);

CREATE INDEX IF NOT EXISTS idx_tours_device_date
ON irrigation_tours (device_id, date DESC);

-- ============================================================
-- VUE MATÉRIALISÉE : daily_summary
-- Résumé journalier pour dashboard direction Azura
-- ============================================================
CREATE MATERIALIZED VIEW IF NOT EXISTS daily_summary AS
SELECT
    d.farm_name,
    d.house_number,
    DATE(sr.timestamp)                        AS day,
    ROUND(AVG(sr.ec_actual)::numeric, 2)      AS avg_ec,
    ROUND(MIN(sr.ec_actual)::numeric, 2)      AS min_ec,
    ROUND(MAX(sr.ec_actual)::numeric, 2)      AS max_ec,
    ROUND(AVG(sr.ph_actual)::numeric, 2)      AS avg_ph,
    ROUND(MIN(sr.ph_actual)::numeric, 2)      AS min_ph,
    ROUND(MAX(sr.ph_actual)::numeric, 2)      AS max_ph,
    ROUND(AVG(sr.avg_temp)::numeric, 1)       AS avg_temp,
    ROUND(MAX(sr.avg_temp)::numeric, 1)       AS max_temp,
    ROUND(MIN(sr.avg_temp)::numeric, 1)       AS min_temp,
    ROUND(AVG(sr.humidity)::numeric, 1)       AS avg_humidity,
    ROUND(MAX(sr.radiation_sum)::numeric, 2)  AS daily_radiation,
    ROUND(AVG(sr.flow)::numeric, 1)           AS avg_flow,
    COUNT(*)                                  AS readings_count
FROM sensor_readings sr
JOIN devices d ON d.id = sr.device_id
GROUP BY d.farm_name, d.house_number, DATE(sr.timestamp);

CREATE UNIQUE INDEX IF NOT EXISTS idx_daily_summary
ON daily_summary (farm_name, house_number, day);


CREATE TABLE IF NOT EXISTS weight_readings (
    id          BIGSERIAL PRIMARY KEY,
    farm_name   VARCHAR(50) NOT NULL,
    capteur_id  VARCHAR(50) NOT NULL,
    poids_kg    FLOAT,
    rssi        INTEGER,
    timestamp   TIMESTAMP NOT NULL,
    created_at  TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_weight_farm_time
ON weight_readings (farm_name, timestamp DESC);