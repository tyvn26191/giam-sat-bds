import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5180,
    strictPort: true,
    // The worker serves /api locally; in production Firebase Hosting rewrites /api/** to Cloud Run.
    proxy: { '/api': 'http://127.0.0.1:8787' },
  },
  preview: { port: 5180, proxy: { '/api': 'http://127.0.0.1:8787' } },
  build: {
    outDir: 'dist',
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      output: {
        manualChunks: {
          firebase: ['firebase/app', 'firebase/auth', 'firebase/firestore'],
          react: ['react', 'react-dom', 'react-router-dom'],
        },
      },
    },
  },
});
