# ============================================================
# backend/models/user_model.py
# ============================================================

import uuid
from sqlalchemy import Column, String, Boolean, DateTime, Text
from sqlalchemy.sql import func
from core.database import Base


class User(Base):
    __tablename__ = "users"

    username   = Column(String, primary_key=True, index=True)
    password   = Column(String, nullable=False)
    role       = Column(String, nullable=False, default="operateur")
    nom        = Column(String, nullable=False)
    email      = Column(String, nullable=True, default=None)       # ← NOUVEAU
    actif      = Column(Boolean, default=True)
    last_login = Column(DateTime(timezone=True), nullable=True)    # ← NOUVEAU
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    def to_dict(self, include_password=False):
        data = {
            "username"  : self.username,
            "role"      : self.role,
            "nom"       : self.nom,
            "email"     : self.email,
            "actif"     : self.actif,
            "last_login": str(self.last_login) if self.last_login else None,
            "created_at": str(self.created_at),
        }
        if include_password:
            data["password"] = self.password
        return data


class AuditLog(Base):
    """Historique de toutes les actions utilisateurs"""
    __tablename__ = "audit_logs"

    id         = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    username   = Column(String, nullable=False, index=True)
    action     = Column(String, nullable=False)   # LOGIN, CREATE_USER, UPDATE_USER...
    detail     = Column(Text, nullable=True)
    ip         = Column(String, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    def to_dict(self):
        return {
            "id"        : self.id,
            "username"  : self.username,
            "action"    : self.action,
            "detail"    : self.detail,
            "ip"        : self.ip,
            "created_at": str(self.created_at),
        }