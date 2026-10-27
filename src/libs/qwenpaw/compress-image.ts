// Full-resolution tab screenshots routinely cross the channel's 5 MB cap
// once base64 inflation is counted, and relays in front of the service (frp
// gateways, web proxies) commonly cap request bodies near 1 MB. Anything
// above a comfortable margin is therefore re-encoded before upload: agents
// eyeballing a page do not need pixel-perfect captures. The original bytes
// stay as the fallback whenever re-encoding would not help.
export const COMPRESS_ABOVE = 3.5 * 1024 * 1024
export const MAX_EDGE = 2560
// Small enough that the base64 JSON body stays under a 1 MiB relay cap.
export const RELAY_SAFE_BYTES = 700_000

// Longest edge after downscale; never upscales.
export const fitEdges = (
  width: number,
  height: number,
  maxEdge: number
): { width: number; height: number } => {
  const factor = Math.min(1, maxEdge / Math.max(width, height))
  return {
    width: Math.max(1, Math.round(width * factor)),
    height: Math.max(1, Math.round(height * factor))
  }
}

interface Bitmap {
  width: number
  height: number
  close?: () => void
}

export interface ImageCodec {
  decode: (blob: Blob) => Promise<Bitmap>
  encode: (
    bitmap: Bitmap,
    width: number,
    height: number,
    quality: number
  ) => Promise<Blob>
}

// The side panel implementation; injectable so the policy stays testable
// without a DOM.
const domCodec: ImageCodec = {
  decode: (blob) => createImageBitmap(blob),
  encode: async (bitmap, width, height, quality) => {
    const canvas = document.createElement("canvas")
    canvas.width = width
    canvas.height = height
    canvas.getContext("2d")?.drawImage(bitmap as never, 0, 0, width, height)
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error("encode failed"))),
        "image/jpeg",
        quality
      )
    )
  }
}

// Each rung trades resolution for bytes; the last one still reads cleanly on
// a phone screen, which is plenty for a page overview.
const LADDER: Array<{ edge: number; quality: number }> = [
  { edge: MAX_EDGE, quality: 0.85 },
  { edge: 1600, quality: 0.75 },
  { edge: 1280, quality: 0.65 },
  { edge: 1024, quality: 0.55 }
]

export const compressScreenshotBlob = async (
  blob: Blob,
  codec: ImageCodec = domCodec,
  maxBytes = COMPRESS_ABOVE
): Promise<Blob> => {
  if (blob.size <= maxBytes) return blob
  const bitmap = await codec.decode(blob)
  try {
    let best: Blob | null = null
    for (const rung of LADDER) {
      const size = fitEdges(bitmap.width, bitmap.height, rung.edge)
      const encoded = await codec.encode(
        bitmap,
        size.width,
        size.height,
        rung.quality
      )
      if (!best || encoded.size < best.size) best = encoded
      if (best.size <= maxBytes) break
    }
    return best && best.size < blob.size ? best : blob
  } finally {
    bitmap.close?.()
  }
}

// Policy wrapper for the composer: images above the comfortable margin are
// re-encoded, everything else (and any compression failure) keeps its bytes
// and runs into the regular size gate unchanged.
export const compressImageFile = async (
  file: File,
  maxBytes = COMPRESS_ABOVE
): Promise<File> => {
  if (!file.type.startsWith("image/") || file.size <= maxBytes) return file
  try {
    const blob = await compressScreenshotBlob(file, undefined, maxBytes)
    if (blob === file) return file
    const name = file.name.replace(/\.[A-Za-z0-9]{1,8}$/, "") || "image"
    return new File([blob], `${name}.jpg`, {
      type: blob.type || "image/jpeg"
    })
  } catch {
    return file
  }
}
