import { defineConfig } from 'vitest/config'
import { resolve } from 'path'

export default defineConfig({
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src')
    }
  },
  test: {
    globals: true,
    environment: 'happy-dom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    // Avoid interference from Electron-specific modules
    deps: {
      optimizer: {
        web: {
          exclude: ['electron', 'node-pty']
        }
      }
    }
  }
})
