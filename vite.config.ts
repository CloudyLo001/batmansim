import { defineConfig } from 'vite';

/**
 * GitHub Pages serves this as a project site under /<repo>/, so the built
 * bundle has to know that prefix or every asset URL misses the subdirectory.
 *
 * Applied to the build and to `vite preview`, so previewing mirrors what Pages
 * actually serves. The dev server stays at the root because
 * .claude/launch.json and the scripts/qa-*.mjs harnesses all request
 * http://127.0.0.1:5188/ directly.
 *
 * `command` is 'serve' for preview as well as dev, hence the isPreview check —
 * without it preview hosts the bundle at / while its index.html asks for
 * /batmansim/, and every asset 404s.
 */
const GITHUB_PAGES_BASE = '/batmansim/';

export default defineConfig(({ command, isPreview }) => ({
  base: command === 'build' || isPreview ? GITHUB_PAGES_BASE : '/',
  server: {
    host: '127.0.0.1',
    port: Number(process.env.PORT) || 5188,
    strictPort: true,
  },
  preview: {
    host: '127.0.0.1',
    port: 4188,
    strictPort: true,
  },
  build: {
    sourcemap: true,
    chunkSizeWarningLimit: 900,
  },
}));
