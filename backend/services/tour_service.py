# ============================================================
# backend/services/tour_service.py
# Calcul et stockage des tours d'irrigation
# Logique basée sur analyse_tours.py — GOUSSA Oussama
#
# RÉVISION MAJEURE — corrections :
#   1. is_complete basé sur une lecture APRÈS la fin estimée (granularité 5 min)
#   2. repos_apres_min calculé et mis à jour sur le tour PRÉCÉDENT
#   3. ec_apport/ph_apport : prend la première lecture NON nulle du demi-tour
#   4. Filtrage renforcé des mini-tours parasites (sequence=16)
#   5. has_flow vérifie la DERNIÈRE lecture ≤ fin du tour (pas n'importe où)
# ============================================================

from datetime import datetime, timedelta, date
from sqlalchemy.orm import Session
from sqlalchemy import desc, func
from loguru import logger

from models.sensor_model import (
    Device, SensorReading, IrrigationCycle,
    IrrigationTour
)

# Granularité des lectures Netafim en secondes (5 min + marge)
LECTURE_INTERVAL_SEC = 330  # 5 min + 30s de marge


# ── Helpers ───────────────────────────────────────────────────

def time_to_seconds(t) -> int:
    """Parse HH:MM:SS → secondes. Retourne 0 si invalide."""
    try:
        parts = str(t).strip().split(':')
        return int(parts[0]) * 3600 + int(parts[1]) * 60 + int(parts[2])
    except Exception:
        return 0


def _premier_ec_non_nul(chunk: list):
    """
    Retourne (ec_prog, ph_prog) de la première lecture du chunk
    où ec_prog > 0 et ph_prog > 0. Fallback : première lecture.
    """
    for sr, ic in chunk:
        if sr.ec_prog and sr.ec_prog > 0 and sr.ph_prog and sr.ph_prog > 0:
            return sr.ec_prog, sr.ph_prog
    # fallback
    return chunk[0][0].ec_prog, chunk[0][0].ph_prog


