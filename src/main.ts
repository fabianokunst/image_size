import './styles.css';
import { zipSync } from 'fflate';
import { I18N, applyStatic, detectLang, type Lang } from './i18n';
import { initEngine, currentBackend } from './engine';
import { codecsReady } from './codecs';
import { decodeFile, isImageFile, ACCEPT } from './decode';
import { hasAlphaPixels } from './imageops';
import { processItem, productRect, geometry, type Item } from './pipeline';
import {
  SIZES, EXTRA_SIZES, ASPECTS, BUILTIN, DEFAULTS, clone, withDefaults, keyOf,
  loadSettings, saveSettings, loadPresets, savePresets, loadLogo, saveLogo, type Settings, type UserPreset,
} from './settings';

const $ = <T extends HTMLElement = HTMLElement>(s: string) => document.querySelector(s) as T;
const $$ = <T extends HTMLElement = HTMLElement>(s: string) => Array.from(document.querySelectorAll(s)) as T[];
const el = {
  drop: $('#drop'), file: $<HTMLInputElement>('#file'), pick: $('#pick'), go: $<HTMLButtonElement>('#go'), clear: $('#clear'),
  engine: $('#engine'), list: $('#list'), tpl: $<HTMLTemplateElement>('#itemTpl'), listFoot: $('#listFoot'), total: $('#total'),
  zip: $<HTMLButtonElement>('#zipBtn'), zipHint: $('#zipHint'), saveFolder: $<HTMLButtonElement>('#saveFolder'),
  cmpWrap: $('#cmpWrap'), cmpScroll: $('#cmpScroll'), cmp: $('#cmp'), before: $<HTMLImageElement>('#before'), after: $<HTMLImageElement>('#after'),
  slider: $<HTMLInputElement>('#slider'), zoom: $('#zoom'), cmpTitle: $('#cmpTitle'), theme: $('#theme'), accel: $('#accel'),
  codecNote: $('#codecNote'), saveNote: $('#saveNote'), modeHint: $('#modeHint'), sizeChips: $('#sizeChips'), sizeHint: $('#sizeHint'),
  extraChips: $('#extraChips'), aspectChips: $('#aspectChips'), center: $<HTMLInputElement>('#center'), margin: $<HTMLInputElement>('#margin'),
  marginOut: $('#marginOut'), marginRow: $('#marginRow'), bg: $<HTMLInputElement>('#bg'), bgHex: $('#bgHex'),
  tones: $<HTMLInputElement>('#tones'), whiteBg: $<HTMLInputElement>('#whiteBg'), resetAdjust: $('#resetAdjust'),
  wmOn: $<HTMLInputElement>('#wmOn'), wmFile: $<HTMLInputElement>('#wmFile'), wmPick: $('#wmPick'), wmRemove: $('#wmRemove'),
  wmPreview: $('#wmPreview'), wmNoLogo: $('#wmNoLogo'), wmPos: $('#wmPos'),
  fmtHint: $('#fmtHint'), lossyOpts: $('#lossyOpts'), pngOpts: $('#pngOpts'), targetKB: $<HTMLInputElement>('#targetKB'),
  pngLossy: $<HTMLInputElement>('#pngLossy'), pattern: $<HTMLInputElement>('#pattern'),
  preset: $<HTMLSelectElement>('#preset'), presetSave: $('#presetSave'), presetDelete: $('#presetDelete'), presetForm: $('#presetForm'),
  presetName: $<HTMLInputElement>('#presetName'), presetConfirm: $('#presetConfirm'), presetCancel: $('#presetCancel'),
};
const RANGES = ['brightness', 'contrast', 'saturation', 'sharpen', 'quality', 'wmOpacity', 'wmScale'] as const;

let lang: Lang = detectLang();
let T = I18N[lang];
let S: Settings = loadSettings();
let presets: UserPreset[] = loadPresets();
const items: Item[] = [];
let uid = 0, busy = false, zipBusy = false, selectedId: number | null = null;
let engine: 'loading' | 'ready' | 'slow' | 'error' = 'loading';
let engMsg: { key: string | null; args: any[]; err: boolean } = { key: 'engLoading', args: [], err: false };
let progressArgs: [number, number] = [1, 1];
let logo: ImageBitmap | null = null, logoUrl: string | null = null, logoId = 0;
let downloads: any = null;
const inFrame = (() => { try { return window.self !== window.top; } catch (e) { return true; } })();

