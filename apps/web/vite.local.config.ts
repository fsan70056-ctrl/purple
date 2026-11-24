// Local, frontend-only build: no Cloudflare Worker, D1, Turnstile or hosted MCP.
// Sharing, feedback and the hosted agent relay are unavailable in this build.
// Mirrors the verified preview config from the stage-one audit, repo-relative.
// Run with: vite <cmd> --config vite.local.config.ts --configLoader native
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath as nativeFileURLToPath } from 'node:url'
import { sameOriginSuperdoughWorklet } from './vite/superdough-worklet.ts'

const fileURLToPath = (url: URL) => nativeFileURLToPath(url).replaceAll('\\', '/')
const root = fileURLToPath(new URL('./', import.meta.url))
const alias: Record<string, string> = { '#': root + 'src' }
for (const pkg of ['core', 'ui']) {
  const base = new URL(`../../packages/${pkg}/`, import.meta.url)
  const meta = JSON.parse(readFileSync(new URL('package.json', base), 'utf8'))
  for (const [key, value] of Object.entries(meta.exports)) {
    alias[`@purple/${pkg}/${key.slice(2)}`] = fileURLToPath(new URL(value as string, base))
  }
}
const fromUi = createRequire(new URL('../../packages/ui/package.json', import.meta.url))
const web = fromUi.resolve('@strudel/web')
const webaudio = createRequire(web).resolve('@strudel/webaudio')
const superRoot = path
  .dirname(path.dirname(createRequire(webaudio).resolve('superdough')))
  .replaceAll('\\', '/')
const worklet = sameOriginSuperdoughWorklet()
worklet.config = () => ({
  optimizeDeps: { exclude: ['superdough'] },
  resolve: { alias: { superdough: superRoot } },
})

export default defineConfig({
  root,
  resolve: { alias },
  plugins: [react(), worklet],
  server: { host: '127.0.0.1', port: 3000, strictPort: true },
  preview: { host: '127.0.0.1', port: 3000, strictPort: true },
  build: { outDir: 'dist-local', emptyOutDir: true },
})
