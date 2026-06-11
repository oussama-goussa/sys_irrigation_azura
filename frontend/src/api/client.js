// ============================================================
// frontend/src/api/client.js — Client API Azura complet
// ============================================================

const BASE = ''

// ── Token en mémoire uniquement (pas sessionStorage → résistant XSS) ──
let _memoryToken = null
export function setAccessToken(token)  { _memoryToken = token }
export function getAccessToken()       { return _memoryToken }
export function clearAccessToken()     { _memoryToken = null }

// ── Auto refresh token ────────────────────────────────────────
let refreshPromise = null
let isRefreshing = false

async function fetchWithRefresh(url, options = {}, _retryCount = 0) {
    const freshToken = _memoryToken
    if (freshToken && !options.headers?.Authorization) {
        options = {
            ...options,
            headers: { ...options.headers, Authorization: `Bearer ${freshToken}` },
        }
    }
    // Toujours envoyer les cookies avec chaque requête
    options = { ...options, credentials: 'include' }

    let res = await fetch(url, options)

    if (res.status === 401) {
        if (_retryCount >= 1) {
            // Éviter la boucle infinie : on a déjà retryé une fois
            window.dispatchEvent(new Event('azura_logout'))
            throw new Error('Session expirée')
        }

        // Tenter un refresh — le cookie HttpOnly est envoyé automatiquement
        if (isRefreshing && refreshPromise) {
            try {
                await refreshPromise
                const newToken = _memoryToken
                options = { ...options, headers: { ...options.headers, Authorization: `Bearer ${newToken}` } }
                return fetch(url, options)
            } catch {
                window.dispatchEvent(new Event('azura_logout'))
                throw new Error('Session expirée')
            }
        }

        isRefreshing    = true
        refreshPromise  = fetch('/api/auth/refresh', {
            method      : 'POST',
            credentials : 'include',  // ← le cookie refresh_token est envoyé automatiquement
            // plus besoin d'envoyer refresh_token dans le body
        })
            .then(async (r) => {
                if (!r.ok) throw new Error('Refresh failed')
                const { access_token } = await r.json()
                _memoryToken = access_token   // stocker en mémoire uniquement
                window.dispatchEvent(new CustomEvent('azura_token_refresh', { detail: { access_token } }))
                return access_token
            })
            .finally(() => {
                isRefreshing   = false
                refreshPromise = null
            })

        try {
            const newAccessToken = await refreshPromise
            options = { ...options, headers: { ...options.headers, Authorization: `Bearer ${newAccessToken}` } }
            res = await fetch(url, options)
        } catch {
            window.dispatchEvent(new Event('azura_logout'))
            throw new Error('Session expirée')
        }
    }

    return res
}

// ── Auth ──────────────────────────────────────────────────────
export async function login(username, password) {
    const fd = new FormData()
    fd.append('username', username)
    fd.append('password', password)
    const res = await fetch(`${BASE}/api/auth/login`, {
        method      : 'POST',
        body        : fd,
        credentials : 'include',   // ← envoie/reçoit les cookies
    })
    if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.detail || 'Identifiants incorrects')
    }
    // La réponse ne contient plus refresh_token (c'est un cookie HttpOnly)
    // Elle contient : access_token, role, username, farm_names
    return res.json()
}

export async function logout(token) {
    await fetch(`${BASE}/api/auth/logout`, {
        method      : 'POST',
        headers     : { Authorization: `Bearer ${token}` },
        credentials : 'include',  // ← le cookie est supprimé côté serveur
    })
    sessionStorage.removeItem('azura_auth')
    _memoryToken = null
}

export async function getMe(token) {
  const res = await fetchWithRefresh(`${BASE}/api/auth/me`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) throw new Error('Erreur chargement profil')
  return res.json()
}

export async function getUsers(token) {
  const res = await fetchWithRefresh(`${BASE}/api/auth/users`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) throw new Error('Accès refusé')
  return res.json()
}

export async function createUser(token, payload) {
  const res = await fetchWithRefresh(`${BASE}/api/auth/users`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    const detail = Array.isArray(err.detail)
      ? err.detail.map(d => `${(d.loc || []).slice(1).join('.')} : ${d.msg}`).join(' | ')
      : err.detail || 'Erreur lors de la création'
    throw new Error(detail)
  }
  return res.json()
}