const fmtBytes = (b: number) => b < 1024 * 1024
  ? `${Math.max(1, Math.round(b / 1024)).toLocaleString(T.locale)} KB`
  : `${(b / 1048576).toLocaleString(T.locale, { maximumFractionDigits: 1 })} MB`;
const pct = (a: number, b: number) => { const p = Math.round((b / a - 1) * 100); return (p > 0 ? '+' : p < 0 ? '−' : '') + Math.abs(p) + '%'; };
const currentKey = () => keyOf(S, logoId);

/* ---------- Mensagem de status ---------- */
function setEngine(key: string | null, args: any[] = [], err = false) { engMsg = { key, args, err }; renderEngine(); }
function renderEngine() {
  const v = engMsg.key ? T[engMsg.key] : '';
  el.engine.textContent = typeof v === 'function' ? v(...engMsg.args) : v;
  el.engine.classList.toggle('err', engMsg.err);
}

/* ---------- Controles de configuração ---------- */
function buildControls() {
  el.sizeChips.innerHTML = SIZES.map(n => `<label class="chip"><input type="radio" name="size" value="${n}"><span>${n} px</span></label>`).join('') +
    `<label class="chip"><input type="radio" name="size" value="custom" id="customRadio"><span data-i18n="custom"></span><input type="number" id="custom" min="64" max="6000" step="1" placeholder="px" inputmode="numeric" data-i18n-aria="customAria"></label>`;
  el.extraChips.innerHTML = EXTRA_SIZES.map(n => `<label class="chip"><input type="checkbox" name="extra" value="${n}"><span>${n}</span></label>`).join('');
  el.aspectChips.innerHTML = Object.keys(ASPECTS).map(a => `<label class="chip"><input type="radio" name="aspect" value="${a}"><span${a === 'orig' ? ' data-i18n="aspectOrig"' : ''}>${a}</span></label>`).join('');
  el.wmPos.innerHTML = ['tl', 'tc', 'tr', 'ml', 'mc', 'mr', 'bl', 'bc', 'br'].map(p => `<button type="button" role="radio" data-pos="${p}" aria-checked="false"></button>`).join('');
}

function toUI() {
  ($(`input[name="mode"][value="${S.mode}"]`) as HTMLInputElement).checked = true;
  const custom = !SIZES.includes(S.size);
  ($(custom ? '#customRadio' : `input[name="size"][value="${S.size}"]`) as HTMLInputElement).checked = true;
  $<HTMLInputElement>('#custom').value = custom ? String(S.size) : '';
  $$<HTMLInputElement>('input[name="extra"]').forEach(i => { i.checked = S.extra.includes(+i.value); });
  ($(`input[name="aspect"][value="${S.aspect}"]`) as HTMLInputElement).checked = true;
  el.center.checked = S.center; el.margin.value = String(S.margin); el.bg.value = S.bg;
  el.tones.checked = S.tones; el.whiteBg.checked = S.whiteBg;
  ($('#brightness') as HTMLInputElement).value = String(S.brightness); ($('#contrast') as HTMLInputElement).value = String(S.contrast);
  ($('#saturation') as HTMLInputElement).value = String(S.saturation); ($('#sharpen') as HTMLInputElement).value = String(S.sharpen);
  el.wmOn.checked = S.wm.on; ($('#wmOpacity') as HTMLInputElement).value = String(S.wm.opacity); ($('#wmScale') as HTMLInputElement).value = String(S.wm.scale);
  ($(`input[name="fmt"][value="${S.fmt}"]`) as HTMLInputElement).checked = true;
  ($('#quality') as HTMLInputElement).value = String(S.quality);
  el.targetKB.value = S.targetKB ? String(S.targetKB) : ''; el.pngLossy.checked = S.pngLossy; el.pattern.value = S.pattern;
}

function fromUI() {
  S.mode = ($('input[name="mode"]:checked') as HTMLInputElement).value as Settings['mode'];
  const sv = ($('input[name="size"]:checked') as HTMLInputElement).value;
  S.size = sv === 'custom' ? parseInt($<HTMLInputElement>('#custom').value, 10) : parseInt(sv, 10);
  S.extra = $$<HTMLInputElement>('input[name="extra"]:checked').map(i => +i.value);
  S.aspect = ($('input[name="aspect"]:checked') as HTMLInputElement).value as Settings['aspect'];
  S.center = el.center.checked; S.margin = +el.margin.value; S.bg = el.bg.value;
  S.tones = el.tones.checked; S.whiteBg = el.whiteBg.checked;
  S.brightness = +($('#brightness') as HTMLInputElement).value; S.contrast = +($('#contrast') as HTMLInputElement).value;
  S.saturation = +($('#saturation') as HTMLInputElement).value; S.sharpen = +($('#sharpen') as HTMLInputElement).value;
  S.wm.on = el.wmOn.checked; S.wm.opacity = +($('#wmOpacity') as HTMLInputElement).value; S.wm.scale = +($('#wmScale') as HTMLInputElement).value;
  S.fmt = ($('input[name="fmt"]:checked') as HTMLInputElement).value as Settings['fmt'];
  S.quality = +($('#quality') as HTMLInputElement).value;
  S.targetKB = Math.max(0, parseInt(el.targetKB.value, 10) || 0); S.pngLossy = el.pngLossy.checked; S.pattern = el.pattern.value;
}

