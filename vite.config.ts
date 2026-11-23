import { defineConfig, loadEnv, type Connect } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';
import { browserConfig } from './src/lib/public-config';
import hosting from './vercel.json';

const appRoute = new RegExp('^' + hosting.rewrites[0].source + '$');
const routeToIndex: Connect.NextHandleFunction = (request, _response, next) => {
  const path = request.url?.split('?')[0] ?? '';
  if ((request.method === 'GET' || request.method === 'HEAD') && request.headers.accept?.includes('text/html') && appRoute.test(path)) {
    request.url = '/index.html';
  }
  next();
};

export default defineConfig(({ mode, command }) => {
  const config = browserConfig(loadEnv(mode, process.cwd(), 'VITE_'), command === 'serve');
  return {
    appType: 'mpa',
    envPrefix: [],
    define: {
      'import.meta.env.VITE_SUPABASE_URL': JSON.stringify(config.url),
      'import.meta.env.VITE_SUPABASE_ANON_KEY': JSON.stringify(config.key),
    },
    plugins: [
      {
        name: 'finance-spa-fallback',
        configureServer: (server) => { server.middlewares.use(routeToIndex); },
        configurePreviewServer: (server) => { server.middlewares.use(routeToIndex); },
      },
      {
        name: 'finance-production-connect-policy',
        apply: 'build',
        transformIndexHtml: () => [
          { tag: 'meta', attrs: { 'http-equiv': 'Content-Security-Policy', content: config.connectPolicy }, injectTo: 'head-prepend' },
        ],
      },
      react(),
    ],
    resolve: {
      alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
    },
    optimizeDeps: { exclude: ['lucide-react'] },
  };
});
