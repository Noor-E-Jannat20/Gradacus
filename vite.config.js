import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

// index.html loads classic <script src="app.js"> tags. Vite can't bundle those (it only warns), so by default the
// files would NOT end up in dist/ and a deployed site would be broken. This plugin adds every local classic
// script referenced by index.html to the build output, so the site works and the PWA precaches them.
function copyClassicScripts() {
  return {
    name: 'copy-classic-scripts',
    generateBundle() {
      const html = readFileSync(resolve('index.html'), 'utf8');
      const re = /<script\b[^>]*?\ssrc=["']([^"']+?)["']/gi;
      let m;
      while ((m = re.exec(html))) {
        const url = m[1].split('?')[0].replace(/^\/+/, '');
        if (/^([a-z]+:)?\/\//i.test(m[1]) || m[1].startsWith('data:')) continue;   // CDN scripts stay as they are
        const file = resolve(url);
        if (!existsSync(file)) { this.warn(`classic script not found: ${url}`); continue; }
        this.emitFile({ type: 'asset', fileName: url, source: readFileSync(file) });
      }
    }
  };
}

export default defineConfig({
  plugins: [
    copyClassicScripts(),
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
        globPatterns: ['**/*.{js,css,html,svg,json,woff2}'],
        navigateFallback: '/index.html',
        // index.html requests app.js?v=<hash>; let those hit the precached app.js
        ignoreURLParametersMatching: [/^v$/, /^utm_/, /^fbclid$/]
      }
    })
  ],
  test: {
    environment: 'node'
  }
});
