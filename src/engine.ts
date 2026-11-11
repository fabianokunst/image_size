// Motor de super-resolução: Real-ESRGAN compacto (realesr-general-x4v3, BSD-3-Clause) em TensorFlow.js.
// Escolhe WebGPU → WebGL → processador, confere cada motor com um autoteste e cada bloco com uma checagem
// de sanidade; se a GPU travar ou devolver lixo, reinicia ou troca de motor sozinho.
import * as tf from '@tensorflow/tfjs';
import '@tensorflow/tfjs-backend-webgpu';
import weightsUrl from './model/realesr-general-x4v3.f16.bin?inline';

export type Backend = 'webgpu' | 'webgl' | 'cpu';
const ORDER: Backend[] = ['webgpu', 'webgl', 'cpu'];
const MARGIN = 24, EDGE = 10;
const MAX_TILE: Record<Backend, number> = { webgpu: 512, webgl: 256, cpu: 256 };
const TILE_TIMEOUT: Record<Backend, number> = { webgpu: 90000, webgl: 90000, cpu: 900000 };
const SELFTEST = [0.7112, 0.8275, 0.0101, 0.4942, 0.0, 0.0, 0.3188, 0.4833, 0.4872, 1.0, 0.4379, 0.8287, 0.5774, 1.0, 0.4725, 0.5516, 0.2694, 0.4851, 0.1396, 0.0985, 0.0902, 0.6097, 0.0148, 0.4758, 0.8894, 0.8439, 0.6683, 0.927, 0.8649, 0.817, 0.4285, 0.0777];
const dbg: any = (globalThis as any).__AMPLIAR_TEST || {};

type Model = { layers: { w: tf.Tensor; b: tf.Tensor; a: tf.Tensor }[]; wf: tf.Tensor; bf: tf.Tensor };
let model: Model | null = null;
let w32: Float32Array | null = null;
let backend: Backend | null = null;
let gpuLost = false;

export const currentBackend = () => backend;

function f16ToF32(u16: Uint16Array) {
  const out = new Float32Array(u16.length);
  for (let i = 0; i < u16.length; i++) {
    const h = u16[i], s = h & 0x8000, e = (h & 0x7c00) >> 10, f = h & 0x03ff;
    const v = e === 0 ? f * 5.960464477539063e-8 : e === 31 ? (f ? NaN : Infinity) : (1 + f / 1024) * Math.pow(2, e - 15);
    out[i] = s ? -v : v;
  }
  return out;
}

function buildModel(w: Float32Array): Model {
  let o = 0;
  const take = (shape: number[]) => { const n = shape.reduce((a, b) => a * b, 1); const t = tf.tensor(w.subarray(o, o + n), shape); o += n; return t; };
  const layers = []; let cin = 3;
  for (let i = 0; i < 33; i++) { layers.push({ w: take([3, 3, cin, 64]), b: take([64]), a: take([64]) }); cin = 64; }
  const wf = take([3, 3, 64, 48]), bf = take([48]);
  if (o !== w.length) throw new Error('pesos inconsistentes');
  return { layers, wf, bf };
}

function runModel(m: Model, x: tf.Tensor4D): tf.Tensor4D {
  return tf.tidy(() => {
    let y: any = x;
    for (const L of m.layers) y = tf.fused.conv2d({ x: y, filter: L.w as any, strides: 1, pad: 'same', bias: L.b, activation: 'prelu', preluActivationWeights: L.a });
    y = tf.fused.conv2d({ x: y, filter: m.wf as any, strides: 1, pad: 'same', bias: m.bf });
    y = tf.depthToSpace(y, 4, 'NHWC');
    const base = tf.image.resizeNearestNeighbor(x, [x.shape[1] * 4, x.shape[2] * 4]);
    return tf.clipByValue(tf.add(y, base), 0, 1) as tf.Tensor4D;
  });
}

// Falha se a GPU perder o contexto ou passar do tempo (conta só o tempo com a aba visível)
function watch<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    let elapsed = 0, last = Date.now();
    const timer = setInterval(() => {
      const now = Date.now();
      if (!document.hidden) elapsed += now - last;
      last = now;
      if (gpuLost) { clearInterval(timer); reject(new Error('gpu-lost')); }
      else if (elapsed > ms) { clearInterval(timer); reject(new Error('gpu-timeout')); }
    }, 500);
    promise.then(v => { clearInterval(timer); resolve(v); }, e => { clearInterval(timer); reject(e); });
  });
}

