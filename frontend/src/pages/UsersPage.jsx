// ============================================================
// frontend/src/pages/UsersPage.jsx
// ============================================================

import { useState, useEffect } from 'react'
import {
  Users, UserPlus, Search, X, Check, ShieldCheck,
  UserCheck, UserX, Pencil, CircleSlash, CircleCheck,
  RefreshCw, Download, History, Mail, Phone,
  AlertTriangle, Clock, Save, ChevronDown, ChevronUp,  // ← ajouter
} from 'lucide-react'

import { ROLES, ROLE_OPTIONS, ROLE_CONFIG } from '../theme.js'
import { Card, Btn, Input, Badge, Spinner, StatCard, Alert, SZ } from '../components/ui.jsx'
import { getUsers, createUser, editUser, changeRole, toggleUser, getAuditLogs, exportCSV, getFarms } from '../api/client.js'

// ── Action label map ──────────────────────────────────────────
const ACTION_LABELS = {
  LOGIN         : { label: 'Connexion',         color: '#34d96f' },
  LOGIN_FAILED  : { label: 'Échec connexion',   color: '#f05252' },
  CREATE_USER   : { label: 'Création user',     color: '#4d9de0' },
  UPDATE_USER   : { label: 'Modification user', color: '#f5a623' },
  CHANGE_ROLE   : { label: 'Changement rôle',   color: '#b197fc' },
  TOGGLE_USER   : { label: 'Activation/Désact', color: '#f5a623' },
  EXPORT_CSV    : { label: 'Export CSV',        color: '#4d9de0' },
}

// ── Confirm modal ─────────────────────────────────────────────
function ConfirmModal({ user, onConfirm, onCancel, C, dark }) {
  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 100,
      background: 'rgba(0,0,0,0.65)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      <div style={{
        background: C.card, border: `1.5px solid ${C.border}`,
        borderRadius: 16, padding: '28px 32px', width: 400,
        boxShadow: `0 8px 40px rgba(0,0,0,0.5)`,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
          <div style={{ width: 42, height: 42, borderRadius: 10, background: `${C.amber}18`, border: `1.5px solid ${C.amber}40`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <AlertTriangle size={20} color={C.amber} strokeWidth={2} />
          </div>
          <div>
            <div style={{ color: C.text, fontWeight: 800, fontSize: 15 }}>Confirmer l'action</div>
            <div style={{ color: C.textMuted, fontSize: 12, marginTop: 2 }}>Cette action est réversible</div>
          </div>
        </div>
        <p style={{ color: C.textMuted, fontSize: 12, marginBottom: 24, lineHeight: 1.6 }}>
          Voulez-vous vraiment <strong style={{ color: user.actif ? C.red : C.green }}>
            {user.actif ? 'désactiver' : 'activer'}
          </strong> le compte de <strong style={{ color: C.text }}>{user.username}</strong> ?
          {user.actif && <span style={{ display: 'block', marginTop: 8, color: C.red, fontSize: 12 }}>
            L'utilisateur ne pourra plus se connecter.
          </span>}
        </p>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <Btn onClick={onCancel} variant="ghost" C={C} icon={X}>Annuler</Btn>
          <Btn onClick={onConfirm} variant={user.actif ? 'danger' : 'primary'} C={C} icon={user.actif ? UserX : UserCheck}>
            {user.actif ? 'Désactiver' : 'Activer'}
          </Btn>
        </div>
      </div>
    </div>
  )
}

// ── Edit modal ────────────────────────────────────────────────
function EditModal({ user, onSave, onClose, C, dark }) {
  const [nom, setNom]       = useState(user.nom)
  const [email, setEmail]   = useState(user.email || '')
  const [pwd, setPwd]       = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError]   = useState('')

  const handleSave = async () => {
    setSaving(true)
    setError('')
    try {
      const payload = {}
      if (nom !== user.nom) payload.nom = nom
      if (email !== (user.email || '')) payload.email = email
      if (pwd) payload.password = pwd
      await onSave(user.username, payload)
      onClose()
    } catch (e) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 100,
      background: 'rgba(0,0,0,0.65)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      <div style={{
        background: C.card, border: `1.5px solid ${C.border}`,
        borderRadius: 16, padding: '28px 32px', width: 460,
        boxShadow: `0 8px 40px rgba(0,0,0,0.5)`,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 22 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Pencil size={18} color={C.green} strokeWidth={2} />
            <div style={{ color: C.text, fontWeight: 800, fontSize: 15 }}>
              Modifier — {user.username}
            </div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: C.textDim }}>
            <X size={18} strokeWidth={2} />
          </button>
        </div>

        <Input label="Nom complet"   value={nom}   onChange={setNom}   C={C} />
        <Input label="Email"         value={email} onChange={setEmail} C={C} placeholder="ex: user@azura.ma" icon={Mail} />
        <Input label="Nouveau mot de passe (laisser vide pour ne pas changer)" value={pwd} onChange={setPwd} type="password" C={C} placeholder="Laisser vide = inchangé" />

        {error && <Alert message={error} C={C} dark={dark} />}

        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 8 }}>
          <Btn onClick={onClose} variant="ghost" C={C} icon={X}>Annuler</Btn>
          <Btn onClick={handleSave} disabled={saving} C={C} icon={Save}>
            {saving ? 'Enregistrement…' : 'Enregistrer'}
          </Btn>
        </div>
      </div>
    </div>
  )
}

