import { buildServer } from './app/server.js'
import { startSupportAttachmentCleanup } from './modules/support/cleanupJob.js'
import { startSupportLearning } from './modules/support/learningJob.js'
import { startSupportModelWorker } from './modules/support/modelWorker.js'

function assertEnv() {
  // В проде всё приходит через docker-compose / окружение.
  const isProd = process.env.NODE_ENV === 'production'
  if (!isProd) return

  const required = ['SHM_BASE', 'APP_ORIGIN', 'COOKIE_SECRET']
  for (const key of required) {
    if (!process.env[key]) {
      console.error(`❌ Missing required env variable in production: ${key}`)
      process.exit(1)
    }
  }
}

async function main() {
  assertEnv()

  const app = await buildServer()

  const port = Number(process.env.PORT || 3000)
  const host = '0.0.0.0'

  try {
    await app.listen({ port, host })

    app.log.info(
      {
        port,
        nodeEnv: process.env.NODE_ENV || 'development',
        shmBase: process.env.SHM_BASE || 'not-set',
        appOrigin: process.env.APP_ORIGIN || 'not-set'
      },
      '🚀 Shpyn API started'
    )

    // Best-effort daily retention cleanup for support attachments.
    startSupportAttachmentCleanup()
    startSupportLearning()
    // Real-dialogue export is opt-in and requires separately recorded approval.
    // With either flag absent the worker is not started and no model call is made.
    if (process.env.SUPPORT_LLM_ENABLED === 'true' && process.env.SUPPORT_LLM_REAL_DIALOGUE_APPROVED === 'true') {
      startSupportModelWorker()
    }
  } catch (err) {
    app.log.error(err)
    process.exit(1)
  }
}

main()
