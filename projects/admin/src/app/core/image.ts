/** Scales (w,h) down so the longer side is at most `max`, never up. */
export function fitWithin(w: number, h: number, max: number): { w: number; h: number } {
  const scale = Math.min(1, max / Math.max(w, h));
  return { w: Math.max(1, Math.round(w * scale)), h: Math.max(1, Math.round(h * scale)) };
}

/** Shrinks a photo to ≤ 800px WebP so menu pages stay fast on mobile data (and under the 1 MB storage rule). */
export async function compressImage(file: File, max = 800, quality = 0.8): Promise<Blob> {
  // createImageBitmap can fail on some phones/photo formats; fall back to a normal <img> decode.
  let src: CanvasImageSource & { width: number; height: number };
  let release = () => {};
  try {
    const bmp = await createImageBitmap(file);
    src = bmp;
    release = () => bmp.close();
  } catch {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.src = url;
    try {
      await img.decode();
    } catch {
      URL.revokeObjectURL(url);
      throw new Error('this photo format is not supported');
    }
    src = img;
    release = () => URL.revokeObjectURL(url);
  }
  const { w, h } = fitWithin(src.width, src.height, max);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  canvas.getContext('2d')!.drawImage(src, 0, 0, w, h);
  release();
  const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/webp', quality));
  if (!blob) throw new Error('Could not process this image');
  return blob;
}
