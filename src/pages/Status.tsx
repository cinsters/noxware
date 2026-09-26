const services = [
  { name: 'Website', status: 'Operational', ok: true, latency: '42ms' },
  { name: 'Auth API', status: 'Operational', ok: true, latency: '68ms' },
  { name: 'Loader CDN', status: 'Operational', ok: true, latency: '91ms' },
  { name: 'Config sync', status: 'Degraded', ok: false, latency: '210ms' },
  { name: 'Discord bot', status: 'Operational', ok: true, latency: '55ms' },
]

export function StatusPage() {
  return (
    <section className="block">
      <div className="container">
        <p className="section-kicker">&gt; status</p>
        <h2 className="section-title">System status</h2>
        <p className="section-lead">Live health of noxware services. Updated every few minutes.</p>
        <div className="status-board">
          {services.map((service) => (
            <div className="status-row" key={service.name}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                <span className={`status-dot ${service.ok ? '' : 'warn'}`} />
                <strong>{service.name}</strong>
              </div>
              <div className="status-meta">
                <span>{service.status}</span>
                <span>{service.latency}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
