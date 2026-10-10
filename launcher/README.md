# EloPeak Booster Launcher

Aplicativo desktop (Windows) usado pelo booster para logar automaticamente
no Riot Client / League of Legends usando o token de acesso opaco emitido
pelo painel web (`JobDetail.tsx`, botão "Obter token de acesso" / "Mostrar
token"). O booster nunca vê login/senha em texto puro — nem no painel, nem
neste app: o processo principal do Electron resolve as credenciais e fala
com o Riot Client sozinho, o processo de UI (renderer) só recebe status.

## Como funciona

1. Booster clica "Vincular Discord" — mesmo fluxo OAuth do painel web
   (`LoginPage.tsx`; não existe conta com e-mail/senha neste produto). O app
   abre o navegador padrão do Windows no Discord, o booster autoriza, e um
   servidor HTTP local efêmero (`127.0.0.1:<porta aleatória>`) captura o
   retorno via PKCE (`?code=...`) e troca por uma sessão Supabase — nunca um
   WebView embutido, nunca lê o fragmento da URL.
2. Sessão fica salva localmente, cifrada via `safeStorage` do Electron
   (DPAPI no Windows) — não precisa logar de novo a cada abertura.
3. Booster cola o token copiado do painel e clica em "Entrar no jogo".
4. O app chama as Edge Functions já existentes no backend
   (`resolve-order-credentials` e `resolve-duo-account-credentials` — tenta
   as duas, pois o token é opaco e pode ser de uma conta do próprio cliente
   ou de uma conta Duo) para trocar o token por login/senha.
5. O app abre o Riot Client — via [Deceive](https://github.com/molenzwiebel/Deceive)
   (vendorizado em `vendor/deceive/`, `lol` como jogo alvo) quando disponível, pra
   já entrar com a presença de chat como offline sem perder chat/partida; se o
   binário não estiver presente, cai para o `--launch-product=league_of_legends`
   direto —, espera o `lockfile` local aparecer e envia as credenciais para a API
   REST local do próprio Riot Client (mesmo mecanismo que a tela de login dele usa
   internamente).
6. Se qualquer etapa falhar, o app mostra o erro e o booster tenta de novo —
   não há cópia manual de usuário/senha (nunca fica exposto, nem no clipboard).

## ⚠️ Avisos importantes

- **Automação do Riot Client** (passo 5): usa a API REST local do processo
  `RiotClientServices.exe`, **não documentada oficialmente pela Riot** —
  implementada com base em engenharia reversa amplamente replicada por
  ferramentas open source de troca de conta. Pode parar de funcionar se a
  Riot mudar o client. Isolado em `src/main/riotClient.ts`. Se a Riot exigir
  verificação adicional (captcha, e-mail, 2FA), o booster completa isso na
  própria janela do Riot Client — o app não tenta contornar.
- **Deceive** (passo 5): cria um ícone na bandeja do sistema (comportamento
  dele, não configurável por fora) e, no primeiro uso em cada máquina, pode
  mandar uma mensagem de boas-vindas no chat — não bloqueia o fluxo. Não
  testado ainda ponta a ponta contra um Riot Client/League real; se o login
  automático falhar só quando o Deceive está presente, comparar com
  `resolveDeceiveExecutable()` retornando `null` (fallback sem Deceive) pra
  isolar se o problema é dele ou do resto do fluxo.
- **Redirect URL do OAuth**: `http://127.0.0.1:*/callback` precisa estar
  liberado em Authentication → URL Configuration → Redirect URLs no projeto
  Supabase (produção). Se o login com Discord falhar com erro de "redirect
  not allowed", adicione essa URL lá.

## Setup

```bash
cd launcher
npm install
# crie config.json (ignorado pelo git; formato abaixo)
npm run build
npm start
```

`launcher/config.json` (embutido no instalador; só a anon key **pública**, nunca a service role):

```json
{
  "supabaseUrl": "https://<projeto>.supabase.co",
  "supabaseAnonKey": "<anon key pública>",
  "updateManifestUrl": "https://raw.githubusercontent.com/channelenvia/EloPeak-Launcher/main/update.json"
}
```

## Build do instalador (Windows)

```bash
npm run package
```

Gera instalador NSIS e versão portátil em `launcher/release/`. **Requer
Modo Desenvolvedor do Windows ativado** (Configurações → Privacidade e
segurança → Para desenvolvedores) — o electron-builder precisa extrair um
pacote de ferramentas que contém symlinks, e isso falha sem essa permissão.

Se não quiser ativar o Modo Desenvolvedor, dá pra gerar só a pasta
empacotada (sem instalador) e usar o `.exe` de dentro dela diretamente:

```bash
npm run icon
npm run build
npx cross-env CSC_IDENTITY_AUTO_DISCOVERY=false electron-builder --win dir
```

Isso ainda falha na etapa final de assinatura (não usada, sem certificado
configurado), mas o `.exe` empacotado em `dist/win-unpacked/` já sai
completo antes dessa etapa. Se `dist/win-unpacked` estiver com um arquivo
travado (`app.asar` em uso — comum logo após o antivírus escanear o build
anterior), aponte a saída pra uma pasta nova em vez de tentar limpar a
antiga:

```bash
npx cross-env CSC_IDENTITY_AUTO_DISCOVERY=false electron-builder --win dir -c.directories.output=dist_new
```

Pra aplicar o ícone customizado nesse caso (o passo de `rcedit` também é
pulado pela mesma falha), rode manualmente após extrair `rcedit-x64.exe` do
pacote `winCodeSign` (procedimento do electron-builder; só necessário nesse caminho sem Modo Desenvolvedor):

```bash
rcedit-x64.exe "dist/win-unpacked/Booster Launcher.exe" --set-icon "build/icon.ico"
```

## Terceiros

- **Deceive** (`vendor/deceive/Deceive.exe`, v1.18.0, GPLv3 — ver
  `vendor/deceive/LICENSE` e `vendor/deceive/NOTICE.md`): binário oficial sem
  modificações, invocado como processo separado. Só afeta a presença de chat
  ("online"/"offline") entre o Riot Client e o servidor de chat — a Riot já
  confirmou publicamente que usar o Deceive não gera banimento. Login, chat em
  partida e queue funcionam normalmente com ele ativo.

## Segurança

- Login/senha do jogo nunca trafegam para o processo de renderização (UI) —
  ficam só no processo main, em memória, e são descartados assim que o
  login automático termina (ou ao fechar o app). O campo do token é limpo
  após qualquer tentativa (sucesso ou erro) e ao sair da conta.
- Sessão do booster (refresh token) persiste cifrada via `safeStorage`
  (escrita atômica); nunca em texto puro. Sem criptografia disponível na
  máquina o login funciona, mas a sessão não é salva e a UI avisa. Nenhuma
  senha da EloPeak existe — login é só OAuth.
- Janela: `contextIsolation`, `sandbox`, `nodeIntegration: false`, DevTools
  só em desenvolvimento, CSP restritiva (`default-src 'none'`, sem rede no
  renderer), sem popups, sem navegação para fora do `index.html`, permissões
  do navegador negadas e uma única instância do app.
- IPC: todo handler confere que o remetente é o `index.html` do app e valida
  tipo/tamanho do token. Só um `openExternal` para URLs `https://`.
- OAuth: servidor local efêmero só atende `GET /callback` com
  `Host: 127.0.0.1:<porta>` (anti DNS-rebinding); requisições estranhas não
  encerram o login; o PKCE garante que um `code` de terceiros não troca por
  sessão. O `debug.log` só existe com `--dev` e nunca grava URL/`?code=`.
- Deceive: o `Deceive.exe` só executa se o SHA-256 bater com
  `src/main/integrity.ts` (senão abre o Riot Client direto). Ver
  `vendor/deceive/NOTICE.md` para atualizar.
- O Riot Client nunca é derrubado com o League aberto (o login pede para
  fechar o jogo antes). O preenchimento (PowerShell) morre por timeout de
  60 s ou ao fechar o app e apaga o que foi digitado se falhar no meio.
- `rejectUnauthorized: false` é usado só para a chamada HTTPS a
  `127.0.0.1` (API local do Riot Client, certificado autoassinado por
  design), com timeout de 5 s — nunca afeta nenhuma outra conexão do app.

## Aviso de nova versão

Não há auto-update (o instalador não é assinado). Em vez disso o app avisa
quando existe versão mais nova, lendo um manifesto JSON público definido em
`updateManifestUrl` no `config.json`. O instalador (~100 MB) fica nos **GitHub
Releases** do repositório público `channelenvia/EloPeak-Launcher` (o Storage
gratuito do Supabase limita arquivos a 50 MB) e o manifesto é o arquivo
`update.json` na branch `main` do mesmo repositório:

`updateManifestUrl` = `https://raw.githubusercontent.com/channelenvia/EloPeak-Launcher/main/update.json`

**Para publicar uma versão nova:**

1. Aumente `version` em `launcher/package.json`, rode `npm run package` e pegue o instalador em `release/`.
2. No repositório de releases: crie a release com a tag `v0.2.0` e anexe `Booster-Launcher-Setup-0.2.0.exe`
   (GitHub → Releases → *Draft a new release*; ou `gh release create v0.2.0 <arquivo> -R channelenvia/EloPeak-Launcher`).
3. Só depois, atualize `update.json` na `main` (mesmo formato abaixo):

```json
{ "version": "0.2.0", "url": "https://github.com/channelenvia/EloPeak-Launcher/releases/download/v0.2.0/Booster-Launcher-Setup-0.2.0.exe", "notes": "o que mudou" }
```

(o `raw.githubusercontent.com` guarda cache por ~5 min; o aviso pode demorar esse tempo a aparecer).

Quem tem versão menor vê o aviso "Nova versão disponível" com o botão
**Baixar** (abre o link no navegador). Regras de segurança: manifesto e `url`
do instalador precisam ser `https`; o instalador só é aceito em
`https://github.com/channelenvia/EloPeak-Launcher/releases/download/…`
(host e caminho comparados na URL já normalizada, sem porta/usuário/dot-segments;
constantes em `src/main/updateCheck.ts`); redirecionamentos do manifesto são
recusados; o app nunca baixa nem executa nada sozinho. Sem manifesto (404) ou
sem `updateManifestUrl` nada aparece. **Quem controla esse repositório controla
o que os boosters instalam**: ative 2FA nas contas com acesso de escrita.

## Testes e verificação

- Lógica pura (callback do OAuth, mensagens de erro, versão, hash do Deceive)
  tem testes em `../shared/launcher*.test.ts` (rodam no `npm test` da raiz).
- `npm run typecheck` e `npm run build` rodam na CI (job `launcher`).
- Login automático ponta a ponta (PowerShell, Riot Client, Deceive) só pode
  ser verificado em Windows com o Riot Client instalado: antes de distribuir
  uma versão nova, faça um login completo, um com token inválido e um com o
  League aberto.
