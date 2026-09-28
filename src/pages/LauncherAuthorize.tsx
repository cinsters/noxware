import { useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { authorizeLauncher } from '../api'
import { useAuth } from '../auth'
import { stashReturnTo } from '../returnTo'

const CLIENT_ID = 'nox-launcher'
const LOOPBACK_RE = /^http:\/\/127\.0\.0\.1:(\d{1,5})\/callback$/

type Problem = { title: string; detail: string }

function validateParams(params: URLSearchParams): Problem | null {
  if (params.get('response_type') !== 'code') {
    return { title: 'Unsupported request', detail: 'response_type must be "code".' }
  }
  if (params.get('client_id') !== CLIENT_ID) {
    return { title: 'Unknown application', detail: `client_id must be "${CLIENT_ID}".` }
  }
  const redirectUri = params.get('redirect_uri') || ''
  if (!LOOPBACK_RE.test(redirectUri)) {
    return { title: 'Invalid redirect', detail: 'redirect_uri must be a loopback http://127.0.0.1:<port>/callback address.' }
  }
  if ((params.get('scope') || 'launch') !== 'launch') {
    return { title: 'Unsupported scope', detail: 'Only the "launch" scope is supported.' }
  }
  if (params.get('code_challenge_method') !== 'S256') {
    return { title: 'Unsupported PKCE method', detail: 'code_challenge_method must be S256.' }
  }
  const challenge = params.get('code_challenge') || ''
  if (!/^[A-Za-z0-9_-]{43,128}$/.test(challenge)) {
    return { title: 'Invalid PKCE challenge', detail: 'code_challenge is missing or malformed.' }
  }
  const state = params.get('state') || ''
  if (state.length < 8 || state.length > 512) {
    return { title: 'Missing state', detail: 'The launcher did not send a valid state parameter.' }
  }
  return null
}

function loopbackRedirect(redirectUri: string, extra: Record<string, string>) {
  const url = new URL(redirectUri)
  for (const [key, value] of Object.entries(extra)) url.searchParams.set(key, value)
  return url.toString()
}

export function LauncherAuthorizePage() {
  const { user, loading } = useAuth()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const problem = validateParams(params)
  const redirectUri = params.get('redirect_uri') || ''
  const state = params.get('state') || ''

  function goToLogin() {
    stashReturnTo(window.location.pathname + window.location.search)
    navigate('/?tab=login')
  }

  async function approve() {
    setError('')
    setBusy(true)
    try {
      const result = await authorizeLauncher({
        clientId: CLIENT_ID,
        redirectUri,
        codeChallenge: params.get('code_challenge') || '',
        scope: params.get('scope') || 'launch',
        state,
      })
      // Full navigation out of the SPA, to the launcher's loopback listener.
      window.location.replace(result.redirect)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not authorize the launcher')
      setBusy(false)
    }
  }

  function deny() {
    window.location.replace(loopbackRedirect(redirectUri, { error: 'access_denied', state }))
  }

  if (problem) {
    return (
      <div className="auth-page">
        <div className="auth-panel">
          <p className="section-kicker">&gt; launcher</p>
          <h1>Can't sign in launcher</h1>
          <p className="sub">{problem.detail}</p>
          <p className="sub">Close this tab and start the sign-in again from the noxware launcher.</p>
        </div>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="gate-loading">
        <span className="cursor-blink">_</span>
      </div>
    )
  }

  if (!user) {
    return (
      <div className="auth-page">
        <div className="auth-panel">
          <p className="section-kicker">&gt; launcher sign-in</p>
          <h1>noxware Launcher</h1>
          <p className="sub">Sign in to your noxware account to approve the launcher on this device.</p>
          <button type="button" className="btn btn-primary btn-block" onClick={goToLogin}>
            Sign in to continue
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="auth-page">
      <div className="auth-panel">
        <p className="section-kicker">&gt; authorize device</p>
        <h1>noxware Launcher</h1>
        <p className="sub">
          <strong>{user.username}</strong> ({user.email})
        </p>

        <div className="stat-row">
          <span>Application</span>
          <strong>noxware Launcher (nox-launcher)</strong>
        </div>
        <div className="stat-row">
          <span>Access requested</span>
          <strong>launch</strong>
        </div>
        <div className="stat-row">
          <span>Callback</span>
          <strong>{redirectUri}</strong>
        </div>

        <p className="sub" style={{ margin: '1rem 0' }}>
          Approving signs this device in to the launcher. You can revoke it later from Dashboard →
          Devices, or on the site at any time.
        </p>

        {error && <p className="form-error">{error}</p>}

        <div style={{ display: 'grid', gap: '0.6rem' }}>
          <button type="button" className="btn btn-primary btn-block" disabled={busy} onClick={() => void approve()}>
            {busy ? 'Authorizing…' : 'Approve'}
          </button>
          <button type="button" className="btn btn-ghost btn-block" disabled={busy} onClick={deny}>
            Deny
          </button>
        </div>
      </div>
    </div>
  )
}