export async function editUser(token, username, payload) {
  const res = await fetchWithRefresh(`${BASE}/api/auth/users/${username}`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.detail || 'Erreur lors de la modification')
  }
  return res.json()
}

export async function changeRole(token, username, new_role) {
  const res = await fetchWithRefresh(`${BASE}/api/auth/users/${username}/role`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ new_role }),
  })
  if (!res.ok) throw new Error('Erreur changement de rôle')
  return res.json()
}

export async function toggleUser(token, username) {
  const res = await fetchWithRefresh(`${BASE}/api/auth/users/${username}/toggle`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) throw new Error('Erreur activation/désactivation')
  return res.json()
}

export async function getAuditLogs(token, username = null, limit = 100) {
  const params = new URLSearchParams({ limit })
  if (username) params.append('username', username)
  const res = await fetchWithRefresh(`${BASE}/api/auth/logs?${params}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) throw new Error('Erreur chargement logs')
  return res.json()
}

export async function exportCSV(token) {
  const res = await fetchWithRefresh(`${BASE}/api/auth/users/export`, {
    headers: { Authorization: `Bearer ${getAccessToken()}` },
  })
  if (!res.ok) throw new Error('Erreur export CSV')
  const blob = await res.blob()
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'liste_utilisateurs.xlsx'
  a.style.display = 'none'
  document.body.appendChild(a)
  a.click()
  setTimeout(() => {
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }, 1000)
}

// ── Devices ───────────────────────────────────────────────────

/** Liste devices groupés par ferme (pour sidebar) */
export async function getDevices(token) {
  const res = await fetchWithRefresh(`${BASE}/api/devices`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) throw new Error('Erreur chargement devices')
  return res.json()
}

/** Dashboard global : toutes les fermes avec métriques */
export async function getDashboard(token) {
  const res = await fetchWithRefresh(`${BASE}/api/devices/dashboard`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) throw new Error('Erreur chargement dashboard')
  return res.json()
}

/** Dernière lecture temps réel d'un device (StatCards) */
export async function getDeviceLatest(token, deviceId) {
  const res = await fetchWithRefresh(`${BASE}/api/devices/${deviceId}/latest`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) throw new Error('Erreur chargement données temps réel')
  return res.json()
}

/** Historique paginé pour le tableau */
export async function getDeviceHistory(token, deviceId, { dateFrom, dateTo, page = 1, perPage = 50 } = {}) {
  const params = new URLSearchParams({ page, per_page: perPage })
  if (dateFrom) params.append('date_from', dateFrom)
  if (dateTo)   params.append('date_to',   dateTo)
  const res = await fetchWithRefresh(`${BASE}/api/devices/${deviceId}/history?${params}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) throw new Error('Erreur chargement historique')
  return res.json()
}

/** Export CSV d'un device sur une période */
export async function exportDeviceCSV(token, deviceId, dateFrom, dateTo, filename = 'azura_export.csv') {
  const params = new URLSearchParams()
  if (dateFrom) params.append('date_from', dateFrom)
  if (dateTo)   params.append('date_to',   dateTo)
  const res = await fetchWithRefresh(`${BASE}/api/devices/${deviceId}/export?${params}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) throw new Error('Erreur export')
  const blob = await res.blob()
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.style.display = 'none'
  document.body.appendChild(a)
  a.click()
  setTimeout(() => {
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }, 1000)
}

/** Alertes actives d'un device */
export async function getDeviceAlerts(token, deviceId, resolved = false) {
  const res = await fetchWithRefresh(`${BASE}/api/devices/${deviceId}/alerts?resolved=${resolved}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) throw new Error('Erreur chargement alertes')
  return res.json()
}