def split_bloc_en_demitours(rows: list) -> list:
    """
    Découpe un bloc d'irrigation continu en demi-tours.
    - Reset de water_act_time (curr < prev) → nouveau demi-tour
    - Changement de cycle_act → nouveau tour complet (nouveau bloc)
    """
    if not rows:
        return []

    demitours = []
    current        = [rows[0]]
    prev_sec       = time_to_seconds(rows[0][1].water_act_time)
    prev_cycle_act = rows[0][1].cycle_act

    for row in rows[1:]:
        curr_sec       = time_to_seconds(row[1].water_act_time)
        curr_cycle_act = row[1].cycle_act

        # Changement de cycle_act → nouveau tour complet
        if curr_cycle_act != prev_cycle_act and prev_cycle_act is not None:
            demitours.append(current)
            current        = [row]
            prev_sec       = curr_sec
            prev_cycle_act = curr_cycle_act
            continue

        # Reset water_act_time → nouveau demi-tour
        if curr_sec < prev_sec:
            demitours.append(current)
            current = [row]
        else:
            current.append(row)

        prev_sec       = curr_sec
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

    PRINCIPE DE STOCKAGE « FIN D'ABORD » :
    Un tour n'est marqué is_complete=True que si on a observé
    une lecture avec débit dans la fenêtre du tour ET une lecture
    postérieure à la fin estimée (Pause/Wait OU timestamp > fin + 1 lecture).
    Tant que cette confirmation n'existe pas, is_complete=False.

    repos_apres_min du tour N est mis à jour au moment où le tour N+1
    est confirmé (on connaît alors le début réel du tour N+1).
    """
    start_dt = datetime.combine(target_date, datetime.min.time())
    end_dt   = start_dt + timedelta(days=1)

    # ── 1. Charger sensor_readings + irrigation_cycles ────────
    rows = (
        db.query(SensorReading, IrrigationCycle)
        .join(
            IrrigationCycle,
            (IrrigationCycle.device_id == SensorReading.device_id) &
            (IrrigationCycle.timestamp == SensorReading.timestamp)
        )
        .filter(
            SensorReading.device_id == device.id,
            SensorReading.timestamp >= start_dt,
            SensorReading.timestamp <  end_dt,
        )
        .order_by(SensorReading.timestamp.asc())
        .all()
    )

    if not rows:
        logger.debug(f"Aucune donnée pour {device.farm_name} H{device.house_number} {target_date}")
        return []

    # ── 2. Construire les blocs d'irrigation ─────────────────
    # Un bloc = séquence continue avec au plus 1 interruption courte
    # (≤ 150% de water_prg_time, min 6 min) entre deux demi-tours.
    blocs     = []
    cur_bloc  = []
    gap_rows  = []

    for sr, ic in rows:
        # Filtre : ignorer les séquences parasites de rinçage/flush
        # sequence=16 avec water_prg_qty ≤ 3 OU ec_prog=0 → mini-tour parasite
        is_parasite = (
            ic.sequence == 16
            and (
                (ic.water_prg_qty is not None and ic.water_prg_qty <= 3)
                or (sr.ec_prog == 0 and sr.ph_prog == 0)
            )
        )
        is_irr = (sr.ec_ph_status == 'Irrigation') and not is_parasite

        if is_irr:
            if gap_rows and cur_bloc:
                gap_sec   = (sr.timestamp - cur_bloc[-1][0].timestamp).total_seconds()
                prg_sec   = time_to_seconds(cur_bloc[-1][1].water_prg_time)
                threshold = max(prg_sec * 1.5, 360)
                if gap_sec <= threshold:
                    cur_bloc.extend(gap_rows)
                else:
                    blocs.append(cur_bloc)
                    cur_bloc = []
            gap_rows = []
            cur_bloc.append((sr, ic))
        else:
            if cur_bloc:
                gap_rows.append((sr, ic))

    if cur_bloc:
        blocs.append(cur_bloc)

    if not blocs:
        return []

    # ── 3. Extraire les demi-tours de chaque bloc ─────────────
    demitours_all = []

    for b_idx, bloc in enumerate(blocs):
        chunks = split_bloc_en_demitours(bloc)

        for k, chunk in enumerate(chunks):
            first_sr, first_ic = chunk[0]
            last_sr,  last_ic  = chunk[-1]

            # Ignorer les chunks à débit nul
            flows = [sr.flow for sr, _ in chunk if sr.flow is not None]
            flow_moyen = sum(flows) / len(flows) if flows else 0
            if flow_moyen == 0:
                continue

            # Ignorer si durée réelle < 30% de la durée programmée
            duree_reelle_sec = max(time_to_seconds(ic.water_act_time) for _, ic in chunk)
            prg_sec_check    = time_to_seconds(first_ic.water_prg_time)
            if prg_sec_check > 0 and duree_reelle_sec < (prg_sec_check * 0.3):
                continue

            # Ignorer les mini-tours avec prg_time < 3 min (< 180s)
            if prg_sec_check < 180:
                continue

            # Début exact : timestamp première lecture - water_act_time
            act_sec     = time_to_seconds(first_ic.water_act_time)
            debut_exact = first_sr.timestamp - timedelta(seconds=act_sec)

            # Fin exacte : timestamp dernière lecture + water_left
            left_sec   = time_to_seconds(last_ic.water_left)
            fin_exacte = last_sr.timestamp + timedelta(seconds=left_sec)

            prg_min  = max(1, round(prg_sec_check / 60))
            qte_prog = int(first_ic.water_prg_qty) if first_ic.water_prg_qty else 0

            # is_first_of_bloc
            if k == 0:
                is_first = True
            else:
                prev_ic  = chunks[k - 1][0][1]
                is_first = (first_ic.cycle_act != prev_ic.cycle_act)

            # Ignorer les chunks avec prg_time incohérent dans le même bloc
            if k > 0 and not is_first:
                prev_prg = time_to_seconds(chunks[k - 1][-1][1].water_prg_time) // 60
                if prg_min < prev_prg:
                    continue

            # ec/ph apport : première valeur non nulle du chunk
            ec_apport, ph_apport = _premier_ec_non_nul(chunk)

            demitours_all.append({
                'debut'           : debut_exact,
                'fin'             : fin_exacte,
                'duree'           : round((fin_exacte - debut_exact).total_seconds() / 60),
                'prg_time_min'    : prg_min,
                'qte_prog'        : qte_prog,
                'is_first_of_bloc': is_first,
                'is_last_of_day'  : False,
                'ec_apport'       : ec_apport,
                'ph_apport'       : ph_apport,
                'radiation_sum'   : first_sr.radiation_sum,
                # Garder la dernière lecture pour la vérification de fin
                '_last_ts'        : last_sr.timestamp,
                '_last_status'    : last_sr.ec_ph_status,
                '_prg_sec'        : prg_sec_check,
            })

    if not demitours_all:
        return []

    demitours_all[-1]['is_last_of_day'] = True

    # ── 4. Regrouper 2 demi-tours en 1 tour complet ───────────
    tours_raw = []
    i = 0
    while i < len(demitours_all):
        dt1 = demitours_all[i]

        if i + 1 < len(demitours_all):
            dt2     = demitours_all[i + 1]
            gap_sec = (dt2['debut'] - dt1['fin']).total_seconds()
            meme_bloc = not dt2['is_first_of_bloc']

            if gap_sec < 600 and meme_bloc:
                tours_raw.append({
                    'debut'        : dt1['debut'],
                    'fin'          : dt2['fin'],
                    'duree_min'    : round((dt2['fin'] - dt1['debut']).total_seconds() / 60),
                    'prg_time_min' : dt1['prg_time_min'],
                    'is_last'      : dt2['is_last_of_day'],
                    'ec_apport'    : dt1['ec_apport'],
                    'ph_apport'    : dt1['ph_apport'],
                    'radiation_sum': dt1['radiation_sum'],
                    '_last_ts'     : dt2['_last_ts'],
                    '_last_status' : dt2['_last_status'],
                    '_prg_sec'     : dt1['_prg_sec'],
                })
                i += 2
                continue

        tours_raw.append({
            'debut'        : dt1['debut'],
            'fin'          : dt1['fin'],
            'duree_min'    : dt1['duree'],
            'prg_time_min' : dt1['prg_time_min'],
            'is_last'      : dt1['is_last_of_day'],
            'ec_apport'    : dt1['ec_apport'],
            'ph_apport'    : dt1['ph_apport'],
            'radiation_sum': dt1['radiation_sum'],
            '_last_ts'     : dt1['_last_ts'],
            '_last_status' : dt1['_last_status'],
            '_prg_sec'     : dt1['_prg_sec'],
        })
        i += 1

    # ── 5. Validation et calcul is_complete ───────────────────
    #
    # RÈGLE « FIN D'ABORD » :
    # Un tour est is_complete=True si et seulement si on a une preuve
    # que la fenêtre du tour est écoulée, à savoir :
    #   (a) la dernière lecture du demi-tour 2 a water_left ≈ 0 (< 60s), OU
    #   (b) il existe une lecture APRÈS fin_estimée avec ec_ph_status != 'Irrigation',
    #   (c) OU la journée est passée (target_date < today)
    #
    # La granularité de 5 min est prise en compte : on tolère que la
    # dernière lecture soit jusqu'à LECTURE_INTERVAL_SEC avant la fin.

    journee_terminee = target_date < date.today()
    if not journee_terminee:
        last_status = rows[-1][0].ec_ph_status if rows else None
        journee_terminee = (last_status not in ('Irrigation', 'Wait', None))

    # Timestamp de la toute dernière lecture disponible
    derniere_lecture_ts = rows[-1][0].timestamp if rows else None

    result  = []
    tour_num = 1
    cumul_prev = 0

    for idx, t in enumerate(tours_raw):
        duree_complete    = t['prg_time_min'] * 2
        debut_tour        = t['debut']
        fin_estimee       = debut_tour + timedelta(minutes=duree_complete)

        # ── Vérification débit réel ──────────────────────────
        # Il doit y avoir au moins une lecture avec débit dans la fenêtre
        # ET cette lecture doit être dans les LECTURE_INTERVAL_SEC avant la fin
        has_flow_near_end = db.query(SensorReading).filter(
            SensorReading.device_id   == device.id,
            SensorReading.ec_ph_status == 'Irrigation',
            SensorReading.flow        >  0,
            SensorReading.timestamp   >= fin_estimee - timedelta(seconds=t['_prg_sec'] + LECTURE_INTERVAL_SEC),
            SensorReading.timestamp   <= fin_estimee + timedelta(seconds=LECTURE_INTERVAL_SEC),
        ).first()

        if not has_flow_near_end:
            # Pas de débit confirmé près de la fin → tour non validé
            continue

        # ── Détermination is_complete ────────────────────────
        # Option (a) : water_left < 60s sur la dernière lecture du tour
        water_left_ok = time_to_seconds(
            getattr(has_flow_near_end, 'water_left', '00:00:00') or '00:00:00'
        ) < 60

        # Option (b) : lecture postérieure à fin_estimée avec statut Pause/Wait
        lecture_post_fin = db.query(SensorReading).filter(
            SensorReading.device_id  == device.id,
            SensorReading.timestamp  >  fin_estimee - timedelta(seconds=LECTURE_INTERVAL_SEC),
            SensorReading.timestamp  <= fin_estimee + timedelta(seconds=LECTURE_INTERVAL_SEC * 2),
            SensorReading.ec_ph_status.notin_(['Irrigation']),
        ).first()

        is_complete = (
            journee_terminee
            or water_left_ok
            or (lecture_post_fin is not None)
        )

        # ── Calcul cumul_radiation ───────────────────────────
        rad_val = t.get('radiation_sum')
        if rad_val is not None:
            cumul      = max(0.0, rad_val - cumul_prev)
            cumul_prev = rad_val  # radiation_sum est cumulatif depuis minuit
        else:
            cumul = None

        # ── repos_apres_min : calculé par rapport au tour SUIVANT ──
        # On ne peut pas le calculer ici (le suivant n'est pas encore validé).
        # On le laisse à None ; upsert_tours le remplira quand le suivant apparaît.
        repos_apres = None

        result.append({
            'tour_num'        : tour_num,
            'debut'           : debut_tour,
            'fin'             : fin_estimee,
            'duree_min'       : duree_complete,
            'prg_time_min'    : t['prg_time_min'],
            'repos_apres_min' : repos_apres,   # mis à jour dans upsert
            'is_complete'     : is_complete,
            'v_apport'        : round((t['prg_time_min'] * 1000) / 60, 1),
            'ec_apport'       : t.get('ec_apport'),
            'ph_apport'       : t.get('ph_apport'),
            'radiation_sum'   : t.get('radiation_sum'),
            'cumul_radiation' : cumul,
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

    LOGIQUE repos_apres_min :
    Quand on insère/met à jour le tour N, on calcule et met à jour
    repos_apres_min du tour N-1 (on connaît le debut_N).

    Utilise UNIQUE (device_id, date, tour_num).
    """
    if not tours:
        return

    for idx, t in enumerate(tours):
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
            if not existing.is_complete:
                existing.fin              = t['fin']
                existing.duree_min        = t['duree_min']
                existing.prg_time_min     = t['prg_time_min']
                existing.is_complete      = t['is_complete']
                existing.v_apport         = t.get('v_apport')
                existing.ec_apport        = t.get('ec_apport')
                existing.ph_apport        = t.get('ph_apport')
                existing.radiation_sum    = t.get('radiation_sum')
                existing.cumul_radiation  = t.get('cumul_radiation')
                existing.updated_at       = datetime.utcnow()
                # repos_apres_min : mis à jour ci-dessous depuis le tour suivant
        else:
            tour = IrrigationTour(
                device_id       = device.id,
                tour_num        = t['tour_num'],
                date            = target_date,
                debut           = t['debut'],
                fin             = t['fin'],
                house_number    = device.house_number,
                duree_min       = t['duree_min'],
                prg_time_min    = t['prg_time_min'],
                repos_apres_min = None,   # rempli quand le suivant arrive
                is_complete     = t['is_complete'],
                v_apport        = t.get('v_apport'),
                ec_apport       = t.get('ec_apport'),
                ph_apport       = t.get('ph_apport'),
                radiation_sum   = t.get('radiation_sum'),
                cumul_radiation = t.get('cumul_radiation'),
            )
            db.add(tour)

        # ── Mettre à jour repos_apres_min du tour PRÉCÉDENT ──
        # Le repos après le tour N-1 = debut_N - fin_(N-1)
        if idx > 0:
            prev_t       = tours[idx - 1]
            prev_existing = (
                db.query(IrrigationTour)
                .filter(
                    IrrigationTour.device_id == device.id,
                    IrrigationTour.date      == target_date,
                    IrrigationTour.tour_num  == prev_t['tour_num'],
                )
                .first()
            )
            if prev_existing:
                fin_prev  = prev_existing.fin
                debut_cur = t['debut']
                repos     = round((debut_cur - fin_prev).total_seconds() / 60)
                if repos >= 0:
                    prev_existing.repos_apres_min = repos
                    prev_existing.updated_at      = datetime.utcnow()

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
    first = (
        db.query(func.min(SensorReading.timestamp))
        .filter(
            SensorReading.device_id    == device.id,
            SensorReading.ec_ph_status == 'Irrigation',
        )
        .scalar()
    )

    if not first:
        return

    start_date = first.date()
    end_date   = date.today() - timedelta(days=1)

    current = start_date
    while current <= end_date:
        logger.info(f"Calcul historique {device.farm_name} H{device.house_number} {current}")
        tours = calculer_tours_journee(db, device, current)
        if tours:
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