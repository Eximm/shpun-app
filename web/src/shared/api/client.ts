const API_BASE = '/api'

export async function apiFetch<T = unknown>(
  path: string,
  init: RequestInit = {}
): Promise<T> {
  const headers = new Headers(init.headers || {})

  // Content-Type ставим только если реально отправляем body
  const hasBody = init.body !== undefined && init.body !== null
  if (hasBody && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json')
  }

  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers,
    credentials: 'include',
  })

  // 204 No Content
  if (res.status === 204) {
    return null as T
  }

  const text = await res.text()

  let data: unknown = null

  if (text) {
    try {
      data = JSON.parse(text)
    } catch {
      data = { message: text }
    }
  }

  if (!res.ok) {
    const err =
      typeof data === 'object' && data !== null
        ? (data as any).error || (data as any).message
        : undefined

    throw new Error(err || `Request failed: ${res.status}`)
  }

  return data as T
}
