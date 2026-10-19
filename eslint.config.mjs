import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  // The Phase 0 spike scripts and the captured PayPal fixtures are kept as they were, outside the app's lint rules.
  globalIgnores([
    '.next/**',
    'out/**',
    'build/**',
    'next-env.d.ts',
    'scripts/**',
    'tests/fixtures/**',
    'playwright-report/**',
    'test-results/**',
  ]),
]);
