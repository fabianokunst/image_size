// Operações de imagem em Canvas 2D: redimensionar, recortar, máscaras de fundo, ajustes e composição.

export type Canvas = HTMLCanvasElement;

export function canvas(w: number, h: number): Canvas {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w)); c.height = Math.max(1, Math.round(h));
  return c;
}
export const ctx2d = (c: Canvas) => c.getContext('2d', { willReadFrequently: true })!;

function drawTo(src: CanvasImageSource & { width: number; height: number }, w: number, h: number) {
  const c = canvas(w, h), x = ctx2d(c);
  x.imageSmoothingEnabled = true; x.imageSmoothingQuality = 'high';
  x.drawImage(src, 0, 0, c.width, c.height);
  return c;
}

// Reduz em etapas de metade (mais nítido que reduzir de uma vez); amplia direto com suavização alta
export function resizeHQ(src: Canvas, w: number, h: number): Canvas {
  w = Math.max(1, Math.round(w)); h = Math.max(1, Math.round(h));
  let cur = src, cw = src.width, ch = src.height;
  while (cw / 2 >= w && ch / 2 >= h) {
    const nw = Math.max(w, Math.round(cw / 2)), nh = Math.max(h, Math.round(ch / 2));
    cur = drawTo(cur, nw, nh); cw = nw; ch = nh;
  }
  return cw === w && ch === h && cur !== src ? cur : drawTo(cur, w, h);
}

export function crop(src: Canvas, r: Rect): Canvas {
  if (r.x === 0 && r.y === 0 && r.w === src.width && r.h === src.height) return src;
  const c = canvas(r.w, r.h);
  ctx2d(c).drawImage(src, r.x, r.y, r.w, r.h, 0, 0, r.w, r.h);
  return c;
}

export type Rect = { x: number; y: number; w: number; h: number };

export function hasAlphaPixels(c: Canvas) {
  const d = ctx2d(c).getImageData(0, 0, c.width, c.height).data;
  for (let i = 3; i < d.length; i += 4) if (d[i] < 255) return true;
  return false;
}

// Preenche áreas transparentes com as cores vizinhas, para a IA não criar bordas escuras
export function bleed(src: Canvas): Canvas {
  const c = canvas(src.width, src.height), x = ctx2d(c);
  x.drawImage(src, 0, 0);
  x.globalCompositeOperation = 'destination-over';
  for (const r of [1, 2, 4, 8, 16, 32, 64]) { x.filter = `blur(${r}px)`; x.drawImage(src, 0, 0); }
  x.filter = 'none'; x.fillStyle = '#808080'; x.fillRect(0, 0, c.width, c.height);
  return c;
}

export function applyAlpha(rgb: Canvas, withAlpha: Canvas) {
  const w = rgb.width, h = rgb.height;
  const a = ctx2d(resizeHQ(withAlpha, w, h)).getImageData(0, 0, w, h).data;
  const x = ctx2d(rgb), img = x.getImageData(0, 0, w, h), p = img.data;
  for (let i = 3; i < p.length; i += 4) p[i] = a[i];
  x.putImageData(img, 0, 0);
}

/* ---------- Desfoque gaussiano rápido (3 caixas) ---------- */
function boxesForGauss(sigma: number) {
  const n = 3, wIdeal = Math.sqrt((12 * sigma * sigma) / n + 1);
  let wl = Math.floor(wIdeal); if (wl % 2 === 0) wl--;
  const m = Math.round((12 * sigma * sigma - n * wl * wl - 4 * n * wl - 3 * n) / (-4 * wl - 4));
  return [0, 1, 2].map(i => (i < m ? wl : wl + 2));
}
function boxBlur(src: Float32Array, dst: Float32Array, w: number, h: number, r: number, horizontal: boolean) {
  const inv = 1 / (2 * r + 1), len = horizontal ? w : h, lines = horizontal ? h : w;
  const stride = horizontal ? 1 : w, lineStep = horizontal ? w : 1;
  for (let l = 0; l < lines; l++) {
    const base = l * lineStep;
    const at = (k: number) => src[base + Math.min(len - 1, Math.max(0, k)) * stride];
    let acc = 0;
    for (let k = -r; k <= r; k++) acc += at(k);
    for (let i = 0; i < len; i++) { dst[base + i * stride] = acc * inv; acc += at(i + r + 1) - at(i - r); }
  }
}
export function gaussBlur(ch: Float32Array, w: number, h: number, sigma: number) {
  if (sigma <= 0.3) return;
  const tmp = new Float32Array(ch.length);
  for (const b of boxesForGauss(sigma)) { const r = (b - 1) / 2; boxBlur(ch, tmp, w, h, r, true); boxBlur(tmp, ch, w, h, r, false); }
}

