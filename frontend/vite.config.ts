import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const BACKEND = 'http://localhost:3333'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/login': BACKEND,
      '/api': BACKEND,
      '/i18n': BACKEND,
      '/screenshots-img': BACKEND,
    },
  },
})
