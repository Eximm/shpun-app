// api/src/app/routes/index.ts

import type { FastifyInstance } from 'fastify'

import { adminRoutes } from "../../modules/admin/routes.js";
import { authRoutes } from '../../modules/auth/routes.js'
import { userRoutes } from '../../modules/user/routes.js'
import { servicesRoutes } from '../../modules/services/routes.js'
import { paymentsRoutes } from '../../modules/payments/routes.js'
import { activityRoutes } from '../../modules/activity/routes.js'
import { referralsRoutes } from '../../modules/referrals/routes.js'
import { pushRoutes } from '../../modules/notifications/push.js'
import { promoRoutes } from '../../modules/promo/routes.js'
import { reviewsRoutes } from '../../modules/reviews/routes.js'
import { serverStatusRoutes } from '../../modules/serverStatus/routes.js'

export async function registerRoutes(app: FastifyInstance) {
  await app.register(
    async (api) => {
      await authRoutes(api)
      await userRoutes(api)
      await servicesRoutes(api)
      await paymentsRoutes(api)
      await activityRoutes(api)
      await referralsRoutes(api)
      await adminRoutes(api)
      await promoRoutes(api)
      await reviewsRoutes(api)
      await serverStatusRoutes(api)

      // 🔔 Billing HTTP Push + Notifications
      await pushRoutes(api)
    },
    { prefix: '/api' }
  )
}