function splitAxis(L: number, maxI: number) {
  const n = Math.max(1, Math.ceil(L / maxI)), I = Math.ceil(L / n), pad = n > 1 ? MARGIN : EDGE;
  return { n, I, pad, T: I + 2 * pad, P: n * I + 2 * pad };
}
function mirror(p: number, L: number) {
  if (p < 0) p = -p;
  if (p >= L) p = 2 * L - 2 - p;
  return Math.min(L - 1, Math.max(0, p));
}

// Checagem de sanidade: reduzido de volta, o resultado deve lembrar a entrada e não ter "grade" de ruído
function looksWrong(data: Uint8ClampedArray, tw: number, th: number, px: Uint8ClampedArray, w: number, ox: number, oy: number) {
  if (tw * th < 256) return false;
  const OW = tw * 4, step = Math.max(1, Math.floor(Math.sqrt((tw * th) / 20000)));
  let m1 = 0, hfo = 0, hfi = 0, n = 0, ni = 0;
  for (let y = 0; y < th; y += step) for (let x = 0; x < tw; x += step) for (let c = 0; c < 3; c++) {
    let s = 0;
    for (let dy = 0; dy < 4; dy++) for (let dx = 0; dx < 4; dx++) s += data[((y * 4 + dy) * OW + x * 4 + dx) * 4 + c];
    const mean = s / 16;
    let dev = 0;
    for (let dy = 0; dy < 4; dy++) for (let dx = 0; dx < 4; dx++) dev += Math.abs(data[((y * 4 + dy) * OW + x * 4 + dx) * 4 + c] - mean);
    const iv = px[((oy + y) * w + ox + x) * 4 + c];
    m1 += Math.abs(mean - iv); hfo += dev / 16; n++;
    if (x + 1 < tw) { hfi += Math.abs(px[((oy + y) * w + ox + x + 1) * 4 + c] - iv); ni++; }
    if (y + 1 < th) { hfi += Math.abs(px[((oy + y + 1) * w + ox + x) * 4 + c] - iv); ni++; }
  }
  m1 /= n; hfo /= n; hfi = ni ? hfi / ni : 0;
  return m1 > 14 || hfo / (hfi + 1) > 1.5;
}

async function superRes(src: HTMLCanvasElement, onProgress: (p: number) => void) {
  const w = src.width, h = src.height;
  const px = src.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, w, h).data;
  const maxI = dbg.maxTile || MAX_TILE[backend!] || 256;
  const ax = splitAxis(w, maxI), ay = splitAxis(h, maxI);
  const rgb = new Float32Array(ax.P * ay.P * 3);
  for (let py = 0; py < ay.P; py++) {
    const sy = mirror(py - ay.pad, h);
    for (let qx = 0; qx < ax.P; qx++) {
      const sx = mirror(qx - ax.pad, w);
      const i = (sy * w + sx) * 4, j = (py * ax.P + qx) * 3;
      rgb[j] = px[i] / 255; rgb[j + 1] = px[i + 1] / 255; rgb[j + 2] = px[i + 2] / 255;
    }
  }
  const X = tf.tensor3d(rgb, [ay.P, ax.P, 3]);
  const out = document.createElement('canvas'); out.width = w * 4; out.height = h * 4;
  const octx = out.getContext('2d')!;
  const total = ax.n * ay.n, ms = dbg.timeout || TILE_TIMEOUT[backend!] || 90000;
  let k = 0;
  try {
    for (let ty = 0; ty < ay.n; ty++) for (let tx = 0; tx < ax.n; tx++) {
      const oy = ty * ay.I, ox = tx * ax.I;
      const th = Math.min(ay.I, h - oy), tw = Math.min(ax.I, w - ox);
      if (th <= 0 || tw <= 0) { k++; continue; }
      const Y = tf.tidy(() => {
        const up = runModel(model!, X.slice([oy, ox, 0], [ay.T, ax.T, 3]).expandDims(0) as tf.Tensor4D);
        return up.slice([0, ay.pad * 4, ax.pad * 4, 0], [1, th * 4, tw * 4, 3]).squeeze([0]) as tf.Tensor3D;
      });
      let read: Promise<Uint8ClampedArray> = tf.browser.toPixels(Y);
      if (dbg.hangOnce) { dbg.hangOnce = false; read = new Promise(() => {}); }
      let data: Uint8ClampedArray;
      try { data = await watch(read, ms); } finally { try { Y.dispose(); } catch (e) { /* já descartado */ } }
      if (dbg.corruptOnce) { dbg.corruptOnce = false; for (let i = 0; i < data.length; i++) if (i % 4 !== 3) data[i] = ((i >> 2) % 5) * 60; }
      if (backend !== 'cpu' && looksWrong(data, tw, th, px, w, ox, oy)) throw new Error('gpu-bad-output');
      octx.putImageData(new ImageData(data as Uint8ClampedArray<ArrayBuffer>, tw * 4, th * 4), ox * 4, oy * 4);
      onProgress(++k / total);
      await new Promise(r => setTimeout(r, 0));
    }
  } finally { try { X.dispose(); } catch (e) { /* já descartado */ } }
  return out;
}

