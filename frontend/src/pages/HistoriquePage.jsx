// ============================================================
// frontend/src/pages/HistoriquePage.jsx
// Historique des saisies journalières
// Projet Azura Irrigation IA — GOUSSA Oussama
// ============================================================

import { useState, useEffect, useRef, useCallback } from 'react'
import {
  History, ChevronDown, ChevronUp, ChevronLeft, ChevronRight,
  Pencil, Trash2, Download, Search, X, AlertTriangle,
  Plus, Save, AlertCircle, Check, Droplets, FlaskConical,
  BarChart2, ClipboardList,
} from 'lucide-react'
import { getSaisies, getSaisie, updateSaisie, deleteSaisie, getDevices } from '../api/client.js'

// ── helpers ───────────────────────────────────────────────────
const fmtNum = (v, dec = 2) => {
  if (v === null || v === undefined || v === '' || isNaN(Number(v))) return '—'
  return Number(v).toFixed(dec)
}
const fmtDuree = (totalMin) => {
  if (!totalMin || totalMin <= 0) return '—'
  const h = Math.floor(totalMin / 60)
  const m = Math.floor(totalMin % 60)
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00`
}
const todayStr = () => new Date().toISOString().split('T')[0]
function newTour(num) {
  return {
    id: Date.now() + num, num,
    rad: '', cumulRad: 0, heure: '', duree: '', tempsRepos: null,
    vApport: '', ecApport: '', phApport: '',
    vDrain: '', ecDrain: '', phDrain: '',
    pctDrain: null, moyPctDrain: null,
  }
}

// ── TInput ───────────────────────────────────────────────────
function TInput({ value, onChange, disabled = false, width = 72, C }) {
  return (
    <input type="number" value={value ?? ''} onChange={e => onChange(e.target.value)}
      disabled={disabled} step="any"
      style={{
        width, textAlign: 'center', padding: '5px 6px', borderRadius: 6,
        border: `1.5px solid ${disabled ? 'transparent' : C.border}`,
        background: disabled ? 'transparent' : C.inputBg,
        color: disabled ? C.green : C.text,
        fontSize: 12, fontFamily: 'inherit', outline: 'none',
        fontWeight: disabled ? 700 : 400,
      }}
    />
  )
}

// ── TimeInput ─────────────────────────────────────────────────
function TimeInput({ value, onChange, C }) {
  const [h, m] = value ? value.split(':') : ['', '']
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
      <select value={h || ''} onChange={e => onChange(`${e.target.value}:${m || '00'}`)}
        style={{ width: 44, padding: '5px 2px', borderRadius: 6, textAlign: 'center',
          border: `1.5px solid ${C.border}`, background: C.inputBg, color: C.text,
          fontSize: 12, fontFamily: 'inherit', outline: 'none' }}>
        <option value="">HH</option>
        {Array.from({ length: 24 }, (_, i) => (
          <option key={i} value={String(i).padStart(2,'0')}>{String(i).padStart(2,'0')}</option>
        ))}
      </select>
      <span style={{ color: C.textDim, fontWeight: 700, fontSize: 12 }}>:</span>
      <select value={m || ''} onChange={e => onChange(`${h || '00'}:${e.target.value}`)}
        style={{ width: 44, padding: '5px 2px', borderRadius: 6, textAlign: 'center',
          border: `1.5px solid ${C.border}`, background: C.inputBg, color: C.text,
          fontSize: 12, fontFamily: 'inherit', outline: 'none' }}>
        <option value="">MM</option>
        {Array.from({ length: 60 }, (_, i) => (
          <option key={i} value={String(i).padStart(2,'0')}>{String(i).padStart(2,'0')}</option>
        ))}
      </select>
    </div>
  )
}

// ── StyledSelect ──────────────────────────────────────────────
function SSelect({ value, onChange, options, placeholder, C, width = '100%' }) {
  return (
    <div style={{ position: 'relative', width }}>
      <select value={value} onChange={e => onChange(e.target.value)}
        style={{ width: '100%', padding: '7px 28px 7px 10px', borderRadius: 7,
          border: `1.5px solid ${C.border}`, background: C.inputBg,
          color: value ? C.text : C.textDim, fontSize: 12,
          fontFamily: 'inherit', outline: 'none', appearance: 'none', cursor: 'pointer' }}>
        <option value="">{placeholder}</option>
        {options.map(o => <option key={o.value ?? o} value={o.value ?? o}>{o.label ?? o}</option>)}
      </select>
      <ChevronDown size={12} strokeWidth={2} style={{
        position: 'absolute', right: 8, top: '50%',
        transform: 'translateY(-50%)', color: C.textDim, pointerEvents: 'none',
      }} />
    </div>
  )
}

// ── Confirm Delete Modal ──────────────────────────────────────
function ConfirmModal({ saisie, onConfirm, onCancel, C }) {
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 200, background: 'rgba(0,0,0,0.65)',
      display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ background: C.card, border: `1.5px solid ${C.border}`,
        borderRadius: 16, padding: '28px 32px', width: 400,
        boxShadow: '0 8px 40px rgba(0,0,0,0.5)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
          <div style={{ width: 42, height: 42, borderRadius: 10,
            background: `${C.amber}18`, border: `1.5px solid ${C.amber}40`,
            display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <AlertTriangle size={20} color={C.amber} strokeWidth={2} />
          </div>
          <div>
            <div style={{ color: C.text, fontWeight: 800, fontSize: 15 }}>Confirmer la suppression</div>
            <div style={{ color: C.textMuted, fontSize: 12, marginTop: 2 }}>Cette action est irréversible</div>
          </div>
        </div>
        <p style={{ color: C.textMuted, fontSize: 12, marginBottom: 24, lineHeight: 1.7 }}>
          Supprimer la saisie du <strong style={{ color: C.text }}>{saisie.date}</strong> —{' '}
          <strong style={{ color: C.text }}>{saisie.farm_name}</strong> {saisie.station} {saisie.serre} ?
          <span style={{ display: 'block', marginTop: 8, color: C.red, fontSize: 11 }}>
            Tous les tours associés seront également supprimés.
          </span>
        </p>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button onClick={onCancel} style={{ padding: '8px 16px', borderRadius: 8,
            border: `1.5px solid ${C.border}`, background: 'transparent',
            color: C.textMuted, fontSize: 12, fontWeight: 700, fontFamily: 'inherit', cursor: 'pointer' }}>
            Annuler
          </button>
          <button onClick={onConfirm} style={{ padding: '8px 16px', borderRadius: 8,
            border: `1.5px solid ${C.red}`, background: 'transparent',
            color: C.red, fontSize: 12, fontWeight: 700, fontFamily: 'inherit', cursor: 'pointer' }}>
            <Trash2 size={13} strokeWidth={2} style={{ marginRight: 5, verticalAlign: 'middle' }} />
            Supprimer
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Edit Modal (comme SaisiePage) ─────────────────────────────
function EditModal({ saisie, token, farms, onSaved, onClose, C, dark }) {
  // Initialiser depuis la saisie existante
  const [ferme, setFerme]         = useState(saisie.farm_name || '')
  const [station, setStation]     = useState(saisie.station || '')
  const [serre, setSerre]         = useState(saisie.serre || '')
  const [vanne, setVanne]         = useState(saisie.vanne || '')
  const [date, setDate]           = useState(saisie.date || todayStr())
  const [nbrBras, setNbrBras]     = useState(saisie.nbr_bras ?? '')
  const [nbrGoutteurs, setNbrGoutteurs] = useState(saisie.nbr_goutteurs ?? '')
  const [poidsMatin, setPoidsMatin] = useState(saisie.poids_matin ?? '')
  const [heureMatin, setHeureMatin] = useState(saisie.heure_matin || '')
  const [poidsSoir, setPoidsSoir] = useState(saisie.poids_soir ?? '')
  const [heureSoir, setHeureSoir] = useState(saisie.heure_soir || '')
  const [bassinEC, setBassinEC]   = useState(saisie.bassin_ec ?? '')
  const [tours, setTours]         = useState([])
  const [saving, setSaving]       = useState(false)
  const [error, setError]         = useState('')
  const tableBottomRef = useRef(null)

  // Charger les tours existants
  useEffect(() => {
    getSaisie(token, saisie.id).then(data => {
      const t = (data.tours || []).map((t, i) => ({
        id: Date.now() + i,
        num: t.num_tour,
        rad: t.rad ?? '',
        cumulRad: t.cumul_rad ?? 0,
        heure: t.heure || '',
        duree: t.duree_min ?? '',
        tempsRepos: t.temps_repos ?? null,
        vApport: t.v_apport ?? '',
        ecApport: t.ec_apport ?? '',
        phApport: t.ph_apport ?? '',
        vDrain: t.v_drain ?? '',
        ecDrain: t.ec_drain ?? '',
        phDrain: t.ph_drain ?? '',
        pctDrain: t.pct_drain ?? null,
        moyPctDrain: t.moy_pct_drain ?? null,
      }))
      setTours(t)
    }).catch(() => {})
  }, [saisie.id])

  // % Ressuyage
  const pctRessuyage = poidsMatin && poidsSoir && Number(poidsMatin) > 0
    ? (((Number(poidsSoir) - Number(poidsMatin)) / Number(poidsMatin)) * 100).toFixed(1)
    : null

  // Options fermes
  const fermeOptions = farms.map(f => ({ value: f.farm_name, label: f.farm_name }))
  const selectedFarm = farms.find(f => f.farm_name === ferme)
  const houses = selectedFarm?.houses || []
  const stationOptions = [...new Set(houses.map(h => h.house_number))].map(v => ({ value: v, label: `Station ${v}` }))

  // Recalcul tours
  const recalculTours = useCallback((list) => {
    let cumulPrev = 0
    return list.map((t, i) => {
      const prev = i > 0 ? list[i - 1] : null
      const radActuelle = Number(t.rad) || 0
      const cumulRad = radActuelle - cumulPrev
      cumulPrev += cumulRad
      let tempsRepos = null
      if (i > 0 && prev?.heure && prev?.duree && t.heure) {
        const toMin = h => { const [hh, mm] = h.split(':').map(Number); return hh * 60 + mm }
        tempsRepos = toMin(t.heure) - (toMin(prev.heure) + (Number(prev.duree) || 0))
        if (tempsRepos < 0) tempsRepos = 0
      }
      let pctDrain = null
      if (t.vDrain && t.vApport && nbrGoutteurs && Number(t.vApport) > 0 && Number(nbrGoutteurs) > 0)
        pctDrain = (Number(t.vDrain) / Number(nbrGoutteurs) / Number(t.vApport)) * 100
      let moyPctDrain = null
      if (pctDrain !== null) {
        const prevMoy = prev?.moyPctDrain ?? null
        moyPctDrain = i === 0 ? pctDrain : prevMoy !== null ? (prevMoy * i + pctDrain) / (i + 1) : null
      }
      return { ...t, cumulRad: Math.max(0, cumulRad), tempsRepos, pctDrain, moyPctDrain }
    })
  }, [nbrGoutteurs])

  const updateTour = (id, field, val) =>
    setTours(prev => recalculTours(prev.map(t => t.id === id ? { ...t, [field]: val } : t)))

  const addTour = () => {
    setTours(prev => {
      const next = [...prev, newTour(prev.length + 1)]
      setTimeout(() => tableBottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 50)
      return recalculTours(next)
    })
  }

  const deleteTourRow = (id) =>
    setTours(prev => recalculTours(prev.filter(t => t.id !== id).map((t, i) => ({ ...t, num: i + 1 }))))

  // Bilan
  const lastTour       = tours[tours.length - 1]
  const totalVApport   = tours.reduce((s, t) => s + (Number(t.vApport) || 0), 0)
  const totalVDrain    = tours.reduce((s, t) => s + (Number(t.vDrain)  || 0), 0)
  const dureeTotal     = tours.reduce((s, t) => s + (Number(t.duree)   || 0), 0)
  const ecMoyApport    = tours.filter(t => t.ecApport).length ? (tours.reduce((s, t) => s + (Number(t.ecApport) || 0), 0) / tours.filter(t => t.ecApport).length) : null
  const phMoyApport    = tours.filter(t => t.phApport).length ? (tours.reduce((s, t) => s + (Number(t.phApport) || 0), 0) / tours.filter(t => t.phApport).length) : null
  const ecMoyDrain     = tours.filter(t => t.ecDrain).length  ? (tours.reduce((s, t) => s + (Number(t.ecDrain)  || 0), 0) / tours.filter(t => t.ecDrain).length)  : null
  const phMoyDrain     = tours.filter(t => t.phDrain).length  ? (tours.reduce((s, t) => s + (Number(t.phDrain)  || 0), 0) / tours.filter(t => t.phDrain).length)  : null
  const moyDrainFinale = lastTour?.moyPctDrain ?? null
  const ccBras = totalVApport && moyDrainFinale !== null && nbrGoutteurs && nbrBras && Number(nbrBras) > 0
    ? ((totalVApport * (1 - moyDrainFinale / 100) * Number(nbrGoutteurs)) / Number(nbrBras)).toFixed(1) : null

  const handleSave = async () => {
    if (!ferme || !date || tours.length === 0) {
      setError('Veuillez remplir la ferme, la date et au moins un tour.')
      return
    }
    setSaving(true); setError('')
    try {
      const payload = {
        ferme, station, serre, vanne, date,
        constantes: {
          nbrBras: nbrBras ? Number(nbrBras) : null,
          nbrGoutteurs: nbrGoutteurs ? Number(nbrGoutteurs) : null,
          poidsMatin: poidsMatin ? Number(poidsMatin) : null,
          heureMatin,
          poidsSoir: poidsSoir ? Number(poidsSoir) : null,
          heureSoir,
          bassinEC: bassinEC ? Number(bassinEC) : null,
          pctRessuyage: pctRessuyage ? Number(pctRessuyage) : null,
        },
        tours: tours.map(t => ({
          num_tour: t.num,
          rad: t.rad ? Number(t.rad) : null,
          cumul_rad: t.cumulRad ? Number(t.cumulRad) : null,
          heure: t.heure || null,
          duree_min: t.duree ? Number(t.duree) : null,
          temps_repos: t.tempsRepos,
          v_apport: t.vApport ? Number(t.vApport) : null,
          ec_apport: t.ecApport ? Number(t.ecApport) : null,
          ph_apport: t.phApport ? Number(t.phApport) : null,
          v_drain: t.vDrain ? Number(t.vDrain) : null,
          ec_drain: t.ecDrain ? Number(t.ecDrain) : null,
          ph_drain: t.phDrain ? Number(t.phDrain) : null,
          pct_drain: t.pctDrain,
          moy_pct_drain: t.moyPctDrain,
        })),
        bilan: {
          nbrTours: tours.length,
          dureeTotal: dureeTotal > 0 ? fmtDuree(dureeTotal) : null,
          totalVApport: totalVApport || null,
          totalVDrain: totalVDrain || null,
          ecMoyApport: ecMoyApport ? Number(ecMoyApport) : null,
          phMoyApport: phMoyApport ? Number(phMoyApport) : null,
          ecMoyDrain: ecMoyDrain ? Number(ecMoyDrain) : null,
          phMoyDrain: phMoyDrain ? Number(phMoyDrain) : null,
          moyDrainFinale,
          ccBras: ccBras ? Number(ccBras) : null,
        },
      }
      await updateSaisie(token, saisie.id, payload)
      onSaved()
      onClose()
    } catch (e) {
      try {
        const parsed = JSON.parse(e.message)
        setError(Array.isArray(parsed?.detail)
          ? parsed.detail.map(d => `${(d.loc||[]).slice(1).join('.')} : ${d.msg}`).join(' | ')
          : String(parsed?.detail || e.message))
      } catch { setError(String(e.message)) }
    } finally { setSaving(false) }
  }

  const inputStyle = {
    width: '100%', padding: '7px 10px', borderRadius: 8,
    border: `1.5px solid ${C.border}`, background: C.inputBg,
    color: C.text, fontSize: 12, fontFamily: 'inherit', outline: 'none',
  }
  const labelStyle = {
    display: 'block', color: C.textMuted, fontSize: 10, fontWeight: 700,
    textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 4,
  }
  const TH = ({ children, w, color }) => (
    <th style={{ padding: '7px 5px', textAlign: 'center', fontSize: 10, fontWeight: 700,
      textTransform: 'uppercase', letterSpacing: '0.07em', color: color || C.textDim,
      whiteSpace: 'nowrap', width: w, borderBottom: `1.5px solid ${C.border}` }}>
      {children}
    </th>
  )

  return (
    <div style={{
        position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
        zIndex: 1000, background: 'rgba(0,0,0,0.65)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: '24px',
    }}>
        <div style={{
        background: C.card, border: `1.5px solid ${C.border}`,
        borderRadius: 16, width: '100%', maxWidth: 1100,
        maxHeight: '90vh', overflowY: 'auto',
        boxShadow: '0 24px 80px rgba(0,0,0,0.6)',
        position: 'relative',
        }}>

        {/* Header modal */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '20px 28px', borderBottom: `1px solid ${C.border}` }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Pencil size={18} color={C.green} strokeWidth={2} />
            <div style={{ color: C.text, fontWeight: 800, fontSize: 15 }}>
              Modifier saisie — {saisie.date} · {saisie.farm_name}
            </div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none',
            cursor: 'pointer', color: C.textDim, padding: 4 }}>
            <X size={18} strokeWidth={2} />
          </button>
        </div>

        <div style={{ padding: '24px 28px' }}>

          {/* Sélecteurs */}
          <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr 1fr 1fr 150px', gap: 14, marginBottom: 18 }}>
            <div>
              <label style={labelStyle}>Ferme</label>
              <SSelect value={ferme} onChange={v => { setFerme(v); setStation('') }}
                options={fermeOptions} placeholder="Sélectionner…" C={C} />
            </div>
            <div>
              <label style={labelStyle}>Bloc (Station)</label>
              <SSelect value={station} onChange={setStation}
                options={stationOptions} placeholder="Sélectionner…" C={C} />
            </div>
            <div>
              <label style={labelStyle}>Serre</label>
              <input value={serre} onChange={e => setSerre(e.target.value)} style={inputStyle} placeholder="ex: S06" />
            </div>
            <div>
              <label style={labelStyle}>Vanne</label>
              <input value={vanne} onChange={e => setVanne(e.target.value)} style={inputStyle} placeholder="ex: 1" />
            </div>
            <div>
              <label style={labelStyle}>Date</label>
              <input type="date" value={date} onChange={e => setDate(e.target.value)} style={inputStyle} />
            </div>
          </div>

          {/* Constantes */}
          <div style={{ background: dark ? 'rgba(52,217,111,0.04)' : 'rgba(24,120,63,0.03)',
            border: `1px solid ${C.border}`, borderRadius: 12, padding: '16px 20px', marginBottom: 18 }}>
            <div style={{ fontSize: 11, fontWeight: 800, color: C.textMuted, textTransform: 'uppercase',
              letterSpacing: '0.1em', marginBottom: 14 }}>Constantes &amp; Substrat</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
              {[
                { label: 'Nbr Bras', val: nbrBras, set: setNbrBras, type: 'number' },
                { label: 'Nbr Goutteurs', val: nbrGoutteurs, set: setNbrGoutteurs, type: 'number' },
                { label: 'Poids matin (Kg)', val: poidsMatin, set: setPoidsMatin, type: 'number' },
                { label: 'Poids soir (Kg)', val: poidsSoir, set: setPoidsSoir, type: 'number' },
                { label: 'Bassin (EC)', val: bassinEC, set: setBassinEC, type: 'number' },
              ].map(f => (
                <div key={f.label}>
                  <label style={labelStyle}>{f.label}</label>
                  <input type={f.type} value={f.val} onChange={e => f.set(e.target.value)}
                    step="any" style={inputStyle} />
                </div>
              ))}
              <div>
                <label style={labelStyle}>Heure matin</label>
                <TimeInput value={heureMatin} onChange={setHeureMatin} C={C} />
              </div>
              <div>
                <label style={labelStyle}>Heure soir</label>
                <TimeInput value={heureSoir} onChange={setHeureSoir} C={C} />
              </div>
              <div>
                <label style={labelStyle}>% Ressuyage</label>
                <div style={{ padding: '7px 10px', borderRadius: 8, textAlign: 'center',
                  background: pctRessuyage !== null ? `${C.green}10` : C.toggleBg,
                  border: `1.5px solid ${pctRessuyage !== null ? C.green + '40' : C.border}`,
                  fontSize: 14, fontWeight: 900,
                  color: pctRessuyage !== null ? C.green : C.textDim,
                  minHeight: 33, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  {pctRessuyage !== null ? `${pctRessuyage}%` : '—'}
                </div>
              </div>
            </div>
          </div>

          {/* Table tours */}
          <div style={{ background: C.card, border: `1.5px solid ${C.border}`, borderRadius: 12,
            overflow: 'hidden', marginBottom: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '12px 16px', borderBottom: `1px solid ${C.border}` }}>
              <div style={{ fontSize: 11, fontWeight: 800, color: C.textMuted, textTransform: 'uppercase',
                letterSpacing: '0.1em' }}>Tours</div>
              <button onClick={addTour} style={{ display: 'flex', alignItems: 'center', gap: 6,
                padding: '6px 14px', background: `${C.green}10`, border: `1.5px solid ${C.green}40`,
                borderRadius: 7, color: C.green, fontSize: 12, fontWeight: 700,
                fontFamily: 'inherit', cursor: 'pointer' }}>
                <Plus size={13} strokeWidth={2.5} /> Nouveau tour
              </button>
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: 'inherit' }}>
                <thead>
                  <tr>
                    <TH w={36}>N°</TH>
                    <TH w={68}>Rad.</TH>
                    <TH w={76} color={C.blue}>Cumul Rad</TH>
                    <TH w={108}>Heure</TH>
                    <TH w={76} color={C.textMuted}>T.Repos</TH>
                    <TH w={70}>Durée(min)</TH>
                    <TH w={76}>V.Apport</TH>
                    <TH w={70}>EC Apport</TH>
                    <TH w={70}>pH Apport</TH>
                    <TH w={70}>V.Drain</TH>
                    <TH w={70}>EC Drain</TH>
                    <TH w={70}>pH Drain</TH>
                    <TH w={70} color={C.amber}>% Drain</TH>
                    <TH w={78} color={C.amber}>Moy % Drain</TH>
                    <TH w={32}></TH>
                  </tr>
                </thead>
                <tbody>
                  {tours.length === 0 ? (
                    <tr><td colSpan={15} style={{ padding: '32px 0', textAlign: 'center',
                      color: C.textDim, fontSize: 12 }}>Aucun tour — cliquer sur Nouveau tour</td></tr>
                  ) : tours.map((t, i) => (
                    <tr key={t.id} style={{ borderBottom: i < tours.length - 1 ? `1px solid ${C.border}` : 'none' }}>
                      <td style={{ padding: '5px 4px', textAlign: 'center' }}>
                        <div style={{ width: 26, height: 26, borderRadius: 6, margin: '0 auto',
                          background: `${C.green}12`, border: `1px solid ${C.green}30`,
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          fontSize: 11, fontWeight: 900, color: C.green }}>{t.num}</div>
                      </td>
                      <td style={{ padding: '5px 4px', textAlign: 'center' }}>
                        <TInput value={t.rad} onChange={v => updateTour(t.id, 'rad', v)} C={C} />
                      </td>
                      <td style={{ padding: '5px 4px', textAlign: 'center' }}>
                        <div style={{ fontSize: 12, fontWeight: 700, color: C.blue }}>
                          {t.cumulRad > 0 ? fmtNum(t.cumulRad, 0) : '—'}
                        </div>
                      </td>
                      <td style={{ padding: '5px 4px', textAlign: 'center' }}>
                        <TimeInput value={t.heure} onChange={v => updateTour(t.id, 'heure', v)} C={C} />
                      </td>
                      <td style={{ padding: '5px 4px', textAlign: 'center' }}>
                        <div style={{ fontSize: 12, fontWeight: 700, color: t.tempsRepos !== null ? C.textMuted : C.textDim }}>
                          {t.tempsRepos !== null ? `${t.tempsRepos} min` : i === 0 ? '—' : '?'}
                        </div>
                      </td>
                      <td style={{ padding: '5px 4px', textAlign: 'center' }}>
                        <TInput value={t.duree} onChange={v => updateTour(t.id, 'duree', v)} C={C} />
                      </td>
                      <td style={{ padding: '5px 4px', textAlign: 'center' }}>
                        <TInput value={t.vApport} onChange={v => updateTour(t.id, 'vApport', v)} C={C} />
                      </td>
                      <td style={{ padding: '5px 4px', textAlign: 'center' }}>
                        <TInput value={t.ecApport} onChange={v => updateTour(t.id, 'ecApport', v)} C={C} />
                      </td>
                      <td style={{ padding: '5px 4px', textAlign: 'center' }}>
                        <TInput value={t.phApport} onChange={v => updateTour(t.id, 'phApport', v)} C={C} />
                      </td>
                      <td style={{ padding: '5px 4px', textAlign: 'center' }}>
                        <TInput value={t.vDrain} onChange={v => updateTour(t.id, 'vDrain', v)} C={C} />
                      </td>
                      <td style={{ padding: '5px 4px', textAlign: 'center' }}>
                        <TInput value={t.ecDrain} onChange={v => updateTour(t.id, 'ecDrain', v)} C={C} />
                      </td>
                      <td style={{ padding: '5px 4px', textAlign: 'center' }}>
                        <TInput value={t.phDrain} onChange={v => updateTour(t.id, 'phDrain', v)} C={C} />
                      </td>
                      <td style={{ padding: '5px 4px', textAlign: 'center' }}>
                        <div style={{ fontSize: 12, fontWeight: 700, color: t.pctDrain !== null ? C.amber : C.textDim }}>
                          {t.pctDrain !== null ? `${fmtNum(t.pctDrain, 1)}%` : '—'}
                        </div>
                      </td>
                      <td style={{ padding: '5px 4px', textAlign: 'center' }}>
                        <div style={{ fontSize: 12, fontWeight: 700, color: t.moyPctDrain !== null ? C.amber : C.textDim }}>
                          {t.moyPctDrain !== null ? `${fmtNum(t.moyPctDrain, 1)}%` : '—'}
                        </div>
                      </td>
                      <td style={{ padding: '5px 4px', textAlign: 'center' }}>
                        <button onClick={() => deleteTourRow(t.id)}
                          style={{ background: 'none', border: 'none', cursor: 'pointer',
                            color: C.textDim, padding: 3, borderRadius: 4 }}
                          onMouseEnter={e => e.currentTarget.style.color = C.red}
                          onMouseLeave={e => e.currentTarget.style.color = C.textDim}>
                          <Trash2 size={12} strokeWidth={2} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div ref={tableBottomRef} />
            </div>
          </div>

          {error && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px',
              background: dark ? '#2a0a0a' : '#fef2f2', border: `1px solid ${C.red}30`,
              borderRadius: 8, color: C.red, fontSize: 12, marginBottom: 14 }}>
              <AlertCircle size={14} strokeWidth={2} />{error}
            </div>
          )}

          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
            <button onClick={onClose} style={{ padding: '9px 20px', borderRadius: 8,
              border: `1.5px solid ${C.border}`, background: 'transparent',
              color: C.textMuted, fontSize: 13, fontWeight: 700, fontFamily: 'inherit', cursor: 'pointer' }}>
              Annuler
            </button>
            <button onClick={handleSave} disabled={saving}
              style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '9px 20px',
                background: saving ? C.toggleBg : C.green, color: saving ? C.textDim : '#fff',
                border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 700,
                fontFamily: 'inherit', cursor: saving ? 'not-allowed' : 'pointer' }}>
              <Save size={14} strokeWidth={2.5} />
              {saving ? 'Enregistrement…' : 'Enregistrer'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Tours expand table ────────────────────────────────────────
function ToursTable({ saisieId, token, C, dark }) {
  const [tours, setTours] = useState(null)

  useEffect(() => {
    getSaisie(token, saisieId).then(d => setTours(d.tours || [])).catch(() => setTours([]))
  }, [saisieId])

  if (tours === null) return (
    <tr><td colSpan={20} style={{ padding: '20px 16px', textAlign: 'center', color: C.textDim, fontSize: 12 }}>
      Chargement…
    </td></tr>
  )

  const TH2 = ({ children, color }) => (
    <th style={{ padding: '7px 8px', fontSize: 10, fontWeight: 700, textTransform: 'uppercase',
      letterSpacing: '0.07em', color: color || C.textDim, textAlign: 'center',
      whiteSpace: 'nowrap', background: dark ? 'rgba(52,217,111,0.05)' : 'rgba(24,120,63,0.04)',
      borderBottom: `1px solid ${C.border}` }}>{children}</th>
  )

  return (
    <div>
      <tr>
        <td colSpan={20} style={{ padding: 0 }}>
          <div style={{ margin: '0 0 0 32px', borderLeft: `3px solid ${C.green}30` }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: 'inherit' }}>
              <thead>
                <tr>
                  <TH2>N° tour</TH2>
                  <TH2>Rad.</TH2>
                  <TH2 color={C.blue}>Cumul.Drain</TH2>
                  <TH2>Heure</TH2>
                  <TH2>T.Repos</TH2>
                  <TH2>Durée(min)</TH2>
                  <TH2>V.Apport</TH2>
                  <TH2>EC Apport</TH2>
                  <TH2>pH Apport</TH2>
                  <TH2>V.Drain</TH2>
                  <TH2>EC Drain</TH2>
                  <TH2>pH Drain</TH2>
                  <TH2 color={C.amber}>% Drain</TH2>
                  <TH2 color={C.amber}>% Drain moyen</TH2>
                </tr>
              </thead>
              <tbody>
                {tours.length === 0 ? (
                  <tr><td colSpan={14} style={{ padding: '16px', textAlign: 'center',
                    color: C.textDim, fontSize: 12 }}>Aucun tour enregistré</td></tr>
                ) : tours.map((t, i) => (
                  <tr key={t.id}
                    style={{ borderBottom: i < tours.length - 1 ? `1px solid ${C.border}` : 'none',
                      background: i % 2 === 0 ? 'transparent' : (dark ? 'rgba(255,255,255,0.01)' : 'rgba(0,0,0,0.01)') }}
                    onMouseEnter={e => e.currentTarget.style.background = C.tableHover}
                    onMouseLeave={e => e.currentTarget.style.background = i % 2 === 0 ? 'transparent' : (dark ? 'rgba(255,255,255,0.01)' : 'rgba(0,0,0,0.01)')}>
                    <td style={{ padding: '8px 8px', textAlign: 'center' }}>
                      <div style={{ width: 26, height: 26, borderRadius: 6, margin: '0 auto',
                        background: `${C.green}12`, border: `1px solid ${C.green}30`,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: 11, fontWeight: 900, color: C.green }}>{t.num_tour}</div>
                    </td>
                    {[
                      { v: t.rad,          dec: 0 },
                      { v: t.cumul_rad,    dec: 0, color: C.blue },
                      { v: t.heure,        raw: true },
                      { v: t.temps_repos !== null ? `${t.temps_repos} min` : '—', raw: true, color: C.textMuted },
                      { v: t.duree_min,    dec: 0 },
                      { v: t.v_apport,     dec: 1 },
                      { v: t.ec_apport,    dec: 2 },
                      { v: t.ph_apport,    dec: 2 },
                      { v: t.v_drain,      dec: 1 },
                      { v: t.ec_drain,     dec: 2 },
                      { v: t.ph_drain,     dec: 2 },
                      { v: t.pct_drain !== null ? `${fmtNum(t.pct_drain, 1)}%` : '—', raw: true, color: C.amber },
                      { v: t.moy_pct_drain !== null ? `${fmtNum(t.moy_pct_drain, 1)}%` : '—', raw: true, color: C.amber },
                    ].map((cell, ci) => (
                      <td key={ci} style={{ padding: '8px 8px', textAlign: 'center',
                        fontSize: 12, fontWeight: cell.color ? 700 : 400,
                        color: cell.color || C.text }}>
                        {cell.raw ? (cell.v ?? '—') : fmtNum(cell.v, cell.dec ?? 2)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </td>
      </tr>
    </div>
  )
}

// ── Filter input ──────────────────────────────────────────────
function FilterInput({ value, onChange, placeholder, C, type = 'text' }) {
  return (
    <div style={{ position: 'relative' }}>
      <input type={type} value={value} onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        style={{ width: '100%', padding: '6px 28px 6px 8px', borderRadius: 6,
          border: `1.5px solid ${C.border}`, background: C.inputBg,
          color: C.text, fontSize: 11, fontFamily: 'inherit', outline: 'none' }} />
      {value && (
        <button onClick={() => onChange('')}
          style={{ position: 'absolute', right: 5, top: '50%', transform: 'translateY(-50%)',
            background: 'none', border: 'none', cursor: 'pointer', color: C.textDim, padding: 2 }}>
          <X size={11} strokeWidth={2} />
        </button>
      )}
    </div>
  )
}

// ── Main HistoriquePage ───────────────────────────────────────
export default function HistoriquePage({ token, C, dark }) {
  const [saisies, setSaisies]     = useState([])
  const [total, setTotal]         = useState(0)
  const [pages, setPages]         = useState(1)
  const [page, setPage]           = useState(1)
  const [perPage, setPerPage]     = useState(10)
  const [loading, setLoading]     = useState(true)
  const [farms, setFarms]         = useState([])
  const [expandedIds, setExpandedIds] = useState(new Set())
  const [editingSaisie, setEditingSaisie] = useState(null)
  const [confirmDelete, setConfirmDelete] = useState(null)

  // Filtres
  const [fDate,      setFDate]      = useState('')
  const [fFerme,     setFFerme]     = useState('')
  const [fStation,   setFStation]   = useState('')
  const [fSerre,     setFSerre]     = useState('')
  const [fVanne,     setFVanne]     = useState('')
  const [fNbrBras,   setFNbrBras]   = useState('')
  const [fNbrGoutt,  setFNbrGoutt]  = useState('')
  const [fPoidsMat,  setFPoidsMat]  = useState('')
  const [fHeureMat,  setFHeureMat]  = useState('')
  const [fPoidsSoir, setFPoidsSoir] = useState('')
  const [fHeureSoir, setFHeureSoir] = useState('')
  const [fBassin,    setFBassin]    = useState('')

  useEffect(() => {
    getDevices(token).then(setFarms).catch(() => {})
  }, [token])

  const load = useCallback(async (p = 1) => {
    setLoading(true)
    try {
      const params = { page: p, perPage }
      if (fFerme) params.farmName = fFerme
      if (fDate)  { params.dateFrom = fDate; params.dateTo = fDate }
      const data = await getSaisies(token, params)
      setSaisies(data.data || [])
      setTotal(data.total || 0)
      setPages(data.pages || 1)
      setPage(p)
    } catch { setSaisies([]) }
    finally { setLoading(false) }
  }, [token, fFerme, fDate, perPage])

  useEffect(() => { load(1) }, [fFerme, fDate, perPage])

  // Filtre côté client pour les champs non filtrés côté API
  const filtered = saisies.filter(s =>
    (!fStation   || String(s.station   || '').toLowerCase().includes(fStation.toLowerCase())) &&
    (!fSerre     || String(s.serre     || '').toLowerCase().includes(fSerre.toLowerCase())) &&
    (!fVanne     || String(s.vanne     || '').toLowerCase().includes(fVanne.toLowerCase())) &&
    (!fNbrBras   || String(s.nbr_bras  || '').includes(fNbrBras)) &&
    (!fNbrGoutt  || String(s.nbr_goutteurs || '').includes(fNbrGoutt)) &&
    (!fPoidsMat  || String(s.poids_matin   || '').includes(fPoidsMat)) &&
    (!fHeureMat  || String(s.heure_matin   || '').includes(fHeureMat)) &&
    (!fPoidsSoir || String(s.poids_soir    || '').includes(fPoidsSoir)) &&
    (!fHeureSoir || String(s.heure_soir    || '').includes(fHeureSoir)) &&
    (!fBassin    || String(s.bassin_ec     || '').includes(fBassin))
  )

  const toggleExpand = (id) => {
    setExpandedIds(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  const handleDelete = async () => {
    if (!confirmDelete) return
    try {
      await deleteSaisie(token, confirmDelete.id)
      setConfirmDelete(null)
      load(page)
    } catch (e) { alert(e.message) }
  }

  const cardStyle = {
    background: C.card, border: `1.5px solid ${C.border}`,
    borderRadius: 14, overflow: 'hidden',
  }

  const TH = ({ children, color }) => (
    <th style={{ padding: '9px 10px', textAlign: 'left', fontSize: 10, fontWeight: 700,
      textTransform: 'uppercase', letterSpacing: '0.08em', color: color || C.textDim,
      whiteSpace: 'nowrap', borderBottom: `1.5px solid ${C.border}` }}>{children}</th>
  )

  return (
    <div style={{ animation: 'az-fade-in 0.3s ease both' }}>

      {/* Modals */}
      {confirmDelete && (
        <ConfirmModal saisie={confirmDelete} onConfirm={handleDelete}
          onCancel={() => setConfirmDelete(null)} C={C} />
      )}
      {editingSaisie && (
        <EditModal saisie={editingSaisie} token={token} farms={farms}
          onSaved={() => load(page)} onClose={() => setEditingSaisie(null)} C={C} dark={dark} />
      )}

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 28 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 36, height: 36, borderRadius: 10,
            background: dark ? 'rgba(52,217,111,0.12)' : 'rgba(24,120,63,0.10)',
            border: `1.5px solid ${C.green}30`,
            display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <History size={18} color={C.green} strokeWidth={2} />
          </div>
          <div>
            <div style={{ fontSize: 20, fontWeight: 900, color: C.text }}>Historique</div>
            <div style={{ fontSize: 11, color: C.textDim }}>{total} saisie{total > 1 ? 's' : ''} enregistrée{total > 1 ? 's' : ''}</div>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <select value={perPage} onChange={e => setPerPage(Number(e.target.value))}
            style={{ padding: '7px 10px', borderRadius: 7, border: `1.5px solid ${C.border}`,
              background: C.inputBg, color: C.text, fontSize: 12, fontFamily: 'inherit',
              outline: 'none', cursor: 'pointer' }}>
            {[10, 20, 50].map(n => <option key={n} value={n}>{n}</option>)}
          </select>
        </div>
      </div>

      {/* Table */}
      <div style={cardStyle}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: 'inherit' }}>
            <thead>
            {/* Headers EN PREMIER */}
            <tr>
                <TH />
                <TH>Date</TH>
                <TH>Ferme</TH>
                <TH>Bloc</TH>
                <TH>Serre</TH>
                <TH>Vanne</TH>
                <TH>Nbr Bras</TH>
                <TH>Nbr Goutteurs</TH>
                <TH>Pds matin(Kg)</TH>
                <TH>H. matin</TH>
                <TH>Pds Soir(Kg)</TH>
                <TH>H. soir</TH>
                <TH>Bassin (EC)</TH>
                <TH color={C.green}>Séchage(%)</TH>
                <TH>Actions</TH>
            </tr>
            {/* Filtres EN DESSOUS */}
            <tr style={{ background: dark ? 'rgba(255,255,255,0.02)' : 'rgba(0,0,0,0.02)' }}>
                <th style={{ padding: '6px 8px', borderBottom: `1px solid ${C.border}` }} />
                <th style={{ padding: '6px 8px', borderBottom: `1px solid ${C.border}` }}>
                <FilterInput value={fDate} onChange={setFDate} placeholder="" C={C} type="date" />
                </th>
                <th style={{ padding: '6px 8px', borderBottom: `1px solid ${C.border}` }}>
                <FilterInput value={fFerme} onChange={setFFerme} placeholder="" C={C} />
                </th>
                <th style={{ padding: '6px 8px', borderBottom: `1px solid ${C.border}` }}>
                <FilterInput value={fStation} onChange={setFStation} placeholder="" C={C} />
                </th>
                <th style={{ padding: '6px 8px', borderBottom: `1px solid ${C.border}` }}>
                <FilterInput value={fSerre} onChange={setFSerre} placeholder="" C={C} />
                </th>
                <th style={{ padding: '6px 8px', borderBottom: `1px solid ${C.border}` }}>
                <FilterInput value={fVanne} onChange={setFVanne} placeholder="" C={C} />
                </th>
                <th style={{ padding: '6px 8px', borderBottom: `1px solid ${C.border}` }}>
                <FilterInput value={fNbrBras} onChange={setFNbrBras} placeholder="" C={C} />
                </th>
                <th style={{ padding: '6px 8px', borderBottom: `1px solid ${C.border}` }}>
                <FilterInput value={fNbrGoutt} onChange={setFNbrGoutt} placeholder="" C={C} />
                </th>
                <th style={{ padding: '6px 8px', borderBottom: `1px solid ${C.border}` }}>
                <FilterInput value={fPoidsMat} onChange={setFPoidsMat} placeholder="" C={C} />
                </th>
                <th style={{ padding: '6px 8px', borderBottom: `1px solid ${C.border}` }}>
                <FilterInput value={fHeureMat} onChange={setFHeureMat} placeholder="" C={C} />
                </th>
                <th style={{ padding: '6px 8px', borderBottom: `1px solid ${C.border}` }}>
                <FilterInput value={fPoidsSoir} onChange={setFPoidsSoir} placeholder="" C={C} />
                </th>
                <th style={{ padding: '6px 8px', borderBottom: `1px solid ${C.border}` }}>
                <FilterInput value={fHeureSoir} onChange={setFHeureSoir} placeholder="" C={C} />
                </th>
                <th style={{ padding: '6px 8px', borderBottom: `1px solid ${C.border}` }}>
                <FilterInput value={fBassin} onChange={setFBassin} placeholder="" C={C} />
                </th>
                <th colSpan={2} style={{ borderBottom: `1px solid ${C.border}` }} />
            </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={15} style={{ padding: '48px 0', textAlign: 'center', color: C.textDim, fontSize: 13 }}>
                  Chargement…
                </td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan={15} style={{ padding: '48px 0', textAlign: 'center', color: C.textDim, fontSize: 13 }}>
                  Aucune saisie trouvée
                </td></tr>
              ) : filtered.map((s, i) => {
                const expanded = expandedIds.has(s.id)
                return (
                  <>
                    <tr key={s.id}
                      style={{ borderBottom: !expanded ? `1px solid ${C.border}` : 'none',
                        transition: 'background 0.12s' }}
                      onMouseEnter={e => { if (!expanded) e.currentTarget.style.background = C.tableHover }}
                      onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}>

                      {/* Expand button */}
                      <td style={{ padding: '10px 8px', textAlign: 'center' }}>
                        <button onClick={() => toggleExpand(s.id)}
                          style={{ background: expanded ? `${C.green}12` : C.toggleBg,
                            border: `1px solid ${expanded ? C.green + '40' : C.border}`,
                            borderRadius: 5, padding: '3px 6px', cursor: 'pointer',
                            color: expanded ? C.green : C.textMuted,
                            display: 'flex', alignItems: 'center' }}>
                          {expanded
                            ? <ChevronUp size={13} strokeWidth={2.5} />
                            : <ChevronDown size={13} strokeWidth={2.5} />}
                        </button>
                      </td>

                      <td style={{ padding: '10px 10px', fontWeight: 700, color: C.text, fontSize: 12, whiteSpace: 'nowrap' }}>
                        {s.date}
                      </td>
                      <td style={{ padding: '10px 10px', fontSize: 12, color: C.text, fontWeight: 600 }}>{s.farm_name}</td>
                      <td style={{ padding: '10px 10px', fontSize: 12, color: C.textMuted }}>{s.station || '—'}</td>
                      <td style={{ padding: '10px 10px', fontSize: 12, color: C.textMuted }}>{s.serre || '—'}</td>
                      <td style={{ padding: '10px 10px', fontSize: 12, color: C.textMuted }}>{s.vanne || '—'}</td>
                      <td style={{ padding: '10px 10px', fontSize: 12, textAlign: 'center', color: C.text }}>{s.nbr_bras ?? '—'}</td>
                      <td style={{ padding: '10px 10px', fontSize: 12, textAlign: 'center', color: C.text }}>{s.nbr_goutteurs ?? '—'}</td>
                      <td style={{ padding: '10px 10px', fontSize: 12, textAlign: 'center', color: C.text }}>{s.poids_matin ?? '—'}</td>
                      <td style={{ padding: '10px 10px', fontSize: 12, textAlign: 'center', color: C.textMuted }}>{s.heure_matin || '—'}</td>
                      <td style={{ padding: '10px 10px', fontSize: 12, textAlign: 'center', color: C.text }}>{s.poids_soir ?? '—'}</td>
                      <td style={{ padding: '10px 10px', fontSize: 12, textAlign: 'center', color: C.textMuted }}>{s.heure_soir || '—'}</td>
                      <td style={{ padding: '10px 10px', fontSize: 12, textAlign: 'center', color: C.text }}>{s.bassin_ec ?? '—'}</td>

                      {/* % Ressuyage badge */}
                      <td style={{ padding: '10px 10px', textAlign: 'center' }}>
                        {s.pct_ressuyage !== null && s.pct_ressuyage !== undefined ? (
                          <span style={{ background: `${C.green}15`, color: C.green,
                            border: `1px solid ${C.green}30`, borderRadius: 6,
                            padding: '3px 8px', fontSize: 12, fontWeight: 700 }}>
                            {fmtNum(s.pct_ressuyage, 1)}%
                          </span>
                        ) : <span style={{ color: C.textDim }}>—</span>}
                      </td>

                      {/* Actions */}
                      <td style={{ padding: '10px 10px' }}>
                        <div style={{ display: 'flex', gap: 6 }}>
                          <button onClick={(e) => { e.stopPropagation(); setEditingSaisie(s) }}
                            style={{ display: 'flex', alignItems: 'center', gap: 5,
                              padding: '5px 10px', borderRadius: 6,
                              border: `1.5px solid ${C.border}`, background: 'transparent',
                              color: C.textMuted, fontSize: 11, fontWeight: 700,
                              fontFamily: 'inherit', cursor: 'pointer' }}
                            onMouseEnter={e => { e.currentTarget.style.borderColor = C.green; e.currentTarget.style.color = C.green }}
                            onMouseLeave={e => { e.currentTarget.style.borderColor = C.border; e.currentTarget.style.color = C.textMuted }}>
                            <Pencil size={11} strokeWidth={2} /> Modifier
                          </button>
                          <button onClick={(e) => { e.stopPropagation(); setConfirmDelete(s) }}
                            style={{ display: 'flex', alignItems: 'center', gap: 5,
                              padding: '5px 10px', borderRadius: 6,
                              border: `1.5px solid ${C.border}`, background: 'transparent',
                              color: C.textMuted, fontSize: 11, fontWeight: 700,
                              fontFamily: 'inherit', cursor: 'pointer' }}
                            onMouseEnter={e => { e.currentTarget.style.borderColor = C.red; e.currentTarget.style.color = C.red }}
                            onMouseLeave={e => { e.currentTarget.style.borderColor = C.border; e.currentTarget.style.color = C.textMuted }}>
                            <Trash2 size={11} strokeWidth={2} />
                          </button>
                        </div>
                      </td>
                    </tr>

                    {/* Tours expand */}
                    {expanded && (
                      <ToursTable key={`tours-${s.id}`} saisieId={s.id} token={token} C={C} dark={dark} />
                    )}
                  </>
                )
              })}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        <div style={{ padding: '12px 16px', borderTop: `1px solid ${C.border}`,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ color: C.textDim, fontSize: 12 }}>
            {total} saisie{total > 1 ? 's' : ''} · page {page}/{pages}
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <button onClick={() => load(page - 1)} disabled={page <= 1}
              style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '5px 12px',
                borderRadius: 6, border: `1.5px solid ${C.border}`, background: 'transparent',
                color: C.textMuted, fontSize: 12, fontWeight: 700,
                cursor: page <= 1 ? 'not-allowed' : 'pointer',
                opacity: page <= 1 ? 0.4 : 1, fontFamily: 'inherit' }}>
              <ChevronLeft size={13} strokeWidth={2} /> Préc
            </button>
            {Array.from({ length: Math.min(pages, 5) }, (_, i) => {
              const p = i + 1
              return (
                <button key={p} onClick={() => load(p)}
                  style={{ width: 32, height: 32, borderRadius: 6,
                    border: `1.5px solid ${page === p ? C.green : C.border}`,
                    background: page === p ? C.green : 'transparent',
                    color: page === p ? '#fff' : C.textMuted,
                    fontSize: 12, fontWeight: 700, fontFamily: 'inherit', cursor: 'pointer' }}>
                  {p}
                </button>
              )
            })}
            <button onClick={() => load(page + 1)} disabled={page >= pages}
              style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '5px 12px',
                borderRadius: 6, border: `1.5px solid ${C.border}`, background: 'transparent',
                color: C.textMuted, fontSize: 12, fontWeight: 700,
                cursor: page >= pages ? 'not-allowed' : 'pointer',
                opacity: page >= pages ? 0.4 : 1, fontFamily: 'inherit' }}>
              Suiv <ChevronRight size={13} strokeWidth={2} />
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}