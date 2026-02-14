// api/src/app/routes/index.ts

import type { FastifyInstance } from 'fastify'

import { authRoutes } from '../../modules/auth/routes.js'
import { userRoutes } from '../../modules/user/routes.js'
import { servicesRoutes } from '../../modules/services/routes.js'
import { paymentsRoutes } from '../../modules/payments/routes.js'

export async function registerRoutes(app: FastifyInstance) {
  await app.register(
    async (api) => {
      await authRoutes(api)
      await userRoutes(api)
      await servicesRoutes(api)
      await paymentsRoutes(api)
    },
    { prefix: '/api' }
  )
}