// ── Audit logs panel ──────────────────────────────────────────
function AuditPanel({ token, filterUser, C, dark, onClose }) {
  const [logs, setLogs]     = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    getAuditLogs(token, filterUser || null, 100)
      .then(setLogs)
      .catch(() => setLogs([]))
      .finally(() => setLoading(false))
  }, [filterUser])

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 100,
      background: 'rgba(0,0,0,0.65)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      <div style={{
        background: C.card, border: `1.5px solid ${C.border}`,
        borderRadius: 16, padding: '28px 32px', width: 680,
        maxHeight: '80vh', display: 'flex', flexDirection: 'column',
        boxShadow: `0 8px 40px rgba(0,0,0,0.5)`,
      }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <History size={18} color={C.green} strokeWidth={2} />
            <div style={{ color: C.text, fontWeight: 800, fontSize: 15 }}>
              Historique des actions
              {filterUser && <span style={{ color: C.textMuted, fontWeight: 400, fontSize: 12 }}> — {filterUser}</span>}
            </div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: C.textDim }}>
            <X size={18} strokeWidth={2} />
          </button>
        </div>

        {/* Logs */}
        <div style={{ overflowY: 'auto', flex: 1 }}>
          {loading ? <Spinner C={C} /> : logs.length === 0 ? (
            <div style={{ textAlign: 'center', color: C.textDim, padding: 40, fontSize: 12 }}>
              Aucune action enregistrée
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {logs.map(log => {
                const cfg = ACTION_LABELS[log.action] || { label: log.action, color: C.textMuted }
                return (
                  <div key={log.id} style={{
                    display: 'flex', alignItems: 'center', gap: 12,
                    padding: '10px 14px', borderRadius: 8,
                    background: C.surface, border: `1px solid ${C.border}`,
                  }}>
                    <span style={{
                      background: `${cfg.color}18`,
                      color: cfg.color,
                      border: `1px solid ${cfg.color}35`,
                      borderRadius: 5, padding: '2px 8px',
                      fontSize: 10, fontWeight: 700, letterSpacing: '0.05em',
                      whiteSpace: 'nowrap',
                    }}>
                      {cfg.label}
                    </span>
                    <span style={{ color: C.text, fontSize: 12, fontWeight: 700, minWidth: 80 }}>{log.username}</span>
                    <span style={{ color: C.textMuted, fontSize: 12, flex: 1 }}>{log.detail || '—'}</span>
                    <span style={{ color: C.textDim, fontSize: 11, display: 'flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap' }}>
                      <Clock size={10} strokeWidth={2} />
                      {new Date(log.created_at).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────
export default function UsersPage({ token, userRole, C, dark }) {
  const [users, setUsers]           = useState([])
  const [loading, setLoading]       = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [showCreate, setShowCreate] = useState(false)
  const [creating, setCreating]     = useState(false)
  const [createError, setCreateError] = useState('')
  const [editingRole, setEditingRole] = useState(null)
  const [editingUser, setEditingUser] = useState(null)
  const [confirmUser, setConfirmUser] = useState(null)
  const [showLogs, setShowLogs]     = useState(false)
  const [logsUser, setLogsUser]     = useState(null)
  const [search, setSearch]         = useState('')
  const [filterRole, setFilterRole] = useState('tous')
  const [newUser, setNewUser]       = useState({ username: '', password: '', role: 'operateur', nom: '', email: '', farm_names: [] })
  const [exporting, setExporting]   = useState(false)
  const [farms, setFarms] = useState([])
  const [dropOpen, setDropOpen] = useState(false)
  const [roleDropOpen, setRoleDropOpen] = useState(false)

  const canAccess = userRole === 'admin'

  const load = async (refresh = false) => {
    if (refresh) setRefreshing(true)
    try { setUsers(await getUsers(token)) }
    catch { setUsers([]) }
    finally { setLoading(false); setRefreshing(false) }
  }

  useEffect(() => {
    if (!canAccess) { setLoading(false); return }
    load()
    getFarms(token).then(setFarms).catch(() => setFarms([]))   // ← ajouter
  }, [])

  if (!canAccess) return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 80, gap: 16 }}>
      <div style={{ width: 64, height: 64, borderRadius: 16, background: `${C.red}18`, border: `1.5px solid ${C.red}40`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <CircleSlash size={28} color={C.red} strokeWidth={1.8} />
      </div>
      <div style={{ color: C.red, fontSize: 18, fontWeight: 800 }}>Accès refusé</div>
      <div style={{ color: C.textDim, fontSize: 12 }}>Rôle Administrateur requis</div>
    </div>
  )

  const setNu = k => v => setNewUser(p => ({ ...p, [k]: v }))

  const q = search.toLowerCase().trim()
  const filtered = users.filter(u =>
    (filterRole === 'tous' || u.role === filterRole) &&
    (q === '' || u.username.toLowerCase().includes(q) || u.nom.toLowerCase().includes(q))
  )

  const stats = {
    total:    users.length,
    actifs:   users.filter(u => u.actif).length,
    inactifs: users.filter(u => !u.actif).length,
    admins:   users.filter(u => u.role === 'admin').length,
  }

  const handleCreate = async () => {
    if (!newUser.username || !newUser.password || !newUser.nom) {
      setCreateError('Les champs identifiant, nom et mot de passe sont obligatoires.')
      return
    }
    setCreating(true); setCreateError('')
    try {
      const res = await createUser(token, newUser)
      setUsers(prev => [...prev, res.user || { ...newUser, actif: true, created_at: new Date().toISOString() }])
      setShowCreate(false)
      setNewUser({ username: '', password: '', role: 'operateur', nom: '', email: '' })
    } catch (e) { setCreateError(e.message) }
    finally { setCreating(false) }
  }

  const handleToggleConfirm = async () => {
    if (!confirmUser) return
    await toggleUser(token, confirmUser.username)
    setUsers(prev => prev.map(u => u.username === confirmUser.username ? { ...u, actif: !u.actif } : u))
    setConfirmUser(null)
  }

  const handleEdit = async (username, payload) => {
    const res = await editUser(token, username, payload)
    setUsers(prev => prev.map(u => u.username === username ? { ...u, ...res.user } : u))
  }

  const handleRoleChange = async (username, new_role) => {
    await changeRole(token, username, new_role)
    setUsers(prev => prev.map(u => u.username === username ? { ...u, role: new_role } : u))
    setEditingRole(null)
  }

  const handleExport = async () => {
    setExporting(true)
    try { await exportCSV(token) }
    catch (e) { alert(e.message) }
    finally { setExporting(false) }
  }

  const formatDate = (d) => d
    ? new Date(d).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' })
    : '—'

  const formatDateTime = (d) => d
    ? new Date(d).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
    : <span style={{ color: C.textDim }}>Jamais</span>

  return (
    <div>
      {/* Modals */}
      {confirmUser && <ConfirmModal user={confirmUser} onConfirm={handleToggleConfirm} onCancel={() => setConfirmUser(null)} C={C} dark={dark} />}
      {editingUser && <EditModal user={editingUser} onSave={handleEdit} onClose={() => setEditingUser(null)} C={C} dark={dark} />}
      {showLogs && <AuditPanel token={token} filterUser={logsUser} C={C} dark={dark} onClose={() => { setShowLogs(false); setLogsUser(null) }} />}

      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 28 }}>
        <div>
          <h1 style={{ color: C.text, fontSize: 22, fontWeight: 900, marginBottom: 4, letterSpacing: '-0.02em', display: 'flex', alignItems: 'center', gap: 10 }}>
            <Users size={22} color={C.green} strokeWidth={2} />
            Gestion des utilisateurs
          </h1>
          <p style={{ color: C.textMuted, fontSize: 12 }}>Contrôle d'accès basé sur les rôles</p>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Btn onClick={() => load(true)} variant="ghost" C={C} icon={RefreshCw} style={{ opacity: refreshing ? 0.5 : 1 }}>
            Actualiser
          </Btn>
          <Btn onClick={handleExport} variant="ghost" C={C} icon={Download} disabled={exporting}>
            {exporting ? 'Export…' : 'Export CSV'}
          </Btn>
          <Btn onClick={() => { setShowLogs(true); setLogsUser(null) }} variant="ghost" C={C} icon={History}>
            Historique
          </Btn>
          <Btn onClick={() => { setShowCreate(!showCreate); setCreateError('') }} variant={showCreate ? 'danger' : 'primary'} C={C} icon={showCreate ? X : UserPlus}>
            {showCreate ? 'Annuler' : 'Nouvel utilisateur'}
          </Btn>
        </div>
      </div>

      {/* Stats */}
      <div style={{ display: 'flex', gap: 14, marginBottom: 24 }}>
        <StatCard label="Total"    value={stats.total}    icon={Users}       color={C.green}  C={C} />
        <StatCard label="Actifs"   value={stats.actifs}   icon={UserCheck}   color={C.green}  C={C} />
        <StatCard label="Inactifs" value={stats.inactifs} icon={UserX}       color={C.red}    C={C} />
        <StatCard label="Admins"   value={stats.admins}   icon={ShieldCheck} color={C.purple} C={C} />
      </div>

      {/* Create form */}
      {showCreate && (
        <Card C={C} style={{ marginBottom: 22, overflow: 'visible' }}>
          <h3 style={{ color: C.text, fontSize: 12, fontWeight: 800, marginBottom: 18, display: 'flex', alignItems: 'center', gap: 8 }}>
            <UserPlus size={SZ.md} color={C.blue} strokeWidth={2} />
            Créer un utilisateur
          </h3>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 20px', overflow: 'visible' }}>
            <Input label="Identifiant"   value={newUser.username} onChange={setNu('username')} C={C} placeholder="ex: jdupont" />
            <Input label="Mot de passe"  value={newUser.password} onChange={setNu('password')} type="password" C={C} placeholder="Min. 8 caractères" />
            <Input label="Nom complet"   value={newUser.nom}      onChange={setNu('nom')}      C={C} placeholder="ex: Jean Dupont" />
            <Input label="Email"         value={newUser.email}    onChange={setNu('email')}    C={C} placeholder="ex: j.dupont@azura.ma" icon={Mail} />
            <div style={{ marginBottom: 14 }}>
              <label style={{
                display: 'block', color: C.textMuted, fontSize: 11, fontWeight: 700,
                textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 6,
              }}>Rôle</label>
              <div style={{ position: 'relative' }}>
                <div
                  onClick={() => setRoleDropOpen(v => !v)}
                  style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    padding: '0 10px', height: 38,
                    border: `1.5px solid ${roleDropOpen ? C.green : C.border}`,
                    borderRadius: 8, background: C.inputBg, cursor: 'pointer',
                    transition: 'border-color 0.15s',
                  }}
                >
                  <span style={{ color: C.text, fontSize: 12 }}>
                    {ROLE_CONFIG[newUser.role]?.label || 'Sélectionner…'}
                  </span>
                  <span style={{ color: C.textDim, display: 'flex', alignItems: 'center' }}>
                    {roleDropOpen ? <ChevronUp size={14} strokeWidth={2}/> : <ChevronDown size={14} strokeWidth={2}/>}
                  </span>
                </div>
                {roleDropOpen && (
                  <div style={{
                    position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0,
                    background: C.card, border: `1.5px solid ${C.border}`,
                    borderRadius: 8, zIndex: 100, boxShadow: `0 4px 20px ${C.shadow}`,
                    overflow: 'visible',
                  }}>
                    {ROLE_OPTIONS.map(r => (
                      <div
                        key={r.value}
                        onClick={() => {
                          setNu('role')(r.value)
                          setNewUser(prev => ({ ...prev, role: r.value, farm_names: [] }))
                          setRoleDropOpen(false)
                        }}
                        style={{
                          padding: '9px 14px', fontSize: 12, cursor: 'pointer',
                          color: newUser.role === r.value ? C.green : C.textMuted,
                          background: newUser.role === r.value ? `${C.green}12` : 'transparent',
                          transition: 'background 0.1s',
                        }}
                        onMouseEnter={e => e.currentTarget.style.background = C.tableHover}
                        onMouseLeave={e => e.currentTarget.style.background = newUser.role === r.value ? `${C.green}12` : 'transparent'}
                      >
                        {r.label}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>            
            {newUser.role !== 'admin' && (
              <div style={{ marginBottom: 14 }}>
                <label style={{
                  display: 'block', color: C.textMuted,
                  fontSize: 11, fontWeight: 700,
                  textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 6,
                }}>
                  Fermes assignées
                  {newUser.role === 'agronome' && (
                    <span style={{ color: C.textDim, fontWeight: 400, marginLeft: 6 }}>
                      (plusieurs possible)
                    </span>
                  )}
                </label>

                {newUser.role === 'agronome' ? (
                  <div style={{ position: 'relative' }}>
                    <div
                      onClick={() => setDropOpen(v => !v)}
                      style={{
                        display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6,
                        padding: '0 36px 0 8px', height: 38,          // ← height fixe
                        border: `1.5px solid ${dropOpen ? C.green : C.border}`,
                        borderRadius: 8, background: C.inputBg, cursor: 'pointer',
                        position: 'relative', transition: 'border-color 0.15s',
                        overflowX: 'auto', overflowY: 'hidden',        // ← scroll horizontal si trop de tags
                      }}
                    >
                      {newUser.farm_names.map(f => (
                        <span key={f} style={{
                          display: 'inline-flex', alignItems: 'center', gap: 4,
                          background: `${C.green}20`, color: C.green,
                          border: `1px solid ${C.green}40`,
                          borderRadius: 5, padding: '2px 6px', fontSize: 12, fontWeight: 600,
                        }}>
                          {f}
                          <span
                            onClick={e => {
                              e.stopPropagation()
                              setNewUser(prev => ({
                                ...prev,
                                farm_names: prev.farm_names.filter(x => x !== f)
                              }))
                            }}
                            style={{ cursor: 'pointer', opacity: 0.7, fontSize: 12, lineHeight: 1 }}
                          >×</span>
                        </span>
                      ))}

                      {newUser.farm_names.length === 0 && (
                        <span style={{ color: C.textDim, fontSize: 12 }}>
                          Sélectionner des fermes…
                        </span>
                      )}

                      <div style={{
                        position: 'absolute', right: 6, top: '50%',
                        transform: 'translateY(-50%)',
                        display: 'flex', alignItems: 'center', gap: 4,
                      }}>
                        {newUser.farm_names.length > 0 && (
                          <span
                            onClick={e => {
                              e.stopPropagation()
                              setNewUser(prev => ({ ...prev, farm_names: [] }))
                            }}
                            style={{ cursor: 'pointer', color: C.textDim, display: 'flex', alignItems: 'center' }}
                          >
                            <X size={12} strokeWidth={2} />
                          </span>
                        )}
                        <span style={{ color: C.textDim, display: 'flex', alignItems: 'center' }}>
                          {dropOpen
                            ? <ChevronUp size={12} strokeWidth={2} />
                            : <ChevronDown size={12} strokeWidth={2} />
                          }
                        </span>
                      </div>
                    </div>

                    {dropOpen && (
                      <div style={{
                        position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0,
                        background: C.card, border: `1.5px solid ${C.border}`,
                        borderRadius: 8, zIndex: 50, boxShadow: `0 4px 20px ${C.shadow}`,
                        maxHeight: 180, overflowY: 'auto',
                      }}>
                        {farms.filter(f => !newUser.farm_names.includes(f)).length === 0 ? (
                          <div style={{ padding: '10px 14px', color: C.textDim, fontSize: 12 }}>
                            Toutes les fermes sélectionnées
                          </div>
                        ) : farms.filter(f => !newUser.farm_names.includes(f)).map(f => (
                          <div
                            key={f}
                            onClick={() => {
                              setNewUser(prev => ({ ...prev, farm_names: [...prev.farm_names, f] }))
                              setDropOpen(false)
                            }}
                            style={{
                              padding: '9px 14px', fontSize: 12,
                              color: C.textMuted, cursor: 'pointer',
                              transition: 'background 0.1s',
                            }}
                            onMouseEnter={e => e.currentTarget.style.background = C.tableHover}
                            onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                          >
                            {f}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ) : (
                  <div style={{ position: 'relative' }}>
                    <div
                      onClick={() => setDropOpen(v => !v)}
                      style={{
                        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                        padding: '0 10px', height: 38,
                        border: `1.5px solid ${dropOpen ? C.green : C.border}`,
                        borderRadius: 8, background: C.inputBg, cursor: 'pointer',
                        transition: 'border-color 0.15s',
                      }}
                    >
                      <span style={{ color: newUser.farm_names[0] ? C.text : C.textDim, fontSize: 12 }}>
                        {newUser.farm_names[0] || 'Sélectionner une ferme…'}
                      </span>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                        {newUser.farm_names[0] && (
                          <span
                            onClick={e => {
                              e.stopPropagation()
                              setNewUser(prev => ({ ...prev, farm_names: [] }))
                            }}
                            style={{ cursor: 'pointer', color: C.textDim, display: 'flex', alignItems: 'center' }}
                          >
                            <X size={12} strokeWidth={2}/>
                          </span>
                        )}
                        <span style={{ color: C.textDim, display: 'flex', alignItems: 'center' }}>
                          {dropOpen ? <ChevronUp size={14} strokeWidth={2}/> : <ChevronDown size={14} strokeWidth={2}/>}
                        </span>
                      </div>
                    </div>
                    {dropOpen && (
                      <div style={{
                        position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0,
                        background: C.card, border: `1.5px solid ${C.border}`,
                        borderRadius: 8, zIndex: 50, boxShadow: `0 4px 20px ${C.shadow}`,
                        maxHeight: 180, overflowY: 'auto',
                      }}>
                        {farms.length === 0 ? (
                          <div style={{ padding: '10px 14px', color: C.textDim, fontSize: 12 }}>
                            Aucune ferme disponible
                          </div>
                        ) : farms.map(f => (
                          <div
                            key={f}
                            onClick={() => {
                              setNewUser(prev => ({ ...prev, farm_names: [f] }))
                              setDropOpen(false)
                            }}
                            style={{
                              padding: '9px 14px', fontSize: 12, cursor: 'pointer',
                              color: newUser.farm_names[0] === f ? C.green : C.textMuted,
                              background: newUser.farm_names[0] === f ? `${C.green}12` : 'transparent',
                              transition: 'background 0.1s',
                            }}
                            onMouseEnter={e => e.currentTarget.style.background = C.tableHover}
                            onMouseLeave={e => e.currentTarget.style.background = newUser.farm_names[0] === f ? `${C.green}12` : 'transparent'}
                          >
                            {f}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
          {createError && <Alert message={createError} C={C} dark={dark} />}
          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 4 }}>
            <Btn onClick={() => setShowCreate(false)} variant="ghost" C={C} icon={X}>Annuler</Btn>
            <Btn onClick={handleCreate} disabled={creating} C={C} icon={Check}>
              {creating ? 'Création…' : 'Créer'}
            </Btn>
          </div>
        </Card>
      )}

      {/* Search + filter */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 16, alignItems: 'center' }}>
        <div style={{ flex: 1, position: 'relative' }}>
          <Search size={SZ.md} strokeWidth={1.8} style={{ position: 'absolute', left: 11, top: '50%', transform: 'translateY(-50%)', color: C.textDim, pointerEvents: 'none' }} />
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Rechercher par nom ou identifiant…"
            style={{ width: '100%', padding: '9px 14px 9px 36px', borderRadius: 8, border: `1.5px solid ${C.border}`, background: C.card, color: C.text, fontSize: 12, outline: 'none' }} />
          {search && (
            <button onClick={() => setSearch('')} style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: C.textDim }}>
              <X size={SZ.sm} strokeWidth={2} />
            </button>
          )}
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          {['tous', ...ROLES].map(r => (
            <button key={r} onClick={() => setFilterRole(r)} style={{
              padding: '7px 13px', borderRadius: 7, fontSize: 12, fontWeight: 700,
              cursor: 'pointer', fontFamily: 'inherit',
              background: filterRole === r ? C.green : C.toggleBg,
              color: filterRole === r ? '#fff' : C.textMuted,
              border: `1.5px solid ${filterRole === r ? C.green : C.border}`,
              transition: 'all 0.15s',
            }}>
              {r === 'tous' ? 'Tous' : ROLE_CONFIG[r].label}
            </button>
          ))}
        </div>
      </div>

      {/* Table */}
      {loading ? <Spinner C={C} /> : (
        <Card C={C}>
          {filtered.length === 0 ? (
            <div style={{ textAlign: 'center', padding: 56 }}>
              <Search size={32} color={C.textDim} strokeWidth={1.2} style={{ margin: '0 auto 12px', display: 'block' }} />
              <div style={{ color: C.textDim, fontSize: 12 }}>Aucun utilisateur trouvé</div>
            </div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: 'inherit' }}>
                <thead>
                  <tr>
                    {['Identifiant', 'Nom / Email', 'Rôle', 'Statut', 'Dernière connexion', 'Créé le', 'Actions'].map(h => (
                      <th key={h} style={{
                        color: C.textDim, fontSize: 11, fontFamily: 'inherit',
                        textTransform: 'uppercase', letterSpacing: '0.08em',
                        padding: '10px 14px', textAlign: 'left',
                        borderBottom: `1.5px solid ${C.border}`,
                        whiteSpace: 'nowrap', fontWeight: 700,
                      }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((u, i) => (
                    <tr key={u.username}
                      style={{ borderBottom: i < filtered.length - 1 ? `1px solid ${C.border}` : 'none', transition: 'background 0.12s' }}
                      onMouseEnter={e => e.currentTarget.style.background = C.tableHover}
                      onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                    >
                      {/* Username */}
                      <td style={{ padding: '13px 14px', fontWeight: 800, color: C.text, fontSize: 12, fontFamily: 'inherit' }}>
                        {u.username}
                      </td>

                      {/* Nom + email */}
                      <td style={{ padding: '13px 14px', fontFamily: 'inherit' }}>
                        <div style={{ color: C.textMuted, fontSize: 12 }}>{u.nom}</div>
                        {u.email && (
                          <div style={{ color: C.textDim, fontSize: 11, display: 'flex', alignItems: 'center', gap: 4, marginTop: 3 }}>
                            <Mail size={10} strokeWidth={2} />
                            {u.email}
                          </div>
                        )}
                      </td>

                      {/* Role */}
                      <td style={{ padding: '13px 14px', fontFamily: 'inherit', position: 'relative' }}>
                        {editingRole === u.username ? (
                          <div style={{ position: 'relative', minWidth: 130 }}>
                            {/* Trigger */}
                            <div
                              onClick={e => { e.stopPropagation(); setRoleDropUser(v => v === u.username ? null : u.username) }}
                              style={{
                                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                                padding: '0 8px', height: 32,
                                border: `1.5px solid ${C.green}`,
                                borderRadius: 7, background: C.inputBg, cursor: 'pointer',
                                transition: 'border-color 0.15s', gap: 6,
                              }}
                            >
                              <Badge role={u.role} dark={dark} />
                              <span style={{ color: C.textDim, display: 'flex', alignItems: 'center' }}>
                                {roleDropUser === u.username
                                  ? <ChevronUp size={13} strokeWidth={2}/>
                                  : <ChevronDown size={13} strokeWidth={2}/>
                                }
                              </span>
                            </div>

                            {/* Dropdown */}
                            {roleDropUser === u.username && (
                              <div style={{
                                position: 'absolute', top: 'calc(100% + 4px)', left: 0,
                                background: C.card, border: `1.5px solid ${C.border}`,
                                borderRadius: 8, zIndex: 200, boxShadow: `0 4px 20px ${C.shadow}`,
                                minWidth: 140, overflow: 'hidden',
                              }}>
                                {ROLES.map(r => (
                                  <div
                                    key={r}
                                    onClick={() => {
                                      handleRoleChange(u.username, r)
                                      setRoleDropUser(null)
                                      setEditingRole(null)
                                    }}
                                    style={{
                                      padding: '8px 12px', fontSize: 12, cursor: 'pointer',
                                      background: u.role === r ? `${C.green}12` : 'transparent',
                                      transition: 'background 0.1s',
                                      display: 'flex', alignItems: 'center',
                                    }}
                                    onMouseEnter={e => e.currentTarget.style.background = C.tableHover}
                                    onMouseLeave={e => e.currentTarget.style.background = u.role === r ? `${C.green}12` : 'transparent'}
                                  >
                                    <Badge role={r} dark={dark} />
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        ) : (
                          <button
                            onClick={() => { setEditingRole(u.username); setRoleDropUser(null) }}
                            title="Modifier le rôle"
                            style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, display: 'flex', alignItems: 'center', gap: 6, fontFamily: 'inherit' }}
                          >
                            <Badge role={u.role} dark={dark} />
                            <Pencil size={11} color={C.textDim} strokeWidth={2} />
                          </button>
                        )}
                      </td>

                      {/* Status */}
                      <td style={{ padding: '13px 14px', fontFamily: 'inherit' }}>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, color: u.actif ? C.green : C.red, fontWeight: 700, fontSize: 12 }}>
                          {u.actif ? <CircleCheck size={SZ.sm} strokeWidth={2.5} /> : <CircleSlash size={SZ.sm} strokeWidth={2.5} />}
                          {u.actif ? 'Actif' : 'Désactivé'}
                        </span>
                      </td>

                      {/* Last login */}
                      <td style={{ padding: '13px 14px', fontSize: 12, color: C.textDim, fontFamily: 'inherit' }}>
                        <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                          <Clock size={11} strokeWidth={2} />
                          {formatDateTime(u.last_login)}
                        </span>
                      </td>

                      {/* Created */}
                      <td style={{ padding: '13px 14px', fontSize: 12, color: C.textDim, fontFamily: 'inherit' }}>
                        {formatDate(u.created_at)}
                      </td>

                      {/* Actions */}
                      <td style={{ padding: '13px 14px', fontFamily: 'inherit' }}>
                        <div style={{ display: 'flex', gap: 6 }}>
                          <Btn onClick={() => setEditingUser(u)} variant="ghost" small C={C} icon={Pencil}>
                            Modifier
                          </Btn>
                          <Btn onClick={() => { setLogsUser(u.username); setShowLogs(true) }} variant="ghost" small C={C} icon={History} />
                          <Btn onClick={() => setConfirmUser(u)} variant={u.actif ? 'danger' : 'secondary'} small C={C}
                            icon={u.actif ? UserX : UserCheck}>
                            {u.actif ? 'Désactiver' : 'Activer'}
                          </Btn>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <div style={{ padding: '12px 14px 0', borderTop: `1px solid ${C.border}`, color: C.textDim, fontSize: 12, display: 'flex', alignItems: 'center', gap: 5 }}>
                <Users size={SZ.xs} strokeWidth={2} />
                {filtered.length} utilisateur{filtered.length > 1 ? 's' : ''} affiché{filtered.length > 1 ? 's' : ''}
                {filterRole !== 'tous' || search ? ' (filtre actif)' : ''}
              </div>
            </div>
          )}
        </Card>
      )}
    </div>
  )
}