// ============================================================
// frontend/src/pages/LoginPage.jsx — Design simple et professionnel
// ============================================================

import { useState } from 'react'
import { User, Lock, LogIn, Sun, Moon, Eye, EyeOff } from 'lucide-react'
import { getColors } from '../theme.js'
import { login } from '../api/client.js'

export default function LoginPage({ onLogin, dark, toggleDark }) {
  const C = getColors(dark)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [showPwd, setShowPwd]   = useState(false)
  const [error, setError]       = useState('')
  const [loading, setLoading]   = useState(false)

  const handleSubmit = async () => {
    if (!username || !password) { setError('Veuillez remplir tous les champs.'); return }
    setLoading(true)
    setError('')
    try {
      const data = await login(username, password)
      onLogin(data)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  // Styles communs
  const inputStyle = {
    width: '100%',
    padding: '11px 14px 11px 40px',
    fontSize: 14,
    fontFamily: 'inherit',
    background: C.inputBg,
    color: C.text,
    border: `1.5px solid ${C.border}`,
    borderRadius: 10,
    outline: 'none',
    transition: 'border-color 0.18s',
  }

  return (
    <div style={{
      minHeight: '100vh',
      background: dark ? C.bg : '#f0f5f2',
      display: 'flex',
      fontFamily: "'JetBrains Mono', monospace",
    }}>


      {/* ── form ── */}
      <div style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 48,
        position: 'relative',
      }}>

        {/* Theme toggle */}
        <button onClick={toggleDark} style={{
          position: 'absolute', top: 24, right: 24,
          background: C.surface,
          border: `1.5px solid ${C.border}`,
          borderRadius: 8, padding: '7px 14px',
          cursor: 'pointer', color: C.textMuted,
          display: 'flex', alignItems: 'center', gap: 6,
          fontSize: 12, fontWeight: 680, fontFamily: 'inherit',
        }}>
          {dark
            ? <><Sun size={13} strokeWidth={2} /> Clair</>
            : <><Moon size={13} strokeWidth={2} /> Sombre</>
          }
        </button>
        {/* logo */}
        <div style={{
          width: '45%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 28,
          position: 'relative',
          overflow: 'hidden',
        }}>
            <img
              src={dark ? '/azura_logo_dark.jpg' : '/azura_logo_light.jpg'}
              alt="Azura"
              style={{
                height: 72,
                width: 'auto',
                objectFit: 'contain',
                marginBottom: 12,
                filter: dark ? 'brightness(0.88)' : 'none',
                borderRadius: 8,
              }}
            />
        </div>

        {/* Form box */}
        <div style={{ width: '100%', maxWidth: 380 }}>

          <div style={{ marginBottom: 36, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
            <h1 style={{
              color: C.text,
              fontSize: 22,
              fontWeight: 800,
              marginBottom: 6,
            }}>
              Connexion
            </h1>
            <p style={{ color: C.textMuted, fontSize: 13 }}>
              Accédez au système d'irrigation Azura
            </p>
          </div>

          {/* Username */}
          <div style={{ marginBottom: 16 }}>
            <label style={{
              display: 'block',
              color: C.textMuted,
              fontSize: 11,
              fontWeight: 680,
              textTransform: 'uppercase',
              letterSpacing: '0.08em',
              marginBottom: 7,
            }}>
              Nom d'utilisateur
            </label>
            <div style={{ position: 'relative' }}>
              <User size={15} strokeWidth={2} style={{
                position: 'absolute', left: 13,
                top: '50%', transform: 'translateY(-50%)',
                color: C.textDim, pointerEvents: 'none',
              }} />
              <input
                type="text"
                value={username}
                onChange={e => setUsername(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleSubmit()}
                placeholder="ex: operateur"
                style={inputStyle}
              />
            </div>
          </div>

          {/* Password */}
          <div style={{ marginBottom: 24 }}>
            <label style={{
              display: 'block',
              color: C.textMuted,
              fontSize: 11,
              fontWeight: 680,
              textTransform: 'uppercase',
              letterSpacing: '0.08em',
              marginBottom: 7,
            }}>
              Mot de passe
            </label>
            <div style={{ position: 'relative' }}>
              <Lock size={15} strokeWidth={2} style={{
                position: 'absolute', left: 13,
                top: '50%', transform: 'translateY(-50%)',
                color: C.textDim, pointerEvents: 'none',
              }} />
              <input
                type={showPwd ? 'text' : 'password'}
                value={password}
                onChange={e => setPassword(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleSubmit()}
                placeholder="••••••••"
                style={{ ...inputStyle, paddingRight: 42 }}
              />
              <button
                type="button"
                onClick={() => setShowPwd(v => !v)}
                style={{
                  position: 'absolute', right: 12,
                  top: '50%', transform: 'translateY(-50%)',
                  background: 'none', border: 'none',
                  cursor: 'pointer', color: C.textDim, padding: 2,
                }}
              >
                {showPwd
                  ? <EyeOff size={15} strokeWidth={2} />
                  : <Eye size={15} strokeWidth={2} />
                }
              </button>
            </div>
          </div>

          {/* Error */}
          {error && (
            <div style={{
              background: dark ? '#2a0a0a' : '#fef2f2',
              color: C.red,
              border: `1.5px solid ${C.red}30`,
              borderRadius: 9,
              padding: '10px 14px',
              fontSize: 12,
              marginBottom: 16,
            }}>
              {error}
            </div>
          )}

          {/* Submit */}
          <button
            onClick={handleSubmit}
            disabled={loading}
            style={{
              width: '100%',
              padding: '12px',
              background: dark ? C.green : '#18783f',
              color: '#ffffff',
              border: 'none',
              borderRadius: 10,
              fontSize: 14,
              fontWeight: 680,
              fontFamily: 'inherit',
              cursor: loading ? 'not-allowed' : 'pointer',
              opacity: loading ? 0.7 : 1,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
              transition: 'opacity 0.18s, filter 0.18s',
              letterSpacing: '0.01em',
            }}
          >
            {loading ? (
              <>
                <div style={{
                  width: 15, height: 15,
                  border: '2px solid rgba(255,255,255,0.3)',
                  borderTopColor: '#fff',
                  borderRadius: '50%',
                  animation: 'azura-spin 0.7s linear infinite',
                }} />
                Connexion…
              </>
            ) : (
              <>
                <LogIn size={15} strokeWidth={2.5} />
                Se connecter
              </>
            )}
          </button>

          {/* Quick accounts */}
          <div style={{ marginTop: 28 }}>
            <div style={{
              color: C.textDim,
              fontSize: 10,
              fontWeight: 680,
              textTransform: 'uppercase',
              letterSpacing: '0.1em',
              marginBottom: 10,
              textAlign: 'center',
            }}>
              Comptes de démonstration
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              {[
                { u: 'admin',     p: 'Admin@2026',     label: 'Admin' },
                { u: 'operateur', p: 'Operateur@2026', label: 'Opérateur' },
              ].map(({ u, p, label }) => (
                <button
                  key={u}
                  onClick={() => { setUsername(u); setPassword(p) }}
                  style={{
                    flex: 1,
                    background: C.surface,
                    border: `1.5px solid ${C.border}`,
                    borderRadius: 9,
                    padding: '8px 10px',
                    color: C.textMuted,
                    fontSize: 12,
                    fontWeight: 680,
                    fontFamily: 'inherit',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 5,
                  }}
                >
                  <User size={11} strokeWidth={2.5} />
                  {label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div style={{
          position: 'absolute', bottom: 20,
          color: C.textDim, fontSize: 11,
        }}>
          Azura Group — Agadir, Maroc
        </div>
      </div>
    </div>
  )
}