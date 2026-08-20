import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

// Served from a sub-path on GitHub Pages (/billing_project/), from the root
// everywhere else. Vite needs both a leading and a trailing slash; the Pages
// action supplies the path without the trailing one.
const base = normalizeBase(process.env.VITE_BASE)

function normalizeBase(value: string | undefined): string {
  if (!value || value === '/') return '/'
  const withLeading = value.startsWith('/') ? value : `/${value}`
  return withLeading.endsWith('/') ? withLeading : `${withLeading}/`
}

export default defineConfig({
  base,
  plugins: [
    react(),
    tailwindcss(),
    // GitHub Pages has no server-side rewrite, so a deep link like
    // /customers/123 would 404. Serving the same document as 404.html lets the
    // SPA boot and route it correctly, with the URL preserved.
    {
      name: 'spa-404-fallback',
      closeBundle() {
        const dist = fileURLToPath(new URL('./dist', import.meta.url))
        const index = path.join(dist, 'index.html')
        if (fs.existsSync(index)) {
          fs.copyFileSync(index, path.join(dist, '404.html'))
        }
      },
    },
    VitePWA({
      // autoUpdate, not 'prompt': 'prompt' requires the app to render an
      // "update available" dialog, and without one an installed phone would
      // keep running the version it was installed with, forever. Shop staff
      // should never have to think about app versions.
      registerType: 'autoUpdate',
      includeAssets: ['perfect-vision-billing-logo.png', 'app-icon-512.png'],
      manifest: {
        name: 'Perfect Vision Billing Software',
        short_name: 'Perfect Vision',
        description: 'Smart billing, clear vision. Optical retail billing, customers and prescriptions.',
        theme_color: '#3B2418',
        background_color: '#F7F1E8',
        display: 'standalone',
        orientation: 'portrait',
        // Relative so "Add to Home screen" works from a sub-path too.
        start_url: base,
        scope: base,
        // A single SVG rather than PNGs that would have to be checked in as
        // binaries: it stays sharp at every size and both Android Chrome and
        // iOS Safari accept it for "Add to Home screen".
        icons: [
          // Home-screen icons must be square. The full lock-up is 2080x1880, so a
          // square crop of the emblem is used here — the size/resolution
          // exception, not a different logo.
          { src: 'app-icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'app-icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,woff2}'],
        // Deep links inside the installed app resolve to the shell, so
        // /customers/123 opens correctly instead of failing.
        navigateFallback: `${base}index.html`,
        // Never cache API responses: financial and clinical data must always be
        // read live. Only the application shell is cached for offline start-up.
        navigateFallbackDenylist: [/^\/api/, /supabase/],
        runtimeCaching: [],
        cleanupOutdatedCaches: true,
      },
    }),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  build: {
    sourcemap: true,
    rollupOptions: {
      output: {
        manualChunks: {
          react: ['react', 'react-dom', 'react-router-dom'],
          supabase: ['@supabase/supabase-js'],
          query: ['@tanstack/react-query'],
        },
      },
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    css: false,
    exclude: ['**/node_modules/**', '**/dist/**', '**/tests/e2e/**'],
  },
})
