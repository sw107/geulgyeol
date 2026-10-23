import { mergeConfig } from 'vite';
import { resolve } from 'node:path';
import { realpathSync } from 'node:fs';
import betaConfig from '../vite.geulgyeol-beta.config.mjs';

// Reuse the shipped aliases and feature flags. Keep dev caches in this checkout
// even when the existing dependencies and SDK are linked for a small QA run.
export default mergeConfig(betaConfig, {
  base: '/',
  cacheDir: resolve(import.meta.dirname, '../../.geulgyeol-local/e2e/vite-cache'),
  server: { fs: { allow: [
    resolve(import.meta.dirname, '../..'),
    realpathSync(process.env.GEULGYEOL_DEV_ENGINE_DIR || resolve(import.meta.dirname, '../../pkg')),
  ] } },
});
