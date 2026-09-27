import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { createCheckoutSession, downloadLoader, fetchLoaderMeta, redeemKey, type LoaderMeta } from '../api'
import { useAuth } from '../auth'

type Tab = 'overview' | 'subscription' | 'loader' | 'redeem'

const PLAN_LABELS: Record<string, string> = {
  '1m': '1 Month — €5.99',
  '3m': '3 Months — €14.99',
  '6m': '6 Months — €24.99',
  lifetime: 'Lifetime',
  comp: 'Granted by staff',
}

const BUYABLE_PLANS = ['1m', '3m', '6m']

export function DashboardPage() {
  const { user, subscription, latestLicenseKey, loading, refresh } = useAuth()
  const [tab, setTab] = useState<Tab>('overview')
  const [plan, setPlan] = useState('3m')
  const [keyInput, setKeyInput] = useState('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const active = Boolean(subscription?.active)
  const activeUntil = subscription?.expiresAt ?? null
  const currentPlan = subscription?.planId || plan

  const expiresLabel = useMemo(() => {
    if (!activeUntil) return 'No active subscription'
    return new Date(activeUntil).toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    })
  }, [activeUntil])

  if (loading) {
    return (
      <div className="auth-page">
        <p className="sub">Loading account…</p>
      </div>
    )
  }

  if (!user) return <Navigate to="/login" replace />

  async function startCheckout(planId: string) {
    setError('')
    setMessage('')
    setBusy(true)
    try {
      const session = await createCheckoutSession(planId)
      window.location.href = session.url
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Checkout failed')
      setBusy(false)
    }
  }

  async function onRedeem(e: FormEvent) {
    e.preventDefault()
    setError('')
    setMessage('')
    setBusy(true)
    try {
      const result = await redeemKey(keyInput.trim())
      setMessage(result.message)
      setKeyInput('')
      await refresh()
      setTab('subscription')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Redeem failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="dashboard">
      <aside className="dash-side">
        <button type="button" className={tab === 'overview' ? 'active' : ''} onClick={() => setTab('overview')}>
          Overview
        </button>
        <button
          type="button"
          className={tab === 'subscription' ? 'active' : ''}
          onClick={() => setTab('subscription')}
        >
          Subscription
        </button>
        <button type="button" className={tab === 'loader' ? 'active' : ''} onClick={() => setTab('loader')}>
          Loader
        </button>
        <button type="button" className={tab === 'redeem' ? 'active' : ''} onClick={() => setTab('redeem')}>
          Redeem key
        </button>
      </aside>

      <div className="dash-main">
        <div className="dash-header">
          <div>
            <h1>Dashboard</h1>
            <p>
              Signed in as <strong>{user.username}</strong> · {user.email}
            </p>
          </div>
          <span className={`pill ${active ? '' : 'inactive'}`}>
            <span className={`status-dot ${active ? '' : 'warn'}`} />
            {active ? 'Subscription active' : 'Inactive'}
          </span>
        </div>

        {(message || error) && (
          <div className="dash-panel wide" style={{ marginBottom: '1rem' }}>
            {message && <p style={{ margin: 0, color: 'var(--muted)' }}>{message}</p>}
            {error && <p className="form-error" style={{ margin: message ? '0.5rem 0 0' : 0 }}>{error}</p>}
          </div>
        )}

        {tab === 'overview' && (
          <div className="dash-grid">
            <section className="dash-panel">
              <h2>Account</h2>
              <div className="stat-row">
                <span>Username</span>
                <strong>{user.username}</strong>
              </div>
              <div className="stat-row">
                <span>Email</span>
                <strong>{user.email}</strong>
              </div>
              <div className="stat-row">
                <span>Status</span>
                <strong>{active ? 'Active' : 'Needs plan'}</strong>
              </div>
            </section>
            <section className="dash-panel">
              <h2>Product</h2>
              <div className="stat-row">
                <span>Game</span>
                <strong>Counter-Strike 2</strong>
              </div>
              <div className="stat-row">
                <span>Build</span>
                <strong>nox-loader 1.4.2</strong>
              </div>
              <div className="stat-row">
                <span>Expires</span>
                <strong>{expiresLabel}</strong>
              </div>
            </section>
            {latestLicenseKey && (
              <section className="dash-panel wide">
                <h2>Latest license key</h2>
                <div className="stat-row">
                  <span>Code</span>
                  <strong>{latestLicenseKey.code}</strong>
                </div>
                <div className="stat-row">
                  <span>Plan</span>
                  <strong>{PLAN_LABELS[latestLicenseKey.planId] || latestLicenseKey.planId}</strong>
                </div>
              </section>
            )}
            <section className="dash-panel wide">
              <h2>Quick actions</h2>
              <div className="loader-box">
                <div>
                  <strong>Launch path</strong>
                  <p style={{ margin: '0.35rem 0 0', color: 'var(--muted)' }}>
                    Checkout with crypto → wait for confirmation → download loader when active.
                  </p>
                </div>
                <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap' }}>
                  <Link className="btn btn-ghost" to="/store">
                    Open store
                  </Link>
                  <button type="button" className="btn btn-primary" onClick={() => setTab('loader')}>
                    Get loader
                  </button>
                </div>
              </div>
            </section>
          </div>
        )}

        {tab === 'subscription' && (
          <div className="dash-grid">
            <section className="dash-panel wide">
              <h2>Current plan</h2>
              <div className="stat-row">
                <span>Active tier</span>
                <strong>
                  {subscription?.planId
                    ? PLAN_LABELS[subscription.planId] || subscription.planId
                    : 'None'}
                </strong>
              </div>
              <div className="stat-row">
                <span>Access</span>
                <strong>{active ? 'Unlocked' : 'Locked'}</strong>
              </div>
              <div className="stat-row">
                <span>Expires</span>
                <strong>{expiresLabel}</strong>
              </div>
              <p style={{ color: 'var(--muted)', marginTop: '1.25rem' }}>
                Pay with crypto via NOWPayments. Access unlocks after the payment confirms on-chain.
              </p>
              <div style={{ marginTop: '1rem', display: 'flex', gap: '0.6rem', flexWrap: 'wrap' }}>
                <Link className="btn btn-primary" to="/store">
                  Go to store
                </Link>
                {BUYABLE_PLANS.map((id) => (
                  <button
                    key={id}
                    type="button"
                    className={`btn ${currentPlan === id ? 'btn-primary' : 'btn-ghost'}`}
                    disabled={busy}
                    onClick={() => {
                      setPlan(id)
                      void startCheckout(id)
                    }}
                  >
                    Buy {PLAN_LABELS[id]}
                  </button>
                ))}
              </div>
            </section>
          </div>
        )}

        {tab === 'loader' && <LoaderTab active={active} />}

        {tab === 'redeem' && (
          <div className="dash-grid">
            <section className="dash-panel wide">
              <h2>Redeem license key</h2>
              <p style={{ marginTop: 0, color: 'var(--muted)' }}>
                Use a key from a purchase (or a gifted key). Checkout also activates your account
                automatically.
              </p>
              <form onSubmit={onRedeem}>
                <div className="field">
                  <label htmlFor="key">License key</label>
                  <input
                    id="key"
                    value={keyInput}
                    onChange={(e) => setKeyInput(e.target.value)}
                    placeholder="NOX-XXXX-XXXX-XXXX"
                    required
                  />
                </div>
                <button className="btn btn-primary" type="submit" disabled={busy}>
                  {busy ? 'Redeeming…' : 'Redeem'}
                </button>
              </form>
            </section>
          </div>
        )}
      </div>
    </div>
  )
}