// "Manter tons originais": soma a diferença suavizada (referência − resultado); só a cor de cada região volta
export function keepTones(rgb: Canvas, ref: Canvas, sigma: number) {
  const w = rgb.width, h = rgb.height, x = ctx2d(rgb);
  const img = x.getImageData(0, 0, w, h), o = img.data;
  const r = ctx2d(ref).getImageData(0, 0, w, h).data;
  const D = new Float32Array(w * h);
  for (let c = 0; c < 3; c++) {
    for (let i = 0, j = c; i < D.length; i++, j += 4) D[i] = r[j] - o[j];
    gaussBlur(D, w, h, sigma);
    for (let i = 0, j = c; i < D.length; i++, j += 4) o[j] = o[j] + D[i];
  }
  x.putImageData(img, 0, 0);
}

/* ---------- Máscara de fundo (preenchimento a partir das bordas) ---------- */
// 1 = fundo. Cresce a partir das bordas enquanto a cor estiver perto da cor dominante da borda.
export function backgroundMask(src: Canvas, opts: { requireLight: boolean }): Uint8Array {
  const w = src.width, h = src.height, d = ctx2d(src).getImageData(0, 0, w, h).data;
  const mask = new Uint8Array(w * h);
  const transparent = (() => { for (let i = 3; i < d.length; i += 4 * 7) if (d[i] < 250) return true; return false; })();
  if (transparent) {
    for (let i = 0; i < w * h; i++) mask[i] = d[i * 4 + 3] < 16 ? 1 : 0;
    return mask;
  }
  // cor dominante da borda: mediana por canal
  const border: number[][] = [[], [], []];
  const pushPx = (x: number, y: number) => { const i = (y * w + x) * 4; border[0].push(d[i]); border[1].push(d[i + 1]); border[2].push(d[i + 2]); };
  for (let x = 0; x < w; x++) { pushPx(x, 0); pushPx(x, h - 1); }
  for (let y = 0; y < h; y++) { pushPx(0, y); pushPx(w - 1, y); }
  const med = border.map(a => a.sort((p, q) => p - q)[a.length >> 1]);
  if (opts.requireLight && Math.min(...med) < 170) return mask;
  const GLOBAL = 30, LOCAL = 12;
  const close = (i: number, j: number) => {
    const a = i * 4, b = j * 4;
    if (opts.requireLight && Math.min(d[a], d[a + 1], d[a + 2]) < 170) return false;
    return Math.max(Math.abs(d[a] - med[0]), Math.abs(d[a + 1] - med[1]), Math.abs(d[a + 2] - med[2])) <= GLOBAL &&
      Math.max(Math.abs(d[a] - d[b]), Math.abs(d[a + 1] - d[b + 1]), Math.abs(d[a + 2] - d[b + 2])) <= LOCAL;
  };
  const queue = new Int32Array(w * h); let qh = 0, qt = 0;
  const seed = (i: number) => {
    if (mask[i]) return;
    const a = i * 4;
    if (Math.max(Math.abs(d[a] - med[0]), Math.abs(d[a + 1] - med[1]), Math.abs(d[a + 2] - med[2])) <= GLOBAL &&
      (!opts.requireLight || Math.min(d[a], d[a + 1], d[a + 2]) >= 170)) { mask[i] = 1; queue[qt++] = i; }
  };
  for (let x = 0; x < w; x++) { seed(x); seed((h - 1) * w + x); }
  for (let y = 0; y < h; y++) { seed(y * w); seed(y * w + w - 1); }
  while (qh < qt) {
    const i = queue[qh++], x = i % w, y = (i / w) | 0;
    if (x > 0 && !mask[i - 1] && close(i - 1, i)) { mask[i - 1] = 1; queue[qt++] = i - 1; }
    if (x < w - 1 && !mask[i + 1] && close(i + 1, i)) { mask[i + 1] = 1; queue[qt++] = i + 1; }
    if (y > 0 && !mask[i - w] && close(i - w, i)) { mask[i - w] = 1; queue[qt++] = i - w; }
    if (y < h - 1 && !mask[i + w] && close(i + w, i)) { mask[i + w] = 1; queue[qt++] = i + w; }
  }
  return mask;
}

