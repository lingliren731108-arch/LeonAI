import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  // Load env file from parent directory (process.cwd() is frontend, so '../' is parent)
  const env = loadEnv(mode, '../', '')
  const backendPort = env.SERVER_PORT || '8900'
  const backendHost = env.SERVER_HOST || '127.0.0.1'
  const frontendPort = parseInt(env.FRONTEND_PORT || '5173', 10)

  return {
    plugins: [react()],
    server: {
      host: env.FRONTEND_HOST || '0.0.0.0',
      port: frontendPort,
      proxy: {
        '/api': {
          target: `http://${backendHost}:${backendPort}`,
          changeOrigin: true,
        },
        '/ws': {
          target: `ws://${backendHost}:${backendPort}`,
          ws: true,
        }
      }
    }
  }
})

