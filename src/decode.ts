// Abre arquivos de imagem num canvas. Formatos do navegador via createImageBitmap; TIFF via UTIF.js.
import UTIF from 'utif';
import { canvas, ctx2d, type Canvas } from './imageops';

export const ACCEPT = 'image/jpeg,image/png,image/webp,image/avif,image/bmp,image/gif,image/tiff,image/heic,image/heif,.jpg,.jpeg,.png,.webp,.avif,.gif,.bmp,.tif,.tiff,.heic,.heif';
export const isImageFile = (f: File) => /^image\//.test(f.type) || /\.(jpe?g|png|webp|avif|bmp|gif|tiff?|heic|heif)$/i.test(f.name);

export async function decodeFile(file: File): Promise<Canvas> {
  if (/\.tiff?$/i.test(file.name) || file.type === 'image/tiff') {
    const buf = await file.arrayBuffer();
    const ifds = UTIF.decode(buf);
    UTIF.decodeImage(buf, ifds[0]);
    const rgba = UTIF.toRGBA8(ifds[0]), w = ifds[0].width, h = ifds[0].height;
    const c = canvas(w, h);
    ctx2d(c).putImageData(new ImageData(new Uint8ClampedArray(rgba.buffer, rgba.byteOffset, w * h * 4), w, h), 0, 0);
    return c;
  }
  const bmp = await createImageBitmap(file);
  const c = canvas(bmp.width, bmp.height);
  ctx2d(c).drawImage(bmp, 0, 0);
  bmp.close?.();
  return c;
}
