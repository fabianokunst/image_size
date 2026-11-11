// Configurações, presets e persistência local (localStorage).
import type { Fmt } from './codecs';
import type { WatermarkPos } from './imageops';

export type Mode = 'ai' | 'restore' | 'convert';
export type Aspect = 'orig' | '1:1' | '4:5' | '3:4' | '16:9';
export type Settings = {
  mode: Mode; size: number; extra: number[];
  aspect: Aspect; center: boolean; margin: number; bg: string;
  tones: boolean; whiteBg: boolean; brightness: number; contrast: number; saturation: number; sharpen: number;
  wm: { on: boolean; pos: WatermarkPos; opacity: number; scale: number };
  fmt: Fmt; quality: number; targetKB: number; pngLossy: boolean; pattern: string;
};

export const SIZES = [1000, 1200, 1500, 2000, 2400];
export const EXTRA_SIZES = [2048, 1600, 1200, 1000, 800, 600, 400];
export const ASPECTS: Record<Aspect, number | null> = { orig: null, '1:1': 1, '4:5': 4 / 5, '3:4': 3 / 4, '16:9': 16 / 9 };

export const DEFAULTS: Settings = {
  mode: 'ai', size: 1200, extra: [],
  aspect: 'orig', center: false, margin: 6, bg: '#ffffff',
  tones: true, whiteBg: false, brightness: 0, contrast: 0, saturation: 0, sharpen: 0,
  wm: { on: false, pos: 'br', opacity: 60, scale: 18 },
  fmt: 'jpg', quality: 88, targetKB: 0, pngLossy: false, pattern: '{nome}_{largura}',
};

// Presets prontos (o nome vem da tradução, pela chave)
export const BUILTIN: { key: string; s: Partial<Settings> }[] = [
  { key: 'presetDefault', s: {} },
  { key: 'presetShop', s: { size: 2048, aspect: '1:1', center: true, margin: 6, whiteBg: true, fmt: 'jpg', quality: 88 } },
  { key: 'presetMarket', s: { size: 1200, aspect: '1:1', center: true, margin: 5, whiteBg: true, fmt: 'jpg', quality: 90 } },
  { key: 'presetWeb', s: { size: 1200, fmt: 'webp', quality: 82, targetKB: 150 } },
];

const K = { settings: 'toolbox.settings', presets: 'toolbox.presets', logo: 'toolbox.logo' };
const OLD: Record<string, string> = { 'toolbox.settings': 'ampliar2.settings', 'toolbox.presets': 'ampliar2.presets', 'toolbox.logo': 'ampliar2.logo' };
const read = (k: string) => { try { return localStorage.getItem(k) ?? (OLD[k] ? localStorage.getItem(OLD[k]) : null); } catch (e) { return null; } };
const write = (k: string, v: string | null) => { try { v === null ? localStorage.removeItem(k) : localStorage.setItem(k, v); return true; } catch (e) { return false; } };

export const clone = (s: Settings): Settings => JSON.parse(JSON.stringify(s));
export const withDefaults = (p: Partial<Settings>): Settings => ({ ...clone(DEFAULTS), ...clone(p as Settings), wm: { ...DEFAULTS.wm, ...(p.wm || {}) } });

export function loadSettings(): Settings {
  try { return withDefaults(JSON.parse(read(K.settings) || '{}')); } catch (e) { return clone(DEFAULTS); }
}
export const saveSettings = (s: Settings) => write(K.settings, JSON.stringify(s));

export type UserPreset = { name: string; s: Settings };
export function loadPresets(): UserPreset[] {
  try { const a = JSON.parse(read(K.presets) || '[]'); return Array.isArray(a) ? a.map(p => ({ name: String(p.name), s: withDefaults(p.s) })) : []; } catch (e) { return []; }
}
export const savePresets = (p: UserPreset[]) => write(K.presets, JSON.stringify(p));
export const loadLogo = () => read(K.logo);
export const saveLogo = (dataUrl: string | null) => write(K.logo, dataUrl);

export const keyOf = (s: Settings, logoId: number) => JSON.stringify(s) + '|' + logoId;
