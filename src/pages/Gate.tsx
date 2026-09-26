import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom'
import {
  fetchAuthConfig,
  fetchLocalCaptcha,
  type AuthConfig,
  type LocalCaptcha,
} from '../api'
import { useAuth } from '../auth'

type Mode = 'login' | 'register'

declare global {
  interface Window {
    turnstile?: {
      render: (
        el: HTMLElement,
        opts: {
          sitekey: string
          callback: (token: string) => void
          'expired-callback'?: () => void
          theme?: string
        },
      ) => string
      reset: (widgetId?: string) => void
      remove: (widgetId?: string) => void
    }
  }
}

export function GatePage() {
  const { user, loading, login, register } = useAuth()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const mode: Mode = params.get('tab') === 'register' ? 'register' : 'login'

  const [username, setUsername] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [inviteCode, setInviteCode] = useState('')
  const [acceptedTerms, setAcceptedTerms] = useState(false)
  const [captchaAnswer, setCaptchaAnswer] = useState('')
  const [captchaToken, setCaptchaToken] = useState('')
  const [localCaptcha, setLocalCaptcha] = useState<LocalCaptcha | null>(null)
  const [authConfig, setAuthConfig] = useState<AuthConfig | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const turnstileRef = useRef<HTMLDivElement | null>(null)
  const widgetIdRef = useRef<string | null>(null)

  function setMode(next: Mode) {
    setError('')
    setAcceptedTerms(false)
    setInviteCode('')
    setCaptchaAnswer('')
    setCaptchaToken('')
    setParams(next === 'register' ? { tab: 'register' } : {}, { replace: true })
  }

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const config = await fetchAuthConfig()
        if (cancelled) return
        setAuthConfig(config)
      } catch {
        if (!cancelled) setAuthConfig({ captchaMode: 'local', turnstileSiteKey: null })
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (mode !== 'register') return
    if (!authConfig || authConfig.captchaMode !== 'local') return

    let cancelled = false
    ;(async () => {
      try {
        const challenge = await fetchLocalCaptcha()
        if (!cancelled) {
          setLocalCaptcha(challenge)
          setCaptchaAnswer('')
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Could not load captcha')
        }
      }
    })()

    return () => {
      cancelled = true
    }
  }, [mode, authConfig])

  useEffect(() => {
    if (mode !== 'register') return
    if (!authConfig || authConfig.captchaMode !== 'turnstile' || !authConfig.turnstileSiteKey) {
      return
    }

    let cancelled = false

    const mount = () => {
      if (cancelled || !turnstileRef.current || !window.turnstile) return
      if (widgetIdRef.current) {
        window.turnstile.remove(widgetIdRef.current)
        widgetIdRef.current = null
      }
      turnstileRef.current.innerHTML = ''
      widgetIdRef.current = window.turnstile.render(turnstileRef.current, {
        sitekey: authConfig.turnstileSiteKey!,
        theme: 'dark',
        callback: (token) => setCaptchaToken(token),
        'expired-callback': () => setCaptchaToken(''),
      })
    }

    const existing = document.querySelector<HTMLScriptElement>('script[data-turnstile]')
    if (existing && window.turnstile) {
      mount()
    } else if (!existing) {
      const script = document.createElement('script')
      script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'
      script.async = true
      script.dataset.turnstile = '1'
      script.onload = mount
      document.head.appendChild(script)
    } else {
      existing.addEventListener('load', mount)
    }

    return () => {
      cancelled = true
      if (widgetIdRef.current && window.turnstile) {
        window.turnstile.remove(widgetIdRef.current)
        widgetIdRef.current = null
      }
    }
  }, [mode, authConfig])

  async function refreshLocalCaptcha() {
    const challenge = await fetchLocalCaptcha()
    setLocalCaptcha(challenge)
    setCaptchaAnswer('')
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError('')
    setBusy(true)
    try {
      if (mode === 'login') {
        await login(email.trim(), password)
      } else {
        if (!acceptedTerms) {
          throw new Error('Accept the Terms of Service and Privacy Policy')
        }
        await register({
          username: username.trim(),
          email: email.trim(),
          password,
          inviteCode: inviteCode.trim(),
          acceptedTerms: true,
          captchaToken: captchaToken || undefined,
          captchaId: localCaptcha?.id,
          captchaAnswer: captchaAnswer || undefined,
        })
      }
      navigate('/dashboard')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Request failed')
      if (mode === 'register' && authConfig?.captchaMode === 'local') {
        try {
          await refreshLocalCaptcha()
        } catch {
          /* ignore */
        }
      }
      if (mode === 'register' && widgetIdRef.current && window.turnstile) {
        window.turnstile.reset(widgetIdRef.current)
        setCaptchaToken('')
      }
    } finally {
      setBusy(false)
    }
  }

  if (!loading && user) {
    return <Navigate to="/dashboard" replace />
  }

  return (
    <div className="gate">
      <div className="gate-card">
        <img className="gate-ace" src="/brand/ace.png" alt="Noxware" />
        <img className="gate-wordmark" src="/brand/wordmark.png" alt="noxware" />

        <div className="gate-tabs" role="tablist">
          <button
            type="button"
            role="tab"
            className={mode === 'login' ? 'active' : ''}
            aria-selected={mode === 'login'}
            onClick={() => setMode('login')}
          >
            Login
          </button>
          <button
            type="button"
            role="tab"
            className={mode === 'register' ? 'active' : ''}
            aria-selected={mode === 'register'}
            onClick={() => setMode('register')}
          >
            Register
          </button>
        </div>

        <form onSubmit={onSubmit}>
          {error && <p className="form-error">{error}</p>}

          {mode === 'register' && (
            <>
              <div className="field">
                <label htmlFor="gate-username">Username</label>
                <input
                  id="gate-username"
                  required
                  minLength={3}
                  maxLength={24}
                  autoComplete="username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                />
              </div>
              <div className="field">
                <label htmlFor="gate-invite">Invitation code</label>
                <input
                  id="gate-invite"
                  required
                  autoComplete="off"
                  value={inviteCode}
                  onChange={(e) => setInviteCode(e.target.value)}
                  placeholder="NOX-••••-••••"
                />
              </div>
            </>
          )}

          <div className="field">
            <label htmlFor="gate-email">Email</label>
            <input
              id="gate-email"
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>

          <div className="field">
            <label htmlFor="gate-password">Password</label>
            <input
              id="gate-password"
              type="password"
              required
              minLength={mode === 'register' ? 6 : 1}
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>

          {mode === 'register' && (
            <>
              {authConfig?.captchaMode === 'local' && localCaptcha && (
                <div className="field">
                  <label htmlFor="gate-captcha">{localCaptcha.question}</label>
                  <div className="captcha-row">
                    <input
                      id="gate-captcha"
                      required
                      inputMode="numeric"
                      autoComplete="off"
                      value={captchaAnswer}
                      onChange={(e) => setCaptchaAnswer(e.target.value)}
                    />
                    <button
                      type="button"
                      className="btn btn-ghost"
                      onClick={() => void refreshLocalCaptcha()}
                    >
                      Refresh
                    </button>
                  </div>
                </div>
              )}

              {authConfig?.captchaMode === 'turnstile' && (
                <div className="field">
                  <label>Captcha</label>
                  <div ref={turnstileRef} className="turnstile-box" />
                </div>
              )}

              <label className="legal-check">
                <input
                  type="checkbox"
                  checked={acceptedTerms}
                  onChange={(e) => setAcceptedTerms(e.target.checked)}
                  required
                />
                <span>
                  I agree to the <Link to="/terms">Terms of Service</Link> and{' '}
                  <Link to="/privacy">Privacy Policy</Link>
                </span>
              </label>
            </>
          )}

          <button className="btn btn-primary btn-block" type="submit" disabled={busy || loading}>
            {busy ? 'Please wait…' : mode === 'login' ? 'Login' : 'Create account'}
          </button>
        </form>

        <p className="gate-legal-links">
          <Link to="/terms">Terms</Link>
          <span>·</span>
          <Link to="/privacy">Privacy</Link>
        </p>
      </div>
    </div>
  )
}
