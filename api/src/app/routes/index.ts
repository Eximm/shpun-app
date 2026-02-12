import type { FastifyInstance } from 'fastify'
import { authRoutes } from '../../modules/auth/routes.js'
import { userRoutes } from '../../modules/user/routes.js'

export async function registerRoutes(app: FastifyInstance) {
  await app.register(async (api) => {
    await authRoutes(api)
    await userRoutes(api)
  }, { prefix: '/api' })
}
