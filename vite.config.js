import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'icon-192.png', 'icon-512.png'],
      manifest: {
        name: 'NeuroNote Meeting OS',
        short_name: 'NeuroNote',
        version: '2.6.1',
        description: 'AI-powered meeting notes with discreet screensaver recording, background-safe recording, chunked live transcription, speaker diarization, live action items, tap-to-correct learning dictionary, persistent Google and Microsoft sign-in, and Google Calendar + Tasks or Outlook Calendar + Microsoft To Do sync',
        start_url: '/',
        display: 'standalone',
        background_color: '#f5f0e8',
        theme_color: '#dc2626',
        orientation: 'portrait-primary',
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any maskable' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' }
        ]
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}']
      }
    })
  ]
})
