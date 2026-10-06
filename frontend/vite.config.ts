import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // Convenience: hitting /api from the browser proxies to the FastAPI backend
    // so there's no CORS setup needed during dev even if VITE_API_URL is unset.
    proxy: {
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      },
    },
  },
})
