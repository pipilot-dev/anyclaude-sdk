// Browser-first image downsampling for read_file. Uses createImageBitmap +
// OffscreenCanvas when available (browser / web worker); degrades gracefully in
// Node-without-DOM by passing the image through unmodified. Never throws.

import { bytesToBase64 } from './fileTypes.js'

export interface ProcessedImage {
  /** Base64 payload (no `data:` prefix). */
  data: string
  media_type: string
  width?: number
  height?: number
  /** Set when the image could not be downsampled (e.g. no canvas) but is oversized. */
  note?: string
}

const MAX_DIMENSION = 2000

type CanvasCtor = new (w: number, h: number) => OffscreenCanvas

function canResize(): boolean {
  return (
    typeof createImageBitmap === 'function' &&
    typeof (globalThis as { OffscreenCanvas?: CanvasCtor }).OffscreenCanvas === 'function'
  )
}

async function blobToBytes(blob: Blob): Promise<Uint8Array> {
  return new Uint8Array(await blob.arrayBuffer())
}

/**
 * Decode, optionally downscale (fit within MAX_DIMENSION, no enlargement) and
 * re-encode an image so the result stays under `maxBytes`. Falls back to the
 * original bytes when DOM imaging APIs are unavailable.
 */
export async function processImage(
  bytes: Uint8Array,
  mediaType: string,
  maxBytes: number
): Promise<ProcessedImage> {
  if (!canResize()) {
    if (bytes.length <= maxBytes) {
      return { data: bytesToBase64(bytes), media_type: mediaType }
    }
    return {
      data: bytesToBase64(bytes),
      media_type: mediaType,
      note: `Image is ${(bytes.length / (1024 * 1024)).toFixed(1)} MB and could not be resized in this runtime (no canvas). It may exceed model limits.`,
    }
  }

  try {
    const OffscreenCanvasCtor = (globalThis as { OffscreenCanvas: CanvasCtor }).OffscreenCanvas
    const srcBlob = new Blob([bytes as BlobPart], { type: mediaType })
    const bitmap = await createImageBitmap(srcBlob)
    const { width: ow, height: oh } = bitmap

    const needsResize =
      bytes.length > maxBytes || ow > MAX_DIMENSION || oh > MAX_DIMENSION
    if (!needsResize) {
      bitmap.close?.()
      return { data: bytesToBase64(bytes), media_type: mediaType, width: ow, height: oh }
    }

    // Keep alpha for PNG; otherwise prefer JPEG for better compression.
    const keepPng = mediaType === 'image/png'
    const outType = keepPng ? 'image/png' : 'image/jpeg'

    let scale = Math.min(1, MAX_DIMENSION / Math.max(ow, oh))
    let quality = 0.8
    let best: { data: Uint8Array; w: number; h: number } | null = null

    for (let attempt = 0; attempt < 6; attempt++) {
      const w = Math.max(1, Math.round(ow * scale))
      const h = Math.max(1, Math.round(oh * scale))
      const canvas = new OffscreenCanvasCtor(w, h)
      const cctx = canvas.getContext('2d')
      if (!cctx) break
      cctx.drawImage(bitmap as unknown as CanvasImageSource, 0, 0, w, h)
      const outBlob = await canvas.convertToBlob(
        outType === 'image/jpeg' ? { type: outType, quality } : { type: outType }
      )
      const outBytes = await blobToBytes(outBlob)
      best = { data: outBytes, w, h }
      if (outBytes.length <= maxBytes) break
      // Shrink further: drop quality first (jpeg), then scale.
      if (outType === 'image/jpeg' && quality > 0.4) quality -= 0.15
      else scale *= 0.75
    }

    bitmap.close?.()
    if (best) {
      return {
        data: bytesToBase64(best.data),
        media_type: outType,
        width: best.w,
        height: best.h,
        note: best.data.length > maxBytes ? 'Image still exceeds the size cap after downsampling.' : undefined,
      }
    }
  } catch {
    // fall through to pass-through below
  }

  return {
    data: bytesToBase64(bytes),
    media_type: mediaType,
    note: bytes.length > maxBytes ? 'Image could not be resized; passed through at original size.' : undefined,
  }
}
