import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1500,
  },
  server: {
    // `npm run dev:worker` を別ターミナルで動かすと、API もローカルで試せます
    proxy: { '/api': 'http://localhost:8787' },
  },
});
