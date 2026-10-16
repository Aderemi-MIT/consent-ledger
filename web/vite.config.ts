import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// The browser calls /api/...; the dev server forwards those calls to the
// Go REST API (chaincode/cmd/api), so the app never holds Fabric
// certificates or database credentials and no CORS setup is needed.
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:18080',
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
    },
  },
})
