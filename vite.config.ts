import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'

export default defineConfig({
  // GitHub Pages project sites serve from /<repo>/, which breaks absolute asset
  // paths. Set BASE_PATH at build time for those; the default suits any host
  // that serves from the domain root (Netlify, Cloudflare Pages, a user site).
  base: process.env.BASE_PATH ?? '/',
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { '@': new URL('./src/', import.meta.url).pathname },
  },
  // libraw-wasm resolves worker.js + libraw.wasm via `new URL(..., import.meta.url)`.
  // Pre-bundling rewrites those URLs and breaks resolution in dev.
  optimizeDeps: { exclude: ['libraw-wasm'] },
  worker: { format: 'es' },
})
