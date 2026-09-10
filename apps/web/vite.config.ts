import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, root, 'NVR_');
  const port = process.env.NVR_PORT ?? env.NVR_PORT ?? '3000';
  const target = `http://127.0.0.1:${port}`;
  return {
    envDir: root,
    plugins: [react(), tailwindcss()],
    server: {
      host: '127.0.0.1', port: 5173, strictPort: true,
      proxy: { '/api': { target }, '/health': { target }, '/ws': { target, ws: true } },
    },
  };
});