/** Tours d'irrigation d'un device */
export async function getDeviceTours(token, deviceId, date = null) {
  const params = new URLSearchParams()
  if (date) params.append('date', date)
  const res = await fetchWithRefresh(`${BASE}/api/devices/${deviceId}/tours?${params}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) throw new Error('Erreur chargement tours')
  return res.json()
}
// ── Saisie journalière ────────────────────────────────────────

/** Enregistrer une saisie journalière complète */
export async function saveSaisie(token, payload) {
  const res = await fetchWithRefresh(`${BASE}/api/saisie`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    // 422 : extraire les détails de validation Pydantic
    if (Array.isArray(err.detail)) {
      const msgs = err.detail.map(d => `${(d.loc || []).slice(1).join('.')} : ${d.msg}`).join(' | ')
      throw new Error(msgs)
    }
    throw new Error(err.detail || `Erreur ${res.status}`)
  }
  return res.json()
}

/** Liste des saisies avec filtres optionnels */
export async function getSaisies(token, {
  farmName, dateFrom, dateTo,
  station, serre, vanne,
  nbr_bras, nbr_goutteurs,
  poids_matin, heure_matin,
  poids_soir, heure_soir,
  bassin_ec,
  page = 1, perPage = 20
} = {}) {
  const params = new URLSearchParams({ page, per_page: perPage })
  if (farmName)      params.append('farm_name',      farmName)
  if (dateFrom)      params.append('date_from',      dateFrom)
  if (dateTo)        params.append('date_to',        dateTo)
  if (station)       params.append('station',        station)
  if (serre)         params.append('serre',          serre)
  if (vanne)         params.append('vanne',          vanne)
  if (nbr_bras)      params.append('nbr_bras',       nbr_bras)
  if (nbr_goutteurs) params.append('nbr_goutteurs',  nbr_goutteurs)
  if (poids_matin)   params.append('poids_matin',    poids_matin)
  if (heure_matin)   params.append('heure_matin',    heure_matin)
  if (poids_soir)    params.append('poids_soir',     poids_soir)
  if (heure_soir)    params.append('heure_soir',     heure_soir)
  if (bassin_ec)     params.append('bassin_ec',      bassin_ec)
  const res = await fetchWithRefresh(`${BASE}/api/saisie?${params}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) throw new Error('Erreur chargement saisies')
  return res.json()
}

/** Détail d'une saisie avec ses tours */
export async function getSaisie(token, saisieId) {
  const res = await fetchWithRefresh(`${BASE}/api/saisie/${saisieId}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) throw new Error('Erreur chargement saisie')
  return res.json()
}

/** Supprimer une saisie */
export async function deleteSaisie(token, saisieId) {
  const res = await fetchWithRefresh(`${BASE}/api/saisie/${saisieId}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) throw new Error('Erreur suppression saisie')
  return res.json()
}

/** Liste des fermes (pour sélecteurs UsersPage et SaisiePage) */
export async function getFarms(token) {
  const res = await fetchWithRefresh(`${BASE}/api/devices`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) throw new Error('Erreur chargement fermes')
  return res.json() // retourne [{ farm_name, houses }, ...]
}

/** Mettre à jour une saisie existante */
export async function updateSaisie(token, saisieId, payload) {
  const res = await fetchWithRefresh(`${BASE}/api/saisie/${saisieId}`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    if (Array.isArray(err.detail)) {
      const msgs = err.detail.map(d => `${(d.loc || []).slice(1).join('.')} : ${d.msg}`).join(' | ')
      throw new Error(msgs)
    }
    throw new Error(err.detail || `Erreur ${res.status}`)
  }
  return res.json()
}

// Poids
export async function getLatestWeight(token, farmName) {
  const res = await fetchWithRefresh(`${BASE}/api/weight/${farmName}/latest`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) throw new Error('Erreur chargement poids')
  return res.json()
}

export async function getWeightHistory(token, farmName, { dateFrom, dateTo, page = 1, perPage = 50 } = {}) {
  // Limiter perPage entre 10 et 500 (respect des contraintes backend)
  perPage = Math.min(500, Math.max(10, perPage));
  const params = new URLSearchParams({ page, per_page: perPage })
  if (dateFrom) params.append('date_from', dateFrom)
  if (dateTo)   params.append('date_to', dateTo)
  const res = await fetchWithRefresh(`${BASE}/api/weight/${farmName}/history?${params}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) throw new Error('Erreur historique poids')
  return res.json()
}

// À ajouter dans client.js après getDeviceAlerts
export async function resolveDeviceAlert(token, deviceId, alertId) {
    const res = await fetchWithRefresh(`${BASE}/api/devices/${deviceId}/alerts/${alertId}/resolve`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}` },
    })
    if (!res.ok) throw new Error('Erreur résolution alerte')
    return res.json()
}
// ── Helper téléchargement blob ────────────────────────────────
function _triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.style.display = 'none'
  document.body.appendChild(a)
  a.click()
  setTimeout(() => {
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }, 1500)
}

