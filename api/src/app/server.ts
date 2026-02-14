// api/src/app/server.ts
import Fastify from 'fastify'
import cors from '@fastify/cors'
import cookie from '@fastify/cookie'
import formbody from '@fastify/formbody'
import multipart from '@fastify/multipart'
import { registerRoutes } from './routes/index.js'
import { getSessionBySid } from '../shared/session/sessionStore.js'

function parseAllowedOrigins(): string[] {
  const raw = (process.env.APP_ORIGIN || '').trim()
  if (!raw) return []
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
}

// cookie maxAge в секундах (для браузера). Сессия в памяти — отдельно (SESSION_TTL_MS).
const COOKIE_MAX_AGE_SEC = Number(process.env.COOKIE_MAX_AGE_SEC || 30 * 24 * 60 * 60) // 30 дней

export async function buildServer() {
  const isProd = process.env.NODE_ENV === 'production'
  const allowed = parseAllowedOrigins()

  const app = Fastify({
    logger: true,
    trustProxy: isProd,
  })

  await app.register(cors, {
    credentials: true,
    origin: (origin, cb) => {
      if (!origin) return cb(null, true)
      if (!isProd) return cb(null, true)

      if (allowed.length === 0) {
        return cb(new Error('CORS: APP_ORIGIN is not configured'), false)
      }
      if (allowed.includes(origin)) return cb(null, true)
      return cb(new Error(`CORS: origin not allowed: ${origin}`), false)
    },
  })

  await app.register(cookie, {
    secret: process.env.COOKIE_SECRET || 'dev-cookie-secret',
  })

  // Accept application/x-www-form-urlencoded (PowerShell default)
  await app.register(formbody)

  // For receipt uploads (multipart/form-data)
  await app.register(multipart, {
    limits: {
      fileSize: 2 * 1024 * 1024, // 2MB
      files: 1,
    },
  })

  // ✅ Rolling refresh cookie:
  // продлеваем sid-cookie максимально долго, но ТОЛЬКО если sid есть в sessionStore
  app.addHook('preHandler', async (req, reply) => {
    const sid = (req as any).cookies?.sid as string | undefined
    if (!sid) return

    const s = getSessionBySid(sid) // ✅ ключевой фикс: тут нужен getSessionBySid
    if (!s) return

    reply.setCookie('sid', sid, {
      httpOnly: true,
      sameSite: 'lax',
      secure: isProd,
      path: '/',
      maxAge: COOKIE_MAX_AGE_SEC,
      // domain: process.env.COOKIE_DOMAIN, // включим позже при необходимости
    })
  })

  app.get('/health', async () => ({ status: 'ok' }))

  await registerRoutes(app)

  return app
}
