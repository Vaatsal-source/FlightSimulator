// Builds public/models/f22/f22.glb from the original Sketchfab download in assets-src/f22-raptor:
// the three 4096 px PNG textures (23 MB) become small JPEGs, everything is packed into one GLB.
// Run: node scripts/prepare-f22.mjs   (needs the dev dependency `sharp`)
import fs from 'node:fs'
import path from 'node:path'
import sharp from 'sharp'

const SRC = 'assets-src/f22-raptor'
const OUT = 'public/models/f22'
const gltf = JSON.parse(fs.readFileSync(path.join(SRC, 'scene.gltf'), 'utf8'))
const bin = fs.readFileSync(path.join(SRC, 'scene.bin'))

// Target size and quality per texture (by file name part).
const PLAN = { baseColor: [2048, 84], metallicRoughness: [1024, 80], normal: [1024, 86] }

const chunks = [bin]
let offset = bin.length
const pad = (n) => (4 - (n % 4)) % 4
const pushBuffer = (buf) => {
  const p = pad(offset)
  if (p) {
    chunks.push(Buffer.alloc(p))
    offset += p
  }
  const view = { buffer: 0, byteOffset: offset, byteLength: buf.length }
  chunks.push(buf)
  offset += buf.length
  gltf.bufferViews.push(view)
  return gltf.bufferViews.length - 1
}

for (const img of gltf.images) {
  const key = Object.keys(PLAN).find((k) => img.uri.includes(k))
  const [size, quality] = PLAN[key]
  const jpg = await sharp(path.join(SRC, decodeURIComponent(img.uri))).resize(size, size).jpeg({ quality, mozjpeg: true }).toBuffer()
  console.log(img.uri, '->', (jpg.length / 1024).toFixed(0), 'kB')
  delete img.uri
  img.mimeType = 'image/jpeg'
  img.bufferView = pushBuffer(jpg)
}

const body = Buffer.concat(chunks)
const tail = Buffer.alloc(pad(body.length))
gltf.buffers = [{ byteLength: body.length + tail.length }]
const json = Buffer.from(JSON.stringify(gltf))
const jsonPad = Buffer.alloc(pad(json.length), 0x20)
const total = 12 + 8 + json.length + jsonPad.length + 8 + body.length + tail.length
const head = Buffer.alloc(12)
head.writeUInt32LE(0x46546c67, 0)
head.writeUInt32LE(2, 4)
head.writeUInt32LE(total, 8)
const jh = Buffer.alloc(8)
jh.writeUInt32LE(json.length + jsonPad.length, 0)
jh.writeUInt32LE(0x4e4f534a, 4)
const bh = Buffer.alloc(8)
bh.writeUInt32LE(body.length + tail.length, 0)
bh.writeUInt32LE(0x004e4942, 4)

fs.mkdirSync(OUT, { recursive: true })
fs.writeFileSync(path.join(OUT, 'f22.glb'), Buffer.concat([head, jh, json, jsonPad, bh, body, tail]))
fs.copyFileSync(path.join(SRC, 'license.txt'), path.join(OUT, 'LICENSE.txt'))
console.log('wrote', path.join(OUT, 'f22.glb'), (total / 1048576).toFixed(1), 'MB')