function LoaderTab({ active }: { active: boolean }) {
  const [metas, setMetas] = useState<Record<'windows' | 'linux', LoaderMeta | null>>({
    windows: null,
    linux: null,
  })
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    Promise.all([fetchLoaderMeta('windows'), fetchLoaderMeta('linux')])
      .then(([w, l]) => {
        if (cancelled) return
        setMetas({ windows: w.build, linux: l.build })
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load build info')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  async function onDownload(platform: 'windows' | 'linux') {
    setError('')
    try {
      const link = await downloadLoader(platform)
      window.location.href = link.url
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Download failed')
    }
  }

  const cards: { platform: 'windows' | 'linux'; title: string; subtitle: string }[] = [
    { platform: 'windows', title: 'Windows 10 / 11', subtitle: 'x64' },
    { platform: 'linux', title: 'Linux', subtitle: 'x64 · ELF binary' },
  ]

  return (
    <div className="dash-grid">
      <section className="dash-panel wide">
        <h2>nox-loader</h2>
        <p style={{ marginTop: 0, color: 'var(--muted)' }}>
          Downloads unlock with an active subscription. Verify the SHA-256 checksum before running.
        </p>
        {error && <p className="form-error">{error}</p>}
        <div className="dash-grid">
          {cards.map(({ platform, title, subtitle }) => {
            const meta = metas[platform]
            return (
              <div className="dash-panel" key={platform}>
                <div className="loader-box">
                  <div>
                    <strong>{title}</strong>
                    <p style={{ margin: '0.35rem 0 0', color: 'var(--muted)' }}>{subtitle}</p>
                  </div>
                  {active && meta ? (
                    <button type="button" className="btn btn-primary" onClick={() => void onDownload(platform)}>
                      Download
                    </button>
                  ) : (
                    <button type="button" className="btn btn-ghost" disabled>
                      {active ? 'No build yet' : 'Locked'}
                    </button>
                  )}
                </div>
                {meta ? (
                  <>
                    <div className="stat-row">
                      <span>Version</span>
                      <strong>{meta.version}</strong>
                    </div>
                    <div className="stat-row">
                      <span>Size</span>
                      <strong>{(meta.sizeBytes / (1024 * 1024)).toFixed(1)} MB</strong>
                    </div>
                    <div className="stat-row">
                      <span>SHA-256</span>
                      <strong style={{ wordBreak: 'break-all' }}>{meta.sha256}</strong>
                    </div>
                    <div className="stat-row">
                      <span>Updated</span>
                      <strong>{new Date(meta.updatedAt).toLocaleDateString()}</strong>
                    </div>
                  </>
                ) : (
                  <p className="sub" style={{ marginTop: '0.75rem' }}>
                    {loading ? 'Loading…' : 'No build published for this platform yet.'}
                  </p>
                )}
              </div>
            )
          })}
        </div>
      </section>
    </div>
  )
}
