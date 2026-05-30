# ============================================================
# backend/models/sensor_model.py
# Modèles SQLAlchemy — Tables capteurs Netafim
# Projet Azura Irrigation IA — GOUSSA Oussama
# ============================================================

from sqlalchemy import (
    Column, String, Boolean, Float, Integer,
    DateTime, BigInteger, ForeignKey, Text, Index,
    Date, UniqueConstraint
)

from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.sql import func
from core.database import Base


# ── TABLE 1 : devices ────────────────────────────────────────
class Device(Base):
    __tablename__ = "devices"

    id                   = Column(Integer, primary_key=True, autoincrement=True)
    farm_name            = Column(String(50),  nullable=False)
    house_number         = Column(String(10),  nullable=False)
    room_number          = Column(String(10),  default='0')
    controller_type      = Column(String(50))
    controller_version   = Column(String(20))
    device_id            = Column(String(50),  unique=True)
    mtech_device_id      = Column(String(20))
    source               = Column(String(100))
    controller_type_id   = Column(String(10))
    export_data_version  = Column(String(5))
    is_active            = Column(Boolean,     default=True)
    created_at           = Column(DateTime(timezone=True), server_default=func.now())
    updated_at           = Column(DateTime(timezone=True), onupdate=func.now())

    def to_dict(self):
        return {
            "id"                 : self.id,
            "farm_name"          : self.farm_name,
            "house_number"       : self.house_number,
            "room_number"        : self.room_number,
            "controller_type"    : self.controller_type,      # ← AJOUTER
            "controller_version" : self.controller_version,   # ← AJOUTER
            "device_id"          : self.device_id,            # ← AJOUTER
            "controller_type"    : self.controller_type,
            "controller_version" : self.controller_version,
            "device_id"          : self.device_id,
            "source"             : self.source,
            "is_active"          : self.is_active,
        }


# ── TABLE 2 : sensor_readings ────────────────────────────────
class SensorReading(Base):
    __tablename__ = "sensor_readings"

    id                   = Column(BigInteger, primary_key=True, autoincrement=True)
    device_id            = Column(Integer, ForeignKey("devices.id"), nullable=False)
    timestamp            = Column(DateTime, nullable=False)

    # General
    alarm                = Column(Integer)
    time_local           = Column(String(10))
    siren                = Column(Boolean)
    house_connection     = Column(Integer)

    # Environnement serre
    avg_temp             = Column(Float)
    humidity             = Column(Float)
    outside_temp         = Column(Float)
    outside_humidity     = Column(Float)

    # Solution nutritive
    ec_actual            = Column(Float)
    ph_actual            = Column(Float)
    ec_prog              = Column(Float)
    ph_prog              = Column(Float)
    ec_pre_process       = Column(Float)
    ec_pre_target        = Column(Float)
    ec_pre_actual        = Column(Float)
    ec_ph_status         = Column(String(20))

    # Débit
    flow                 = Column(Float)
    flow_nominal         = Column(Float)

    # Station météo
    radiation            = Column(Float)
    radiation_sum        = Column(Float)
    wind_speed           = Column(Float)
    wind_dir             = Column(Integer)
    rain_status          = Column(String(20))
    rain_flow            = Column(Float)
    daily_rain           = Column(Float)
    vpd                  = Column(Float)
    vpd_sum              = Column(Float)

    # Arrays historique JSONB
    ec_actual_array      = Column(JSONB)
    ph_actual_array      = Column(JSONB)
    ec_prg_array         = Column(JSONB)
    ph_prg_array         = Column(JSONB)
    flow_actual_array    = Column(JSONB)
    flow_prg_array       = Column(JSONB)


# ── TABLE 3 : irrigation_cycles ──────────────────────────────
class IrrigationCycle(Base):
    __tablename__ = "irrigation_cycles"

    id                   = Column(BigInteger, primary_key=True, autoincrement=True)
    device_id            = Column(Integer, ForeignKey("devices.id"), nullable=False)
    timestamp            = Column(DateTime, nullable=False)

    # Séquence
    sequence             = Column(Integer)
    cycle_prog           = Column(Integer)
    cycle_act            = Column(Integer)
    next_sequence        = Column(Integer)
    next_seq_time        = Column(String(10))
    remaining_time       = Column(String(20))
    active_order         = Column(Integer)
    dry_cont             = Column(Integer)

    # Pompes
    pump1                = Column(Integer)
    pump2                = Column(Integer)
    pump3                = Column(Integer)
    pump4                = Column(Integer)
    pump5                = Column(Integer)
    pump6                = Column(Integer)

    # Vannes principales
    main_valve1          = Column(Integer)
    main_valve2          = Column(Integer)
    main_valve3          = Column(Integer)
    main_valve4          = Column(Integer)
    main_valve5          = Column(Integer)
    main_valve6          = Column(Integer)

    # Vannes zones
    valve1               = Column(Integer)
    valve2               = Column(Integer)
    valve3               = Column(Integer)
    valve4               = Column(Integer)
    valves_in_irrig      = Column(Integer)

    # Etat système
    valve_prog           = Column(Integer)
    fert_prog            = Column(Integer)
    manual_prog          = Column(Integer)
    pause                = Column(Integer)
    uncompressed_prog    = Column(Integer)

    # DigitalOut
    irrigation_active    = Column(String(10))
    fert_active          = Column(String(10))
    booster_active       = Column(String(10))
    misting_active       = Column(String(10))
    cooling_active       = Column(String(10))
    flushing_status      = Column(String(10))
    flushing_active      = Column(String(10))

    # Eau programme
    water_mode           = Column(Integer)
    water_prg_qty        = Column(Integer)
    water_prg_time       = Column(String(20))

    # Eau actuelle
    water_act_qty        = Column(Float)
    water_act_time       = Column(String(20))
    water_left           = Column(String(20))

    # Fertigation programme
    fertilizer_qty       = Column(Integer)
    dosing_pump_type1    = Column(String(20))
    dosing_pump_type2    = Column(String(20))
    dosing_pump_type3    = Column(String(20))
    dosing_pump_type4    = Column(String(20))
    dosing_pump_type5    = Column(String(20))
    dosing_pump_type6    = Column(String(20))
    dosing_pump_type7    = Column(String(20))
    dosing_pump_type8    = Column(String(20))


