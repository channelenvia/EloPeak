// Combina os PNGs redimensionados (icon-src/icon-<size>.png, gerados a
// partir do logo real do EloPeak em public/dark.png) num .ico multi-size.
const fs = require('fs')
const path = require('path')

async function main() {
  const srcDir = path.join(__dirname, '..', 'build', 'icon-src')
  const buildDir = path.join(__dirname, '..', 'build')
  const sizes = [256, 128, 64, 48, 32, 16]
  const pngBuffers = sizes.map((size) => fs.readFileSync(path.join(srcDir, `icon-${size}.png`)))

  fs.copyFileSync(path.join(srcDir, 'icon-256.png'), path.join(buildDir, 'icon.png'))

  const { default: pngToIco } = await import('png-to-ico')
  const icoBuffer = await pngToIco(pngBuffers)
  fs.writeFileSync(path.join(buildDir, 'icon.ico'), icoBuffer)

  console.log('Ícone (logo EloPeak) gerado em build/icon.ico e build/icon.png')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
