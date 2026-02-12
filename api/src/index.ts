import 'dotenv/config'
import { buildServer } from './app/server.js'

function assertEnv() {
  const isProd = process.env.NODE_ENV === 'production'

  if (!isProd) return

  const required = ['SHM_BASE']
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
        shmBase: process.env.SHM_BASE || 'not-set'
      },
      '🚀 Shpun API started'
    )
  } catch (err) {
    app.log.error(err)
    process.exit(1)
  }
}

main()
