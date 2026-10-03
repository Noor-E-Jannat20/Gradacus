import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg'],
      manifest: {
        name: 'Academic Console',
        short_name: 'Gradacus',
        description: 'CGPA planning, course mapping, and deadlines for BRACU CSE & CS.',
        theme_color: '#0b0e1c',
        background_color: '#05060d',
        display: 'standalone',
        start_url: '/',
        icons: [
          { src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' }
        ]
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,json,woff2,otf}'],
        navigateFallback: '/index.html'
      }
    })
  ],
  test: {
    environment: 'node'
  }
});