// ── Export saisie Excel (centralisé, avec refresh auto) ───────
export async function exportSaisieExcel(farmNames, dateFrom, dateTo) {
  const params = new URLSearchParams({
    farm_names: farmNames.join(','),
    date_from: dateFrom,
    date_to: dateTo,
  })

  // AbortController pour timeout de 60 secondes
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), 60000)

  let res
  try {
    res = await fetchWithRefresh(`${BASE}/api/export/saisie?${params}`, {
      headers: { Authorization: `Bearer ${_memoryToken}` },
      signal: controller.signal,
    })
  } finally {
    clearTimeout(timeoutId)
  }

  if (!res.ok) {
    // Essayer de lire le message d'erreur JSON
    let detail = `Erreur ${res.status}`
    try {
      const err = await res.json()
      detail = err.detail || detail
    } catch { /* body pas JSON */ }
    throw new Error(detail)
  }

  const blob = await res.blob()
  if (blob.size === 0) throw new Error('Fichier vide reçu du serveur')

  _triggerDownload(blob, `suivi_irrigation_${dateFrom}_${dateTo}.xlsx`)
}

// ── Agent IA ──────────────────────────────────────────────────

/** Recommandation IA pour un device à une date donnée */
export async function getRecommandation(token, deviceId, dateStr) {
  const params = dateStr ? `?date_str=${dateStr}` : ''
  const res = await fetchWithRefresh(`${BASE}/api/ai/recommandations/${deviceId}${params}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (res.status === 404) return null
  if (res.status === 422) {
    const err = await res.json().catch(() => ({}))
    const detail = err.detail || {}
    // Retourner un objet erreur lisible par HouseCard
    return {
      erreur : detail.code    || "ERREUR_CONFIG",
      message: detail.message || "Erreur de configuration",
    }
  }
  if (!res.ok) throw new Error(`Erreur API: ${res.status}`)
  const data = await res.json()
  return data.recommandation || data
}

/** Récupérer la configuration IA d'un device */
export async function getAIConfig(token, deviceId) {
  const res = await fetchWithRefresh(`${BASE}/api/ai/config/${deviceId}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (res.status === 404) return null
  if (!res.ok) throw new Error(`Erreur API: ${res.status}`)
  return res.json()
}

/** Mettre à jour la configuration IA d'un device */
export async function updateAIConfig(token, deviceId, updates) {
  const res = await fetchWithRefresh(`${BASE}/api/ai/config/${deviceId}`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(updates),
  })
  if (!res.ok) throw new Error(`Erreur API: ${res.status}`)
  return res.json()
}

/** Statistiques journalières min/max/avg d'un device */
export async function getDeviceDailyStats(token, deviceId, date = null) {
  const params = new URLSearchParams()
  if (date) params.append('date', date)
  const res = await fetchWithRefresh(
    `${BASE}/api/devices/${deviceId}/daily-stats?${params}`,
    { headers: { Authorization: `Bearer ${token}` } }
  )
  if (!res.ok) throw new Error('Erreur chargement stats journalières')
  return res.json()
}

/** Saisie drainage après un tour + décision ML */
export async function postDecisionTour(token, payload) {
  const res = await fetchWithRefresh(`${BASE}/api/ai/decision-tour`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.detail || `Erreur ${res.status}`)
  }
  return res.json()
}

/** Décisions tour/tour d'un device pour une journée */
export async function getDecisionsTour(token, deviceId, dateStr) {
  const params = dateStr ? `?date_str=${dateStr}` : ''
  const res = await fetchWithRefresh(`${BASE}/api/ai/decision-tour/${deviceId}${params}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) throw new Error(`Erreur ${res.status}`)
  return res.json()
}