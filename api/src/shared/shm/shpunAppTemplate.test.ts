import assert from 'node:assert/strict'
import http from 'node:http'
import test from 'node:test'

const server = http.createServer((request, response) => {
  let body = ''
  request.on('data', (chunk) => { body += chunk })
  request.on('end', () => {
    const params = new URLSearchParams(body)
    response.setHeader('content-type', 'application/json')
    response.end(JSON.stringify(params.has('ok') ? { ok: 1 } : { ok: 0, error: 'bad_session' }))
  })
})

await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
const address = server.address()
assert.ok(address && typeof address !== 'string')
process.env.SHM_BASE = `http://127.0.0.1:${address.port}/shm/`

const { shmShpunAppTemplate } = await import('./shmClient.js')

test('a logical template error is not reported as success', async () => {
  const result = await shmShpunAppTemplate('test-session', 'status')
  assert.equal(result.ok, false)
  assert.equal(result.status, 422)
  assert.equal((result.json as any)?.error, 'bad_session')
})

test('successful template response stays successful', async () => {
  const result = await shmShpunAppTemplate('test-session', 'status', { ok: 1 })
  assert.equal(result.ok, true)
  assert.equal((result.json as any)?.ok, 1)
})

test.after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()))
})