const sizeValid = () => Number.isFinite(S.size) && S.size >= 64 && S.size <= 6000;

function renderControls() {
  el.modeHint.textContent = T[{ ai: 'hintAi', restore: 'hintRestore', convert: 'hintConvert' }[S.mode]];
  $$<HTMLInputElement>('input[name="size"]').forEach(i => { i.disabled = S.mode === 'restore'; });
  $<HTMLInputElement>('#custom').disabled = S.mode === 'restore';
  if (S.mode === 'restore') { el.sizeHint.textContent = T.hintRestoreSize; el.sizeHint.classList.remove('err'); }
  else if (!sizeValid()) { el.sizeHint.textContent = T.hintInvalid; el.sizeHint.classList.add('err'); }
  else { el.sizeHint.textContent = (S.aspect === '1:1' ? T.hintSquare : T.hintOne)(S.size); el.sizeHint.classList.remove('err'); }
  el.marginRow.hidden = !S.center; el.marginOut.textContent = S.margin + '%';
  el.bgHex.textContent = S.bg.toUpperCase();
  el.tones.disabled = S.mode === 'convert';
  RANGES.forEach(id => { const r = $<HTMLInputElement>('#' + id); (r.nextElementSibling as HTMLOutputElement).textContent = (id.startsWith('wm') ? r.value + '%' : r.value); });
  $$('#wmPos button').forEach(b => b.setAttribute('aria-checked', String(b.dataset.pos === S.wm.pos)));
  el.wmRemove.hidden = !logo; el.wmNoLogo.hidden = !!logo;
  el.wmPick.textContent = logo ? T.wmChange : T.wmPick;
  el.wmPreview.innerHTML = logoUrl ? `<img src="${logoUrl}" alt="">` : '';
  el.fmtHint.textContent = T.fmtHint[S.fmt];
  el.lossyOpts.hidden = S.fmt === 'png'; el.pngOpts.hidden = S.fmt !== 'png';
  // indicador nas abas que estão alterando as imagens
  const active: Record<string, boolean> = {
    frame: S.aspect !== 'orig' || S.center || S.whiteBg || S.bg.toLowerCase() !== '#ffffff',
    adjust: !!(S.brightness || S.contrast || S.saturation || S.sharpen),
    wm: S.wm.on && !!logo,
  };
  for (const [k, on] of Object.entries(active)) {
    const t = $('#tab-' + k);
    (t.querySelector('.dot') as HTMLElement).hidden = !on; (t.querySelector('.sr') as HTMLElement).hidden = !on;
  }
}

function settingsChanged() {
  fromUI(); saveSettings(S); markPresetCustom(); refresh();
}

/* ---------- Abas ---------- */
const TABS = $$<HTMLButtonElement>('.tab');
function selectTab(name: string, focus = false) {
  if (!TABS.some(t => t.dataset.tab === name)) name = 'resize';
  TABS.forEach(t => {
    const on = t.dataset.tab === name;
    t.setAttribute('aria-selected', String(on)); t.tabIndex = on ? 0 : -1;
    $('#pane-' + t.dataset.tab).hidden = !on;
    if (on && focus) t.focus();
  });
  try { localStorage.setItem('toolbox.tab', name); } catch (e) { /* ignora */ }
}
TABS.forEach((t, i) => {
  t.addEventListener('click', () => selectTab(t.dataset.tab!));
  t.addEventListener('keydown', e => {
    const k = e.key, n = TABS.length;
    const j = k === 'ArrowRight' ? (i + 1) % n : k === 'ArrowLeft' ? (i - 1 + n) % n : k === 'Home' ? 0 : k === 'End' ? n - 1 : -1;
    if (j >= 0) { e.preventDefault(); selectTab(TABS[j].dataset.tab!, true); }
  });
});
selectTab((() => { try { return localStorage.getItem('toolbox.tab') || 'resize'; } catch (e) { return 'resize'; } })());

