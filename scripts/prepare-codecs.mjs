// Copia os carregadores dos codecs (jSquash) para src/vendor e remove a busca automática do .wasm.
// O wasm é compilado pela página principal e entregue ao Web Worker já pronto, evitando duplicá-lo no build.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
const nm = new URL('../node_modules/@jsquash/', import.meta.url);
const out = new URL('../src/vendor/', import.meta.url);
mkdirSync(out, { recursive: true });
const files = {
  'mozjpeg_enc.js': 'jpeg/codec/enc/mozjpeg_enc.js',
  'webp_enc.js': 'webp/codec/enc/webp_enc.js',
  'avif_enc.js': 'avif/codec/enc/avif_enc.js',
  'squoosh_oxipng.js': 'oxipng/codec/pkg/squoosh_oxipng.js',
};
for (const [name, src] of Object.entries(files)) {
  let code = readFileSync(new URL(src, nm), 'utf8');
  const before = code.length;
  code = code.replace(/new URL\((["'])[\w.]+\.wasm\1,\s*import\.meta\.url\)/g, 'new URL("data:,")');
  if (code.length === before) throw new Error('padrão do wasm não encontrado em ' + src);
  writeFileSync(new URL(name, out), '// @ts-nocheck\n/* Copiado de @jsquash (Apache-2.0); busca automática do wasm removida. */\n' + code);
  console.log('ok', name);
}
