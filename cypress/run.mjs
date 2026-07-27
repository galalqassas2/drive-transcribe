import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const host = '127.0.0.1'
const port = '5173'
const url = `http://${host}:${port}`
const projectCache = resolve(root, '.cypress-cache')
const cypressPackage = JSON.parse(
  readFileSync(resolve(root, 'node_modules/cypress/package.json'), 'utf8'),
)
const localCacheInstalled = existsSync(
  resolve(projectCache, cypressPackage.version),
)
const cypressCache =
  process.env.CYPRESS_CACHE_FOLDER ??
  (localCacheInstalled ? projectCache : undefined)
const cypressEnvironment = cypressCache
  ? { ...process.env, CYPRESS_CACHE_FOLDER: cypressCache }
  : process.env
const vite = spawn(
  process.execPath,
  [
    resolve(root, 'node_modules/vite/bin/vite.js'),
    '--host',
    host,
    '--port',
    port,
    '--strictPort',
  ],
  { cwd: root, stdio: 'inherit' },
)

async function waitForServer() {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (vite.exitCode !== null) {
      throw new Error(`Vite exited with code ${vite.exitCode}`)
    }

    try {
      const response = await fetch(url)
      if (response.ok) return
    } catch {}

    await new Promise((resolveWait) => setTimeout(resolveWait, 250))
  }

  throw new Error('Vite did not start within 20 seconds')
}

try {
  await waitForServer()
  const cypress = spawn(
    process.execPath,
    [resolve(root, 'node_modules/cypress/bin/cypress'), 'run'],
    { cwd: root, env: cypressEnvironment, stdio: 'inherit' },
  )
  const [exitCode] = await once(cypress, 'exit')
  process.exitCode = exitCode ?? 1
} finally {
  vite.kill()
  await Promise.race([
    once(vite, 'exit'),
    new Promise((resolveWait) => setTimeout(resolveWait, 2000)),
  ])
}
