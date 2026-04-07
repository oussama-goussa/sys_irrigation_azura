# ============================================================
# backend/services/tour_service.py
# Calcul et stockage des tours d'irrigation
# Logique basée sur analyse_tours.py — GOUSSA Oussama
# ============================================================

from datetime import datetime, timedelta, date
from sqlalchemy.orm import Session
from sqlalchemy import desc, func
from loguru import logger

from models.sensor_model import (
    Device, SensorReading, IrrigationCycle,
    IrrigationTour
)


# ── Helpers ───────────────────────────────────────────────────

def time_to_seconds(t) -> int:
    """Parse HH:MM:SS → secondes. Retourne 0 si invalide."""
    try:
        parts = str(t).strip().split(':')
        return int(parts[0]) * 3600 + int(parts[1]) * 60 + int(parts[2])
    except Exception:
        return 0


def split_bloc_en_demitours(rows: list) -> list:
    """
    Découpe un bloc d'irrigation continu en demi-tours.
    Un reset de water_act_time signale le début d'un nouveau demi-tour.
    rows : liste de tuples (SensorReading, IrrigationCycle)
    Retourne une liste de listes de tuples.
    """
    if not rows:
        return []

    demitours = []
    current   = [rows[0]]
    prev_sec  = time_to_seconds(rows[0][1].water_act_time)

    for row in rows[1:]:
        curr_sec = time_to_seconds(row[1].water_act_time)
        if curr_sec < prev_sec:
            # Reset détecté → nouveau demi-tour
            demitours.append(current)
            current = [row]
        else:
            current.append(row)
        prev_sec = curr_sec

    if current:
        demitours.append(current)

    return demitours


# ── Calcul des tours pour un device et une date ───────────────

