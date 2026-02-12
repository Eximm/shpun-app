import Fastify from 'fastify'
import cors from '@fastify/cors'
import cookie from '@fastify/cookie'
import formbody from '@fastify/formbody'
import { registerRoutes } from './routes/index.js'

function parseAllowedOrigins(): string[] {
  // APP_ORIGIN может быть:
  // - "https://sdnonline.online"
  // - "https://sdnonline.online,https://www.sdnonline.online"
  // - пустым (тогда в dev разрешаем все)
  const raw = (process.env.APP_ORIGIN || '').trim()
  if (!raw) return []
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
}

export async function buildServer() {
  const isProd = process.env.NODE_ENV === 'production'
  const allowed = parseAllowedOrigins()

  const app = Fastify({
    logger: true,
    // Если ты деплоишь за Nginx/Caddy/Cloudflare — это важно,
    // иначе secure-cookie/headers могут определяться неверно.
    trustProxy: isProd
  })

  await app.register(cors, {
    credentials: true,
    // В prod лучше ограничить origin.
    // В dev можно оставить “разрешить всё”.
    origin: (origin, cb) => {
      // Non-browser requests (curl, server-to-server) часто без Origin
      if (!origin) return cb(null, true)

      // Dev: разрешаем всё
      if (!isProd) return cb(null, true)

      // Prod: разрешаем только заданные APP_ORIGIN
      if (allowed.length === 0) {
        // Если забыли настроить APP_ORIGIN — лучше явно запретить,
        // чтобы не получить “cookie не ставятся” и странные баги.
        return cb(new Error('CORS: APP_ORIGIN is not configured'), false)
      }

      if (allowed.includes(origin)) return cb(null, true)
      return cb(new Error(`CORS: origin not allowed: ${origin}`), false)
    }
  })

  await app.register(cookie, {
    secret: process.env.COOKIE_SECRET || 'dev-cookie-secret'
  })

  // Accept application/x-www-form-urlencoded (PowerShell default)
  await app.register(formbody)

  app.get('/health', async () => ({ status: 'ok' }))

  await registerRoutes(app)

  return app
}
