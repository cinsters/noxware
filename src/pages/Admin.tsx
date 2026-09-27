import { useCallback, useEffect, useState } from 'react'
import { Navigate } from 'react-router-dom'
import {
  createInvite,
  fetchAuditLog,
  generateKeys,
  grantUser,
  isAdmin,
  listInvites,
  listUsers,
  patchUser,
  revokeInvite,
  revokeUserInvites,
  type AdminUser,
  type AuditEntry,
  type Invite,
} from '../api'
import { useAuth } from '../auth'

type Tab = 'users' | 'keys' | 'invites' | 'audit'

export function AdminPage() {
  const { user, loading } = useAuth()
  const [tab, setTab] = useState<Tab>('users')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  if (loading) {
    return (
      <div className="auth-page">
        <p className="sub">Loading…</p>
      </div>
    )
  }
  if (!user || !isAdmin(user)) return <Navigate to="/dashboard" replace />

  return (
    <div className="dash-grid">
      <div className="dash-header wide">
        <div>
          <h1>Admin</h1>
          <p>Users, keys, and the audit trail.</p>
        </div>
        <div className="staff-filters">
          {(['users', 'keys', 'invites', 'audit'] as Tab[]).map((t) => (
            <button key={t} type="button" className={`btn btn-ghost ${tab === t ? 'active' : ''}`} onClick={() => setTab(t)}>
              {t}
            </button>
          ))}
        </div>
      </div>

      {(notice || error) && (
        <div className="dash-panel wide">
          {notice && <p style={{ margin: 0, color: 'var(--muted)' }}>{notice}</p>}
          {error && <p className="form-error" style={{ margin: notice ? '0.5rem 0 0' : 0 }}>{error}</p>}
        </div>
      )}

      {tab === 'users' && <UsersTab setNotice={setNotice} setError={setError} />}
      {tab === 'keys' && <KeysTab setNotice={setNotice} setError={setError} />}
      {tab === 'invites' && <InvitesTab setNotice={setNotice} setError={setError} />}
      {tab === 'audit' && <AuditTab setError={setError} />}
    </div>
  )
}

