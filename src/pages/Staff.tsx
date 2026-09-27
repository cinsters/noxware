import { useCallback, useEffect, useState } from 'react'
import { Navigate } from 'react-router-dom'
import {
  getStaffTicket,
  isStaff,
  listStaffTickets,
  replyStaffTicket,
  updateStaffTicket,
  type Ticket,
} from '../api'
import { useAuth } from '../auth'

const STATUS_FILTERS = ['all', 'open', 'pending', 'closed'] as const

export function StaffPage() {
  const { user, loading } = useAuth()
  const [tickets, setTickets] = useState<Ticket[]>([])
  const [filter, setFilter] = useState<(typeof STATUS_FILTERS)[number]>('all')
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [selected, setSelected] = useState<Ticket | null>(null)
  const [reply, setReply] = useState('')
  const [internal, setInternal] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const loadQueue = useCallback(async () => {
    try {
      const data = await listStaffTickets(filter)
      setTickets(data.tickets)
      setSelectedId((current) => (current && data.tickets.some((t) => t.id === current) ? current : data.tickets[0]?.id ?? null))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load tickets')
    }
  }, [filter])

  useEffect(() => {
    if (user && isStaff(user)) void loadQueue()
  }, [user, loadQueue])

  useEffect(() => {
    if (!selectedId) {
      setSelected(null)
      return
    }
    getStaffTicket(selectedId)
      .then((data) => setSelected(data.ticket))
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load ticket'))
  }, [selectedId])

  if (loading) {
    return (
      <div className="auth-page">
        <p className="sub">Loading…</p>
      </div>
    )
  }
  if (!user || !isStaff(user)) return <Navigate to="/dashboard" replace />

  async function onReply(e: React.FormEvent) {
    e.preventDefault()
    if (!selected || !reply.trim()) return
    setBusy(true)
    setError('')
    try {
      await replyStaffTicket(selected.id, reply.trim(), internal, selected.status === 'closed')
      setReply('')
      setInternal(false)
      setNotice(internal ? 'Internal note added.' : 'Reply sent.')
      await Promise.all([loadQueue(), selectedId ? getStaffTicket(selectedId).then((d) => setSelected(d.ticket)) : null])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Reply failed')
    } finally {
      setBusy(false)
    }
  }

  async function onPatch(patch: { status?: string; priority?: string }) {
    if (!selected) return
    setBusy(true)
    setError('')
    try {
      const data = await updateStaffTicket(selected.id, patch)
      setSelected(data.ticket)
      await loadQueue()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Update failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="staff-page">
      <div className="staff-queue">
        <div className="staff-queue-head">
          <h1>Support</h1>
          <span className="pill">{tickets.length} shown</span>
        </div>
        <div className="staff-filters">
          {STATUS_FILTERS.map((s) => (
            <button
              key={s}
              type="button"
              className={`btn btn-ghost ${filter === s ? 'active' : ''}`}
              onClick={() => setFilter(s)}
            >
              {s}
            </button>
          ))}
        </div>
        <div className="staff-list">
          {tickets.length === 0 && <p className="sub">No tickets in this view.</p>}
          {tickets.map((t) => (
            <button
              key={t.id}
              type="button"
              className={`staff-item ${selectedId === t.id ? 'selected' : ''}`}
              onClick={() => setSelectedId(t.id)}
            >
              <div className="staff-item-top">
                <strong>#{t.id}</strong>
                <span className={`pill ${t.status === 'open' ? '' : t.status === 'pending' ? 'warn' : 'inactive'}`}>
                  {t.status}
                </span>
                {t.priority === 'high' && <span className="pill danger">high</span>}
              </div>
              <div className="staff-item-subject">{t.subject}</div>
              <div className="staff-item-meta">
                {t.username} · {t.createdVia} · {new Date(t.updatedAt).toLocaleString()}
              </div>
            </button>
          ))}
        </div>
      </div>

      <div className="staff-conversation">
        {!selected ? (
          <p className="sub">Select a ticket.</p>
        ) : (
          <>
            <div className="dash-header">
              <div>
                <h2>#{selected.id} — {selected.subject}</h2>
                <p>
                  <strong>{selected.username}</strong> ({selected.email}) · via {selected.createdVia}
                </p>
              </div>
              <div className="staff-controls">
                <label>
                  status{' '}
                  <select
                    value={selected.status}
                    disabled={busy}
                    onChange={(e) => void onPatch({ status: e.target.value })}
                  >
                    <option value="open">open</option>
                    <option value="pending">pending</option>
                    <option value="closed">closed</option>
                  </select>
                </label>
                <label>
                  priority{' '}
                  <select
                    value={selected.priority}
                    disabled={busy}
                    onChange={(e) => void onPatch({ priority: e.target.value })}
                  >
                    <option value="low">low</option>
                    <option value="normal">normal</option>
                    <option value="high">high</option>
                  </select>
                </label>
              </div>
            </div>

            <div className="staff-messages">
              {selected.messages?.map((m) => (
                <div key={m.id} className={`staff-msg ${m.authorRole} ${m.internal ? 'note' : ''}`}>
                  <div className="staff-msg-head">
                    <strong>{m.authorRole === 'staff' ? 'Staff' : selected.username}</strong>
                    {m.internal && <span className="pill warn">internal note</span>}
                    <span className="staff-msg-time">{new Date(m.createdAt).toLocaleString()}</span>
                  </div>
                  <p style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{m.body}</p>
                </div>
              ))}
            </div>

            <form onSubmit={onReply} className="staff-reply">
              {(notice || error) && (
                <p className={error ? 'form-error' : 'sub'} style={{ marginTop: 0 }}>
                  {error || notice}
                </p>
              )}
              <textarea
                value={reply}
                onChange={(e) => setReply(e.target.value)}
                placeholder={selected.status === 'closed' ? 'Ticket is closed — replying reopens it' : 'Write a reply…'}
                rows={4}
                required
              />
              <div className="staff-reply-actions">
                <label className="staff-check">
                  <input type="checkbox" checked={internal} onChange={(e) => setInternal(e.target.checked)} />
                  internal note (hidden from customer)
                </label>
                <button type="submit" className="btn btn-primary" disabled={busy || !reply.trim()}>
                  {busy ? 'Sending…' : internal ? 'Add note' : 'Send reply'}
                </button>
              </div>
            </form>
          </>
        )}
      </div>
    </div>
  )
}
