// Web Worker dos codecs: MozJPEG, WebP, AVIF (Emscripten), OxiPNG (wasm-bindgen) e PNG com paleta (UPNG).
// Os módulos wasm chegam já compilados da página principal.
import mozjpeg from './vendor/mozjpeg_enc.js';
import webpEnc from './vendor/webp_enc.js';
import avifEnc from './vendor/avif_enc.js';
import initOxi, { optimise } from './vendor/squoosh_oxipng.js';
import UPNG from 'upng-js';
import { defaultOptions as jpegDefaults } from '@jsquash/jpeg/meta.js';
import { defaultOptions as webpDefaults } from '@jsquash/webp/meta.js';
import { defaultOptions as avifDefaults } from '@jsquash/avif/meta.js';

const factories: Record<string, any> = { jpeg: mozjpeg, webp: webpEnc, avif: avifEnc };
const modules: Record<string, WebAssembly.Module> = {};
const ready: Record<string, Promise<any>> = {};

function emscripten(name: string) {
  return (ready[name] ??= factories[name]({
    noInitialRun: true,
    instantiateWasm(imports: any, receive: (inst: WebAssembly.Instance, mod?: WebAssembly.Module) => void) {
      WebAssembly.instantiate(modules[name], imports).then(inst => receive(inst, modules[name]));
      return {};
    },
  }));
}
const oxipng = () => (ready.oxipng ??= initOxi(modules.oxipng));

async function handle(m: any): Promise<ArrayBuffer | null> {
  switch (m.op) {
    case 'ping': return null;
    case 'init': modules[m.codec] = m.module; return null;
    case 'jpeg': case 'webp': case 'avif': {
      const mod = await emscripten(m.op);
      const defaults = m.op === 'jpeg' ? jpegDefaults : m.op === 'webp' ? webpDefaults : avifDefaults;
      const data = m.op === 'avif' ? new Uint8Array(m.data) : new Uint8ClampedArray(m.data);
      const out = mod.encode(data, m.width, m.height, { ...defaults, ...m.options });
      if (!out) throw new Error('falha ao codificar ' + m.op);
      return out.slice().buffer;
    }
    case 'oxipng': {
      await oxipng();
      return optimise(new Uint8Array(m.buf), m.level ?? 2, false, false).slice().buffer;
    }
    case 'pngq': return UPNG.encode([m.data], m.width, m.height, m.colors);
  }
  throw new Error('operação desconhecida ' + m.op);
}

self.onmessage = async (e: MessageEvent) => {
  const m = e.data;
  try {
    const buf = await handle(m);
    (self as any).postMessage({ id: m.id, ok: true, buf }, buf ? [buf] : []);
  } catch (err) {
    (self as any).postMessage({ id: m.id, ok: false, error: String(err) });
  }
};
