import { useEffect, useState } from 'react'
import { apiFetch } from '../../shared/api/client'

export type Me = {
  ok: true
  profile: { id: string; displayName: string }
  balance: { amount: number; currency: string }
  services: { active: number; blocked: number; expired: number }
}

export function useMe() {
  const [me, setMe] = useState<Me | null>(null)
  const [loading, setLoading] = useState(true)

  async function refresh() {
    setLoading(true)
    try {
      const data = await apiFetch<Me>('/me')
      setMe(data)
    } catch {
      setMe(null)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    refresh()
  }, [])

  return { me, loading, refresh }
}
