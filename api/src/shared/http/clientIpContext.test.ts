import { test } from 'node:test'
import assert from 'node:assert/strict'
import Fastify from 'fastify'
import { clientIpFromRequest, registerClientIpContext, trustedProxyAddresses } from './clientIpContext.js'
import { shmFetch } from '../shm/shmClient.js'

test('forwards the client IP to SHM through trusted proxies without accepting a forged first hop', async () => {
  const trusted = trustedProxyAddresses('127.0.0.1, ::1, 155.212.208.114')
  const app = Fastify({ trustProxy: (address) => trusted.has(address), logger: false })
  registerClientIpContext(app)
  app.get('/check', async (req) => {
    await shmFetch(null, 'check')
    return { ip: clientIpFromRequest(req) }
  })

  const originalFetch = globalThis.fetch
  const captured: Array<{ real: string | null; forwarded: string | null }> = []
  globalThis.fetch = async (_input, init) => {
    const headers = new Headers(init?.headers)
    captured.push({ real: headers.get('X-Real-IP'), forwarded: headers.get('X-Forwarded-For') })
    return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } })
  }
  try {
    const response = await app.inject({
      method: 'GET',
      url: '/check',
      headers: { 'x-forwarded-for': '198.51.100.99, 203.0.113.42, 155.212.208.114' },
    })
    assert.equal(response.statusCode, 200)
    assert.equal(response.json().ip, '203.0.113.42')
    assert.deepEqual(captured, [{ real: '203.0.113.42', forwarded: '203.0.113.42' }])
  } finally {
    globalThis.fetch = originalFetch
    await app.close()
  }
})

test('requests outside an inbound client request do not invent a client IP', async () => {
  const originalFetch = globalThis.fetch
  let real: string | null = null
  globalThis.fetch = async (_input, init) => {
    real = new Headers(init?.headers).get('X-Real-IP')
    return new Response('{}', { status: 200 })
  }
  try {
    await shmFetch(null, 'check')
    assert.equal(real, null)
  } finally {
    globalThis.fetch = originalFetch
  }
})
