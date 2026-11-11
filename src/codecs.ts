// Codificação de imagens: worker com codecs wasm quando disponível; codificadores nativos do navegador como reserva.
import CodecWorker from './codec.worker?worker&inline';
import jpegWasm from '@jsquash/jpeg/codec/enc/mozjpeg_enc.wasm?url';
import webpWasm from '@jsquash/webp/codec/enc/webp_enc.wasm?url';
import avifWasm from '@jsquash/avif/codec/enc/avif_enc.wasm?url';
import oxiWasm from '@jsquash/oxipng/codec/pkg/squoosh_oxipng_bg.wasm?url';
import { ctx2d, type Canvas } from './imageops';

export type Fmt = 'jpg' | 'png' | 'webp' | 'avif';
export const MIME: Record<Fmt, string> = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp', avif: 'image/avif' };
type Codec = 'jpeg' | 'webp' | 'avif' | 'oxipng';
const WASM: Record<Codec, string> = { jpeg: jpegWasm, webp: webpWasm, avif: avifWasm, oxipng: oxiWasm };

let worker: Worker | null = null;
let seq = 0;
const pending = new Map<number, { resolve: (v: any) => void; reject: (e: any) => void }>();
const sent = new Set<Codec>();
const compiled: Partial<Record<Codec, Promise<WebAssembly.Module>>> = {};

function call(msg: any, transfer: Transferable[] = []): Promise<ArrayBuffer | null> {
  return new Promise((resolve, reject) => {
    const id = ++seq;
    pending.set(id, { resolve, reject });
    worker!.postMessage({ ...msg, id }, transfer);
  });
}

async function bytesOf(url: string) {
  if (url.startsWith('data:')) {
    const b64 = url.slice(url.indexOf(',') + 1), bin = atob(b64), out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  return new Uint8Array(await (await fetch(url)).arrayBuffer());
}

// Inicia o worker e confere se responde e se o wasm compila aqui (regras de segurança podem bloquear)
export const codecsReady: Promise<boolean> = (async () => {
  try {
    worker = new CodecWorker();
    worker.onmessage = (e: MessageEvent) => {
      const p = pending.get(e.data.id); if (!p) return;
      pending.delete(e.data.id);
      e.data.ok ? p.resolve(e.data.buf) : p.reject(new Error(e.data.error));
    };
    await Promise.race([call({ op: 'ping' }), new Promise((_, rej) => setTimeout(() => rej(new Error('worker sem resposta')), 4000))]);
    await ensure('jpeg');
    return true;
  } catch (e) {
    console.warn('Codecs avançados indisponíveis; usando os do navegador.', e);
    try { worker?.terminate(); } catch (_) { /* ignora */ }
    worker = null;
    return false;
  }
})();

async function ensure(codec: Codec) {
  if (sent.has(codec)) return;
  const mod = await (compiled[codec] ??= bytesOf(WASM[codec]).then(b => WebAssembly.compile(b)));
  await call({ op: 'init', codec, module: mod });
  sent.add(codec);
}

const pixels = (c: Canvas) => ctx2d(c).getImageData(0, 0, c.width, c.height);
const nativeBlob = (c: Canvas, type: string, q?: number) =>
  new Promise<Blob>((res, rej) => c.toBlob(b => (b ? res(b) : rej(new Error('encode'))), type, q));

async function encodeOnce(c: Canvas, fmt: Fmt, quality: number, pngLossy: boolean): Promise<{ blob: Blob; native: boolean }> {
  const useWasm = await codecsReady;
  if (useWasm) {
    if (fmt === 'png') {
      let png: ArrayBuffer;
      if (pngLossy) {
        const img = pixels(c);
        png = (await call({ op: 'pngq', data: img.data.buffer, width: c.width, height: c.height, colors: 256 }, [img.data.buffer]))!;
      } else png = await (await nativeBlob(c, 'image/png')).arrayBuffer();
      await ensure('oxipng');
      const opt = (await call({ op: 'oxipng', buf: png, level: 2 }, [png]))!;
      return { blob: new Blob([opt], { type: 'image/png' }), native: false };
    }
    const codec: Codec = fmt === 'jpg' ? 'jpeg' : fmt;
    await ensure(codec);
    const img = pixels(c);
    const options = fmt === 'avif' ? { quality, speed: 7 } : { quality };
    const buf = (await call({ op: codec, data: img.data.buffer, width: c.width, height: c.height, options }, [img.data.buffer]))!;
    return { blob: new Blob([buf], { type: MIME[fmt] }), native: false };
  }
  if (fmt === 'avif') throw new Error('avif-unavailable');
  const blob = await nativeBlob(c, MIME[fmt], fmt === 'png' ? undefined : quality / 100);
  if (blob.type !== MIME[fmt]) throw new Error(fmt + '-unavailable');
  return { blob, native: true };
}

export type Encoded = { blob: Blob; quality: number; missedTarget: boolean; native: boolean };

// Codifica; com meta de tamanho (KB), busca a maior qualidade que cabe (só formatos com perda)
export async function encode(c: Canvas, fmt: Fmt, quality: number, opts: { pngLossy: boolean; targetKB: number }): Promise<Encoded> {
  const first = await encodeOnce(c, fmt, quality, opts.pngLossy);
  const target = opts.targetKB * 1024;
  if (!target || fmt === 'png' || first.blob.size <= target) return { ...first, quality, missedTarget: false };
  let lo = 10, hi = quality - 1, best: { blob: Blob; native: boolean; q: number } | null = null;
  for (let i = 0, max = fmt === 'avif' ? 4 : 6; i < max && lo <= hi; i++) {
    const q = (lo + hi) >> 1, r = await encodeOnce(c, fmt, q, false);
    if (r.blob.size <= target) { best = { ...r, q }; lo = q + 1; } else hi = q - 1;
  }
  if (best) return { blob: best.blob, native: best.native, quality: best.q, missedTarget: false };
  const low = await encodeOnce(c, fmt, 10, false);
  return { ...low, quality: 10, missedTarget: low.blob.size > target };
}
