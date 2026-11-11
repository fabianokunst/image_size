// Processa uma imagem: recorte do produto → ampliação/restauração com IA → tons → ajustes → fundo → composição
// → marca d'água → codificação (+ tamanhos extras).
import { ASPECTS, type Settings } from './settings';
import { upscale4x } from './engine';
import { encode, type Fmt } from './codecs';
import {
  canvas, ctx2d, crop, resizeHQ, bleed, applyAlpha, keepTones, backgroundMask, productBox, whitenBackground,
  adjust, sharpen, watermark, type Canvas, type Rect,
} from './imageops';

export type Output = { name: string; blob: Blob; w: number; h: number };
export type Item = {
  id: number; file: File; name: string; stem: string; bytes: number;
  w?: number; h?: number; orig?: Canvas; hasAlpha?: boolean; thumbUrl?: string;
  bleedC?: Canvas; maskAny?: Uint8Array; maskLight?: Uint8Array; srCache?: { key: string; canvas: Canvas };
  status: 'loading' | 'ready' | 'working' | 'done' | 'error'; progress: number; t0?: number; secs?: number;
  key?: string; error?: string; notes?: string[]; outputs?: Output[]; outUrl?: string; beforeUrl?: string;
  li?: HTMLLIElement; removed?: boolean;
};

const SR_MAX_INPUT = 1500;

export function geometry(it: Item, s: Settings, r: Rect) {
  const m = s.center ? s.margin / 100 : 0;
  const L = s.mode === 'restore' ? Math.max(it.w!, it.h!) : s.size;
  const ar = ASPECTS[s.aspect] ?? r.w / r.h;
  const W = ar >= 1 ? L : Math.max(1, Math.round(L * ar)), H = ar >= 1 ? Math.max(1, Math.round(L / ar)) : L;
  const sc = Math.min((W * (1 - 2 * m)) / r.w, (H * (1 - 2 * m)) / r.h);
  return { W, H, sc, cw: Math.max(1, Math.round(r.w * sc)), ch: Math.max(1, Math.round(r.h * sc)) };
}

export function productRect(it: Item, s: Settings): Rect {
  const full = { x: 0, y: 0, w: it.w!, h: it.h! };
  if (!s.center) return full;
  it.maskAny ??= backgroundMask(it.orig!, { requireLight: false });
  return productBox(it.maskAny, it.w!, it.h!) || full;
}

function compose(content: Canvas, W: number, H: number, bg: string | null) {
  const c = canvas(W, H), x = ctx2d(c);
  if (bg) { x.fillStyle = bg; x.fillRect(0, 0, W, H); }
  x.drawImage(content, Math.round((W - content.width) / 2), Math.round((H - content.height) / 2));
  return c;
}

export function fileName(pattern: string, t: { nome: string; largura: number; altura: number; n: number; formato: Fmt }) {
  const name = (pattern || '{nome}_{largura}').replace(/\{(nome|nombre|name|largura|ancho|width|altura|alto|height|n|formato|format)\}/g, (_, k) =>
    String(({ nome: t.nome, nombre: t.nome, name: t.nome, largura: t.largura, ancho: t.largura, width: t.largura, altura: t.altura, alto: t.altura, height: t.altura, n: t.n, formato: t.formato, format: t.formato } as any)[k]));
  return (name.replace(/[\\/:*?"<>|]+/g, '-').trim() || t.nome) + '.' + t.formato;
}

export async function processItem(
  it: Item, s: Settings, n: number, logo: ImageBitmap | HTMLCanvasElement | null,
  hooks: { progress: (p: number) => void; recover: () => void; encoding: () => void },
) {
  const r = productRect(it, s);
  const { W, H, sc, cw, ch } = geometry(it, s, r);
  const srcA = crop(it.orig!, r);
  const needSR = s.mode === 'restore' || (s.mode === 'ai' && sc > 1);
  let content: Canvas;
  if (needSR) {
    const rule = s.mode === 'restore' ? Math.max(r.w, r.h) : Math.min(Math.max(r.w, r.h), Math.ceil(Math.max(cw, ch) / 2));
    const k = Math.min(rule, SR_MAX_INPUT) / Math.max(r.w, r.h);
    const inW = Math.max(1, Math.round(r.w * k)), inH = Math.max(1, Math.round(r.h * k));
    const key = [r.x, r.y, r.w, r.h, inW, inH].join(',');
    it.bleedC ??= it.hasAlpha ? bleed(it.orig!) : it.orig!;
    if (it.srCache?.key !== key) {
      const base = crop(it.bleedC, r);
      const input = inW === r.w && inH === r.h ? base : resizeHQ(base, inW, inH);
      it.srCache = { key, canvas: await upscale4x(input, hooks.progress, hooks.recover) };
    }
    content = resizeHQ(it.srCache.canvas, cw, ch);
    if (s.tones) keepTones(content, resizeHQ(crop(it.bleedC, r), cw, ch), (4 * cw) / r.w);
    if (it.hasAlpha) applyAlpha(content, srcA);
  } else content = resizeHQ(srcA, cw, ch);

  adjust(content, s.brightness, s.contrast, s.saturation);
  sharpen(content, s.sharpen);
  const keepAlpha = !!it.hasAlpha && s.fmt !== 'jpg';
  if (s.whiteBg && !keepAlpha) {
    it.maskLight ??= backgroundMask(it.orig!, { requireLight: true });
    whitenBackground(content, it.maskLight, it.w!, it.h!, r);
  }
  const bg = keepAlpha ? null : s.whiteBg ? '#ffffff' : s.bg;
  const out = compose(content, W, H, bg);
  if (logo && s.wm.on) watermark(out, logo, s.wm.pos, s.wm.opacity, s.wm.scale);
  const before = compose(resizeHQ(srcA, cw, ch), W, H, keepAlpha ? null : s.bg);

  hooks.encoding();
  const notes: string[] = [];
  const main = await encode(out, s.fmt, s.quality, { pngLossy: s.pngLossy, targetKB: s.targetKB });
  if (main.missedTarget) notes.push('noteTarget');
  if (main.native) notes.push('noteNative');
  const outputs: Output[] = [{ name: fileName(s.pattern, { nome: it.stem, largura: W, altura: H, n, formato: s.fmt }), blob: main.blob, w: W, h: H }];
  const L = Math.max(W, H);
  for (const e of [...new Set(s.extra)].sort((a, b) => b - a)) {
    if (e >= L) continue;
    const w2 = Math.max(1, Math.round((W * e) / L)), h2 = Math.max(1, Math.round((H * e) / L));
    const enc = await encode(resizeHQ(out, w2, h2), s.fmt, main.quality, { pngLossy: s.pngLossy, targetKB: 0 });
    outputs.push({ name: fileName(s.pattern, { nome: it.stem, largura: w2, altura: h2, n, formato: s.fmt }), blob: enc.blob, w: w2, h: h2 });
  }
  const beforeBlob = await new Promise<Blob>(res => before.toBlob(b => res(b!), keepAlpha ? 'image/png' : 'image/jpeg', 0.9));
  return { outputs, beforeBlob, notes, W, H, usedAI: needSR };
}
