/** Screenshot normalization for durable attachment storage. */

import { Buffer } from 'node:buffer'
import type { ImageAttachmentLimits } from '@deepseek-ai/dsh-attachment'
import sharp from 'sharp'
import {
  LIVE_PREVIEW_MAX_BYTES,
  LIVE_PREVIEW_MAX_DIMENSION,
  type LiveScreenshotPreview,
} from './progress.ts'

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

/**
 * Produce a small lossy preview for live UI polling. The original PNG remains
 * the GUI model's grounding input and the durable attachment's source.
 * @param pngBase64 - source PNG encoded without a data-URL prefix.
 * @returns bounded JPEG preview metadata and its process-local data URL.
 */
export async function createLiveScreenshotPreview(pngBase64: string): Promise<LiveScreenshotPreview> {
  const input = Buffer.from(pngBase64, 'base64')
  const metadata = await sharp(input, { failOn: 'error', limitInputPixels: false }).metadata()
  const sourceWidth = metadata.width
  const sourceHeight = metadata.height
  if (sourceWidth < 1 || sourceHeight < 1) {
    throw new Error('Screenshot dimensions could not be determined.')
  }
  let width = Math.max(1, Math.round(sourceWidth * Math.min(
    1,
    LIVE_PREVIEW_MAX_DIMENSION / sourceWidth,
    LIVE_PREVIEW_MAX_DIMENSION / sourceHeight,
  )))
  let height = Math.max(1, Math.round(sourceHeight * Math.min(
    1,
    LIVE_PREVIEW_MAX_DIMENSION / sourceWidth,
    LIVE_PREVIEW_MAX_DIMENSION / sourceHeight,
  )))
  let output = Buffer.alloc(0)
  for (let pass = 0; pass < MAX_RESIZE_PASSES; pass += 1) {
    output = await sharp(input, { failOn: 'error', limitInputPixels: false })
      .resize({ width, height, fit: 'fill' })
      .jpeg({ quality: Math.max(35, 72 - pass * 7), mozjpeg: true })
      .toBuffer()
    if (output.byteLength <= LIVE_PREVIEW_MAX_BYTES) break
    const scale = Math.min(0.85, Math.sqrt(LIVE_PREVIEW_MAX_BYTES / output.byteLength) * 0.9)
    width = Math.max(1, Math.floor(width * scale))
    height = Math.max(1, Math.floor(height * scale))
  }
  if (output.byteLength > LIVE_PREVIEW_MAX_BYTES) {
    throw new Error('Screenshot could not be reduced to the live-preview byte limit.')
  }
  return {
    dataUrl: `data:image/jpeg;base64,${output.toString('base64')}`,
    mediaType: 'image/jpeg',
    bytes: output.byteLength,
    width,
    height,
  }
}
