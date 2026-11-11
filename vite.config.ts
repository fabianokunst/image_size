import { defineConfig, type Plugin } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';
import { readFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';

// Gera o service worker com a lista de todos os arquivos do build (funciona offline desde a 1ª visita)
function serviceWorker(): Plugin {
  return {
    name: 'ampliar-sw',
    apply: 'build',
    generateBundle(_, bundle) {
      const files = ['./', './index.html', './manifest.webmanifest', './icons/icon-192.png', './icons/icon-512.png',
        ...Object.keys(bundle).filter(f => !f.endsWith('.map') && f !== 'index.html').map(f => './' + f)];
      const src = readFileSync(new URL('./src/sw-template.js', import.meta.url), 'utf8')
        .replace('__FILES__', JSON.stringify(files)).replace('__VERSION__', String(Date.now()));
      this.emitFile({ type: 'asset', fileName: 'sw.js', source: src });
    },
  };
}

// No modo "single", salva o arquivo como toolbox-web.html (nome claro para quem abre com dois cliques)
function singleFileName(): Plugin {
  return {
    name: 'toolbox-single-name',
    apply: 'build',
    enforce: 'post',
    writeBundle(options) {
      renameSync(join(options.dir!, 'index.html'), join(options.dir!, 'toolbox-web.html'));
    },
  };
}

// "npm run build"        → dist/        site estático (PWA instalável, funciona offline)
// "npm run build:single" → dist-single/toolbox-web.html, um único arquivo com tudo embutido (abre com dois cliques)
export default defineConfig(({ mode }) => ({
  base: './',
  plugins: mode === 'single' ? [viteSingleFile({ removeViteModuleLoader: true }), singleFileName()] : [serviceWorker()],
  define: { __SINGLE__: JSON.stringify(mode === 'single') },
  assetsInclude: ['**/*.bin'],
  publicDir: mode === 'single' ? false : 'public',
  build: {
    outDir: mode === 'single' ? 'dist-single' : 'dist',
    target: 'es2020',
    chunkSizeWarningLimit: 12000,
    assetsInlineLimit: (file: string) => (file.endsWith('.bin') ? true : undefined),
  },
  worker: { format: 'iife' },
}));
