import { defineConfig } from 'vitest/config';
import path from 'path';

/**
 * Added during hardening sprint 1.
 *
 * Existing tests use relative imports because there was no config to resolve
 * the `@/` alias, which meant anything importing app code (routes, libs that
 * touch prisma) simply could not be tested. That is why the RevenueCat webhook
 * — an endpoint that grants paid access — had no coverage at all.
 *
 * The alias is additive: relative imports keep working exactly as before.
 */
export default defineConfig({
  // Match Next's automatic JSX runtime so tests can import .tsx components
  // (added for the /gift/20 server-render guard test). No effect on .ts files.
  esbuild: { jsx: 'automatic' },
  resolve: {
    alias: { '@': path.resolve(__dirname, '.') },
  },
  test: {
    environment: 'node',
    include: ['__tests__/**/*.test.ts'],
  },
});
