import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '../auth'

export function RequireAuth() {
  const { user, loading } = useAuth()
  const location = useLocation()

  if (loading) {
    return (
      <div className="gate-loading">
        <span className="cursor-blink">_</span>
      </div>
    )
  }

  if (!user) {
    return <Navigate to="/" replace state={{ from: location.pathname }} />
  }

  return <Outlet />
}
