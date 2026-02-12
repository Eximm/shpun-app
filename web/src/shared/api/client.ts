const API_BASE = '/api'

export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers || {})

  // Content-Type ставим только если реально отправляем body
  const hasBody = init.body !== undefined && init.body !== null
  if (hasBody && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json')
  }

  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers,
    credentials: 'include'
  })

  // 204 No Content
  if (res.status === 204) return null as unknown as T

  const text = await res.text()

  // Пытаемся распарсить JSON, но не падаем, если пришёл текст/HTML
  let data: any = null
  if (text) {
    try {
      data = JSON.parse(text)
    } catch {
      data = { message: text }
    }
  }

  if (!res.ok) {
    const msg = data?.error || data?.message || `Request failed: ${res.status}`
    throw new Error(msg)
  }

  return data as T
}
