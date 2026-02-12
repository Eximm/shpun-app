import { Navigate, useLocation } from 'react-router-dom'
import { useMe } from './useMe'

export function AuthGate({ children }: { children: React.ReactNode }) {
  const { me, loading } = useMe()
  const loc = useLocation()

  if (loading) return <div style={{ padding: 24 }}>Loading...</div>

  if (!me) {
    return <Navigate to="/login" replace state={{ from: loc.pathname }} />
  }

  return <>{children}</>
}
