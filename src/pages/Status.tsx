import { useEffect, useState } from 'react'
import { fetchStatus, type SystemStatus } from '../api'

const REFRESH_MS = 30_000

export function StatusPage() {
  const [status, setStatus] = useState<SystemStatus | null>(null)
  const [error, setError] = useState('')
  const [lastLoaded, setLastLoaded] = useState<number | null>(null)

  useEffect(() => {
    let cancelled = false

    async function load() {
      try {
        const data = await fetchStatus()
        if (cancelled) return
        setStatus(data)
        setError('')
        setLastLoaded(Date.now())
      } catch {
        if (!cancelled) setError('Could not reach the status endpoint. Retrying…')
      }
    }

    void load()
    const timer = setInterval(load, REFRESH_MS)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [])

  return (
    <section className="block">
      <div className="container">
        <p className="section-kicker">&gt; status</p>
        <h2 className="section-title">System status</h2>
        <p className="section-lead">
          Live health of noxware services. Refreshes every 30 seconds.
        </p>

        {error && (
          <p className="form-error" role="alert">
            {error}{' '}
            <button type="button" className="btn btn-ghost" onClick={() => window.location.reload()}>
              Retry
            </button>
        </p>
        )}

        <div className="status-board">
          {!status &&
            !error &&
            Array.from({ length: 5 }).map((_, i) => (
              <div className="status-row" key={i}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                  <span className="status-dot" style={{ opacity: 0.35 }} />
                  <span className="sub">checking…</span>
                </div>
              </div>
            ))}

          {status?.services.map((service) => (
            <div className="status-row" key={service.name}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                <span className={`status-dot ${service.ok ? '' : 'warn'}`} />
                <strong>{service.name}</strong>
              </div>
              <div className="status-meta">
                <span>{service.status}</span>
                {service.latency && <span>{service.latency}</span>}
              </div>
            </div>
          ))}
        </div>

        {status && (
          <p className="sub" style={{ marginTop: '0.75rem' }}>
            Updated {new Date(lastLoaded ?? status.updatedAt).toLocaleTimeString()} ·{' '}
            {status.invitesAvailable > 0
              ? `${status.invitesAvailable} invite slot${status.invitesAvailable === 1 ? '' : 's'} open`
              : 'registration currently closed'}
          </p>
        )}
      </div>
    </section>
  )
}