def calculer_tours_journee(
    db: Session,
    device: Device,
    target_date: date,
) -> list:
    """
    Calcule les tours d'irrigation pour un device et une date.
    Retourne une liste de dicts représentant les tours.
    """
    start_dt = datetime.combine(target_date, datetime.min.time())
    end_dt   = start_dt + timedelta(days=1)

    # Récupérer sensor_readings + irrigation_cycles joinés
    rows = (
        db.query(SensorReading, IrrigationCycle)
        .join(
            IrrigationCycle,
            (IrrigationCycle.device_id == SensorReading.device_id) &
            (IrrigationCycle.timestamp == SensorReading.timestamp)
        )
        .filter(
            SensorReading.device_id  == device.id,
            SensorReading.timestamp  >= start_dt,
            SensorReading.timestamp  <  end_dt,
        )
        .order_by(SensorReading.timestamp.asc())
        .all()
    )

    if not rows:
        logger.debug(f"Aucune donnée pour {device.farm_name} H{device.house_number} {target_date}")
        return []

    # Détecter les blocs d'irrigation
    blocs = []
    current_bloc = []
    prev_is_irr  = False

    for sr, ic in rows:
        is_irr = sr.ec_ph_status == 'Irrigation'
        if is_irr:
            current_bloc.append((sr, ic))
        else:
            if current_bloc:
                blocs.append(current_bloc)
                current_bloc = []
        prev_is_irr = is_irr

    if current_bloc:
        blocs.append(current_bloc)

    if not blocs:
        return []

    # Construire la liste de tous les demi-tours
    demitours_all = []

    for b_idx, bloc in enumerate(blocs):
        # Status avant ce bloc
        first_ts  = bloc[0][0].timestamp
        prev_row = (
            db.query(SensorReading)
            .filter(
                SensorReading.device_id < device.id,
                SensorReading.timestamp < first_ts,
            )
            .order_by(SensorReading.timestamp.desc())
            .first()
        )
        # Chercher dans les rows chargés
        bloc_rows_idx = None
        for i, (sr, ic) in enumerate(rows):
            if sr.timestamp == first_ts:
                bloc_rows_idx = i
                break

        prev_status = 'Pause'
        if bloc_rows_idx is not None and bloc_rows_idx > 0:
            prev_status = rows[bloc_rows_idx - 1][0].ec_ph_status or 'Pause'

        chunks = split_bloc_en_demitours(bloc)

        for k, chunk in enumerate(chunks):
            first_sr, first_ic = chunk[0]
            last_sr,  last_ic  = chunk[-1]

            act_sec   = time_to_seconds(first_ic.water_act_time)
            debut_exact = first_sr.timestamp - timedelta(seconds=act_sec)

            left_sec   = time_to_seconds(last_ic.water_left)
            fin_exacte  = last_sr.timestamp + timedelta(seconds=left_sec)

            duree_min  = round((fin_exacte - debut_exact).total_seconds() / 60)
            debit_vals = [sr.flow for sr, ic in chunk if sr.flow and sr.flow > 0]
            debit_moy  = round(sum(debit_vals) / len(debit_vals), 1) if debit_vals else 0.0
            prg_sec    = time_to_seconds(first_ic.water_prg_time)
            prg_min    = max(1, round(prg_sec / 60))
            qte_prog   = int(first_ic.water_prg_qty) if first_ic.water_prg_qty else 0

            demitours_all.append({
                'debut'           : debut_exact,
                'fin'             : fin_exacte,
                'duree'           : duree_min,
                'debit_moy'       : debit_moy,
                'prg_time_min'    : prg_min,
                'qte_prog'        : qte_prog,
                'prev_status'     : prev_status if k == 0 else 'Irrigation',
                'is_first_of_bloc': k == 0,
                'is_last_of_day'  : False,
            })

    if not demitours_all:
        return []

    demitours_all[-1]['is_last_of_day'] = True

    # Regrouper 2 demi-tours consécutifs en 1 tour complet
    tours = []
    i = 0
    while i < len(demitours_all):
        dt1 = demitours_all[i]

        if i + 1 < len(demitours_all):
            dt2     = demitours_all[i + 1]
            gap_sec = (dt2['debut'] - dt1['fin']).total_seconds()
            meme_bloc = not dt2['is_first_of_bloc']

            if gap_sec < 180 and meme_bloc:
                tours.append({
                    'debut'        : dt1['debut'],
                    'fin'          : dt2['fin'],
                    'duree_min'    : round((dt2['fin'] - dt1['debut']).total_seconds() / 60),
                    'prg_time_min' : dt1['prg_time_min'],
                    'prev_status'  : dt1['prev_status'],
                    'is_last'      : dt2['is_last_of_day'],
                })
                i += 2
                continue

        tours.append({
            'debut'        : dt1['debut'],
            'fin'          : dt1['fin'],
            'duree_min'    : dt1['duree'],
            'prg_time_min' : dt1['prg_time_min'],
            'prev_status'  : dt1['prev_status'],
            'is_last'      : dt1['is_last_of_day'],
        })
        i += 1

    # Calculer repos_apres et is_complete
    # Vérifier si la journée est terminée (date passée ou Pause finale)
    journee_terminee = target_date < date.today()
    if not journee_terminee:
        # Vérifier si dernier status est Pause
        last_status = rows[-1][0].ec_ph_status if rows else None
        journee_terminee = last_status == 'Pause'

    result = []
    for idx, t in enumerate(tours):
        expected_duree = t['prg_time_min'] * 2

        if idx + 1 < len(tours):
            delta = (tours[idx + 1]['debut'] - t['fin']).total_seconds() / 60
            repos_brut = round(delta)

            if t['duree_min'] < expected_duree:
                manque = expected_duree - t['duree_min']
                if repos_brut >= manque:
                    t = dict(t)
                    t['duree_min'] = expected_duree
                    t['fin'] = t['debut'] + timedelta(minutes=expected_duree)
                    repos = max(0, repos_brut - manque)
                else:
                    t = dict(t)
                    t['duree_min'] = t['duree_min'] + repos_brut
                    t['fin'] = t['debut'] + timedelta(minutes=t['duree_min'])
                    repos = 0
                raison = 'Enchaînement direct' if repos == 0 else 'Repos'  # ← AJOUTÉ
                is_complete = True                                           # ← AJOUTÉ
            else:
                repos = max(0, repos_brut)
                next_ps = tours[idx + 1]['prev_status']
                if repos == 0:
                    raison = 'Enchaînement direct'
                elif next_ps == 'Wait' and repos > 30:
                    raison = 'Attente RadS'
                elif next_ps == 'Wait':
                    raison = 'Repos prog.'
                else:
                    raison = 'Repos'
                is_complete = True
        else:
            repos      = None
            raison     = '—'
            is_complete = journee_terminee

        result.append({
            'tour_num'       : idx + 1,
            'debut'          : t['debut'],
            'fin'            : t['fin'],
            'duree_min'      : t['duree_min'],
            'prg_time_min'   : t['prg_time_min'],
            'repos_apres_min': repos,
            'is_complete'    : is_complete,
        })

    return result


