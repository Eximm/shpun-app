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

const COOKIE_MAX_AGE_SEC = Number(process.env.COOKIE_MAX_AGE_SEC || 30 * 24 * 60 * 60)

export async function buildServer() {
  const isProd = process.env.NODE_ENV === 'production'
  const allowed = parseAllowedOrigins()

  const app = Fastify({
    logger: {
      // Человекопонятный timestamp вместо unix ms
      timestamp: () => `,"time":"${new Date().toISOString()}"`,
      // В dev — красивый вывод через pino-pretty если доступен,
      // в prod — стандартный JSON (удобно для парсинга в Loki/ELK)
      transport: isProd
        ? undefined
        : {
            target: 'pino-pretty',
            options: {
              colorize: true,
              translateTime: 'SYS:yyyy-mm-dd HH:MM:ss',
              ignore: 'pid,hostname',
            },
          },
    },
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

  await app.register(formbody)

  await app.register(multipart, {
    limits: {
      fileSize: 2 * 1024 * 1024,
      files: 1,
    },
  })

  app.addHook('preHandler', async (req, reply) => {
    const sid = (req as any).cookies?.sid as string | undefined
    if (!sid) return

    const s = getSessionBySid(sid)
    if (!s) return

    reply.setCookie('sid', sid, {
      httpOnly: true,
      sameSite: 'lax',
      secure: isProd,
      path: '/',
      maxAge: COOKIE_MAX_AGE_SEC,
    })
  })

  app.get('/health', async () => ({ status: 'ok' }))

  await registerRoutes(app)

  return app
}