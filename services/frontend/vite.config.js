import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode, command, isPreview }) => {
  const env = { ...loadEnv(mode, process.cwd(), ''), ...process.env };
  const portValue = isPreview ? env.FRONTEND_PREVIEW_PORT : env.FRONTEND_PORT;
  if (command === 'serve' && (!portValue || !/^\d+$/.test(portValue) || +portValue < 1 || +portValue > 65535)) {
    throw new Error('Set FRONTEND_PORT (or FRONTEND_PREVIEW_PORT for preview) to a valid port.');
  }
  const proxy = {};
  for (const [prefix, target] of [['/order-api', env.ORDER_API_UPSTREAM], ['/controller-api', env.CONTROLLER_API_UPSTREAM]]) {
    if (target) proxy[prefix] = { target, changeOrigin: true, rewrite: path => path.slice(prefix.length) };
  }
  return {
    plugins: [react()],
    server: { host: env.FRONTEND_HOST, port: portValue ? Number(portValue) : undefined, strictPort: true, proxy },
    preview: { host: env.FRONTEND_HOST, port: portValue ? Number(portValue) : undefined, strictPort: true, proxy },
  };
});
