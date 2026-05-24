# backend/routers/export_sensor.py
# ─────────────────────────────────────────────────────────────
# Endpoint : GET /export/sensor-csv
# Exporte sensor_readings → CSV (StreamingResponse)
# Filtres : farm_name, house_number, date_debut, date_fin
# ─────────────────────────────────────────────────────────────

import csv
import io
from datetime import date, datetime
from typing import Optional

from fastapi import APIRouter, Depends, Query
from fastapi.responses import StreamingResponse
from sqlalchemy import text
from sqlalchemy.orm import Session

from core.database import get_db

router = APIRouter(prefix="/export", tags=["Export"])

COLUMNS = [
    "timestamp",
    "farm_name",
    "house_number",
    "avg_temp",
    "humidity",
    "outside_temp",
    "outside_humidity",
]

QUERY = text("""
    SELECT
        sr.timestamp,
        d.farm_name,
        d.house_number,
        sr.avg_temp,
        sr.humidity,
        sr.outside_temp,
        sr.outside_humidity
    FROM sensor_readings sr
    JOIN devices d ON d.id = sr.device_id
    WHERE d.farm_name    = :farm_name
      AND d.house_number = :house_number
      AND (:date_debut IS NULL OR sr.timestamp >= :date_debut)
      AND (:date_fin   IS NULL OR sr.timestamp <  :date_fin + INTERVAL '1 day')
    ORDER BY sr.timestamp ASC
""")


@router.get(
    "/sensor-csv",
    summary="Export sensor_readings → CSV",
    response_description="Fichier CSV téléchargeable",
)
def export_sensor_csv(
    farm_name:    str           = Query(...,  example="AZ106", description="Nom de la ferme"),
    house_number: str           = Query(...,  example="1",     description="Numéro de serre"),
    date_debut:   Optional[date] = Query(None, description="Date début (YYYY-MM-DD)"),
    date_fin:     Optional[date] = Query(None, description="Date fin   (YYYY-MM-DD)"),
    db: Session = Depends(get_db),
):
    rows = db.execute(QUERY, {
        "farm_name":    farm_name,
        "house_number": house_number,
        "date_debut":   date_debut,
        "date_fin":     date_fin,
    }).fetchall()

    # Construire le CSV en mémoire
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(COLUMNS)

    for row in rows:
        writer.writerow([
            row.timestamp,
            row.farm_name,
            row.house_number,
            row.avg_temp,
            row.humidity,
            row.outside_temp,
            row.outside_humidity,
        ])

    output.seek(0)

    # Nom du fichier
    now_str  = datetime.now().strftime("%Y%m%d_%H%M%S")
    filename = f"sensor_{farm_name}_H{house_number}_{now_str}.csv"

    return StreamingResponse(
        iter([output.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": f"attachment; filename={filename}"},
    )