/* ---------- Presets ---------- */
function renderPresets() {
  const cur = el.preset.value;
  el.preset.innerHTML =
    `<optgroup label="${T.presetBuiltin}">${BUILTIN.map(b => `<option value="b:${b.key}">${T[b.key]}</option>`).join('')}</optgroup>` +
    (presets.length ? `<optgroup label="${T.presetMine}">${presets.map((p, i) => `<option value="u:${i}"></option>`).join('')}</optgroup>` : '') +
    `<option value="custom">${T.presetCustom}</option>`;
  presets.forEach((p, i) => { (el.preset.querySelector(`option[value="u:${i}"]`) as HTMLOptionElement).textContent = p.name; });
  el.preset.value = cur && el.preset.querySelector(`option[value="${CSS.escape(cur)}"]`) ? cur : matchPreset();
  el.presetDelete.hidden = !el.preset.value.startsWith('u:');
}
function matchPreset() {
  const now = JSON.stringify(S);
  for (const b of BUILTIN) if (JSON.stringify(withDefaults(b.s)) === now) return 'b:' + b.key;
  for (let i = 0; i < presets.length; i++) if (JSON.stringify(presets[i].s) === now) return 'u:' + i;
  return 'custom';
}
function markPresetCustom() { el.preset.value = matchPreset(); el.presetDelete.hidden = !el.preset.value.startsWith('u:'); }
el.preset.addEventListener('change', () => {
  const v = el.preset.value;
  if (v.startsWith('b:')) S = withDefaults(BUILTIN.find(b => 'b:' + b.key === v)!.s);
  else if (v.startsWith('u:')) S = clone(presets[+v.slice(2)].s);
  else return;
  saveSettings(S); toUI(); el.presetDelete.hidden = !v.startsWith('u:'); refresh();
});
el.presetSave.addEventListener('click', () => { el.presetForm.hidden = false; el.presetName.value = ''; el.presetName.focus(); });
el.presetCancel.addEventListener('click', () => { el.presetForm.hidden = true; });
const confirmPreset = () => {
  const name = el.presetName.value.trim(); if (!name) return;
  const i = presets.findIndex(p => p.name === name);
  if (i >= 0) presets[i].s = clone(S); else presets.push({ name, s: clone(S) });
  savePresets(presets); el.presetForm.hidden = true; el.preset.value = ''; renderPresets();
};
el.presetConfirm.addEventListener('click', confirmPreset);
el.presetName.addEventListener('keydown', e => { if (e.key === 'Enter') confirmPreset(); if (e.key === 'Escape') el.presetForm.hidden = true; });
el.presetDelete.addEventListener('click', () => {
  const v = el.preset.value; if (!v.startsWith('u:')) return;
  presets.splice(+v.slice(2), 1); savePresets(presets); el.preset.value = ''; renderPresets();
});

/* ---------- Marca d'água ---------- */
async function setLogo(dataUrl: string | null, persist: boolean) {
  logo?.close?.(); logo = null; logoUrl = null;
  if (dataUrl) {
    try {
      const blob = await (await fetch(dataUrl)).blob();
      logo = await createImageBitmap(blob); logoUrl = dataUrl;
    } catch (e) { logo = null; logoUrl = null; }
  }
  logoId++;
  if (persist) saveLogo(logoUrl && logoUrl.length < 1_500_000 ? logoUrl : null);
  refresh();
}
el.wmPick.addEventListener('click', () => el.wmFile.click());
el.wmFile.addEventListener('change', () => {
  const f = el.wmFile.files?.[0]; if (!f) return;
  const r = new FileReader();
  r.onload = () => { setLogo(String(r.result), true); if (!S.wm.on) { el.wmOn.checked = true; settingsChanged(); } };
  r.readAsDataURL(f); el.wmFile.value = '';
});
el.wmRemove.addEventListener('click', () => setLogo(null, true));
el.wmPos.addEventListener('click', e => {
  const b = (e.target as HTMLElement).closest('button'); if (!b) return;
  S.wm.pos = b.dataset.pos as any; saveSettings(S); markPresetCustom(); refresh();
});