// Caixa do produto = tudo que não é fundo (ignora ruído isolado)
export function productBox(mask: Uint8Array, w: number, h: number): Rect | null {
  const rows = new Int32Array(h), cols = new Int32Array(w);
  let fg = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (!mask[y * w + x]) { rows[y]++; cols[x]++; fg++; }
  if (fg < w * h * 0.005) return null;
  const minR = Math.max(2, Math.round(w * 0.002)), minC = Math.max(2, Math.round(h * 0.002));
  let y0 = 0, y1 = h - 1, x0 = 0, x1 = w - 1;
  while (y0 < h && rows[y0] < minR) y0++;
  while (y1 > y0 && rows[y1] < minR) y1--;
  while (x0 < w && cols[x0] < minC) x0++;
  while (x1 > x0 && cols[x1] < minC) x1--;
  if (y0 >= y1 || x0 >= x1) return null;
  x0 = Math.max(0, x0 - 1); y0 = Math.max(0, y0 - 1); x1 = Math.min(w - 1, x1 + 1); y1 = Math.min(h - 1, y1 + 1);
  const r = { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
  return r.w >= w * 0.98 && r.h >= h * 0.98 ? null : r;
}

// Clareia o fundo até branco puro, com transição suave na borda do produto
export function whitenBackground(rgb: Canvas, mask: Uint8Array, mw: number, mh: number, r: Rect) {
  const m = new Float32Array(r.w * r.h);
  for (let y = 0; y < r.h; y++) for (let x = 0; x < r.w; x++) m[y * r.w + x] = mask[(r.y + y) * mw + r.x + x];
  gaussBlur(m, r.w, r.h, 1);
  const small = canvas(r.w, r.h), sx = ctx2d(small), si = sx.createImageData(r.w, r.h);
  for (let i = 0; i < m.length; i++) { const v = Math.round(m[i] * 255); si.data[i * 4] = si.data[i * 4 + 1] = si.data[i * 4 + 2] = v; si.data[i * 4 + 3] = 255; }
  sx.putImageData(si, 0, 0);
  const W = rgb.width, H = rgb.height, big = ctx2d(resizeHQ(small, W, H)).getImageData(0, 0, W, H).data;
  const x = ctx2d(rgb), img = x.getImageData(0, 0, W, H), p = img.data;
  for (let i = 0; i < p.length; i += 4) {
    const t = big[i] / 255;
    if (t > 0) { p[i] += (255 - p[i]) * t; p[i + 1] += (255 - p[i + 1]) * t; p[i + 2] += (255 - p[i + 2]) * t; }
  }
  x.putImageData(img, 0, 0);
}

// Brilho, contraste e saturação (−100 a 100)
export function adjust(c: Canvas, brightness: number, contrast: number, saturation: number) {
  if (!brightness && !contrast && !saturation) return;
  const x = ctx2d(c), img = x.getImageData(0, 0, c.width, c.height), p = img.data;
  const cv = contrast * 1.275, f = (259 * (cv + 255)) / (255 * (259 - cv)), b = brightness * 0.8;
  const lut = new Float32Array(256);
  for (let i = 0; i < 256; i++) lut[i] = f * (i + b - 128) + 128;
  const s = 1 + saturation / 100;
  for (let i = 0; i < p.length; i += 4) {
    let r = lut[p[i]], g = lut[p[i + 1]], bl = lut[p[i + 2]];
    if (saturation) { const l = 0.2126 * r + 0.7152 * g + 0.0722 * bl; r = l + (r - l) * s; g = l + (g - l) * s; bl = l + (bl - l) * s; }
    p[i] = r; p[i + 1] = g; p[i + 2] = bl;
  }
  x.putImageData(img, 0, 0);
}

// Nitidez por máscara de desfoque (0 a 100)
export function sharpen(c: Canvas, amount: number) {
  if (!amount) return;
  const w = c.width, h = c.height, x = ctx2d(c), img = x.getImageData(0, 0, w, h), p = img.data;
  const k = (amount / 100) * 1.2, ch = new Float32Array(w * h), orig = new Float32Array(w * h);
  for (let c3 = 0; c3 < 3; c3++) {
    for (let i = 0, j = c3; i < ch.length; i++, j += 4) { ch[i] = p[j]; orig[i] = p[j]; }
    gaussBlur(ch, w, h, 1);
    for (let i = 0, j = c3; i < ch.length; i++, j += 4) p[j] = orig[i] + (orig[i] - ch[i]) * k;
  }
  x.putImageData(img, 0, 0);
}

export type WatermarkPos = 'tl' | 'tc' | 'tr' | 'ml' | 'mc' | 'mr' | 'bl' | 'bc' | 'br';
export function watermark(c: Canvas, logo: ImageBitmap | HTMLCanvasElement, pos: WatermarkPos, opacity: number, scale: number) {
  const W = c.width, H = c.height, lw = Math.max(1, Math.round((W * scale) / 100)), lh = Math.max(1, Math.round((lw * logo.height) / logo.width));
  const m = Math.round(Math.min(W, H) * 0.03);
  const col = pos[1], row = pos[0];
  const x = col === 'l' ? m : col === 'c' ? (W - lw) / 2 : W - lw - m;
  const y = row === 't' ? m : row === 'm' ? (H - lh) / 2 : H - lh - m;
  const g = ctx2d(c);
  g.save(); g.globalAlpha = opacity / 100; g.imageSmoothingQuality = 'high';
  g.drawImage(logo, Math.round(x), Math.round(y), lw, lh);
  g.restore();
}
