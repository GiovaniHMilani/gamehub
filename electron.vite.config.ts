import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import type { Plugin } from 'vite'

const shared = resolve(import.meta.dirname, 'src/shared')

const CSP_DIRECTIVES = [
  "default-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "object-src 'none'",
  "frame-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
]

/**
 * Injects the shell CSP. Production builds get `script-src 'self'`.
 * The local dev server additionally allows inline scripts, because React
 * Refresh injects an inline preamble. Production is never relaxed.
 */
function shellCsp(): Plugin {
  let isDevServer = false
  return {
    name: 'gamehub-shell-csp',
    configResolved(config) {
      isDevServer = config.command === 'serve'
    },
    transformIndexHtml() {
      const scriptSrc = isDevServer ? "script-src 'self' 'unsafe-inline'" : "script-src 'self'"
      const content = [...CSP_DIRECTIVES, scriptSrc].join('; ')
      return [{ tag: 'meta', attrs: { 'http-equiv': 'Content-Security-Policy', content }, injectTo: 'head-prepend' }]
    },
  }
}

export default defineConfig({
  main: {
    resolve: { alias: { '@shared': shared } },
    build: { rollupOptions: { input: { index: resolve(import.meta.dirname, 'src/main/index.ts') } } },
  },
  preload: {
    resolve: { alias: { '@shared': shared } },
    build: {
      rollupOptions: {
        input: { index: resolve(import.meta.dirname, 'src/preload/index.ts') },
        // Sandboxed preloads cannot use ESM imports; emit a single CJS file.
        output: { format: 'cjs', entryFileNames: '[name].cjs' },
      },
    },
  },
  renderer: {
    root: resolve(import.meta.dirname, 'src/renderer'),
    resolve: { alias: { '@shared': shared } },
    plugins: [shellCsp(), react()],
    build: { rollupOptions: { input: { index: resolve(import.meta.dirname, 'src/renderer/index.html') } } },
  },
})
