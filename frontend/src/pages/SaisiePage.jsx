// ============================================================
// frontend/src/pages/SaisiePage.jsx
// Saisie journalière — Azura Irrigation IA
// ============================================================

import { useState, useEffect, useRef } from 'react'
import {
  Plus, Save, ChevronDown, Clock, Leaf,
  Droplets, FlaskConical, BarChart2, Trash2, AlertCircle
} from 'lucide-react'
import { getDevices } from '../api/client.js'

// ── helpers ───────────────────────────────────────────────────
const today = () => new Date().toISOString().split('T')[0]

const fmtNum = (v, dec = 2) => {
  if (v === null || v === undefined || v === '' || isNaN(Number(v))) return '—'
  return Number(v).toFixed(dec)
}

function newTour(num) {
  return {
    id: Date.now() + num,
    num,
    rad: '',
    cumulRad: 0,
    heure: '',
    duree: '',
    tempsRepos: null,
    vApport: '',
    ecApport: '',
    phApport: '',
    vDrain: '',
    ecDrain: '',
    phDrain: '',
    pctDrain: null,
    moyPctDrain: null,
  }
}

// ── Petit input stylisé ───────────────────────────────────────
function TInput({ value, onChange, placeholder = '', disabled = false, width = 72, align = 'center', type = 'number' }) {
  return (
    <input
      type={type}
      value={value}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      disabled={disabled}
      step="any"
      style={{
        width, textAlign: align,
        padding: '5px 6px',
        borderRadius: 6,
        border: `1.5px solid ${disabled ? 'transparent' : '#c8dece'}`,
        background: disabled ? 'transparent' : '#f9fbfa',
        color: disabled ? '#3a6b4a' : '#0d1f14',
        fontSize: 12, fontFamily: 'inherit',
        outline: 'none',
        fontWeight: disabled ? 700 : 400,
      }}
    />
  )
}

// ── Sélecteur Heure:Minute ────────────────────────────────────
function TimeInput({ value, onChange, C }) {
  const [h, m] = value ? value.split(':') : ['', '']
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
      <select
        value={h}
        onChange={e => onChange(`${e.target.value}:${m || '00'}`)}
        style={{
          width: 46, padding: '5px 2px', borderRadius: 6, textAlign: 'center',
          border: `1.5px solid ${C.border}`, background: C.inputBg,
          color: C.text, fontSize: 12, fontFamily: 'inherit', outline: 'none',
        }}
      >
        <option value="">HH</option>
        {Array.from({ length: 24 }, (_, i) => (
          <option key={i} value={String(i).padStart(2, '0')}>{String(i).padStart(2, '0')}</option>
        ))}
      </select>
      <span style={{ color: C.textDim, fontWeight: 700, fontSize: 13 }}>:</span>
      <select
        value={m}
        onChange={e => onChange(`${h || '00'}:${e.target.value}`)}
        style={{
          width: 46, padding: '5px 2px', borderRadius: 6, textAlign: 'center',
          border: `1.5px solid ${C.border}`, background: C.inputBg,
          color: C.text, fontSize: 12, fontFamily: 'inherit', outline: 'none',
        }}
      >
        <option value="">MM</option>
        {Array.from({ length: 60 }, (_, i) => (
          <option key={i} value={String(i).padStart(2, '0')}>{String(i).padStart(2, '0')}</option>
        ))}
      </select>
    </div>
  )
}

// ── Select stylisé ────────────────────────────────────────────
function StyledSelect({ value, onChange, options, placeholder, C, width = '100%' }) {
  return (
    <div style={{ position: 'relative', width }}>
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        style={{
          width: '100%', padding: '9px 32px 9px 12px',
          borderRadius: 8, border: `1.5px solid ${C.border}`,
          background: C.inputBg, color: value ? C.text : C.textDim,
          fontSize: 13, fontFamily: 'inherit', outline: 'none',
          appearance: 'none', cursor: 'pointer',
        }}
      >
        <option value="">{placeholder}</option>
        {options.map(o => (
          <option key={o.value ?? o} value={o.value ?? o}>{o.label ?? o}</option>
        ))}
      </select>
      <ChevronDown size={13} strokeWidth={2} style={{
        position: 'absolute', right: 10, top: '50%',
        transform: 'translateY(-50%)', color: C.textDim, pointerEvents: 'none',
      }} />
    </div>
  )
}