function UsersTab({
  setNotice,
  setError,
}: {
  setNotice: (v: string) => void
  setError: (v: string) => void
}) {
  const [search, setSearch] = useState('')
  const [users, setUsers] = useState<AdminUser[]>([])
  const [busyId, setBusyId] = useState<number | null>(null)

  const load = useCallback(async (q: string) => {
    try {
      const data = await listUsers(q)
      setUsers(data.users)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load users')
    }
  }, [setError])

  useEffect(() => {
    void load(search)
  }, [load, search])

  async function act(id: number, fn: () => Promise<unknown>, okMessage: string) {
    setBusyId(id)
    setError('')
    setNotice('')
    try {
      await fn()
      setNotice(okMessage)
      await load(search)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Action failed')
    } finally {
      setBusyId(null)
    }
  }

  async function onBan(u: AdminUser) {
    const reason = window.prompt(`Ban ${u.username} (${u.email}) — reason:`)
    if (reason === null) return
    await act(u.id, () => patchUser(u.id, { ban: true, banReason: reason || 'No reason provided' }), `Banned ${u.username}.`)
  }

  async function onGrant(u: AdminUser) {
    const input = window.prompt(`Grant days to ${u.username}:\n(e.g. 30, 365, or "lifetime")`, '30')
    if (input === null) return
    const lifetime = input.trim().toLowerCase() === 'lifetime'
    const days = Number.parseInt(input, 10)
    if (!lifetime && (!Number.isInteger(days) || days <= 0)) {
      setError('Enter a positive number of days or "lifetime".')
      return
    }
    await act(u.id, () => grantUser(u.id, lifetime ? { lifetime: true } : { days }), `Granted ${lifetime ? 'lifetime' : `${days} days`} to ${u.username}.`)
  }

  async function onRevokeInvites(u: AdminUser) {
    if (!window.confirm(`Revoke ALL invite codes used by ${u.username}?\n\nThis blocks anyone who got codes from them from registering.`)) return
    setBusyId(u.id)
    setError('')
    setNotice('')
    try {
      const data = await revokeUserInvites(u.id)
      setNotice(`Revoked ${data.revoked.length} invite code(s) for ${u.username}.`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Revoke failed')
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="dash-panel wide">
      <div className="staff-queue-head">
        <h2>Users ({users.length})</h2>
        <input
          className="staff-search"
          placeholder="Search email or username…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>
      <div className="admin-table-wrap">
        <table className="admin-table">
          <thead>
            <tr>
              <th>User</th>
              <th>Role</th>
              <th>Subscription</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} className={u.banned ? 'banned-row' : ''}>
                <td>
                  <strong>{u.username}</strong>
                  <br />
                  <span className="sub">{u.email} · #{u.id}</span>
                </td>
                <td>
                  <select
                    value={u.role}
                    disabled={busyId === u.id}
                    onChange={(e) =>
                      act(u.id, () => patchUser(u.id, { role: e.target.value }), `${u.username} is now ${e.target.value}.`)
                    }
                  >
                    <option value="customer">customer</option>
                    <option value="support">support</option>
                    <option value="admin">admin</option>
                  </select>
                </td>
                <td>
                  {u.subscription ? (
                    <>
                      {u.subscription.planId}
                      <br />
                      <span className="sub">{new Date(u.subscription.expiresAt).toLocaleDateString()}</span>
                    </>
                  ) : (
                    <span className="sub">none</span>
                  )}
                </td>
                <td>
                  {u.banned ? (
                    <>
                      <span className="pill danger">banned</span>
                      <br />
                      <span className="sub">{u.banReason}</span>
                    </>
                  ) : (
                    <span className="pill">ok</span>
                  )}
                </td>
                <td>
                  <div className="admin-actions">
                    {u.banned ? (
                      <button
                        type="button"
                        className="btn btn-ghost"
                        disabled={busyId === u.id}
                        onClick={() => act(u.id, () => patchUser(u.id, { ban: false }), `Unbanned ${u.username}.`)}
                      >
                        Unban
                      </button>
                    ) : (
                      <button type="button" className="btn btn-ghost danger" disabled={busyId === u.id} onClick={() => void onBan(u)}>
                        Ban
                      </button>
                    )}
                    <button type="button" className="btn btn-ghost" disabled={busyId === u.id} onClick={() => void onGrant(u)}>
                      Grant
                    </button>
                    {u.inviteCode && (
                      <button
                        type="button"
                        className="btn btn-ghost danger"
                        disabled={busyId === u.id}
                        title={`Revoke invite code: ${u.inviteCode}`}
                        onClick={() => void onRevokeInvites(u)}
                      >
                        Revoke invite
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function InvitesTab({
  setNotice,
  setError,
}: {
  setNotice: (v: string) => void
  setError: (v: string) => void
}) {
  const [invites, setInvites] = useState<Invite[]>([])
  const [code, setCode] = useState('')
  const [maxUses, setMaxUses] = useState(1)
  const [expiresInDays, setExpiresInDays] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    try {
      const data = await listInvites()
      setInvites(data.invites)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load invites')
    }
  }, [setError])

  useEffect(() => {
    void load()
  }, [load])

  async function onCreate(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const data = await createInvite({
        code,
        maxUses,
        expiresInDays: expiresInDays ? Number(expiresInDays) : null,
        note: note || null,
      })
      setNotice(`Invite ${data.invite.code} created.`)
      setCode('')
      setMaxUses(1)
      setExpiresInDays('')
      setNote('')
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Create failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="dash-panel wide">
      <h2>Invite codes</h2>
      <form onSubmit={onCreate} className="staff-reply-actions" style={{ alignItems: 'center', flexWrap: 'wrap' }}>
        <label>
          code{' '}
          <input
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="SUMMER-2026"
            required
            minLength={4}
          />
        </label>
        <label>
          max uses{' '}
          <input
            type="number"
            min={1}
            max={10000}
            value={maxUses}
            onChange={(e) => setMaxUses(Math.max(1, Math.min(10000, Number(e.target.value) || 1)))}
          />
        </label>
        <label>
          expires in days{' '}
          <input
            type="number"
            min={1}
            max={3650}
            value={expiresInDays}
            onChange={(e) => setExpiresInDays(e.target.value)}
            placeholder="never"
          />
        </label>
        <label>
          note{' '}
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="optional" />
        </label>
        <button type="submit" className="btn btn-primary" disabled={busy}>
          {busy ? 'Creating…' : 'Create invite'}
        </button>
      </form>

      <div className="admin-table-wrap" style={{ marginTop: '1rem' }}>
        <table className="admin-table">
          <thead>
            <tr>
              <th>Code</th>
              <th>Usage</th>
              <th>Signups</th>
              <th>Expires</th>
              <th>Note</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {invites.map((inv) => (
              <tr key={inv.id} className={inv.expired || inv.exhausted ? 'banned-row' : ''}>
                <td>
                  <code>{inv.code}</code>
                </td>
                <td className="sub">
                  {inv.uses}/{inv.maxUses}
                </td>
                <td className="sub">{inv.signups}</td>
                <td className="sub">{inv.expiresAt ? new Date(inv.expiresAt).toLocaleDateString() : 'never'}</td>
                <td className="sub">{inv.note ?? '—'}</td>
                <td>
                  {inv.expired ? (
                    <span className="pill danger">expired</span>
                  ) : inv.exhausted ? (
                    <span className="pill danger">exhausted</span>
                  ) : (
                    <span className="pill">active</span>
                  )}
                </td>
                <td>
                  {!inv.expired && !inv.exhausted && (
                    <button
                      type="button"
                      className="btn btn-ghost danger"
                      onClick={async () => {
                        if (!window.confirm(`Revoke ${inv.code}? New signups will be rejected.`)) return
                        try {
                          await revokeInvite(inv.id)
                          setNotice(`Revoked ${inv.code}.`)
                          await load()
                        } catch (err) {
                          setError(err instanceof Error ? err.message : 'Revoke failed')
                        }
                      }}
                    >
                      Revoke
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {invites.length === 0 && (
              <tr>
                <td colSpan={7} className="sub">
                  No invite codes yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function KeysTab({
  setNotice,
  setError,
}: {
  setNotice: (v: string) => void
  setError: (v: string) => void
}) {
  const [count, setCount] = useState(3)
  const [planId, setPlanId] = useState('3m')
  const [keys, setKeys] = useState<string[]>([])
  const [busy, setBusy] = useState(false)

  async function onGenerate(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const data = await generateKeys(count, planId)
      setKeys(data.keys)
      setNotice(`${data.keys.length} key(s) generated — copy them now; they are shown once here.`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Generation failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="dash-panel wide">
      <h2>Generate license keys</h2>
      <form onSubmit={onGenerate} className="staff-reply-actions" style={{ alignItems: 'center' }}>
        <label>
          plan{' '}
          <select value={planId} onChange={(e) => setPlanId(e.target.value)}>
            <option value="1m">1 Month</option>
            <option value="3m">3 Months</option>
            <option value="6m">6 Months</option>
            <option value="lifetime">Lifetime</option>
          </select>
        </label>
        <label>
          count{' '}
          <input
            type="number"
            min={1}
            max={50}
            value={count}
            onChange={(e) => setCount(Math.max(1, Math.min(50, Number(e.target.value) || 1)))}
          />
        </label>
        <button type="submit" className="btn btn-primary" disabled={busy}>
          {busy ? 'Generating…' : 'Generate'}
        </button>
      </form>

      {keys.length > 0 && (
        <div className="loader-box" style={{ marginTop: '1rem' }}>
          <div>
            <strong>Copy these now — shown once</strong>
            <div className="key-list">
              {keys.map((k) => (
                <code key={k}>{k}</code>
              ))}
            </div>
          </div>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => void navigator.clipboard.writeText(keys.join('\n'))}
          >
            Copy all
          </button>
        </div>
      )}
      <p style={{ color: 'var(--muted)', marginTop: '1rem' }}>
        Keys are unredeemed until someone enters them on the Redeem tab. Lifetime keys add ~100 years.
      </p>
    </div>
  )
}

function AuditTab({ setError }: { setError: (v: string) => void }) {
  const [entries, setEntries] = useState<AuditEntry[]>([])

  useEffect(() => {
    fetchAuditLog()
      .then((data) => setEntries(data.entries))
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load audit log'))
  }, [setError])

  return (
    <div className="dash-panel wide">
      <h2>Audit log ({entries.length})</h2>
      <div className="admin-table-wrap">
        <table className="admin-table">
          <thead>
            <tr>
              <th>When</th>
              <th>Actor</th>
              <th>Action</th>
              <th>Target</th>
              <th>Details</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((e) => (
              <tr key={e.id}>
                <td className="sub">{new Date(e.createdAt).toLocaleString()}</td>
                <td>{e.actor?.username ?? 'system'}</td>
                <td>
                  <code>{e.action}</code>
                </td>
                <td className="sub">{e.targetType ? `${e.targetType} #${e.targetId}` : '—'}</td>
                <td className="sub">{e.details ? JSON.stringify(e.details) : '—'}</td>
              </tr>
            ))}
            {entries.length === 0 && (
              <tr>
                <td colSpan={5} className="sub">
                  No admin actions recorded yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