function selfTestInput() {
  const a = new Float32Array(12 * 12 * 3); let i = 0;
  for (let y = 0; y < 12; y++) for (let x = 0; x < 12; x++) for (let c = 0; c < 3; c++) a[i++] = 0.5 + 0.4 * Math.sin(0.7 * y + 1.3 * x + 2.1 * c);
  return a;
}
async function selfTest() {
  const x = tf.tensor4d(selfTestInput(), [1, 12, 12, 3]), y = runModel(model!, x);
  let d: Float32Array;
  try { d = (await watch(y.data(), 60000)) as Float32Array; } finally { x.dispose(); y.dispose(); }
  for (let k = 0; k < SELFTEST.length; k++) if (!(Math.abs(d[(k * 2879) % d.length] - SELFTEST[k]) < 0.02)) return false;
  return true;
}
function disposeModel() {
  if (!model) return;
  try { for (const L of model.layers) { L.w.dispose(); L.b.dispose(); L.a.dispose(); } model.wf.dispose(); model.bf.dispose(); } catch (e) { /* ignora */ }
  model = null;
}
function listenLoss() {
  gpuLost = false;
  try {
    const b: any = tf.backend();
    if (backend === 'webgl' && b.gpgpu?.gl?.canvas) b.gpgpu.gl.canvas.addEventListener('webglcontextlost', () => { gpuLost = true; });
    if (backend === 'webgpu' && b.device?.lost) b.device.lost.then(() => { gpuLost = true; });
  } catch (e) { /* ignora */ }
}
async function startBackend(name: Backend) {
  if (!tf.findBackendFactory(name)) return false;
  if (name === 'webgpu' && !(navigator as any).gpu) return false;
  if (dbg.skip?.includes(name)) return false;
  if (name === 'webgl') {
    tf.env().set('WEBGL_FLUSH_THRESHOLD', 1);
    tf.env().set('WEBGL_DELETE_TEXTURE_THRESHOLD', 384 * 1024 * 1024);
  }
  let ok = false;
  try { ok = await tf.setBackend(name); await tf.ready(); } catch (e) { ok = false; }
  if (!ok || tf.getBackend() !== name) return false;
  backend = name; listenLoss();
  disposeModel(); model = buildModel(w32!);
  try { return await selfTest(); } catch (e) { console.warn('Autoteste falhou (' + name + '):', e); return false; }
}
async function restartBackend(name: Backend) {
  const f = tf.findBackendFactory(name);
  disposeModel();
  try { tf.removeBackend(name); } catch (e) { /* ignora */ }
  if (f) tf.registerBackend(name, f);
  return startBackend(name);
}
async function chooseBackend(from: number) {
  for (let i = Math.max(0, from); i < ORDER.length; i++) if (await startBackend(ORDER[i])) return true;
  return false;
}

export async function initEngine(): Promise<Backend | null> {
  const b64 = weightsUrl.slice(weightsUrl.indexOf(',') + 1);
  const bin = atob(b64), bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  w32 = f16ToF32(new Uint16Array(bytes.buffer));
  return (await chooseBackend(0)) ? backend : null;
}

// Amplia 4× com recuperação: 1ª falha reinicia o motor; falha seguinte (ou resultado errado) passa ao próximo.
export async function upscale4x(src: HTMLCanvasElement, onProgress: (p: number) => void, onRecover: () => void) {
  for (let attempt = 0; ; attempt++) {
    try { return await superRes(src, onProgress); }
    catch (e: any) {
      console.warn('Falha na IA (' + backend + '):', e);
      if (attempt >= 2) throw e;
      onRecover();
      let ok = (attempt === 0 && e.message !== 'gpu-bad-output') ? await restartBackend(backend!) : false;
      if (!ok) ok = await chooseBackend(ORDER.indexOf(backend!) + 1);
      if (!ok) throw e;
      onProgress(0);
    }
  }
}
