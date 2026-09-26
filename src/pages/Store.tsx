import { useState } from 'react'
import { createCheckoutSession } from '../api'

const plans = [
  {
    id: '1m',
    name: '1 Month',
    price: '€5.99',
    per: '/ month',
    features: ['Full feature access', 'Config sync', 'Discord support', 'Frequent updates'],
  },
  {
    id: '3m',
    name: '3 Months',
    price: '€14.99',
    per: '/ 3 months',
    featured: true,
    features: ['Everything in 1 Month', 'Priority updates', 'Early feature trials', 'Save ~17%'],
  },
  {
    id: '6m',
    name: '6 Months',
    price: '€24.99',
    per: '/ 6 months',
    features: ['Everything in 3 Months', 'Best value rate', 'Extended support window', 'Save ~30%'],
  },
]

function PlanCheckoutButton({ planId, label }: { planId: string; label: string }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  return (
    <>
      <button
        type="button"
        className="btn btn-primary btn-block"
        disabled={busy}
        onClick={async () => {
          setBusy(true)
          setError('')
          try {
            const session = await createCheckoutSession(planId)
            window.location.href = session.url
          } catch (err) {
            setError(err instanceof Error ? err.message : 'Checkout failed')
            setBusy(false)
          }
        }}
      >
        {busy ? 'Opening crypto checkout…' : label}
      </button>
      {error && (
        <p className="form-error" style={{ marginTop: '0.75rem' }}>
          {error}
        </p>
      )}
    </>
  )
}

export function StorePage() {
  return (
    <section className="block">
      <div className="container">
        <p className="section-kicker">&gt; store</p>
        <h2 className="section-title">Subscriptions</h2>
        <p className="section-lead">
          Crypto checkout only. Pick a window — access unlocks after payment confirms.
        </p>
        <p className="crypto-rail" aria-label="Accepted cryptocurrencies">
          <span>BTC</span>
          <span>ETH</span>
          <span>USDT</span>
          <span>USDC</span>
          <span>LTC</span>
          <span>+ more</span>
        </p>
        <div className="pricing-grid">
          {plans.map((plan) => (
            <article className={`plan ${plan.featured ? 'featured' : ''}`} key={plan.id}>
              {plan.featured && <span className="plan-badge">Popular</span>}
              <h3>{plan.name}</h3>
              <p className="price">
                {plan.price} <span>{plan.per}</span>
              </p>
              <ul>
                {plan.features.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
              <PlanCheckoutButton planId={plan.id} label={`Buy ${plan.name}`} />
            </article>
          ))}
        </div>
      </div>
    </section>
  )
}
