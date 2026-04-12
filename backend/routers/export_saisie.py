# ============================================================
# backend/routers/export_saisie.py
# Export Excel — Suivi Irrigation Azura
# Structure exacte comme les photos Excel
# ============================================================

from fastapi import APIRouter, Depends, Query, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session
from sqlalchemy import and_
from datetime import date as date_type, timedelta
from typing import List, Optional
from loguru import logger
import io

from core.database import get_db
from core.security import require_any
from models.saisie_model import SaisieJournaliere, SaisieTour

router = APIRouter(prefix="/api/export", tags=["Export Excel"])


def get_date_range(date_from: str, date_to: str):
    d1 = date_type.fromisoformat(date_from)
    d2 = date_type.fromisoformat(date_to)
    days = []
    cur = d1
    while cur <= d2:
        days.append(cur)
        cur += timedelta(days=1)
    return days


@router.get("/saisie")
def export_saisie_excel(
    farm_names : str   = Query(..., description="Fermes séparées par virgule"),
    date_from  : str   = Query(..., description="YYYY-MM-DD"),
    date_to    : str   = Query(..., description="YYYY-MM-DD"),
    db         : Session = Depends(get_db),
    user       : dict    = Depends(require_any),
):
    """
    Export Excel du suivi d'irrigation.
    Structure : une table par ferme/station/jour.
    Colonnes : Tours (1..N), lignes : métriques.
    """
    try:
        from openpyxl import Workbook
        from openpyxl.styles import (
            Font, PatternFill, Alignment, Border, Side, GradientFill
        )
        from openpyxl.utils import get_column_letter
    except ImportError:
        raise HTTPException(status_code=500, detail="openpyxl non installé")

    try:
        d1 = date_type.fromisoformat(date_from)
        d2 = date_type.fromisoformat(date_to)
    except ValueError:
        raise HTTPException(status_code=400, detail="Format date invalide")

    farms_list = [f.strip() for f in farm_names.split(",") if f.strip()]
    if not farms_list:
        raise HTTPException(status_code=400, detail="Aucune ferme sélectionnée")

    date_range = get_date_range(date_from, date_to)

    # ── Récupérer toutes les saisies ──────────────────────────
    saisies = (
        db.query(SaisieJournaliere)
        .filter(
            SaisieJournaliere.farm_name.in_(farms_list),
            SaisieJournaliere.date >= d1,
            SaisieJournaliere.date <= d2,
        )
        .order_by(SaisieJournaliere.farm_name, SaisieJournaliere.date)
        .all()
    )

    # Map saisie_id → tours
    saisie_ids = [s.id for s in saisies]
    all_tours = (
        db.query(SaisieTour)
        .filter(SaisieTour.saisie_id.in_(saisie_ids))
        .order_by(SaisieTour.saisie_id, SaisieTour.num_tour)
        .all()
    ) if saisie_ids else []

    tours_by_saisie = {}
    for t in all_tours:
        tours_by_saisie.setdefault(t.saisie_id, []).append(t)

    # ── Workbook ──────────────────────────────────────────────
    wb = Workbook()
    ws = wb.active
    ws.title = "Suivi Irrigation"

    # ── Styles ────────────────────────────────────────────────
    def make_fill(hex_color):
        return PatternFill("solid", fgColor=hex_color)

    def make_font(bold=False, color="000000", size=10):
        return Font(bold=bold, color=color, name="Arial", size=size)

    def make_border(style="thin"):
        s = Side(style=style, color="000000")
        return Border(left=s, right=s, top=s, bottom=s)

    def make_align(h="center", v="center", wrap=False):
        return Alignment(horizontal=h, vertical=v, wrap_text=wrap)

    FILL_HEADER    = make_fill("1F7A4E")   # vert foncé
    FILL_ROW_LABEL = make_fill("70AD47")   # vert moyen
    FILL_TOUR_ODD  = make_fill("E2EFDA")   # vert très clair
    FILL_TOUR_EVEN = make_fill("FFFFFF")   # blanc
    FILL_BILAN     = make_fill("FFF2CC")   # jaune clair
    FILL_BILAN_LBL = make_fill("F4B942")   # orange/jaune
    FILL_WARNING   = make_fill("FF0000")   # rouge pour valeurs hors norme

    FONT_HEADER = make_font(bold=True, color="FFFFFF", size=10)
    FONT_LABEL  = make_font(bold=True, color="FFFFFF", size=9)
    FONT_DATA   = make_font(bold=False, color="000000", size=9)
    FONT_DATA_R = make_font(bold=True, color="C00000", size=9)  # rouge pour valeurs
    FONT_BILAN  = make_font(bold=True, color="C00000", size=9)
    BORDER      = make_border()

    def cell(ws, row, col, value="", fill=None, font=None, align=None, border=None, number_format=None):
        c = ws.cell(row=row, column=col, value=value)
        if fill:   c.fill = fill
        if font:   c.font = font
        if align:  c.alignment = align
        if border: c.border = border
        if number_format: c.number_format = number_format
        return c

    def apply_row(ws, row, cols, fill=None, font=None, border=None):
        for c in cols:
            cc = ws.cell(row=row, column=c)
            if fill:   cc.fill = fill
            if font:   cc.font = font
            if border: cc.border = border

    current_row = 1

    # ── Pour chaque ferme ─────────────────────────────────────
    for farm in farms_list:
        farm_saisies = [s for s in saisies if s.farm_name == farm]

        # Grouper par station
        stations = sorted(set(s.station or "—" for s in farm_saisies))

        for station in stations:
            station_saisies = sorted(
                [s for s in farm_saisies if (s.station or "—") == station],
                key=lambda x: x.date
            )

            # ── Pour chaque saisie (jour) ──────────────────────
            for saisie in station_saisies:
                tours = tours_by_saisie.get(saisie.id, [])
                n_tours = len(tours)
                max_tours = max(n_tours, 1)

                # ── HEADER FERME / DATE ────────────────────────
                # Ligne titre
                ws.merge_cells(
                    start_row=current_row, start_column=1,
                    end_row=current_row, end_column=7 + max_tours
                )
                title_val = f"{farm}  |  Station: {station}  |  Serre: {saisie.serre or '—'}  |  Vanne: {saisie.vanne or '—'}  |  Date: {saisie.date.strftime('%d/%m/%Y')}"
                c = ws.cell(row=current_row, column=1, value=title_val)
                c.fill = FILL_HEADER
                c.font = make_font(bold=True, color="FFFFFF", size=11)
                c.alignment = make_align("left", "center")
                c.border = BORDER
                ws.row_dimensions[current_row].height = 20
                current_row += 1

                # ── HEADER COLONNES TOURS ──────────────────────
                # Col A: Date, B: Ferme, C: Bloc, D: Serre, E: Vanne, F: Label métrique
                # Col G+: Tour 1, Tour 2...
                col_label = 1
                col_first_tour = 2

                # Row headers
                headers = ["", "Tours →"] + [f"Tour {i+1}" for i in range(max_tours)]
                for ci, h in enumerate(headers):
                    c = ws.cell(row=current_row, column=col_label + ci, value=h)
                    c.fill = FILL_HEADER
                    c.font = FONT_HEADER
                    c.alignment = make_align("center", "center")
                    c.border = BORDER
                ws.row_dimensions[current_row].height = 18
                current_row += 1

                # ── LIGNES MÉTRIQUES ───────────────────────────
                metrics = [
                    ("Radiation",              "rad",           None,   FILL_ROW_LABEL, FONT_LABEL, "0"),
                    ("Cumul Radiation",        "cumul_rad",     None,   FILL_ROW_LABEL, FONT_LABEL, "0"),
                    ("Heure",                  "heure",         None,   FILL_ROW_LABEL, FONT_LABEL, "@"),
                    ("Durée (min)",            "duree_min",     None,   FILL_ROW_LABEL, FONT_LABEL, "0"),
                    ("Temps Repos (min)",      "temps_repos",   None,   FILL_ROW_LABEL, FONT_LABEL, "0:00"),
                    ("V Apport (cc)",          "v_apport",      None,   FILL_ROW_LABEL, FONT_LABEL, "0"),
                    ("EC Apport",              "ec_apport",     None,   FILL_ROW_LABEL, FONT_LABEL, "0.00"),
                    ("pH Apport",              "ph_apport",     None,   FILL_ROW_LABEL, FONT_LABEL, "0.00"),
                    ("V Drainage (cc)",        "v_drain",       None,   FILL_ROW_LABEL, FONT_LABEL, "0"),
                    ("% Drainage",             "pct_drain",     None,   FILL_ROW_LABEL, FONT_LABEL, "0.0%_"),
                    ("Moyenne % Drainage",     "moy_pct_drain", None,   FILL_ROW_LABEL, FONT_LABEL, "0.0%_"),
                    ("EC Drainage",            "ec_drain",      None,   FILL_ROW_LABEL, FONT_LABEL, "0.00"),
                    ("pH Drainage",            "ph_drain",      None,   FILL_ROW_LABEL, FONT_LABEL, "0.00"),
                ]

                for row_idx, (label, field, _, fill_lbl, font_lbl, num_fmt) in enumerate(metrics):
                    row = current_row + row_idx
                    fill_row = FILL_TOUR_ODD if row_idx % 2 == 0 else FILL_TOUR_EVEN

                    # Colonne label
                    c = ws.cell(row=row, column=col_label, value=label)
                    c.fill = fill_lbl
                    c.font = font_lbl
                    c.alignment = make_align("left", "center")
                    c.border = BORDER

                    # Colonnes tours
                    for ti, tour in enumerate(tours):
                        val = getattr(tour, field, None)
                        if val is None:
                            val = ""
                        elif field == "pct_drain" and val is not None:
                            val = round(val / 100, 4)
                        elif field == "moy_pct_drain" and val is not None:
                            val = round(val / 100, 4)
                        elif field == "temps_repos" and val is not None:
                            # Format HH:MM
                            h = int(val) // 60
                            m = int(val) % 60
                            val = f"{h:02d}:{m:02d}"

                        tc = ws.cell(row=row, column=col_first_tour + ti, value=val)
                        tc.fill = fill_row
                        tc.font = FONT_DATA_R if (field in ("pct_drain","moy_pct_drain","v_apport","v_drain") and val) else FONT_DATA
                        tc.alignment = make_align("center", "center")
                        tc.border = BORDER
                        if num_fmt and val != "":
                            tc.number_format = num_fmt

                    # Colonnes vides si moins de max_tours
                    for ti in range(len(tours), max_tours):
                        ec = ws.cell(row=row, column=col_first_tour + ti, value="")
                        ec.fill = fill_row
                        ec.border = BORDER

                    ws.row_dimensions[row].height = 15

                current_row += len(metrics)

                # ── BILAN ROW ──────────────────────────────────
                bilan_row = current_row

                # Ligne bilan substrat (poids matin/soir etc)
                bilan_labels = [
                    ("Heure Matin",    saisie.heure_matin),
                    ("Poids Matin (Kg)", f"{saisie.poids_matin:.1f}" if saisie.poids_matin else "—"),
                    ("Heure Soir",     saisie.heure_soir),
                    ("Poids Soir (Kg)", f"{saisie.poids_soir:.1f}" if saisie.poids_soir else "—"),
                    ("% Ressuyage",    f"{saisie.pct_ressuyage:.1f}%" if saisie.pct_ressuyage else "—"),
                    ("EC Bassin",      f"{saisie.bassin_ec}" if saisie.bassin_ec else "—"),
                ]
                for bi, (lbl, val) in enumerate(bilan_labels):
                    r = bilan_row + bi // 2
                    offset = (bi % 2) * 2
                    lc = ws.cell(row=r, column=col_label + offset, value=lbl)
                    lc.fill = FILL_BILAN_LBL
                    lc.font = FONT_LABEL
                    lc.alignment = make_align("left", "center")
                    lc.border = BORDER
                    vc = ws.cell(row=r, column=col_label + offset + 1, value=val)
                    vc.fill = FILL_BILAN
                    vc.font = FONT_BILAN
                    vc.alignment = make_align("center", "center")
                    vc.border = BORDER
                    ws.row_dimensions[r].height = 15

                bilan_rows = (len(bilan_labels) + 1) // 2
                current_row += bilan_rows

                # ── BILAN GLOBAL (droite) ──────────────────────
                # Place bilan global en colonne droite
                bilan_col_start = col_first_tour + max_tours + 1
                bilan_global = [
                    ("Nombre De Bras",      saisie.nbr_bras),
                    ("Nombre de Goutteurs", saisie.nbr_goutteurs),
                    ("Durée totale",        saisie.duree_totale),
                    ("EC Bassin",           saisie.bassin_ec),
                    ("Total V Apport",      saisie.total_v_apport),
                    ("EC cumul apport",     f"{saisie.ec_moy_apport:.2f}" if saisie.ec_moy_apport else "—"),
                    ("PH cumul apport",     f"{saisie.ph_moy_apport:.2f}" if saisie.ph_moy_apport else "—"),
                    ("Total V Drainage",    saisie.total_v_drain),
                    ("Moyenne % drainage",  f"{saisie.moy_drain_finale:.0f}%" if saisie.moy_drain_finale else "—"),
                    ("EC cumul drainage",   f"{saisie.ec_moy_drain:.2f}" if saisie.ec_moy_drain else "—"),
                    ("PH cumul Drainage",   f"{saisie.ph_moy_drain:.2f}" if saisie.ph_moy_drain else "—"),
                    ("CC/bras consommé",    f"{saisie.cc_bras:.3f}" if saisie.cc_bras else "—"),
                    ("Nombre des tours",    saisie.nbr_tours),
                ]

                # On place le bilan à droite de la section tours
                bilan_start_row = current_row - bilan_rows - len(metrics)
                for bi, (lbl, val) in enumerate(bilan_global):
                    r = bilan_start_row + bi
                    lc = ws.cell(row=r, column=bilan_col_start, value=lbl)
                    lc.fill = FILL_BILAN_LBL
                    lc.font = FONT_LABEL
                    lc.alignment = make_align("left", "center")
                    lc.border = BORDER
                    ws.column_dimensions[get_column_letter(bilan_col_start)].width = 22

                    vc = ws.cell(row=r, column=bilan_col_start + 1, value=val)
                    vc.fill = FILL_BILAN
                    vc.font = FONT_BILAN
                    vc.alignment = make_align("center", "center")
                    vc.border = BORDER
                    ws.column_dimensions[get_column_letter(bilan_col_start + 1)].width = 12
                    ws.row_dimensions[r].height = 15

                # Espace entre les sections
                current_row += 3

    # ── Largeurs colonnes ─────────────────────────────────────
    ws.column_dimensions['A'].width = 25  # labels
    for i in range(max_tours + 5):
        col = get_column_letter(2 + i)
        ws.column_dimensions[col].width = 10

    # ── Freeze panes ──────────────────────────────────────────
    ws.freeze_panes = "B3"

    # ── Output ────────────────────────────────────────────────
    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)

    filename = f"suivi_irrigation_{date_from}_{date_to}.xlsx"
    logger.success(f"Export Excel généré : {filename} — {len(saisies)} saisies")

    return StreamingResponse(
        buf,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f"attachment; filename={filename}"}
    )