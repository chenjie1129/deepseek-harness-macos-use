/** Screenshot normalization for durable attachment storage. */

import { Buffer } from 'node:buffer'
import type { ImageAttachmentLimits } from '@deepseek-ai/dsh-attachment'
import sharp from 'sharp'

const MAX_RESIZE_PASSES = 6

function boundedScale(width: number, height: number, bytes: number, limits: ImageAttachmentLimits): number {
  const dimensionScale = Math.min(
    1,
    limits.maxImageDimension / width,
    limits.maxImageDimension / height,
    Math.sqrt(limits.maxImagePixels / (width * height)),
  )
  if (bytes <= limits.maxImageBytes) return dimensionScale
  return Math.min(dimensionScale, Math.sqrt(limits.maxImageBytes / bytes) * 0.9)
}

/**
 * Downscale a PNG only when the active attachment backend would reject its dimensions, pixels, or encoded bytes.
 * The task loop keeps the original capture for GUI grounding so action coordinates are not changed.
 * @param data - original PNG bytes from the desktop or browser screenshot service.
 * @param limits - deployment-resolved durable attachment limits.
 * @returns original bytes when already admissible, otherwise a resized PNG.
 */
export async function fitPngToAttachmentLimits(
  data: Uint8Array,
  limits: ImageAttachmentLimits,
): Promise<Buffer> {
  const input = Buffer.from(data)
  const metadata = await sharp(input, { failOn: 'error', limitInputPixels: false }).metadata()
  const width = metadata.width
  const height = metadata.height
  if (width < 1 || height < 1) {
    throw new Error('Screenshot dimensions could not be determined.')
  }

  let scale = boundedScale(width, height, input.byteLength, limits)
  if (scale >= 1 && input.byteLength <= limits.maxImageBytes) return input

  let output = input
  for (let pass = 0; pass < MAX_RESIZE_PASSES; pass++) {
    const targetWidth = Math.max(1, Math.floor(width * scale))
    const targetHeight = Math.max(1, Math.floor(height * scale))
    output = await sharp(input, { failOn: 'error', limitInputPixels: false })
      .resize({ width: targetWidth, height: targetHeight, fit: 'fill' })
      .png({ compressionLevel: 9 })
      .toBuffer()
    if (output.byteLength <= limits.maxImageBytes) return output
    scale *= Math.min(0.9, Math.sqrt(limits.maxImageBytes / output.byteLength) * 0.9)
  }
  return output
}
