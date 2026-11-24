import { AsyncLocalStorage } from 'node:async_hooks'
import { isIP } from 'node:net'
import type { FastifyInstance } from 'fastify'

const requestIp = new AsyncLocalStorage<string>()

export function clientIpFromRequest(req: any): string {
  const ip = String(req?.ip ?? '').trim()
  if (isIP(ip)) return ip
  const socketIp = String(req?.socket?.remoteAddress ?? '').trim()
  return isIP(socketIp) ? socketIp : ''
}

export function currentRequestClientIp(): string {
  return requestIp.getStore() ?? ''
}

export function trustedProxyAddresses(raw: string): Set<string> {
  return new Set(String(raw ?? '').split(/[\s,]+/).map((s) => s.trim()).filter((s) => isIP(s) !== 0))
}

export function registerClientIpContext(app: FastifyInstance): void {
  app.addHook('onRequest', (req, _reply, done) => {
    requestIp.run(clientIpFromRequest(req), done)
  })
}
