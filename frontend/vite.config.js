import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

// Permite apontar para um backend em outra porta (dev): API_PORT=3101 npx vite
const apiTarget = `http://localhost:${process.env.API_PORT || 3001}`;

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: parseInt(process.env.VITE_PORT, 10) || 5173,
    host: '0.0.0.0',
    proxy: {
      '/api': {
        target: apiTarget,
        changeOrigin: true,
      },
      '/uploads': {
        target: apiTarget,
        changeOrigin: true,
      },
    },
  },
});
