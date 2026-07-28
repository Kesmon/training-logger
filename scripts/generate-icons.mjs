// Generates the PWA / apple-touch icons as real PNGs with no image dependency.
// Node's zlib is enough: a PNG is just a signature, an IHDR chunk, deflated
// RGBA scanlines in IDAT, and IEND. Run with `npm run icons`.
import { deflateSync } from 'node:zlib'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'icons')

const BG = [0x0b, 0x0d, 0x10]
const BAR = [0x9d, 0xa8, 0xb8] // steel
const PLATE = [0xff, 0x7a, 0x3d] // accent orange

// ---------------------------------------------------------------- PNG writer

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})

function crc32(buf) {
  let c = 0xffffffff
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crc])
}

/** @param {Uint8Array} rgba length = w*h*4 */
function encodePng(rgba, w, h) {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0)
  ihdr.writeUInt32BE(h, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // colour type: RGBA
  // 10..12 = compression, filter, interlace — all 0

  // Each scanline is prefixed with its filter byte (0 = None).
  const raw = Buffer.alloc(h * (w * 4 + 1))
  for (let y = 0; y < h; y++) {
    const src = y * w * 4
    const dst = y * (w * 4 + 1)
    raw[dst] = 0
    Buffer.from(rgba.buffer, rgba.byteOffset + src, w * 4).copy(raw, dst + 1)
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

// ------------------------------------------------------------------ drawing

/** Rounded-rect hit test in normalised artwork space. */
function inRoundedRect(x, y, x0, y0, x1, y1, r) {
  if (x < x0 || x > x1 || y < y0 || y > y1) return false
  const cx = Math.min(Math.max(x, x0 + r), x1 - r)
  const cy = Math.min(Math.max(y, y0 + r), y1 - r)
  const dx = x - cx
  const dy = y - cy
  return dx * dx + dy * dy <= r * r
}

// A barbell seen side-on: centre bar, two plates per side.
// Coordinates are normalised so the artwork spans x in [-1, 1].
function sample(x, y) {
  if (inRoundedRect(x, y, -0.62, -0.66, -0.42, 0.66, 0.07)) return PLATE
  if (inRoundedRect(x, y, 0.42, -0.66, 0.62, 0.66, 0.07)) return PLATE
  if (inRoundedRect(x, y, -0.9, -0.42, -0.72, 0.42, 0.06)) return PLATE
  if (inRoundedRect(x, y, 0.72, -0.42, 0.9, 0.42, 0.06)) return PLATE
  if (inRoundedRect(x, y, -1, -0.1, 1, 0.1, 0.05)) return BAR
  return null
}

/**
 * @param size  pixel dimensions (square)
 * @param scale fraction of the icon the artwork spans. Maskable icons need to
 *              sit inside the inner 80% safe zone, so they use a smaller value.
 */
function renderIcon(size, scale) {
  const rgba = new Uint8Array(size * size * 4)
  const SS = 4 // supersample factor, for antialiased edges
  const half = (size * scale) / 2
  const mid = size / 2

  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let r = 0
      let g = 0
      let b = 0
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const x = (px + (sx + 0.5) / SS - mid) / half
          const y = (py + (sy + 0.5) / SS - mid) / half
          const c = sample(x, y) ?? BG
          r += c[0]
          g += c[1]
          b += c[2]
        }
      }
      const n = SS * SS
      const i = (py * size + px) * 4
      rgba[i] = Math.round(r / n)
      rgba[i + 1] = Math.round(g / n)
      rgba[i + 2] = Math.round(b / n)
      rgba[i + 3] = 255 // opaque: iOS composites transparency onto black
    }
  }
  return encodePng(rgba, size, size)
}

const FAVICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <rect width="64" height="64" rx="12" fill="#0b0d10"/>
  <g fill="#ff7a3d">
    <rect x="18.2" y="10.9" width="6.4" height="42.2" rx="2.2"/>
    <rect x="39.4" y="10.9" width="6.4" height="42.2" rx="2.2"/>
    <rect x="9.3" y="18.6" width="5.8" height="26.8" rx="1.9"/>
    <rect x="48.9" y="18.6" width="5.8" height="26.8" rx="1.9"/>
  </g>
  <rect x="4.8" y="28.8" width="54.4" height="6.4" rx="1.6" fill="#9da8b8"/>
</svg>
`

mkdirSync(OUT, { recursive: true })
const targets = [
  ['icon-192.png', 192, 0.78],
  ['icon-512.png', 512, 0.78],
  ['icon-maskable-512.png', 512, 0.56],
  ['apple-touch-icon-180.png', 180, 0.74],
]
for (const [name, size, scale] of targets) {
  writeFileSync(join(OUT, name), renderIcon(size, scale))
  console.log(`  ${name}  ${size}x${size}`)
}
writeFileSync(join(OUT, 'favicon.svg'), FAVICON_SVG)
console.log('  favicon.svg')
