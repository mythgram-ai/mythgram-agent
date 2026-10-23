import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

const backendPort = Number(process.env.BACKEND_PORT ?? 7878)

// The UI is served on port 4000 and reaches the Python backend through the
// /api proxy below. Everything else (audio blobs, event streams) also flows
// through this origin, so the browser only ever needs this one address.
export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 4000,
    strictPort: true,
    proxy: {
      '/api': {
        target: `http://localhost:${backendPort}`,
        changeOrigin: true,
      },
    },
  },
})
