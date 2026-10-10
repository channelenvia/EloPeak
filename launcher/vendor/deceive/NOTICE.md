# Deceive (third-party binary)

`Deceive.exe` neste diretório é o binário oficial, sem modificações, do projeto
[Deceive](https://github.com/molenzwiebel/Deceive) (molenzwiebel), versão
`v1.18.0`, baixado de:

https://github.com/molenzwiebel/Deceive/releases/download/v1.18.0/Deceive.exe

SHA-256: `25dc5427affed66aa38ec1d9103ffa1a47256dab4e698bef32543fbf0cf3d2e5`
(confere com o digest publicado pela API de releases do GitHub para este asset).

Licenciado sob GPLv3 — ver `LICENSE` neste diretório. Código-fonte correspondente
disponível em https://github.com/molenzwiebel/Deceive/tree/v1.18.0.

O Booster Launcher invoca este executável como processo separado (via
`child_process.spawn`) — não há vínculo estático nem modificação do binário.

Ao atualizar a versão vendorizada, atualizar a tag/URL/SHA-256 acima **e** `DECEIVE_SHA256` em
`launcher/src/main/integrity.ts`: o launcher só executa o Deceive se o arquivo bater com esse hash, e o teste
`shared/launcherIntegrity.test.ts` falha se os dois divergirem.
