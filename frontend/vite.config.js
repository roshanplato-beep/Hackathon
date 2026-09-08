import { createReadStream, statSync } from 'node:fs'
import { join, normalize, extname, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { viteStaticCopy } from 'vite-plugin-static-copy'

const CESIUM_DIRS = ['Workers', 'ThirdParty', 'Assets', 'Widgets']
const CESIUM_BUILD = 'node_modules/cesium/Build/Cesium'

// Resolve against this config's own directory, not process.cwd(): starting
// Vite from anywhere but frontend/ would otherwise silently fall through to the
// SPA fallback and serve Cesium's workers as HTML.
const ROOT = dirname(fileURLToPath(import.meta.url))
const CESIUM_ABS = join(ROOT, CESIUM_BUILD)

const MIME = {
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.json': 'application/json',
  '.css': 'text/css',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.wasm': 'application/wasm',
  '.glb': 'model/gltf-binary',
  '.ktx2': 'image/ktx2',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.xml': 'text/xml',
}

/**
 * vite-plugin-static-copy only runs for the build. Without this, every dev
 * request for /cesium/** falls through to the SPA fallback and returns HTML,
 * which breaks Cesium's workers and kills the render loop.
 */
function serveCesium() {
  return {
    name: 'serve-cesium-dev',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = req.url ?? ''
        if (!url.startsWith('/cesium/')) return next()

        const rel = normalize(decodeURIComponent(url.slice('/cesium/'.length).split('?')[0]))
        if (rel.startsWith('..')) return next()
        if (!CESIUM_DIRS.some(d => rel === d || rel.startsWith(`${d}/`) || rel.startsWith(`${d}\\`)))
          return next()

        const file = join(CESIUM_ABS, rel)
        try {
          if (!statSync(file).isFile()) return next()
        } catch {
          return next()
        }

        res.setHeader('Content-Type', MIME[extname(file).toLowerCase()] ?? 'application/octet-stream')
        createReadStream(file).pipe(res)
      })
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    serveCesium(),
    viteStaticCopy({
      targets: CESIUM_DIRS.map(name => ({
        src: join(CESIUM_ABS, name, '**/*').replace(/\\/g, '/'),
        dest: `cesium/${name}`,
        rename: { stripBase: true },
      })),
    }),
  ],
  define: { CESIUM_BASE_URL: JSON.stringify('/cesium/') },
  // Optional local production-bundle check; deployed requests use Vercel routes.
  preview: {
    proxy: process.env.HEATSCAPE_PREVIEW_API ? {
      '/api': process.env.HEATSCAPE_PREVIEW_API,
      '/health': process.env.HEATSCAPE_PREVIEW_API,
    } : undefined,
  },
})