# ── Upsert tours en base ──────────────────────────────────────

def upsert_tours(
    db: Session,
    device: Device,
    target_date: date,
    tours: list,
):
    """
    Insère ou met à jour les tours calculés en base.
    Utilise UNIQUE (device_id, date, tour_num).
    """
    if not tours:
        return

    for t in tours:
        existing = (
            db.query(IrrigationTour)
            .filter(
                IrrigationTour.device_id == device.id,
                IrrigationTour.date      == target_date,
                IrrigationTour.tour_num  == t['tour_num'],
            )
            .first()
        )

        if existing:
            # Mettre à jour seulement si pas encore complet
            if not existing.is_complete:
                existing.fin             = t['fin']
                existing.duree_min       = t['duree_min']
                existing.repos_apres_min = t['repos_apres_min']
                existing.is_complete     = t['is_complete']
                existing.updated_at      = datetime.utcnow()
        else:
            tour = IrrigationTour(
                device_id        = device.id,
                tour_num         = t['tour_num'],
                date             = target_date,
                debut            = t['debut'],
                fin              = t['fin'],
                house_number     = device.house_number,
                duree_min        = t['duree_min'],
                prg_time_min     = t['prg_time_min'],
                repos_apres_min  = t['repos_apres_min'],
                is_complete      = t['is_complete'],
            )
            db.add(tour)

    try:
        db.commit()
        logger.success(
            f"✅ Tours upsert : {device.farm_name} H{device.house_number} "
            f"{target_date} → {len(tours)} tours"
        )
    except Exception as e:
        db.rollback()
        logger.error(f"Erreur upsert tours : {e}")


# ── Calculer les jours manquants ──────────────────────────────

def calculer_historique_complet(db: Session, device: Device):
    """
    Calcule les tours pour tous les jours manquants
    depuis la première donnée jusqu'à hier.
    """
    # Première date avec irrigation
    first = (
        db.query(func.min(SensorReading.timestamp))
        .filter(
            SensorReading.device_id  == device.id,
            SensorReading.ec_ph_status == 'Irrigation',
        )
        .scalar()
    )

    if not first:
        return

    start_date = first.date()
    end_date   = date.today() - timedelta(days=1)  # jusqu'à hier inclus

    current = start_date
    while current <= end_date:
        # Vérifier si ce jour a déjà des tours complets
        logger.info(f"Calcul historique {device.farm_name} H{device.house_number} {current}")
        tours = calculer_tours_journee(db, device, current)
        if tours:
            # Supprimer les anciens tours de ce jour avant upsert
            db.query(IrrigationTour).filter(
                IrrigationTour.device_id == device.id,
                IrrigationTour.date      == current,
            ).delete()
            db.commit()
            upsert_tours(db, device, current, tours)

        current += timedelta(days=1)


# ── Calculer le jour en cours ─────────────────────────────────

def calculer_jour_en_cours(db: Session, device: Device):
    """
    Recalcule les tours du jour en cours et les met à jour.
    Appelé toutes les 5 minutes par Celery.
    """
    today = date.today()
    tours = calculer_tours_journee(db, device, today)
    upsert_tours(db, device, today, tours)


# ── Point d'entrée principal ──────────────────────────────────

def run_pour_tous_les_devices(db: Session):
    """
    Lance le calcul pour tous les devices actifs.
    """
    devices = db.query(Device).filter(Device.is_active == True).all()
    logger.info(f"Calcul tours pour {len(devices)} devices")

    for device in devices:
        try:
            calculer_historique_complet(db, device)
            calculer_jour_en_cours(db, device)
        except Exception as e:
            logger.error(f"Erreur device {device.farm_name} H{device.house_number} : {e}")