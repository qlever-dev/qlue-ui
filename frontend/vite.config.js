import { execSync } from 'node:child_process';
import { relative, resolve } from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';
import checker from 'vite-plugin-checker';
import wasm from 'vite-plugin-wasm';

let gitCommitHash = process.env.VITE_GIT_COMMIT || '';
if (!gitCommitHash) {
  try {
    gitCommitHash = execSync('git rev-parse --short HEAD').toString().trim();
  } catch {
    // git not available
  }
}

/**
 * Dev-only: full-page reload when the backend restarts.
 *
 * uvicorn --reload already restarts the API when backend/*.py or *.yaml change,
 * but the browser keeps its stale state. This watches the same files and pushes
 * a reload once the API answers again, so we never refresh into a dead backend.
 */
function reloadOnApiRestart({ watch, health, timeoutMs = 15000 }) {
  return {
    name: 'reload-on-api-restart',
    apply: 'serve',
    configureServer(server) {
      const roots = watch.map((p) => resolve(import.meta.dirname, p));
      server.watcher.add(roots);

      let pending;
      const trigger = (file) => {
        if (!roots.some((r) => file === r || file.startsWith(`${r}/`))) return;
        clearTimeout(pending);
        // Debounce: a restart touches several files, and uvicorn needs a moment.
        pending = setTimeout(async () => {
          const deadline = Date.now() + timeoutMs;
          while (Date.now() < deadline) {
            try {
              if ((await fetch(health)).ok) {
                server.config.logger.info(
                  `[api-reload] ${relative(import.meta.dirname, file)} -> reloading page`
                );
                server.hot.send({ type: 'full-reload', path: '*' });
                return;
              }
            } catch {
              // API still restarting
            }
            await new Promise((r) => setTimeout(r, 200));
          }
          server.config.logger.warn('[api-reload] API did not come back; skipping reload');
        }, 300);
      };

      for (const event of ['add', 'change', 'unlink']) server.watcher.on(event, trigger);
    },
  };
}

export default defineConfig({
  // Relative asset URLs so the build resolves against the runtime <base href>,
  // allowing the same image to be served from any sub-path.
  base: './',
  define: {
    __GIT_COMMIT__: JSON.stringify(gitCommitHash),
  },
  build: {
    assetsInlineLimit: 0,
  },
  server: {
    allowedHosts: true,
    fs: {
      strict: false,
    },
    proxy: {
      '/ui-api': {
        // Overridable so the e2e suite can proxy to its own fixture backend
        // rather than whatever happens to be on the default dev port.
        target: process.env.UI_API_TARGET || 'http://localhost:8000',
        changeOrigin: true,
      },
    },
  },
  plugins: [
    reloadOnApiRestart({
      watch: ['../backend/src', '../backend/config.yaml'],
      health: `${process.env.UI_API_TARGET || 'http://localhost:8000'}/ui-api/health`,
    }),
    tailwindcss(),
    checker({
      typescript: {
        tsconfigPath: './tsconfig.json',
      },
    }),
  ],
  assetsInclude: ['**/*yaml'],
  worker: {
    format: 'es',
    plugins: () => [wasm()],
  },
});