/* ---------- Lista de imagens ---------- */
async function addFiles(list: FileList | File[]) {
  const files = Array.from(list).filter(isImageFile);
  for (const file of files) {
    const it: Item = { id: ++uid, file, name: file.name, stem: file.name.replace(/\.[^.]+$/, '') || 'imagem', bytes: file.size, status: 'loading', progress: 0 };
    items.push(it); mountItem(it);
    try {
      it.orig = await decodeFile(file);
      it.w = it.orig.width; it.h = it.orig.height; it.hasAlpha = hasAlphaPixels(it.orig);
      it.thumbUrl = URL.createObjectURL(file);
      it.status = 'ready';
    } catch (e) {
      it.status = 'error'; it.error = /\.(heic|heif)$/i.test(file.name) ? 'errHeic' : 'errOpen';
    }
    updateItem(it);
  }
  refresh();
}
function mountItem(it: Item) {
  const li = el.tpl.content.firstElementChild!.cloneNode(true) as HTMLLIElement;
  li.querySelector('.name')!.textContent = it.name;
  (li.querySelector('.name') as HTMLElement).title = it.name;
  li.querySelector('.thumb-btn')!.addEventListener('click', () => { if (it.outUrl) select(it.id); });
  li.querySelector('.dl')!.addEventListener('click', () => saveItem(it));
  li.querySelector('.rm')!.addEventListener('click', () => removeItem(it));
  it.li = li; el.list.appendChild(li); el.list.hidden = false;
}
function updateProgress(it: Item) {
  const bar = it.li!.querySelector('.bar') as HTMLElement;
  bar.hidden = false; (bar.firstElementChild as HTMLElement).style.width = `${Math.round(it.progress * 100)}%`;
  it.li!.querySelector('.state')!.textContent = T.stWorking(Math.round(it.progress * 100), Math.round((performance.now() - it.t0!) / 1000));
}
function updateItem(it: Item) {
  const li = it.li!, st = li.querySelector('.state') as HTMLElement, dims = li.querySelector('.dims')!, sizes = li.querySelector('.sizes')!;
  const thumb = li.querySelector('.thumb-btn img') as HTMLImageElement;
  if (it.thumbUrl && thumb.src !== it.thumbUrl) thumb.src = it.thumbUrl;
  li.querySelector('.thumb-btn')!.setAttribute('aria-label', T.compareAria(it.name));
  li.querySelector('.rm')!.setAttribute('aria-label', T.removeAria(it.name));
  const dl = li.querySelector('.dl') as HTMLButtonElement;
  dl.textContent = T.download; dl.setAttribute('aria-label', T.downloadAria(it.name));
  if (it.w && (sizeValid() || S.mode === 'restore')) {
    const g = geometry(it, S, productRect(it, S));
    dims.textContent = T.dims(it.w, it.h, g.W, g.H);
  } else dims.textContent = it.w ? `${it.w} × ${it.h} px` : '';
  const current = it.key === currentKey();
  if (it.outputs && current) {
    const main = it.outputs[0].blob.size;
    sizes.textContent = T.sizeLine(fmtBytes(it.bytes), fmtBytes(main), pct(it.bytes, main)) + (it.outputs.length > 1 ? T.extras(it.outputs.length - 1) : '');
  } else sizes.textContent = '';
  st.className = 'state';
  (li.querySelector('.bar') as HTMLElement).hidden = it.status !== 'working';
  dl.hidden = !(it.status === 'done' && current);
  if (it.status === 'loading') st.textContent = T.stOpening;
  else if (it.status === 'error') { st.textContent = T[it.error!] || T.errProcess; st.classList.add('err'); }
  else if (it.status === 'working') st.textContent = (it as any).phase === 'encode' ? T.stEncoding : T.stWorking(Math.round(it.progress * 100), Math.round((performance.now() - it.t0!) / 1000));
  else if (it.status === 'done' && current) {
    st.textContent = T.stDone(it.secs!.toLocaleString(T.locale, { maximumFractionDigits: 1 })) + (it.notes?.length ? ' ' + it.notes.map(n => T[n]).join(' ') : '');
    st.classList.add('ok');
  } else if (it.status === 'done') st.textContent = T.stStale;
  else st.textContent = T.stWaiting;
  li.classList.toggle('selected', selectedId === it.id);
}
function revoke(it: Item, all = false) {
  for (const k of ['outUrl', 'beforeUrl'] as const) if (it[k]) { URL.revokeObjectURL(it[k]!); it[k] = undefined; }
  if (all && it.thumbUrl) URL.revokeObjectURL(it.thumbUrl);
}
function removeItem(it: Item) {
  if (busy && it.status === 'working') return;
  const i = items.indexOf(it); if (i >= 0) items.splice(i, 1);
  it.removed = true; revoke(it, true); it.li!.remove();
  if (selectedId === it.id) { selectedId = null; const next = items.find(x => x.outUrl); next ? select(next.id) : (el.cmpWrap.hidden = true); }
  refresh();
}