// ── Label section ─────────────────────────────────────────────
function SLabel({ children, C }) {
  return (
    <div style={{
      fontSize: 10, fontWeight: 700, textTransform: 'uppercase',
      letterSpacing: '0.1em', color: C.textDim, marginBottom: 5,
    }}>
      {children}
    </div>
  )
}

// ── Bilan card ────────────────────────────────────────────────
function BilanCard({ title, apport, drainage, color, icon: Icon, C, dark }) {
  return (
    <div style={{
      background: dark ? `${color}10` : `${color}08`,
      border: `1.5px solid ${color}30`,
      borderRadius: 12, padding: '14px 18px', flex: 1,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <div style={{ fontSize: 12, fontWeight: 800, color, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
          {title}
        </div>
        <div style={{
          width: 28, height: 28, borderRadius: 7,
          background: `${color}18`, border: `1px solid ${color}30`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <Icon size={14} color={color} strokeWidth={2} />
        </div>
      </div>
      <div style={{ display: 'flex', gap: 16 }}>
        <div>
          <div style={{ fontSize: 10, color: C.textDim, marginBottom: 2 }}>Apport</div>
          <div style={{ fontSize: 18, fontWeight: 900, color }}>{apport ?? '—'}</div>
        </div>
        {drainage !== undefined && (
          <div>
            <div style={{ fontSize: 10, color: C.textDim, marginBottom: 2 }}>Drainage</div>
            <div style={{ fontSize: 18, fontWeight: 900, color }}>{drainage ?? '—'}</div>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Colonne header ────────────────────────────────────────────
function TH({ children, w, color }) {
  return (
    <th style={{
      padding: '8px 6px', textAlign: 'center',
      fontSize: 10, fontWeight: 700, textTransform: 'uppercase',
      letterSpacing: '0.07em', color: color || '#6fa882',
      whiteSpace: 'nowrap', width: w,
      borderBottom: '1.5px solid #e0ece5',
    }}>
      {children}
    </th>
  )
}

// ── Main Page ─────────────────────────────────────────────────
export default function SaisiePage({ token, auth, C, dark }) {
  // ── Sélecteurs ──
  const [farms, setFarms]     = useState([])
  const [ferme, setFerme]     = useState('')
  const [bloc, setBloc]       = useState('')
  const [serre, setSerre]     = useState('')
  const [vanne, setVanne]     = useState('')
  const [date, setDate]       = useState(today())

  // ── Constantes & Substrat ──
  const [nbrBras, setNbrBras]         = useState('')
  const [nbrGoutteurs, setNbrGoutteurs] = useState('')
  const [poidsMatin, setPoidsMatin]   = useState('')
  const [heureMatin, setHeureMatin]   = useState('')
  const [poidsSoir, setPoidsSoir]     = useState('')
  const [heureSoir, setHeureSoir]     = useState('')
  const [bassinEC, setBassinEC]       = useState('')

  // ── Tours ──
  const [tours, setTours] = useState([])

  // ── Saving ──
  const [saving, setSaving] = useState(false)
  const [saved, setSaved]   = useState(false)
  const [error, setError]   = useState('')

  // ── Load farms ──
  useEffect(() => {
    getDevices(token)
      .then(setFarms)
      .catch(() => setFarms([]))
  }, [token])

  // ── Options dérivées ──
  const fermeOptions = farms.map(f => ({ value: f.farm_name, label: f.farm_name }))
  const selectedFarm = farms.find(f => f.farm_name === ferme)
  const houses = selectedFarm?.houses || []
  const blocOptions = [...new Set(houses.map(h => h.house_number))].map(v => ({ value: v, label: `House ${v}` }))
  const serreOptions = houses.filter(h => h.house_number === bloc).map(h => ({ value: h.house_number, label: `S${h.house_number}` }))

  // ── % Ressuyage auto ──
  const pctRessuyage = poidsMatin && poidsSoir && Number(poidsMatin) > 0
    ? (((Number(poidsSoir) - Number(poidsMatin)) / Number(poidsMatin)) * 100).toFixed(1)
    : null

  // ── Recalcul d'un tour ──────────────────────────────────────
  const recalculTours = (list) => {
    return list.map((t, i) => {
      const prev = i > 0 ? list[i - 1] : null

      // Cumul Rad
      const cumulRad = list.slice(0, i + 1).reduce((s, x) => s + (Number(x.rad) || 0), 0)

      // Temps repos
      let tempsRepos = null
      if (i > 0 && prev?.heure && prev?.duree && t.heure) {
        const toMin = h => {
          const [hh, mm] = h.split(':').map(Number)
          return hh * 60 + mm
        }
        tempsRepos = toMin(t.heure) - (toMin(prev.heure) + (Number(prev.duree) || 0) * 2)
        if (tempsRepos < 0) tempsRepos = 0
      }

      // % Drain
      let pctDrain = null
      if (t.vDrain && t.vApport && nbrGoutteurs && Number(t.vApport) > 0 && Number(nbrGoutteurs) > 0) {
        pctDrain = (Number(t.vDrain) / Number(nbrGoutteurs) / Number(t.vApport)) * 100
      }

      // Moyenne % Drain
      let moyPctDrain = null
      if (pctDrain !== null) {
        const prevMoy = prev?.moyPctDrain ?? null
        if (i === 0) {
          moyPctDrain = pctDrain
        } else if (prevMoy !== null) {
          moyPctDrain = (prevMoy * i + pctDrain) / (i + 1)
        }
      }

      return { ...t, cumulRad, tempsRepos, pctDrain, moyPctDrain }
    })
  }

  // ── Update un champ d'un tour ──────────────────────────────
  const updateTour = (id, field, val) => {
    setTours(prev => {
      const updated = prev.map(t => t.id === id ? { ...t, [field]: val } : t)
      return recalculTours(updated)
    })
  }

  // ── Ajouter un tour ────────────────────────────────────────
  const addTour = () => {
    setTours(prev => {
      const next = [...prev, newTour(prev.length + 1)]
      return recalculTours(next)
    })
  }

  // ── Supprimer un tour ──────────────────────────────────────
  const deleteTour = (id) => {
    setTours(prev => {
      const filtered = prev.filter(t => t.id !== id).map((t, i) => ({ ...t, num: i + 1 }))
      return recalculTours(filtered)
    })
  }

  // ── Bilan calculé ─────────────────────────────────────────
  const lastTour = tours[tours.length - 1]
  const totalVApport    = tours.reduce((s, t) => s + (Number(t.vApport) || 0), 0)
  const totalVDrain     = tours.reduce((s, t) => s + (Number(t.vDrain) || 0), 0)
  const dureeTotal      = tours.reduce((s, t) => s + (Number(t.duree) || 0) + (t.tempsRepos || 0), 0)
  const ecMoyApport     = tours.length ? (tours.reduce((s, t) => s + (Number(t.ecApport) || 0), 0) / tours.length).toFixed(2) : null
  const phMoyApport     = tours.length ? (tours.reduce((s, t) => s + (Number(t.phApport) || 0), 0) / tours.length).toFixed(2) : null
  const ecMoyDrain      = tours.length ? (tours.reduce((s, t) => s + (Number(t.ecDrain) || 0), 0) / tours.length).toFixed(2) : null
  const phMoyDrain      = tours.length ? (tours.reduce((s, t) => s + (Number(t.phDrain) || 0), 0) / tours.length).toFixed(2) : null
  const moyDrainFinale  = lastTour?.moyPctDrain ?? null

  const ccBras = totalVApport && moyDrainFinale !== null && nbrGoutteurs && nbrBras && Number(nbrBras) > 0
    ? ((totalVApport * (1 - moyDrainFinale / 100) * Number(nbrGoutteurs)) / Number(nbrBras)).toFixed(1)
    : null

  // ── Enregistrer ───────────────────────────────────────────
  const handleSave = async () => {
    if (!ferme || !date || tours.length === 0) {
      setError('Veuillez remplir la ferme, la date et au moins un tour.')
      return
    }
    setSaving(true)
    setError('')
    try {
      const payload = {
        ferme, bloc, serre, vanne, date,
        constantes: { nbrBras, nbrGoutteurs, poidsMatin, heureMatin, poidsSoir, heureSoir, bassinEC, pctRessuyage },
        tours,
        bilan: {
          nbrTours: tours.length, dureeTotal,
          totalVApport, totalVDrain,
          ecMoyApport, phMoyApport, ecMoyDrain, phMoyDrain,
          moyDrainFinale, ccBras,
        }
      }
      // TODO: appel API — await saveSaisie(token, payload)
      console.log('Saisie enregistrée:', payload)
      await new Promise(r => setTimeout(r, 600)) // simulation
      setSaved(true)
      setTimeout(() => setSaved(false), 3000)
    } catch (e) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  // ── Styles communs ────────────────────────────────────────
  const cardStyle = {
    background: C.card,
    border: `1.5px solid ${C.border}`,
    borderRadius: 14, padding: '20px 22px',
    marginBottom: 18,
  }

  const inputStyle = {
    width: '100%', padding: '8px 12px',
    borderRadius: 8, border: `1.5px solid ${C.border}`,
    background: C.inputBg, color: C.text,
    fontSize: 13, fontFamily: 'inherit', outline: 'none',
  }

  const labelStyle = {
    display: 'block', color: C.textMuted,
    fontSize: 10, fontWeight: 700,
    textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 5,
  }

  return (
    <div style={{ animation: 'az-fade-in 0.3s ease both', maxWidth: 1400 }}>

      {/* ── Header ──────────────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 28 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{
            width: 36, height: 36, borderRadius: 10,
            background: dark ? 'rgba(52,217,111,0.12)' : 'rgba(24,120,63,0.10)',
            border: `1.5px solid ${C.green}30`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <Leaf size={18} color={C.green} strokeWidth={2} />
          </div>
          <div>
            <div style={{ fontSize: 20, fontWeight: 900, color: C.text }}>Saisie journalière</div>
            <div style={{ fontSize: 11, color: C.textDim }}>{date}</div>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          {error && (
            <div style={{
              display: 'flex', alignItems: 'center', gap: 6,
              background: dark ? '#2a0a0a' : '#fef2f2',
              border: `1px solid ${C.red}30`,
              borderRadius: 8, padding: '8px 14px',
              color: C.red, fontSize: 12,
            }}>
              <AlertCircle size={14} strokeWidth={2} />
              {error}
            </div>
          )}
          {saved && (
            <div style={{
              background: dark ? 'rgba(52,217,111,0.12)' : 'rgba(24,120,63,0.08)',
              border: `1px solid ${C.green}30`,
              borderRadius: 8, padding: '8px 14px',
              color: C.green, fontSize: 12, fontWeight: 700,
            }}>
              ✓ Enregistré
            </div>
          )}
          <button
            onClick={handleSave}
            disabled={saving || tours.length === 0}
            style={{
              display: 'flex', alignItems: 'center', gap: 7,
              padding: '10px 20px',
              background: saving || tours.length === 0 ? C.toggleBg : C.green,
              color: saving || tours.length === 0 ? C.textDim : '#fff',
              border: 'none', borderRadius: 9,
              fontSize: 13, fontWeight: 700, fontFamily: 'inherit',
              cursor: saving || tours.length === 0 ? 'not-allowed' : 'pointer',
              transition: 'all 0.15s',
            }}
          >
            <Save size={14} strokeWidth={2.5} />
            {saving ? 'Enregistrement…' : 'Enregistrer'}
          </button>
        </div>
      </div>

      {/* ── Sélecteurs Ferme / Bloc / Serre / Vanne / Date ── */}
      <div style={cardStyle}>
        <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr 1fr 1fr 160px', gap: 16 }}>
          <div>
            <label style={labelStyle}>Ferme</label>
            <StyledSelect value={ferme} onChange={v => { setFerme(v); setBloc(''); setSerre('') }}
              options={fermeOptions} placeholder="Sélectionner…" C={C} />
          </div>
          <div>
            <label style={labelStyle}>Bloc (House)</label>
            <StyledSelect value={bloc} onChange={v => { setBloc(v); setSerre('') }}
              options={blocOptions} placeholder="Sélectionner…" C={C} />
          </div>
          <div>
            <label style={labelStyle}>Serre</label>
            <StyledSelect value={serre} onChange={setSerre}
              options={serreOptions.length ? serreOptions : [{ value: serre, label: serre }]}
              placeholder="Saisir…" C={C} />
          </div>
          <div>
            <label style={labelStyle}>Vanne</label>
            <input value={vanne} onChange={e => setVanne(e.target.value)}
              placeholder="ex: 1"
              style={inputStyle} />
          </div>
          <div>
            <label style={labelStyle}>Date</label>
            <input type="date" value={date} onChange={e => setDate(e.target.value)}
              style={inputStyle} />
          </div>
        </div>
      </div>

      {/* ── Layout 2 colonnes : Bilansd + Constantes ─────── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 280px', gap: 18, marginBottom: 18 }}>

        {/* Bilans */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {/* Bilan Irrigation */}
          <div style={{ ...cardStyle, marginBottom: 0 }}>
            <div style={{ fontSize: 11, fontWeight: 800, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 14 }}>
              Irrigation
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16 }}>
              {[
                { label: 'Total tours', value: tours.length || '—' },
                { label: 'Durée totale (min)', value: dureeTotal > 0 ? dureeTotal : '—' },
                { label: 'CC/bras (cc)', value: ccBras ?? '—' },
              ].map(item => (
                <div key={item.label}>
                  <div style={{ fontSize: 10, color: C.textDim, marginBottom: 4 }}>{item.label}</div>
                  <div style={{ fontSize: 22, fontWeight: 900, color: C.green }}>{item.value}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Bilans EC / pH / Eau */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
            <BilanCard title="Bilan Eau" apport={totalVApport > 0 ? fmtNum(totalVApport, 1) : null}
              drainage={totalVDrain > 0 ? `${fmtNum(moyDrainFinale, 1)}%` : null}
              color={C.blue} icon={Droplets} C={C} dark={dark} />
            <BilanCard title="Bilan EC" apport={ecMoyApport} drainage={ecMoyDrain}
              color={C.green} icon={BarChart2} C={C} dark={dark} />
            <BilanCard title="Bilan pH" apport={phMoyApport} drainage={phMoyDrain}
              color={C.amber} icon={FlaskConical} C={C} dark={dark} />
          </div>
        </div>

        {/* Constantes & Substrat */}
        <div style={{ ...cardStyle, marginBottom: 0 }}>
          <div style={{ fontSize: 11, fontWeight: 800, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 16 }}>
            Constantes &amp; Substrat
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div>
              <label style={labelStyle}>Nbr Bras</label>
              <input type="number" value={nbrBras} onChange={e => setNbrBras(e.target.value)}
                placeholder="0" style={{ ...inputStyle, padding: '7px 10px' }} />
            </div>
            <div>
              <label style={labelStyle}>Nbr Goutteurs</label>
              <input type="number" value={nbrGoutteurs} onChange={e => setNbrGoutteurs(e.target.value)}
                placeholder="0" style={{ ...inputStyle, padding: '7px 10px' }} />
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 10 }}>
            <div>
              <label style={labelStyle}>Poids matin (Kg)</label>
              <input type="number" value={poidsMatin} onChange={e => setPoidsMatin(e.target.value)}
                placeholder="0.00" step="0.01" style={{ ...inputStyle, padding: '7px 10px' }} />
            </div>
            <div>
              <label style={labelStyle}>Heure matin</label>
              <TimeInput value={heureMatin} onChange={setHeureMatin} C={C} />
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 10 }}>
            <div>
              <label style={labelStyle}>Poids soir (Kg)</label>
              <input type="number" value={poidsSoir} onChange={e => setPoidsSoir(e.target.value)}
                placeholder="0.00" step="0.01" style={{ ...inputStyle, padding: '7px 10px' }} />
            </div>
            <div>
              <label style={labelStyle}>Heure soir</label>
              <TimeInput value={heureSoir} onChange={setHeureSoir} C={C} />
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 10 }}>
            <div>
              <label style={labelStyle}>Bassin (EC)</label>
              <input type="number" value={bassinEC} onChange={e => setBassinEC(e.target.value)}
                placeholder="0.00" step="0.01" style={{ ...inputStyle, padding: '7px 10px' }} />
            </div>
            <div>
              <label style={labelStyle}>% Ressuyage</label>
              <div style={{
                padding: '7px 10px', borderRadius: 8,
                background: pctRessuyage !== null
                  ? (dark ? 'rgba(52,217,111,0.10)' : 'rgba(24,120,63,0.06)')
                  : C.toggleBg,
                border: `1.5px solid ${pctRessuyage !== null ? C.green + '40' : C.border}`,
                fontSize: 14, fontWeight: 900,
                color: pctRessuyage !== null ? C.green : C.textDim,
                textAlign: 'center', minHeight: 34,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                {pctRessuyage !== null ? `${pctRessuyage}%` : '—'}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── Table Tours ──────────────────────────────────────── */}
      <div style={{ ...cardStyle, marginBottom: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <div style={{ fontSize: 11, fontWeight: 800, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '0.1em' }}>
            Tours d'irrigation
          </div>
          <button
            onClick={addTour}
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '8px 16px',
              background: dark ? 'rgba(52,217,111,0.10)' : 'rgba(24,120,63,0.08)',
              border: `1.5px solid ${C.green}40`,
              borderRadius: 8, color: C.green,
              fontSize: 12, fontWeight: 700, fontFamily: 'inherit', cursor: 'pointer',
            }}
          >
            <Plus size={14} strokeWidth={2.5} />
            Nouveau tour
          </button>
        </div>

        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: 'inherit' }}>
            <thead>
              <tr>
                <TH w={36}>N°</TH>
                <TH w={70}>Rad.</TH>
                <TH w={80} color={C.blue}>Cumul Rad</TH>
                <TH w={110}>Heure</TH>
                <TH w={80} color={dark ? '#4a7a5a' : '#4a7a5a'}>T.Repos</TH>
                <TH w={72}>Durée (min)</TH>
                <TH w={78}>V.Apport</TH>
                <TH w={72}>EC Apport</TH>
                <TH w={72}>pH Apport</TH>
                <TH w={72}>V.Drain</TH>
                <TH w={72}>EC Drain</TH>
                <TH w={72}>pH Drain</TH>
                <TH w={72} color={C.amber}>% Drain</TH>
                <TH w={80} color={C.amber}>Moy % Drain</TH>
                <TH w={36}></TH>
              </tr>
            </thead>
            <tbody>
              {tours.length === 0 ? (
                <tr>
                  <td colSpan={15} style={{
                    padding: '40px 0', textAlign: 'center',
                    color: C.textDim, fontSize: 12,
                  }}>
                    Cliquez sur <strong>Nouveau tour</strong> pour ajouter le premier tour
                  </td>
                </tr>
              ) : tours.map((t, i) => (
                <tr
                  key={t.id}
                  style={{
                    borderBottom: i < tours.length - 1 ? `1px solid ${C.border}` : 'none',
                    background: i % 2 === 0 ? 'transparent' : (dark ? 'rgba(255,255,255,0.01)' : 'rgba(0,0,0,0.01)'),
                  }}
                >
                  {/* N° tour */}
                  <td style={{ padding: '6px 4px', textAlign: 'center' }}>
                    <div style={{
                      width: 28, height: 28, borderRadius: 7,
                      background: dark ? 'rgba(52,217,111,0.12)' : 'rgba(24,120,63,0.08)',
                      border: `1.5px solid ${C.green}30`,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 12, fontWeight: 900, color: C.green,
                      margin: '0 auto',
                    }}>
                      {t.num}
                    </div>
                  </td>

                  {/* Rad */}
                  <td style={{ padding: '6px 4px', textAlign: 'center' }}>
                    <TInput value={t.rad} onChange={v => updateTour(t.id, 'rad', v)} width={68} />
                  </td>

                  {/* Cumul Rad — auto */}
                  <td style={{ padding: '6px 4px', textAlign: 'center' }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: C.blue }}>
                      {t.cumulRad > 0 ? fmtNum(t.cumulRad, 1) : '—'}
                    </div>
                  </td>

                  {/* Heure */}
                  <td style={{ padding: '6px 4px', textAlign: 'center' }}>
                    <TimeInput value={t.heure} onChange={v => updateTour(t.id, 'heure', v)} C={C} />
                  </td>

                  {/* Temps repos — auto */}
                  <td style={{ padding: '6px 4px', textAlign: 'center' }}>
                    <div style={{
                      fontSize: 12, fontWeight: 700,
                      color: t.tempsRepos !== null ? C.textMuted : C.textDim,
                    }}>
                      {t.tempsRepos !== null ? `${t.tempsRepos} min` : i === 0 ? '—' : '?'}
                    </div>
                  </td>

                  {/* Durée */}
                  <td style={{ padding: '6px 4px', textAlign: 'center' }}>
                    <TInput value={t.duree} onChange={v => updateTour(t.id, 'duree', v)} width={68} />
                  </td>

                  {/* V.Apport */}
                  <td style={{ padding: '6px 4px', textAlign: 'center' }}>
                    <TInput value={t.vApport} onChange={v => updateTour(t.id, 'vApport', v)} width={72} />
                  </td>

                  {/* EC Apport */}
                  <td style={{ padding: '6px 4px', textAlign: 'center' }}>
                    <TInput value={t.ecApport} onChange={v => updateTour(t.id, 'ecApport', v)} width={68} />
                  </td>

                  {/* pH Apport */}
                  <td style={{ padding: '6px 4px', textAlign: 'center' }}>
                    <TInput value={t.phApport} onChange={v => updateTour(t.id, 'phApport', v)} width={68} />
                  </td>

                  {/* V.Drain */}
                  <td style={{ padding: '6px 4px', textAlign: 'center' }}>
                    <TInput value={t.vDrain} onChange={v => updateTour(t.id, 'vDrain', v)} width={68} />
                  </td>

                  {/* EC Drain */}
                  <td style={{ padding: '6px 4px', textAlign: 'center' }}>
                    <TInput value={t.ecDrain} onChange={v => updateTour(t.id, 'ecDrain', v)} width={68} />
                  </td>

                  {/* pH Drain */}
                  <td style={{ padding: '6px 4px', textAlign: 'center' }}>
                    <TInput value={t.phDrain} onChange={v => updateTour(t.id, 'phDrain', v)} width={68} />
                  </td>

                  {/* % Drain — auto */}
                  <td style={{ padding: '6px 4px', textAlign: 'center' }}>
                    <div style={{
                      fontSize: 12, fontWeight: 700,
                      color: t.pctDrain !== null ? C.amber : C.textDim,
                    }}>
                      {t.pctDrain !== null ? `${fmtNum(t.pctDrain, 1)}%` : '—'}
                    </div>
                  </td>

                  {/* Moy % Drain — auto */}
                  <td style={{ padding: '6px 4px', textAlign: 'center' }}>
                    <div style={{
                      fontSize: 12, fontWeight: 700,
                      color: t.moyPctDrain !== null ? C.amber : C.textDim,
                    }}>
                      {t.moyPctDrain !== null ? `${fmtNum(t.moyPctDrain, 1)}%` : '—'}
                    </div>
                  </td>

                  {/* Supprimer */}
                  <td style={{ padding: '6px 4px', textAlign: 'center' }}>
                    <button
                      onClick={() => deleteTour(t.id)}
                      style={{
                        background: 'none', border: 'none', cursor: 'pointer',
                        color: C.textDim, padding: 4, borderRadius: 5,
                        display: 'flex', alignItems: 'center',
                      }}
                      onMouseEnter={e => e.currentTarget.style.color = C.red}
                      onMouseLeave={e => e.currentTarget.style.color = C.textDim}
                    >
                      <Trash2 size={13} strokeWidth={2} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>

            {/* Totaux */}
            {tours.length > 0 && (
              <tfoot>
                <tr style={{ borderTop: `2px solid ${C.border}` }}>
                  <td colSpan={6} style={{ padding: '8px 6px', fontSize: 11, fontWeight: 700, color: C.textMuted }}>
                    TOTAUX
                  </td>
                  <td style={{ padding: '8px 4px', textAlign: 'center', fontSize: 12, fontWeight: 900, color: C.green }}>
                    {fmtNum(totalVApport, 1)}
                  </td>
                  <td style={{ padding: '8px 4px', textAlign: 'center', fontSize: 12, fontWeight: 700, color: C.textMuted }}>
                    {ecMoyApport ?? '—'}
                  </td>
                  <td style={{ padding: '8px 4px', textAlign: 'center', fontSize: 12, fontWeight: 700, color: C.textMuted }}>
                    {phMoyApport ?? '—'}
                  </td>
                  <td style={{ padding: '8px 4px', textAlign: 'center', fontSize: 12, fontWeight: 900, color: C.blue }}>
                    {fmtNum(totalVDrain, 1)}
                  </td>
                  <td style={{ padding: '8px 4px', textAlign: 'center', fontSize: 12, fontWeight: 700, color: C.textMuted }}>
                    {ecMoyDrain ?? '—'}
                  </td>
                  <td style={{ padding: '8px 4px', textAlign: 'center', fontSize: 12, fontWeight: 700, color: C.textMuted }}>
                    {phMoyDrain ?? '—'}
                  </td>
                  <td style={{ padding: '8px 4px', textAlign: 'center', fontSize: 12, fontWeight: 900, color: C.amber }}>
                    {moyDrainFinale !== null ? `${fmtNum(moyDrainFinale, 1)}%` : '—'}
                  </td>
                  <td colSpan={2} />
                </tr>
              </tfoot>
            )}
          </table>
        </div>

        {/* CC/bras résumé */}
        {tours.length > 0 && (
          <div style={{
            marginTop: 16, padding: '12px 16px',
            background: dark ? 'rgba(52,217,111,0.06)' : 'rgba(24,120,63,0.04)',
            border: `1px solid ${C.green}20`,
            borderRadius: 10,
            display: 'flex', gap: 32, flexWrap: 'wrap',
          }}>
            {[
              { label: 'Durée totale', value: dureeTotal > 0 ? `${dureeTotal} min` : '—' },
              { label: 'Total V.Apport', value: fmtNum(totalVApport, 1) },
              { label: 'Total V.Drain', value: fmtNum(totalVDrain, 1) },
              { label: 'Moy % Drainage finale', value: moyDrainFinale !== null ? `${fmtNum(moyDrainFinale, 1)}%` : '—' },
              { label: 'CC/bras consommé (cc)', value: ccBras ?? '—', highlight: true },
            ].map(item => (
              <div key={item.label}>
                <div style={{ fontSize: 10, color: C.textDim, marginBottom: 3 }}>{item.label}</div>
                <div style={{
                  fontSize: item.highlight ? 22 : 16,
                  fontWeight: 900,
                  color: item.highlight ? C.green : C.text,
                }}>
                  {item.value}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}