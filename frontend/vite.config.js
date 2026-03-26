import { defineConfig } from 'vite';
import { execSync } from 'child_process';
import checker from 'vite-plugin-checker';
import tailwindcss from '@tailwindcss/vite';
import wasm from 'vite-plugin-wasm';

let gitCommitHash = process.env.VITE_GIT_COMMIT || '';
if (!gitCommitHash) {
  try {
    gitCommitHash = execSync('git rev-parse --short HEAD').toString().trim();
  } catch {
    // git not available
  }
}

export default defineConfig({
  define: {
    __GIT_COMMIT__: JSON.stringify(gitCommitHash),
  },
  build: {
    assetsInlineLimit: 0,
  },
  optimizeDeps: {
    include: ['vscode-textmate', 'vscode-oniguruma'],
  },
  server: {
    allowedHosts: true,
    fs: {
      strict: false,
    },
    proxy: {
      '/ui-api': {
        target: 'http://localhost:8000',
        rewrite: (path) => path.replace(/^\/ui-api/, ''),
        changeOrigin: true,
      }
    },
  },
  plugins: [
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
