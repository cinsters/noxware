import { NavLink, Link, useNavigate } from 'react-router-dom'
import { useState } from 'react'
import { useAuth } from '../auth'

/** Member chrome only — guests see the gate with no nav. */
export function SiteNav() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)

  if (!user) return null

  return (
    <header className="site-nav">
      <div className="container">
        <Link to="/dashboard" className="brand-link" onClick={() => setOpen(false)}>
          <img className="ace" src="/brand/ace.png" alt="Noxware ace mark" />
          <img className="wordmark" src="/brand/wordmark.png" alt="noxware" />
        </Link>

        <nav className={`nav-links ${open ? 'open' : ''}`}>
          <NavLink to="/dashboard" onClick={() => setOpen(false)}>
            Dashboard
          </NavLink>
          <NavLink to="/store" onClick={() => setOpen(false)}>
            Store
          </NavLink>
          <NavLink to="/status" onClick={() => setOpen(false)}>
            Status
          </NavLink>
        </nav>

        <div className="nav-actions">
          <button
            type="button"
            className="mobile-nav-toggle"
            aria-label="Toggle menu"
            onClick={() => setOpen((v) => !v)}
          >
            Menu
          </button>
          <span className="nav-user">{user.username}</span>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => {
              logout()
              navigate('/')
            }}
          >
            Log out
          </button>
        </div>
      </div>
    </header>
  )
}

export function SiteFooter() {
  const { user } = useAuth()
  if (!user) return null

  return (
    <footer className="site-footer">
      <div className="container">
        <img src="/brand/wordmark.png" alt="noxware" />
        <span>© {new Date().getFullYear()} noxware</span>
      </div>
    </footer>
  )
}
