import { Image } from 'https://deno.land/x/imagescript@1.3.0/mod.ts'

// Mascara a imagem do campeao para o captcha de aceite: recorte aleatorio, rotacao, pixelizacao,
// hachura colorida e ruido. A semente vem do banco (por desafio), entao o mesmo desafio rende a mesma imagem.
const OUTPUT_SIZE = 168
const PIXEL_BLOCKS = 56

function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6D2B79F5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export async function maskChampionImage(source: Uint8Array, seed: number): Promise<Uint8Array> {
  const decoded = await Image.decode(source)
  const img = decoded as Image
  const rnd = mulberry32(seed)

  const side = Math.min(img.width, img.height)
  const crop = Math.max(8, Math.floor(side * (0.62 + rnd() * 0.2)))
  const x = Math.floor(rnd() * (img.width - crop + 1))
  const y = Math.floor(rnd() * (img.height - crop + 1))
  img.crop(x, y, crop, crop)
  img.resize(OUTPUT_SIZE, OUTPUT_SIZE)
  img.rotate((rnd() - 0.5) * 12, false)

  // pixeliza (desce e sobe com vizinho mais proximo)
  img.resize(PIXEL_BLOCKS, PIXEL_BLOCKS, Image.RESIZE_NEAREST_NEIGHBOR)
  img.resize(OUTPUT_SIZE, OUTPUT_SIZE, Image.RESIZE_NEAREST_NEIGHBOR)

  const period = 7 + Math.floor(rnd() * 4)
  const thickness = 2 + Math.floor(rnd() * 2)
  const phase = Math.floor(rnd() * period)
  const hatch = [Math.floor(rnd() * 255), Math.floor(rnd() * 255), Math.floor(rnd() * 255)]
  const bitmap = img.bitmap
  for (let py = 0; py < img.height; py++) {
    for (let px = 0; px < img.width; px++) {
      const i = (py * img.width + px) * 4
      if (((px + py + phase) % period) < thickness) {
        for (let c = 0; c < 3; c++) bitmap[i + c] = Math.round(bitmap[i + c] * 0.35 + hatch[c] * 0.65)
      } else if (rnd() < 0.16) {
        const delta = Math.floor((rnd() - 0.5) * 80)
        for (let c = 0; c < 3; c++) bitmap[i + c] = Math.max(0, Math.min(255, bitmap[i + c] + delta))
      }
    }
  }
  return await img.encode(1)
}
