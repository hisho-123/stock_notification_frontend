import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./tests/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    clearMocks: true,
    restoreMocks: true,
    coverage: {
      provider: 'istanbul',
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/**/*.test.{ts,tsx}', 'src/**/*.d.ts'],
      reportsDirectory: 'coverage/vitest',
      reporter: ['text', 'html', 'json', 'json-summary', 'lcov'],
      reportOnFailure: true,
      thresholds: { statements: 100, branches: 100, perFile: true },
    },
  },
});
