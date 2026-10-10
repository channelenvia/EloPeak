import { assert, assertEquals, assertNotEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'
import { Image } from 'https://deno.land/x/imagescript@1.3.0/mod.ts'
import { maskChampionImage } from './captchaImage.ts'
import { normalizeChampionName } from './championCatalog.ts'

async function sampleIcon(): Promise<Uint8Array> {
  const img = new Image(120, 120)
  for (let y = 1; y <= 120; y++) for (let x = 1; x <= 120; x++) img.setPixelAt(x, y, Image.rgbToColor(x * 2, y * 2, 128))
  return await img.encode()
}

Deno.test('maskChampionImage: saida PNG 168x168, determinística por semente e diferente entre sementes', async () => {
  const icon = await sampleIcon()
  const a1 = await maskChampionImage(icon, 123)
  const a2 = await maskChampionImage(icon, 123)
  const b = await maskChampionImage(icon, 124)
  const decoded = await Image.decode(a1) as Image
  assertEquals([decoded.width, decoded.height], [168, 168])
  assertEquals(a1, a2)
  assertNotEquals(a1, b)
})

Deno.test('maskChampionImage: a imagem mascarada difere da original redimensionada (hachura/ruido aplicados)', async () => {
  const icon = await sampleIcon()
  const plain = (await Image.decode(icon) as Image).resize(168, 168)
  const masked = await Image.decode(await maskChampionImage(icon, 7)) as Image
  let diff = 0
  for (let i = 0; i < plain.bitmap.length; i++) if (plain.bitmap[i] !== masked.bitmap[i]) diff++
  assert(diff > plain.bitmap.length * 0.2, `esperava >20% dos bytes alterados, veio ${diff}`)
})

Deno.test("normalizeChampionName: aceita maiusculas/acentos/apostrofos como o front (Kai'Sa == kaisa)", () => {
  assertEquals(normalizeChampionName("Kai'Sa"), 'kaisa')
  assertEquals(normalizeChampionName('  LeBlanc '), 'leblanc')
  assertEquals(normalizeChampionName('Nunu e Willump'), 'nunuewillump')
})
