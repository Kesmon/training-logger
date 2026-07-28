import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// Declared locally rather than pulling @types/node into a browser project.
declare const process: { env: Record<string, string | undefined> }

// The GitHub Pages project subpath. Overridable so the same source can be
// deployed to a root domain (BASE_PATH=/) without editing this file.
const base = process.env.BASE_PATH ?? '/training-logger/'

export default defineConfig({
  base,
  plugins: [
    react(),
    VitePWA({
      // 'prompt', not 'autoUpdate': an automatic reload mid-session could
      // interrupt logging. UpdateToast surfaces the waiting worker instead.
      registerType: 'prompt',
      includeAssets: ['icons/apple-touch-icon-180.png', 'icons/favicon.svg'],
      manifest: {
        name: 'Training Logger',
        short_name: 'Training',
        description: 'Offline strength training log — sets, weights, effort, PRs.',
        theme_color: '#0b0d10',
        background_color: '#0b0d10',
        display: 'standalone',
        orientation: 'portrait',
        start_url: base,
        scope: base,
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          {
            src: 'icons/icon-maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        navigateFallback: `${base}index.html`,
        cleanupOutdatedCaches: true,
      },
    }),
  ],
})
