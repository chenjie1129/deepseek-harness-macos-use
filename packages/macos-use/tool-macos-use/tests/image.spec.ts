/** Screenshot attachment normalization. */

import sharp from 'sharp'
import { describe, expect, it } from 'vitest'
import { fitPngToAttachmentLimits } from '../src/image.ts'

const LIMITS = {
  maxImageBytes: 3.5 * 1024 * 1024,
  maxImagesPerMessage: 20,
  maxMessageImageBytes: 100 * 1024 * 1024,
  maxImagePixels: 40_000_000,
  maxImageDimension: 2000,
  mediaTypes: ['image/png', 'image/jpeg', 'image/webp', 'image/gif'] as const,
}

describe('fitPngToAttachmentLimits', () => {
  it('downscales a Retina-sized desktop capture to the attachment dimension limit', async () => {
    const original = await sharp({
      create: { width: 3840, height: 2160, channels: 4, background: '#336699' },
    }).png().toBuffer()

    const fitted = await fitPngToAttachmentLimits(original, LIMITS)
    const metadata = await sharp(fitted).metadata()

    expect(metadata.width).toBe(2000)
    expect(metadata.height).toBe(1125)
    expect(fitted.byteLength).toBeLessThanOrEqual(LIMITS.maxImageBytes)
  })

  it('keeps an already admissible screenshot byte-for-byte', async () => {
    const original = await sharp({
      create: { width: 1200, height: 800, channels: 4, background: '#ffffff' },
    }).png().toBuffer()

    const fitted = await fitPngToAttachmentLimits(original, LIMITS)

    expect(fitted.equals(original)).toBe(true)
  })
})
