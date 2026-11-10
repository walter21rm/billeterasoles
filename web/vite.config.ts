import { createHmac } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import type { Plugin } from 'vite'
import { defineConfig } from 'vite'

const root = dirname(fileURLToPath(import.meta.url))

function readDevAuth(): { secret: string; issuer: string } {
  let secret = process.env.JWT_SECRET
  let issuer = process.env.JWT_ISSUER
  try {
    const file = readFileSync(resolve(root, '../.env'), 'utf8')
    for (const line of file.split(/\r?\n/)) {
      const match = line.match(/^(JWT_SECRET|JWT_ISSUER)=(.*)$/)
      if (!match) continue
      const value = match[2].trim()
      if (match[1] === 'JWT_SECRET' && !secret) secret = value
      if (match[1] === 'JWT_ISSUER' && !issuer) issuer = value
    }
  } catch {
    // El entorno de desarrollo puede no tener el archivo.
  }
  return {
    secret: secret || 'dev-only-change-me',
    issuer: issuer || 'billetera-dev',
  }
}

function sign(sub: string, secret: string, issuer: string): string {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url')
  const body = Buffer.from(
    JSON.stringify({ sub, iss: issuer, exp: Math.floor(Date.now() / 1000) + 60 * 60 }),
  ).toString('base64url')
  const signature = createHmac('sha256', secret).update(`${header}.${body}`).digest('base64url')
  return `${header}.${body}.${signature}`
}

function devSession(): Plugin {
  return {
    name: 'dev-session',
    configureServer(server) {
      server.middlewares.use('/session', (_req, res) => {
        const auth = readDevAuth()
        res.setHeader('content-type', 'application/json')
        res.end(JSON.stringify({ token: sign('canal-web', auth.secret, auth.issuer) }))
      })
    },
  }
}

export default defineConfig({
  plugins: [react(), devSession()],
  server: {
    port: 5173,
    proxy: {
      '/v1': 'http://127.0.0.1:30080',
    },
  },
})