/* ---------- Processamento ---------- */
const needsAI = () => S.mode !== 'convert';
const pending = () => items.filter(it => it.orig && it.status !== 'error' && it.status !== 'working' && it.key !== currentKey());

async function processAll() {
  if (busy || (S.mode !== 'restore' && !sizeValid())) return;
  if (needsAI() && (engine === 'loading' || engine === 'error')) return;
  const s = clone(S), key = currentKey(), queue = pending();
  if (!queue.length) return;
  busy = true; refresh();
  const tick = setInterval(() => items.forEach(it => { if (it.status === 'working' && (it as any).phase !== 'encode') updateProgress(it); }), 1000);
  for (let i = 0; i < queue.length; i++) {
    const it = queue[i];
    if (it.removed) continue;
    progressArgs = [i + 1, queue.length]; setEngine('engProgress', progressArgs);
    it.status = 'working'; it.progress = 0; it.t0 = performance.now(); (it as any).phase = 'ai'; updateItem(it);
    try {
      const res = await processItem(it, s, items.indexOf(it) + 1, logo, {
        progress: p => { it.progress = p; updateProgress(it); },
        recover: () => setEngine('engRecover'),
        encoding: () => { (it as any).phase = 'encode'; updateItem(it); },
      });
      if (res.usedAI) renderAccel();
      if (it.removed) continue;
      revoke(it);
      it.outputs = res.outputs; it.notes = res.notes; it.key = key; it.status = 'done';
      it.outUrl = URL.createObjectURL(res.outputs[0].blob); it.beforeUrl = URL.createObjectURL(res.beforeBlob);
      it.secs = (performance.now() - it.t0) / 1000;
      if (selectedId === null || selectedId === it.id) select(it.id);
    } catch (e: any) {
      console.error(e);
      it.status = 'error';
      it.error = /avif-unavailable/.test(e?.message) ? 'errAvif' : /webp-unavailable/.test(e?.message) ? 'errWebp' : 'errProcess';
    }
    if (!it.removed) updateItem(it);
    setEngine('engProgress', progressArgs);
    await new Promise(r => setTimeout(r, 0));
  }
  clearInterval(tick);
  busy = false;
  setEngine(engine === 'slow' ? 'engSlow' : null);
  refresh();
}

/* ---------- Comparador ---------- */
function select(id: number) {
  const it = items.find(x => x.id === id); if (!it || !it.outUrl) return;
  selectedId = id;
  const o = it.outputs![0];
  el.before.src = it.beforeUrl!; el.after.src = it.outUrl;
  el.cmp.style.setProperty('--ar', `${o.w} / ${o.h}`); el.cmp.style.setProperty('--natw', `${o.w}px`);
  el.cmpTitle.textContent = `${o.name}, ${o.w} × ${o.h} px`;
  el.cmpWrap.hidden = false;
  items.forEach(x => x.li?.classList.toggle('selected', x.id === id));
}
function setPos(v: number) { v = Math.max(0, Math.min(100, v)); el.cmp.style.setProperty('--pos', `${v}%`); el.slider.value = String(v); }
let dragging = false;
const move = (e: PointerEvent) => { const r = el.cmp.getBoundingClientRect(); setPos(((e.clientX - r.left) / r.width) * 100); };
el.cmp.addEventListener('pointerdown', e => { if (el.cmpWrap.classList.contains('zoomed')) return; dragging = true; el.cmp.setPointerCapture(e.pointerId); move(e); });
el.cmp.addEventListener('pointermove', e => { if (dragging) move(e); });
el.cmp.addEventListener('pointerup', () => { dragging = false; });
el.cmp.addEventListener('pointercancel', () => { dragging = false; });
el.slider.addEventListener('input', () => setPos(parseFloat(el.slider.value)));
el.zoom.addEventListener('click', () => {
  const on = !el.cmpWrap.classList.contains('zoomed');
  el.cmpWrap.classList.toggle('zoomed', on); el.zoom.setAttribute('aria-pressed', String(on));
  el.zoom.textContent = on ? T.zoomOff : T.zoomOn;
  if (on) requestAnimationFrame(() => {
    const sc = el.cmpScroll, p = parseFloat(el.slider.value) / 100;
    sc.scrollLeft = p * sc.scrollWidth - sc.clientWidth / 2; sc.scrollTop = (sc.scrollHeight - sc.clientHeight) / 2;
  });
});
setPos(50);

