from sqlalchemy import Column, String, Float, Integer, DateTime, BigInteger
from sqlalchemy.sql import func
from core.database import Base

class WeightReading(Base):
    __tablename__ = "weight_readings"

    id         = Column(BigInteger, primary_key=True, autoincrement=True)
    farm_name  = Column(String(50), nullable=False)
    capteur_id = Column(String(50), nullable=False)
    poids_kg   = Column(Float)
    rssi       = Column(Integer)
    timestamp  = Column(DateTime, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    def to_dict(self):
        return {
            "id"        : self.id,
            "farm_name" : self.farm_name,
            "capteur_id": self.capteur_id,
            "poids_kg"  : self.poids_kg,
            "rssi"      : self.rssi,
            "timestamp" : str(self.timestamp),
        }