import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

// サーバーなしで動く1ファイル版（プレビュー・配布用）。API は使わずゲストモードで動きます。
export default defineConfig({
  plugins: [viteSingleFile()],
  define: { 'import.meta.env.VITE_STANDALONE': '"1"' },
  build: { target: 'es2022', outDir: 'dist-single', chunkSizeWarningLimit: 4000 },
});
