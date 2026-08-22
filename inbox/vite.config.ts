import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import path from 'node:path'

export default defineConfig({
  // Rutas relativas: hace falta para que funcione dentro de Capacitor,
  // donde la app se sirve desde file:// o capacitor://, no desde /.
  base: './',

  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'icono-192.png', 'icono-512.png'],
      manifest: {
        name: 'LumaBot Inbox',
        short_name: 'Inbox',
        description: 'Bandeja de entrada de Lado Luminoso',
        theme_color: '#0b141a',
        background_color: '#0b141a',
        display: 'standalone',
        orientation: 'portrait',
        start_url: './',
        scope: './',
        icons: [
          { src: 'icono-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icono-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icono-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // Offline básico: el armazón de la app. Los datos NO se cachean,
        // que enseñar mensajes viejos como si fueran nuevos es peor que no enseñar nada.
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        navigateFallback: 'index.html',
        runtimeCaching: [
          {
            // Solo las imágenes ya vistas, para que el hilo no parpadee.
            urlPattern: /\/storage\/v1\/object\/public\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'media-lumabot',
              expiration: { maxEntries: 200, maxAgeSeconds: 60 * 60 * 24 * 7 },
            },
          },
        ],
      },
    }),
  ],

  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },

  build: {
    target: 'es2020',
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks: {
          proveedor: ['react', 'react-dom', 'react-router-dom'],
          datos: ['@supabase/supabase-js', '@tanstack/react-query'],
          audio: ['wavesurfer.js'],
        },
      },
    },
  },
})
