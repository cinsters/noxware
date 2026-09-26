import { useEffect, useState } from 'react'
import { Link, Navigate, useSearchParams } from 'react-router-dom'
import { confirmCheckout } from '../api'
import { useAuth } from '../auth'

export function CheckoutSuccessPage() {
  const { user, loading, refresh } = useAuth()
  const [params] = useSearchParams()
  const orderId = Number(params.get('order_id') || 0)
  const [status, setStatus] = useState<'working' | 'done' | 'error'>('working')
  const [message, setMessage] = useState('Confirming crypto payment…')
  const [licenseKey, setLicenseKey] = useState<string | null>(null)

  useEffect(() => {
    if (loading) return
    if (!user) return
    if (!orderId) {
      setStatus('error')
      setMessage('Missing order id.')
      return
    }

    let cancelled = false
    let attempts = 0

    const poll = async () => {
      try {
        const result = await confirmCheckout(orderId)
        if (cancelled) return
        await refresh()
        setLicenseKey(result.licenseKey)
        setStatus('done')
        setMessage(
          result.alreadyProcessed
            ? 'Payment already recorded. Your subscription is active.'
            : 'Crypto payment confirmed. Subscription activated.',
        )
      } catch (err) {
        if (cancelled) return
        attempts += 1
        const text = err instanceof Error ? err.message : 'Could not confirm payment'
        if (attempts < 8 && /not confirmed|waiting|402/i.test(text)) {
          setMessage('Waiting for blockchain confirmations…')
          window.setTimeout(poll, 4000)
          return
        }
        setStatus('error')
        setMessage(text)
      }
    }

    void poll()

    return () => {
      cancelled = true
    }
  }, [loading, user, orderId, refresh])

  if (!loading && !user) {
    return <Navigate to="/login" replace />
  }

  return (
    <div className="auth-page">
      <div className="auth-panel">
        <h1>{status === 'done' ? "You're in" : status === 'error' ? 'Payment pending' : 'Confirming'}</h1>
        <p className="sub">{message}</p>
        {licenseKey && (
          <p style={{ color: 'var(--accent)', wordBreak: 'break-all' }}>
            License key: <strong>{licenseKey}</strong>
          </p>
        )}
        <Link className="btn btn-primary btn-block" to="/dashboard">
          Open dashboard
        </Link>
      </div>
    </div>
  )
}

export function CheckoutCancelPage() {
  return (
    <div className="auth-page">
      <div className="auth-panel">
        <h1>Checkout canceled</h1>
        <p className="sub">No crypto was sent. Restart checkout anytime from pricing.</p>
        <div style={{ display: 'grid', gap: '0.75rem' }}>
          <Link className="btn btn-primary btn-block" to="/#pricing">
            Back to pricing
          </Link>
          <Link className="btn btn-ghost btn-block" to="/dashboard">
            Dashboard
          </Link>
        </div>
      </div>
    </div>
  )
}
