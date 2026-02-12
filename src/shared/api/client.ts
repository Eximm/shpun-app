const API_BASE = '/api'

export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      ...(init.headers || {}),
      'Content-Type': 'application/json'
    },
    credentials: 'include'
  })

  const text = await res.text()
  const data = text ? JSON.parse(text) : null

  if (!res.ok) {
    const msg = data?.error || data?.message || `Request failed: ${res.status}`
    throw new Error(msg)
  }

  return data as T
}