/* ---------- Downloads ---------- */
async function save(filename: string, blob: Blob) {
  if (downloads) {
    try { await downloads.save({ filename, data: blob }); return; }
    catch (e: any) {
      if (e?.code === 'declined') return;
      if (e?.code === 'rate_limited') { setEngine('dlPending'); return; }
      if (e?.code === 'too_large') { setEngine('dlTooLarge'); return; }
    }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = filename;
  document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 5000);
}
async function zipOf(list: { name: string; blob: Blob }[]) {
  const files: Record<string, [Uint8Array, { level: 0 }]> = {}, used = new Set<string>();
  for (const f of list) {
    let n = f.name, k = 2;
    while (used.has(n)) n = f.name.replace(/(\.[^.]+)$/, `-${k++}$1`);
    used.add(n); files[n] = [new Uint8Array(await f.blob.arrayBuffer()), { level: 0 }];
  }
  return new Blob([zipSync(files) as Uint8Array<ArrayBuffer>], { type: "application/zip" });
}
const readyItems = () => items.filter(it => it.status === 'done' && it.key === currentKey());
async function saveItem(it: Item) {
  if (!it.outputs) return;
  if (it.outputs.length === 1) return save(it.outputs[0].name, it.outputs[0].blob);
  save(`${it.stem}.zip`, await zipOf(it.outputs));
}
el.zip.addEventListener('click', async () => {
  const done = readyItems(); if (!done.length) return;
  if (done.length === 1) return saveItem(done[0]);
  zipBusy = true; el.zip.disabled = true; el.zip.textContent = T.zipBusy;
  try { await save(T.zipName(S.mode === 'restore' ? 'original' : S.size), await zipOf(done.flatMap(it => it.outputs!))); }
  finally { zipBusy = false; refresh(); }
});
el.saveFolder.addEventListener('click', async () => {
  const done = readyItems(); if (!done.length) return;
  try {
    const dir = await (window as any).showDirectoryPicker({ mode: 'readwrite' });
    let n = 0;
    for (const f of done.flatMap(it => it.outputs!)) {
      const h = await dir.getFileHandle(f.name, { create: true }), w = await h.createWritable();
      await w.write(f.blob); await w.close(); n++;
    }
    setEngine('savedFolder', [n]);
  } catch (e: any) { if (e?.name !== 'AbortError') console.warn(e); }
});

/* ---------- Atualização geral ---------- */
function refresh() {
  renderControls();
  const todo = (S.mode === 'restore' || sizeValid()) ? pending().length : 0;
  const aiBlocked = needsAI() && (engine === 'loading' || engine === 'error');
  el.go.disabled = busy || !todo || aiBlocked;
  el.go.textContent = busy ? T.goBusy : todo ? T.goN(todo) : T.goIdle;
  if (!busy && aiBlocked && engine === 'error' && items.length) setEngine('needsAI', [], true);
  else if (!busy && engMsg.key === 'needsAI') setEngine(engine === 'slow' ? 'engSlow' : null);
  if (!busy && engine === 'ready' && (!engMsg.key || engMsg.key === 'engReady')) setEngine(items.length ? null : 'engReady');
  const done = readyItems();
  el.listFoot.hidden = !items.length; el.clear.hidden = !items.length || busy; el.list.hidden = !items.length;
  el.zip.disabled = !done.length || busy || zipBusy;
  if (!zipBusy) el.zip.textContent = T.zipAll(done.length);
  el.zipHint.textContent = done.length > 1 || done.some(it => it.outputs!.length > 1) ? T.zipHint : '';
  el.saveFolder.hidden = !('showDirectoryPicker' in window) || inFrame || !done.length;
  if (done.length) {
    const a = done.reduce((t, it) => t + it.bytes, 0), b = done.reduce((t, it) => t + it.outputs![0].blob.size, 0);
    el.total.textContent = T.totalLine(fmtBytes(a), fmtBytes(b), pct(a, b));
  } else el.total.textContent = '';
  items.forEach(updateItem);
}

