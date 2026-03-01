const API_BASE = '/api'

function isPlainObject(x: unknown): x is Record<string, unknown> {
  if (!x || typeof x !== 'object') return false
  const proto = Object.getPrototypeOf(x)
  return proto === Object.prototype || proto === null
}

export async function apiFetch<T = unknown>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers || {})

  let body: BodyInit | null | undefined = init.body as any

  // If body is a plain object, send it as JSON
  if (body !== undefined && body !== null && isPlainObject(body)) {
    // Only set JSON content-type when we actually send JSON
    if (!headers.has('Content-Type')) headers.set('Content-Type', 'application/json')
    body = JSON.stringify(body)
  } else {
    // For FormData / Blob / URLSearchParams / string etc:
    // Do not force Content-Type — browser will set it correctly (especially for multipart/form-data)
  }

  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    body,
    headers,
    credentials: 'include',
  })

  // 204 No Content
  if (res.status === 204) return null as T

  const text = await res.text()

  let data: any = null
  if (text) {
    try {
      data = JSON.parse(text)
    } catch {
      data = { message: text }
    }
  }

  if (!res.ok) {
    const errMsg =
      data && typeof data === 'object'
        ? (data.error as string | undefined) || (data.message as string | undefined)
        : undefined

    throw new Error(errMsg || `Request failed: ${res.status}`)
  }

  return data as T
}