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
    - Reset de water_act_time → nouveau demi-tour
    - Changement de cycle_act → nouveau tour complet (nouveau bloc)
    """
    if not rows:
        return []

    demitours = []
    current   = [rows[0]]
    prev_sec  = time_to_seconds(rows[0][1].water_act_time)
    prev_cycle_act = rows[0][1].cycle_act

    for row in rows[1:]:
        curr_sec = time_to_seconds(row[1].water_act_time)
        curr_cycle_act = row[1].cycle_act

        # Changement de cycle_act → nouveau tour complet
        if curr_cycle_act != prev_cycle_act and prev_cycle_act is not None:
            demitours.append(current)
            current = [row]
            prev_sec = curr_sec
            prev_cycle_act = curr_cycle_act
            continue

        # Reset water_act_time → nouveau demi-tour
        if curr_sec < prev_sec:
            demitours.append(current)
            current = [row]
        else:
            current.append(row)
        
        prev_sec = curr_sec
        prev_cycle_act = curr_cycle_act

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

    # Détecter les blocs d'irrigation.
    # Un bloc = burst continu d'irrigation avec au plus UNE interruption courte
    # (≤ 6 min = 1 seul cycle de lecture à 5 min) entre 2 demi-tours Netafim.
    # Les vraies pauses inter-tours durent 20+ min → elles clôturent le bloc.
    blocs = []
    current_bloc = []
    gap_rows = []

    for sr, ic in rows:
        is_irr = (
            sr.ec_ph_status == 'Irrigation'
            and not (ic.sequence == 16 and ic.water_prg_qty <= 3)
            and not (ic.sequence == 16 and sr.ec_prog is None and sr.ph_prog is None)
        )
        if is_irr:
            if gap_rows and current_bloc:
                gap_sec = (sr.timestamp - current_bloc[-1][0].timestamp).total_seconds()
                if gap_sec <= 660:   # ≤ 11 min : interruption interne (Pause entre 2 demi-tours)
                    current_bloc.extend(gap_rows)
                else:
                    blocs.append(current_bloc)
                    current_bloc = []
            gap_rows = []
            current_bloc.append((sr, ic))
        else:
            if current_bloc:
                gap_rows.append((sr, ic))

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
                SensorReading.device_id == device.id,
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

            # ── Ignorer les chunks incomplets (débit nul ou durée insuffisante) ──
            flows = [sr.flow for sr, ic in chunk if sr.flow is not None]
            flow_moyen = sum(flows) / len(flows) if flows else 0
            if flow_moyen == 0:
                continue

            # Durée réelle du chunk = water_act_time de la dernière lecture
            duree_reelle_sec = max(time_to_seconds(ic.water_act_time) for _, ic in chunk)
            prg_sec_check    = time_to_seconds(first_ic.water_prg_time)
            # Ignorer si le chunk n'a pas atteint 50% de la durée programmée
            if prg_sec_check > 0 and duree_reelle_sec < (prg_sec_check * 0.3):
                continue

            act_sec     = time_to_seconds(first_ic.water_act_time)
            debut_exact = first_sr.timestamp - timedelta(seconds=act_sec)

            left_sec   = time_to_seconds(last_ic.water_left)
            fin_exacte  = last_sr.timestamp + timedelta(seconds=left_sec)

            prg_sec    = time_to_seconds(first_ic.water_prg_time)
            prg_min    = max(1, round(prg_sec / 60))
            qte_prog   = int(first_ic.water_prg_qty) if first_ic.water_prg_qty else 0

            # is_first_of_bloc = True si premier chunk du bloc OU cycle_act différent du chunk précédent
            if k == 0:
                is_first = True
                prev_chunk_cycle = first_ic.cycle_act
            else:
                prev_chunk_first_ic = chunks[k-1][0][1]
                is_first = (first_ic.cycle_act != prev_chunk_first_ic.cycle_act)
                prev_chunk_cycle = first_ic.cycle_act
            
            # Ignorer les chunks avec prg_time incohérent par rapport au chunk précédent du même bloc
            if k > 0:
                prev_prg = time_to_seconds(chunks[k-1][-1][1].water_prg_time) // 60
                curr_prg = prg_min
                if not is_first and prev_prg != curr_prg and curr_prg < prev_prg:
                    continue

            demitours_all.append({
                'debut'           : debut_exact,
                'fin'             : fin_exacte,
                'duree'           : round((fin_exacte - debut_exact).total_seconds() / 60),
                'prg_time_min'    : prg_min,
                'qte_prog'        : qte_prog,
                'prev_status'     : prev_status if k == 0 else 'Irrigation',
                'is_first_of_bloc': is_first,
                'is_last_of_day'  : False,
                'ec_apport'       : first_sr.ec_prog,
                'ph_apport'       : first_sr.ph_prog,
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

            if gap_sec < 600 and meme_bloc:
                tours.append({
                    'debut'        : dt1['debut'],
                    'fin'          : dt2['fin'],
                    'duree_min'    : round((dt2['fin'] - dt1['debut']).total_seconds() / 60),
                    'prg_time_min' : dt1['prg_time_min'],
                    'prev_status'  : dt1['prev_status'],
                    'is_last'      : dt2['is_last_of_day'],
                    'ec_apport'    : dt1['ec_apport'],
                    'ph_apport'    : dt1['ph_apport'],
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
            'ec_apport'    : dt1['ec_apport'],
            'ph_apport'    : dt1['ph_apport'],
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
    tour_num = 1
    for idx, t in enumerate(tours):
        # Durée complète = prg_time_min * 2 (2 demi-tours Netafim)
        duree_complete = t['prg_time_min'] * 2
        debut_tour     = t['debut'] 

        # Vérifier qu'il y a eu du flow réel pendant toute la fenêtre du tour
        fin_tour = debut_tour + timedelta(minutes=duree_complete)
        has_flow = db.query(SensorReading).filter(
            SensorReading.device_id == device.id,
            SensorReading.ec_ph_status == 'Irrigation',
            SensorReading.flow > 0,
            SensorReading.timestamp >= debut_tour,
            SensorReading.timestamp <= fin_tour,
        ).first()
        if not has_flow:
            continue

        # Repos AVANT ce tour — basé sur result (tours déjà validés)
        if result:
            prev_t = result[-1]
            repos = round((t['debut'] - prev_t['debut']).total_seconds() / 60) - prev_t['duree_min']
            if repos < 0:
                repos = 0
        else:
            repos = None

        if idx + 1 < len(tours):
            is_complete = True
        else:
            is_complete = journee_terminee

        result.append({
            'tour_num'       : tour_num,
            'debut'          : t['debut'],
            'fin'            : t['debut'] + timedelta(minutes=duree_complete),
            'duree_min'      : duree_complete,
            'prg_time_min'   : t['prg_time_min'],
            'repos_apres_min': repos,
            'is_complete'    : is_complete,
            'v_apport'       : round((t['prg_time_min'] * 1000) / 60, 1),
            'ec_apport'      : t.get('ec_apport'),
            'ph_apport'      : t.get('ph_apport'),
        })
        tour_num += 1

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
                existing.prg_time_min    = t['prg_time_min']
                existing.repos_apres_min = t['repos_apres_min']
                existing.is_complete     = t['is_complete']
                existing.v_apport        = t.get('v_apport')
                existing.ec_apport       = t.get('ec_apport')
                existing.ph_apport       = t.get('ph_apport')
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
                v_apport         = t.get('v_apport'),
                ec_apport        = t.get('ec_apport'),
                ph_apport        = t.get('ph_apport'),
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