/* ---------- Idioma e tema ---------- */
function renderAccel() { const b = currentBackend(); el.accel.textContent = b ? T.accel[b] : ''; }
function setLang(l: Lang) {
  lang = l; T = I18N[l];
  try { localStorage.setItem('toolbox.lang', l); } catch (e) { /* ignora */ }
  applyStatic(l);
  el.zoom.textContent = el.cmpWrap.classList.contains('zoomed') ? T.zoomOff : T.zoomOn;
  renderPresets(); renderEngine(); renderTheme(); renderAccel(); renderCodecNote(); refresh();
}
$$('.lang [data-lang]').forEach(b => b.addEventListener('click', () => setLang(b.dataset.lang as Lang)));
const mq = window.matchMedia('(prefers-color-scheme: dark)');
const isDark = () => { const t = document.documentElement.getAttribute('data-theme'); return t ? t === 'dark' : mq.matches; };
function renderTheme() {
  const dark = isDark();
  document.documentElement.classList.toggle('is-dark', dark);
  el.theme.setAttribute('aria-label', dark ? T.toLight : T.toDark); el.theme.title = dark ? T.toLight : T.toDark;
}
el.theme.addEventListener('click', () => {
  const next = isDark() ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  try { localStorage.setItem('toolbox.theme', next); } catch (e) { /* ignora */ }
  renderTheme();
});
mq.addEventListener?.('change', renderTheme);
let codecsOk: boolean | null = null;
function renderCodecNote() { el.codecNote.textContent = codecsOk === false ? T.codecsNative : ''; }

/* ---------- Eventos ---------- */
el.file.accept = ACCEPT;
el.pick.addEventListener('click', e => { e.stopPropagation(); el.file.click(); });
el.drop.addEventListener('click', () => el.file.click());
el.drop.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); el.file.click(); } });
el.file.addEventListener('change', () => { if (el.file.files) addFiles(el.file.files); el.file.value = ''; });
let dragDepth = 0;
window.addEventListener('dragenter', e => { if (e.dataTransfer?.types.includes('Files')) { dragDepth++; el.drop.classList.add('over'); } });
window.addEventListener('dragleave', () => { dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) el.drop.classList.remove('over'); });
window.addEventListener('dragover', e => e.preventDefault());
window.addEventListener('drop', e => { e.preventDefault(); dragDepth = 0; el.drop.classList.remove('over'); if (e.dataTransfer?.files.length) addFiles(e.dataTransfer.files); });
window.addEventListener('paste', e => { const f = e.clipboardData?.files; if (f?.length) addFiles(f); });
el.go.addEventListener('click', processAll);
el.clear.addEventListener('click', () => {
  if (busy) return;
  items.splice(0).forEach(it => { it.removed = true; revoke(it, true); it.li!.remove(); });
  selectedId = null; el.cmpWrap.hidden = true; refresh();
});
el.resetAdjust.addEventListener('click', () => {
  ['brightness', 'contrast', 'saturation', 'sharpen'].forEach(id => { $<HTMLInputElement>('#' + id).value = '0'; });
  settingsChanged();
});

buildControls();
applyStatic(lang);
toUI();
document.querySelector('.panel')!.addEventListener('input', e => {
  const t = e.target as HTMLElement;
  if (t.id === 'custom') ($('#customRadio') as HTMLInputElement).checked = true;
  if (t.id === 'presetName' || t.id === 'wmFile') return;
  settingsChanged();
});
document.querySelector('.panel')!.addEventListener('change', e => { if ((e.target as HTMLElement).id !== 'preset' && (e.target as HTMLElement).id !== 'wmFile') settingsChanged(); });
$<HTMLInputElement>('#custom').addEventListener('focus', () => { ($('#customRadio') as HTMLInputElement).checked = true; settingsChanged(); });
renderPresets(); renderTheme(); renderEngine(); refresh();

/* ---------- Inicialização ---------- */
(async () => {
  const saved = loadLogo(); if (saved) await setLogo(saved, false);
})();
(async () => {
  try { if ((window as any).claude?.use) downloads = await (window as any).claude.use('downloads'); } catch (e) { downloads = null; }
  el.saveNote.hidden = !inFrame || !!downloads;
})();
codecsReady.then(ok => { codecsOk = ok; renderCodecNote(); });
setTimeout(async () => {
  try {
    const b = await initEngine();
    if (!b) throw new Error('nenhum motor');
    engine = b === 'cpu' ? 'slow' : 'ready';
    renderAccel();
    setEngine(engine === 'slow' ? 'engSlow' : (items.length ? null : 'engReady'));
  } catch (e) { console.error(e); engine = 'error'; setEngine('engError', [], true); }
  refresh();
}, 30);
if (!__SINGLE__ && 'serviceWorker' in navigator && /^https?:$/.test(location.protocol) && !inFrame) {
  navigator.serviceWorker.register('./sw.js').catch(() => { /* sem cache offline */ });
}
void DEFAULTS;
