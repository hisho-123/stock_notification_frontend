import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import basicSsl from '@vitejs/plugin-basic-ssl';
import istanbul from 'vite-plugin-istanbul';

export default defineConfig(({ mode }) => {
  const coverage = mode === 'coverage';
  const sourceMaps: Record<string, object> = {};
  const baseline: Record<string, object> = {};
  const env = loadEnv(mode, process.cwd(), 'API_');
  const proxy = {
    '/api': {
      target: env.API_PROXY_TARGET || 'http://127.0.0.1:8080',
      changeOrigin: false,
      timeout: 120_000,
      proxyTimeout: 120_000,
    },
  };
  return {
    plugins: [
      react(),
      basicSsl(),
      ...(coverage
        ? [
            {
              name: 'coverage-source-maps',
              enforce: 'post' as const,
              transform(_code: string, id: string) {
                if (/\/src\/.*\.(ts|tsx)$/.test(id)) sourceMaps[id] = this.getCombinedSourcemap();
              },
            } satisfies Plugin,
            istanbul({
              include: ['src/**/*.{ts,tsx}'],
              exclude: ['**/*.test.{ts,tsx}', '**/*.d.ts'],
              forceBuildInstrument: true,
              // プラグインの内部用identity mapではなく、元のTSへの対応表を保存する。
              onCover: (file, data) => {
                baseline[file] = { ...data, inputSourceMap: sourceMaps[file] };
              },
            }),
            {
              name: 'coverage-baseline',
              generateBundle() {
                this.emitFile({
                  type: 'asset',
                  fileName: 'coverage-baseline.json',
                  source: JSON.stringify(baseline),
                });
              },
            } satisfies Plugin,
          ]
        : []),
    ],
    build: coverage ? { outDir: '.coverage-dist', sourcemap: true, minify: false } : {},
    server: {
      host: 'localhost',
      port: 5173,
      strictPort: true,
      proxy,
      headers: { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' },
    },
    preview: {
      headers: { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' },
      host: 'localhost',
      port: Number(process.env.E2E_PORT || 5173),
      strictPort: true,
      proxy,
    },
  };
});
