// Full-resolution tab screenshots routinely cross the channel's 5 MB cap
// once base64 inflation is counted, so anything above a comfortable margin
// is re-encoded smaller before upload. Agent eyeballing a page does not need
// pixel-perfect captures: screen-reader resolution JPEG is enough, and the
// original bytes stay as the fallback whenever re-encoding would not help.
export const COMPRESS_ABOVE = 3.5 * 1024 * 1024
export const MAX_EDGE = 2560

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
  encode: (bitmap: Bitmap, width: number, height: number) => Promise<Blob>
}

// The side panel implementation; injectable so the policy stays testable
// without a DOM.
const domCodec: ImageCodec = {
  decode: (blob) => createImageBitmap(blob),
  encode: async (bitmap, width, height) => {
    const canvas = document.createElement("canvas")
    canvas.width = width
    canvas.height = height
    canvas.getContext("2d")?.drawImage(bitmap as never, 0, 0, width, height)
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error("encode failed"))),
        "image/jpeg",
        0.85
      )
    )
  }
}

export const compressScreenshotBlob = async (
  blob: Blob,
  codec: ImageCodec = domCodec
): Promise<Blob> => {
  if (blob.size <= COMPRESS_ABOVE) return blob
  const bitmap = await codec.decode(blob)
  try {
    for (const maxEdge of [MAX_EDGE, 1280]) {
      const size = fitEdges(bitmap.width, bitmap.height, maxEdge)
      const encoded = await codec.encode(bitmap, size.width, size.height)
      if (encoded.size <= COMPRESS_ABOVE || maxEdge === 1280)
        return encoded.size < blob.size ? encoded : blob
    }
    return blob
  } finally {
    bitmap.close?.()
  }
}

// Policy wrapper for the composer: images above the comfortable margin are
// re-encoded, everything else (and any compression failure) keeps its bytes
// and runs into the regular size gate unchanged.
export const compressImageFile = async (file: File): Promise<File> => {
  if (!file.type.startsWith("image/") || file.size <= COMPRESS_ABOVE)
    return file
  try {
    const blob = await compressScreenshotBlob(file)
    if (blob === file) return file
    const name = file.name.replace(/\.[A-Za-z0-9]{1,8}$/, "") || "image"
    return new File([blob], `${name}.jpg`, {
      type: blob.type || "image/jpeg"
    })
  } catch {
    return file
  }
}