# ── TABLE 4 : fertigation_state ──────────────────────────────
class FertigationState(Base):
    __tablename__ = "fertigation_state"

    id           = Column(BigInteger, primary_key=True, autoincrement=True)
    device_id    = Column(Integer, ForeignKey("devices.id"), nullable=False)
    timestamp    = Column(DateTime, nullable=False)

    # Canal 1 (KNO3)
    fert_open1   = Column(Float)
    fert_min1    = Column(Float)
    fert_act1    = Column(Float)
    fert_max1    = Column(Float)
    fert_flow1   = Column(Float)

    # Canal 2 (Ca_NO3)
    fert_open2   = Column(Float)
    fert_min2    = Column(Float)
    fert_act2    = Column(Float)
    fert_max2    = Column(Float)
    fert_flow2   = Column(Float)

    # Canal 3 (MgSO4)
    fert_open3   = Column(Float)
    fert_min3    = Column(Float)
    fert_act3    = Column(Float)
    fert_max3    = Column(Float)
    fert_flow3   = Column(Float)

    # Canal 4 (K2SO4)
    fert_open4   = Column(Float)
    fert_min4    = Column(Float)
    fert_act4    = Column(Float)
    fert_max4    = Column(Float)
    fert_flow4   = Column(Float)

    # Canal 5 (Acide/Base)
    fert_open5   = Column(Float)
    fert_min5    = Column(Float)
    fert_act5    = Column(Float)
    fert_max5    = Column(Float)
    fert_flow5   = Column(Float)

    # Canal 6
    fert_open6   = Column(Float)
    fert_min6    = Column(Float)
    fert_act6    = Column(Float)
    fert_max6    = Column(Float)
    fert_flow6   = Column(Float)

    # Canal 7
    fert_open7   = Column(Float)
    fert_min7    = Column(Float)
    fert_act7    = Column(Float)
    fert_max7    = Column(Float)
    fert_flow7   = Column(Float)

    # Canal 8
    fert_open8   = Column(Float)
    fert_min8    = Column(Float)
    fert_act8    = Column(Float)
    fert_max8    = Column(Float)
    fert_flow8   = Column(Float)


# ── TABLE 5 : alerts ─────────────────────────────────────────
class Alert(Base):
    __tablename__ = "alerts"

    id              = Column(BigInteger, primary_key=True, autoincrement=True)
    device_id       = Column(Integer, ForeignKey("devices.id"), nullable=False)
    timestamp       = Column(DateTime, nullable=False)
    alert_type      = Column(String(50), nullable=False)
    value_detected  = Column(Float)
    threshold_min   = Column(Float)
    threshold_max   = Column(Float)
    severity        = Column(String(20), default='WARNING')
    resolved_at     = Column(DateTime, nullable=True)
    resolved_by     = Column(String(50), nullable=True)
    message         = Column(Text)
    created_at      = Column(DateTime(timezone=True), server_default=func.now())

    def to_dict(self):
        return {
            "id"            : self.id,
            "device_id"     : self.device_id,
            "timestamp"     : str(self.timestamp),
            "alert_type"    : self.alert_type,
            "value_detected": self.value_detected,
            "threshold_min" : self.threshold_min,
            "threshold_max" : self.threshold_max,
            "severity"      : self.severity,
            "message"       : self.message,
            "resolved_at"   : str(self.resolved_at) if self.resolved_at else None,
        }

# ── TABLE 6 : alert_thresholds ───────────────────────────────
class AlertThreshold(Base):
    __tablename__ = "alert_thresholds"

    id            = Column(Integer, primary_key=True, autoincrement=True)
    device_id     = Column(Integer, ForeignKey("devices.id"), nullable=False)
    parameter     = Column(String(50), nullable=False)
    threshold_min = Column(Float)
    threshold_max = Column(Float)
    severity      = Column(String(20), default='WARNING')
    is_active     = Column(Boolean, default=True)

# ── TABLE 7 : irrigation_tours ────────────────────────────────
class IrrigationTour(Base):
    __tablename__ = "irrigation_tours"

    id               = Column(BigInteger, primary_key=True, autoincrement=True)
    device_id        = Column(Integer, ForeignKey("devices.id"), nullable=False)
    tour_num         = Column(Integer, nullable=False)
    date             = Column(Date, nullable=False)
    debut            = Column(DateTime, nullable=False)
    fin              = Column(DateTime, nullable=True)
    house_number     = Column(String(10), nullable=False)
    duree_min        = Column(Integer, nullable=True)
    prg_time_min     = Column(Integer, nullable=False)
    repos_apres_min  = Column(Integer, nullable=True)
    is_complete      = Column(Boolean, default=False)
    v_apport         = Column(Float, nullable=True)
    ec_apport        = Column(Float, nullable=True)
    ph_apport        = Column(Float, nullable=True)
    radiation_sum    = Column(Float, nullable=True)
    cumul_radiation  = Column(Float, nullable=True)
    created_at       = Column(DateTime(timezone=True), server_default=func.now())
    updated_at       = Column(DateTime(timezone=True), onupdate=func.now())

    __table_args__ = (
        UniqueConstraint('device_id', 'date', 'tour_num', name='uq_tour'),
    )