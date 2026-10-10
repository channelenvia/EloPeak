import { DECEIVE_SHA256, isTrustedFile } from './integrity'
import { app } from 'electron'
import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync, unlinkSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID, createHash } from 'node:crypto'
import https from 'node:https'

// ── Automação do Riot Client (não-oficial) ─────────────────────────────────
// A Riot bloqueia (com "auth_failure" genérico, mesmo com usuário/senha
// corretos) o envio direto de credenciais pela API REST local não-documentada
// do Riot Client (PUT /rso-auth/v1/session/credentials) — esse caminho, usado
// por várias ferramentas de troca de conta mais antigas, parece ter sido
// fechado propositalmente contra automação. Login manual na mesma janela,
// com as mesmas credenciais, funciona normalmente.
//
// Por isso o login automático aqui não fala com esse endpoint de credenciais:
// ele simula clique de mouse + digitação de verdade na janela do Riot
// Client, como um booster faria na mão — só que o booster nunca vê o texto,
// porque quem digita é o processo main do Electron. A confirmação de que o
// login deu certo usa só a parte somente-leitura da API local (POST
// /rso-auth/v2/authorizations, que devolve o estado atual da sessão), que
// continua funcionando normalmente — o bloqueio da Riot é especificamente na
// submissão de credenciais via API, não nessa consulta de estado nem na
// janela real.
//
// O Riot Client mantém a árvore de acessibilidade do Windows desligada
// nessa tela (confirmado até com o Narrador do Windows, sem ser via nosso
// código) — provavelmente proposital, contra automação. Por isso não dá pra
// "achar" os campos via UI Automation (SetValue/Invoke): em vez disso a
// janela é localizada pelo processo dono dela (RiotClientUx.exe /
// RiotClientUxRender.exe / RiotClientServices.exe) via EnumWindows, e o
// preenchimento clica de verdade (SetCursorPos + SendInput) nas posições
// onde os campos de usuário/senha e o botão de entrar ficam — calculadas
// como proporção do tamanho da janela (relX/relY medidos contra uma
// captura de tela da janela de login), não pixels fixos de tela, pra
// tolerar a janela em qualquer posição/monitor. Um clique de
// verdade dá foco real ao campo (diferente de só ativar a janela), e só
// depois disso a digitação (via SendInput — ver comentário mais abaixo,
// perto de TypeUnicodeText) funciona.
//
// Não existe documentação oficial da Riot pra nenhuma dessas partes — o
// comportamento é baseado em engenharia reversa amplamente replicada por
// ferramentas de troca de conta open source. Se a Riot mudar o layout da
// tela de login, as proporções abaixo (relX/relY) são o único lugar que
// precisa de ajuste.
//
// Como o preenchimento roda na máquina do próprio booster (fora do nosso
// controle), um processo já rodando em segundo plano (não precisa de mouse
// nem teclado — é só uma chamada de API de outro processo pra outro) pode
// suspender o script exatamente no timing certo e ler usuário/senha
// enquanto ele fica parado, além do campo de usuário ficar visível na tela
// sem máscara (a Riot não mascara esse campo). Três defesas cobrem isso,
// todas no LOGIN_SCRIPT: um overlay opaco (EloBoostNativeWin.CreateOverlay)
// tapa cada campo ANTES de digitar nele — nunca depois, porque um processo
// suspenso não executa nenhuma linha pra reagir depois do fato, então se o
// overlay só subisse depois de digitar, uma suspensão bem cronometrada
// pegaria o texto sem cobertura nenhuma; BlockInput trava mouse/teclado do
// Windows inteiro durante o preenchimento, então o booster não consegue
// interagir (clicar, digitar) nesse intervalo por conta própria; e um
// watchdog de tempo de parede (Confirm-NotTampered/$criticalWatch) aborta o
// login e limpa os campos se a seção crítica (do primeiro clique até o
// "Entrar") demorar mais do que uma pausa deliberada exigiria. Isso reduz
// bastante a janela de exposição, mas não elimina o risco por completo:
// BlockInput não bloqueia Ctrl+Alt+Del (é desenhado pelo próprio Windows
// pra nunca poder ser bloqueado por nenhum app) nem impede outro processo
// de suspender o nosso via API diretamente — é exatamente esse caminho que
// o overlay-antes-de-digitar e o watchdog de timing cobrem. Enquanto o
// preenchimento acontece numa máquina que o
// booster controla, não existe garantia criptográfica contra alguém
// suficientemente instrumentado (ex.: um driver de kernel próprio pra
// capturar input, fora do que dá pra defender por software).

const LOCKFILE_PATH = join(
  process.env.LOCALAPPDATA ?? '',
  'Riot Games', 'Riot Client', 'Config', 'lockfile',
)

const RIOT_CLIENT_INSTALLS_PATH = join(
  process.env.PROGRAMDATA ?? 'C:\\ProgramData',
  'Riot Games', 'RiotClientInstalls.json',
)

const FALLBACK_PATHS = [
  'C:\\Riot Games\\Riot Client\\RiotClientServices.exe',
]

// Compilar o helper nativo (classe C# abaixo) via Add-Type -TypeDefinition
// custa várias centenas de ms a mais de um segundo (invoca o compilador do
// .NET Framework num processo powershell.exe novo, sem nenhum estado
// aquecido) — isso pesa muito mais no tempo total do login do que qualquer
// um dos Start-Sleep ajustados no LOGIN_SCRIPT. Por isso compilamos essa
// classe uma única vez (ver prewarmNativeHelper, chamado na abertura do
// Booster Launcher) e cacheamos o .dll aqui; da segunda execução em diante
// (inclusive entre reaberturas do app) o LOGIN_SCRIPT só faz Add-Type -Path,
// que é só carregar um assembly já compilado — muito mais rápido.
const NATIVE_HELPER_DIR = join(process.env.LOCALAPPDATA ?? tmpdir(), 'EloBoostBoosterLauncher')

// Janela total de espera pela confirmação do login (poll da API somente-
// leitura) e intervalo entre cada consulta.
// O proprio script aborta (START_TOO_LATE) se a espera pela janela passar disso, ANTES de travar mouse/teclado.
const SCRIPT_START_DEADLINE_MS = 40_000
const LOGIN_CONFIRMATION_TIMEOUT_MS = 25_000
const AUTH_POLL_INTERVAL_MS = 75
const LOCAL_API_TIMEOUT_MS = 5_000

interface LockfileInfo {
  port: string
  password: string
}

export interface AutoLoginResult {
  ok: boolean
  step: string
  error?: string
  leagueLaunched?: boolean
}

// ── Deceive (proxy de presença) ─────────────────────────────────────────────
// Deceive (https://github.com/molenzwiebel/Deceive, binário vendorizado em
// vendor/deceive/) senta entre o Riot Client e o servidor de chat e reescreve
// só a presença ("online"/"offline") — login, partida e chat continuam
// funcionando normalmente. A Riot já confirmou publicamente que usar o
// Deceive não gera banimento. Por isso, sempre que formos nós a abrir o Riot
// Client (cold start), abrimos via Deceive em vez do executável direto — se o
// binário não estiver presente por algum motivo (build sem vendor, path
// errado), cai pro spawn direto de sempre, sem travar o login.
const trustedDeceivePaths = new Set<string>()
const rejectedDeceivePaths = new Set<string>()

function resolveDeceiveExecutable(): string | null {
  const path = app.isPackaged
    ? join(process.resourcesPath, 'vendor', 'Deceive.exe')
    : join(__dirname, '..', '..', 'vendor', 'deceive', 'Deceive.exe')
  if (!existsSync(path)) return null
  if (trustedDeceivePaths.has(path)) return path
  if (rejectedDeceivePaths.has(path)) return null
  // Nunca executa um binario que nao bate com o hash vendorizado: cai no spawn direto do Riot Client (sem Deceive).
  if (!isTrustedFile(path, DECEIVE_SHA256)) {
    rejectedDeceivePaths.add(path)
    console.error('Deceive.exe não confere com o hash esperado -- ignorado. Reinstale o launcher.')
    return null
  }
  trustedDeceivePaths.add(path)
  return path
}

// `lol` diz pro Deceive qual jogo abrir sozinho (equivalente ao que
// findRiotClientExecutable + spawn fariam), evitando o seletor interativo
// "qual jogo abrir" que ele mostra sem argumento nenhum. `fallbackArgs` só é
// usado se o Deceive não estiver disponível — mantém o comportamento de
// sempre de cada chamador (prelaunch sem args, login com --launch-product).
function launchRiotClient(executable: string, fallbackArgs: string[]): void {
  const deceiveExecutable = resolveDeceiveExecutable()
  if (deceiveExecutable) {
    spawn(deceiveExecutable, ['lol'], {
      detached: true,
      stdio: 'ignore',
      cwd: dirname(deceiveExecutable),
    }).unref()
    return
  }
  spawn(executable, fallbackArgs, { detached: true, stdio: 'ignore' }).unref()
}

const GAME_PROCESS_IMAGES = ['League of Legends.exe', 'LeagueClient.exe']

export class GameRunningError extends Error {
  constructor() {
    super('O League of Legends está aberto. Feche o jogo antes de entrar com outra conta e tente de novo.')
    this.name = 'GameRunningError'
  }
}

const SYSTEM32 = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32')
const TASKLIST = join(SYSTEM32, 'tasklist.exe')
const TASKKILL = join(SYSTEM32, 'taskkill.exe')
const PROCESS_TOOL_TIMEOUT_MS = 5_000

// Fail-closed: se nao der para listar os processos, assume que o jogo pode estar aberto (nunca derruba o Riot Client no escuro).
function isAnyProcessRunning(images: string[]): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn(TASKLIST, ['/FO', 'CSV', '/NH'], { stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true })
    const timer = setTimeout(() => { try { child.kill() } catch { /* ja saiu */ } resolve(true) }, PROCESS_TOOL_TIMEOUT_MS)
    let stdout = ''
    child.stdout.on('data', (chunk) => { stdout += chunk.toString() })
    child.on('error', () => { clearTimeout(timer); resolve(true) })
    child.on('close', () => {
      clearTimeout(timer)
      const lower = stdout.toLowerCase()
      resolve(images.some((image) => lower.includes(`"${image.toLowerCase()}"`)))
    })
  })
}

function isDeceiveRunning(): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn(TASKLIST, ['/FI', 'IMAGENAME eq Deceive.exe', '/FO', 'CSV', '/NH'], {
      stdio: ['ignore', 'pipe', 'ignore'],
      windowsHide: true,
    })
    let stdout = ''
    child.stdout.on('data', (chunk) => { stdout += chunk.toString() })
    child.on('error', () => resolve(false))
    child.on('close', () => resolve(stdout.toLowerCase().includes('deceive.exe')))
  })
}

const RIOT_CLIENT_PROCESS_IMAGES = [
  'RiotClientServices.exe',
  'RiotClientUx.exe',
  'RiotClientUxRender.exe',
  'RiotClientCrashHandler.exe',
]

// Se o Riot Client já está de pé mas sem o Deceive rodando (ex.: booster
// deixou aberto de uma sessão/teste anterior, aberto manualmente, etc.), a
// presença dele já conectou direto no servidor de chat real — reabrir por
// cima não muda isso, então derrubamos os processos do Riot Client pra forçar
// um cold start real na próxima chamada de launchRiotClient (dessa vez via
// Deceive). Só derruba RiotClientServices/Ux/CrashHandler — nunca o próprio
// League, que pode estar em uso de uma sessão anterior.
function killRiotClientProcesses(): Promise<void> {
  return Promise.all(
    RIOT_CLIENT_PROCESS_IMAGES.map(
      (image) =>
        new Promise<void>((resolve) => {
          const child = spawn(TASKKILL, ['/F', '/IM', image], { stdio: 'ignore', windowsHide: true })
          child.on('error', () => resolve())
          child.on('close', () => resolve())
        }),
    ),
  ).then(() => undefined)
}

// Garante que a próxima verificação de "já está rodando" (readLockfile) não
// veja o lockfile antigo — taskkill mata o processo, mas o arquivo em si só
// some quando o processo sai normalmente; forçamos a remoção aqui.
async function restartRiotClientWithoutDeceive(): Promise<void> {
  // Derrubar o Riot Client com uma partida em andamento fecharia o jogo do booster. Nesse caso para e explica.
  if (await isAnyProcessRunning(GAME_PROCESS_IMAGES)) {
    throw new GameRunningError()
  }
  await killRiotClientProcesses()
  try { unlinkSync(LOCKFILE_PATH) } catch { /* já pode não existir */ }
}

function findRiotClientExecutable(manualPath?: string | null): string | null {
  if (manualPath && existsSync(manualPath)) return manualPath

  if (existsSync(RIOT_CLIENT_INSTALLS_PATH)) {
    try {
      const installs = JSON.parse(readFileSync(RIOT_CLIENT_INSTALLS_PATH, 'utf-8')) as Record<string, string>
      const candidate = installs.rc_live ?? installs.rc_default ?? Object.values(installs)[0]
      if (candidate && existsSync(candidate)) return candidate
    } catch {
      // arquivo corrompido/ausente — cai para os caminhos padrão abaixo
    }
  }

  return FALLBACK_PATHS.find((path) => existsSync(path)) ?? null
}

function readLockfile(): LockfileInfo | null {
  if (!existsSync(LOCKFILE_PATH)) return null
  const raw = readFileSync(LOCKFILE_PATH, 'utf-8').trim()
  const parts = raw.split(':')
  if (parts.length < 5) return null
  return { port: parts[2], password: parts[3] }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function waitForLockfile(timeoutMs: number): Promise<LockfileInfo> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const info = readLockfile()
    if (info) return info
    await sleep(25)
  }
  throw new Error('O Riot Client não iniciou a tempo.')
}

// Chamada HTTPS local com certificado autoassinado (só para 127.0.0.1 — não
// afeta a validação de TLS em nenhuma outra parte do app).
function localApiRequest(
  lockfile: LockfileInfo,
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const payload = body !== undefined ? JSON.stringify(body) : undefined
    const req = https.request(
      {
        host: '127.0.0.1',
        port: lockfile.port,
        path,
        method,
        rejectUnauthorized: false,
        headers: {
          Authorization: `Basic ${Buffer.from(`riot:${lockfile.password}`).toString('base64')}`,
          'Content-Type': 'application/json',
          ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
        },
      },
      (res) => {
        let data = ''
        res.on('data', (chunk) => { data += chunk })
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body: data }))
      },
    )
    // Sem timeout a chamada podia ficar pendurada para sempre se o Riot Client travasse.
    req.setTimeout(LOCAL_API_TIMEOUT_MS, () => req.destroy(new Error('Riot Client local API timeout')))
    req.on('error', reject)
    if (payload) req.write(payload)
    req.end()
  })
}

// Clica de verdade (SetCursorPos + SendInput) nas posições do formulário
// de login do Riot Client, calculadas como proporção do tamanho da janela
// (não pixels fixos de tela). Ver comentário no topo do arquivo pro porquê
// de não dar pra usar UI Automation aqui.
//
// Nunca recebe as credenciais como argumento de linha de comando (ficariam
// visíveis pra qualquer processo que liste a linha de comando de outros
// processos, ex.: Gerenciador de Tarefas) — em vez disso lê as duas pela
// stdin do processo powershell.exe. O script em si não tem segredo nenhum.
// Fonte do helper nativo — usada tanto pra compilar o .dll cacheado com
// antecedência (prewarmNativeHelper) quanto como fallback inline no
// LOGIN_SCRIPT, caso o cache não exista ou esteja corrompido.
const NATIVE_TYPE_SOURCE = `
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;

public class EloBoostNativeWin {
  public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

  public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }

  [DllImport("user32.dll")]
  public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);

  [DllImport("user32.dll")]
  public static extern bool IsWindowVisible(IntPtr hWnd);

  [DllImport("user32.dll")]
  public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);

  [DllImport("user32.dll")]
  public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);

  [DllImport("user32.dll")]
  public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);

  [DllImport("user32.dll")]
  public static extern bool SetCursorPos(int x, int y);

  [DllImport("user32.dll")]
  public static extern bool SetProcessDPIAware();

  [DllImport("user32.dll")]
  public static extern bool SetForegroundWindow(IntPtr hWnd);

  [DllImport("user32.dll")]
  public static extern bool BringWindowToTop(IntPtr hWnd);

  [DllImport("user32.dll")]
  public static extern IntPtr GetForegroundWindow();

  [DllImport("user32.dll")]
  public static extern bool AttachThreadInput(uint idAttach, uint idAttachTo, bool fAttach);

  [DllImport("kernel32.dll")]
  public static extern uint GetCurrentThreadId();

  const int SW_RESTORE = 9;

  // ── SendInput (clique + digitação) ──────────────────────────────────────
  // BlockInput (ver mais abaixo) só deixa passar input sintético gerado pela
  // MESMA thread que chamou BlockInput(true), e a exceção documentada da
  // Microsoft é especificamente pra SendInput — não pro par antigo
  // mouse_event/keybd_event nem pro SendKeys do .NET (que historicamente usa
  // um "journal hook" de reprodução, um mecanismo totalmente diferente). Por
  // isso ClickAt e a digitação abaixo usam SendInput em vez dessas duas
  // alternativas mais simples que o resto do arquivo usava antes.
  [StructLayout(LayoutKind.Sequential)]
  private struct MOUSEINPUT {
    public int dx;
    public int dy;
    public uint mouseData;
    public uint dwFlags;
    public uint time;
    public IntPtr dwExtraInfo;
  }

  [StructLayout(LayoutKind.Sequential)]
  private struct KEYBDINPUT {
    public ushort wVk;
    public ushort wScan;
    public uint dwFlags;
    public uint time;
    public IntPtr dwExtraInfo;
  }

  [StructLayout(LayoutKind.Explicit)]
  private struct INPUT_UNION {
    [FieldOffset(0)] public MOUSEINPUT mi;
    [FieldOffset(0)] public KEYBDINPUT ki;
  }

  [StructLayout(LayoutKind.Sequential)]
  private struct INPUT {
    public uint type;
    public INPUT_UNION U;
  }

  [DllImport("user32.dll", SetLastError = true)]
  private static extern uint SendInput(uint nInputs, INPUT[] pInputs, int cbSize);

  [DllImport("user32.dll")]
  public static extern bool BlockInput(bool fBlockIt);

  private const uint INPUT_MOUSE = 0;
  private const uint INPUT_KEYBOARD = 1;
  private const uint MOUSEEVENTF_LEFTDOWN = 0x0002;
  private const uint MOUSEEVENTF_LEFTUP = 0x0004;
  private const uint KEYEVENTF_KEYUP = 0x0002;
  private const uint KEYEVENTF_UNICODE = 0x0004;
  private const ushort VK_CONTROL = 0x11;
  private const ushort VK_A = 0x41;
  private const ushort VK_DELETE = 0x2E;
  private static readonly int INPUT_SIZE = Marshal.SizeOf(typeof(INPUT));

  private static void SendOneInput(INPUT input) {
    SendInput(1, new INPUT[] { input }, INPUT_SIZE);
  }

  private static void SendVk(ushort vk, bool keyUp) {
    var input = new INPUT { type = INPUT_KEYBOARD };
    input.U.ki = new KEYBDINPUT { wVk = vk, dwFlags = keyUp ? KEYEVENTF_KEYUP : 0 };
    SendOneInput(input);
  }

  public static void TypeUnicodeText(string text) {
    foreach (char c in text) {
      var down = new INPUT { type = INPUT_KEYBOARD };
      down.U.ki = new KEYBDINPUT { wScan = c, dwFlags = KEYEVENTF_UNICODE };
      var up = new INPUT { type = INPUT_KEYBOARD };
      up.U.ki = new KEYBDINPUT { wScan = c, dwFlags = KEYEVENTF_UNICODE | KEYEVENTF_KEYUP };
      SendOneInput(down);
      SendOneInput(up);
    }
  }

  public static void SelectAllAndDelete() {
    SendVk(VK_CONTROL, false);
    SendVk(VK_A, false);
    SendVk(VK_A, true);
    SendVk(VK_CONTROL, true);
    System.Threading.Thread.Sleep(8);
    SendVk(VK_DELETE, false);
    SendVk(VK_DELETE, true);
  }

  public static List<IntPtr> FindTopLevelWindowsByPid(HashSet<uint> pids) {
    var result = new List<IntPtr>();
    EnumWindows(delegate(IntPtr hWnd, IntPtr lParam) {
      if (!IsWindowVisible(hWnd)) return true;
      uint pid;
      GetWindowThreadProcessId(hWnd, out pid);
      if (pids.Contains(pid)) result.Add(hWnd);
      return true;
    }, IntPtr.Zero);
    return result;
  }

  // O Windows bloqueia SetForegroundWindow/AppActivate vindos de um processo
  // que não é o app em foco no momento (proteção contra "roubo de foco") -
  // por isso, se o Riot Client estiver minimizado ou atrás de outra janela
  // (o caso comum é atrás do próprio Booster Launcher), um SetForegroundWindow
  // direto às vezes só pisca o ícone na barra de tarefas em vez de trazer a
  // janela pra frente de verdade. O truque padrão pra contornar isso é ligar
  // temporariamente o estado de input da nossa thread ao da thread dona da
  // janela em foco atual via AttachThreadInput - isso faz o Windows tratar o
  // pedido como se estivesse vindo do próprio app em foco, então libera.
  public static void ForceForeground(IntPtr hWnd) {
    ShowWindow(hWnd, SW_RESTORE);

    IntPtr foreground = GetForegroundWindow();
    uint currentThread = GetCurrentThreadId();
    uint foregroundThread = 0;
    GetWindowThreadProcessId(foreground, out foregroundThread);
    uint targetThread = 0;
    GetWindowThreadProcessId(hWnd, out targetThread);

    bool attachedToForeground = foregroundThread != 0 && foregroundThread != currentThread
      && AttachThreadInput(currentThread, foregroundThread, true);
    bool attachedToTarget = targetThread != 0 && targetThread != currentThread && targetThread != foregroundThread
      && AttachThreadInput(currentThread, targetThread, true);

    BringWindowToTop(hWnd);
    SetForegroundWindow(hWnd);

    if (attachedToTarget) AttachThreadInput(currentThread, targetThread, false);
    if (attachedToForeground) AttachThreadInput(currentThread, foregroundThread, false);
  }

  public static void ClickAt(int x, int y) {
    SetCursorPos(x, y);
    System.Threading.Thread.Sleep(8);
    var down = new INPUT { type = INPUT_MOUSE };
    down.U.mi = new MOUSEINPUT { dwFlags = MOUSEEVENTF_LEFTDOWN };
    var up = new INPUT { type = INPUT_MOUSE };
    up.U.mi = new MOUSEINPUT { dwFlags = MOUSEEVENTF_LEFTUP };
    SendOneInput(down);
    System.Threading.Thread.Sleep(8);
    SendOneInput(up);
  }

  // ── Overlay opaco (tapa-campo) ─────────────────────────────────────────
  // Janela preta, sem borda, sempre no topo, que nunca rouba foco do
  // teclado (WS_EX_NOACTIVATE) - usada pra cobrir fisicamente os campos de
  // usuario/senha do Riot Client assim que preenchidos, antes do clique em
  // "Entrar". O campo de usuario não vem mascarado pela própria Riot (ao
  // contrário do de senha, que já mostra bolinhas) - sem isso ele fica
  // legível na tela, e mesmo o de senha pode ser revelado por um ícone de
  // "mostrar senha" se alguém clicar nele antes da tela avançar. Por ser
  // WS_EX_NOACTIVATE, cliques nossos seguintes (posição na tela, não em
  // foco) continuam acertando a janela real do Riot Client por baixo, sem
  // interferência.
  //
  // Janela crua via user32 (não System.Windows.Forms.Form) de propósito:
  // um Form do WinForms sem loop de mensagens rodando é frágil pra manter
  // topo/estilo sem foco, e aqui não precisa de nada interativo - só um
  // retângulo sólido cobrindo a tela por meio segundo.
  private delegate IntPtr WndProcDelegate(IntPtr hWnd, uint msg, IntPtr wParam, IntPtr lParam);
  private static WndProcDelegate _overlayWndProc;
  private static bool _overlayClassRegistered = false;
  private const string OVERLAY_CLASS_NAME = "EloBoostOverlayWnd";

  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  private struct WNDCLASS {
    public uint style;
    public IntPtr lpfnWndProc;
    public int cbClsExtra;
    public int cbWndExtra;
    public IntPtr hInstance;
    public IntPtr hIcon;
    public IntPtr hCursor;
    public IntPtr hbrBackground;
    public string lpszMenuName;
    public string lpszClassName;
  }

  [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  private static extern ushort RegisterClassW(ref WNDCLASS lpWndClass);

  [DllImport("user32.dll", CharSet = CharSet.Unicode)]
  private static extern IntPtr CreateWindowExW(
    uint dwExStyle, string lpClassName, string lpWindowName, uint dwStyle,
    int x, int y, int nWidth, int nHeight,
    IntPtr hWndParent, IntPtr hMenu, IntPtr hInstance, IntPtr lpParam);

  [DllImport("user32.dll")]
  private static extern IntPtr DefWindowProcW(IntPtr hWnd, uint msg, IntPtr wParam, IntPtr lParam);

  [DllImport("user32.dll")]
  private static extern bool DestroyWindow(IntPtr hWnd);

  [DllImport("gdi32.dll")]
  private static extern IntPtr CreateSolidBrush(int crColor);

  [DllImport("kernel32.dll", CharSet = CharSet.Unicode)]
  private static extern IntPtr GetModuleHandle(string lpModuleName);

  private const uint WS_POPUP = 0x80000000;
  private const uint WS_EX_TOPMOST = 0x00000008;
  private const uint WS_EX_NOACTIVATE = 0x08000000;
  private const uint WS_EX_TOOLWINDOW = 0x00000080;
  private const int SW_SHOWNOACTIVATE = 4;

  private static IntPtr OverlayWndProc(IntPtr hWnd, uint msg, IntPtr wParam, IntPtr lParam) {
    return DefWindowProcW(hWnd, msg, wParam, lParam);
  }

  private static void EnsureOverlayClassRegistered() {
    if (_overlayClassRegistered) return;
    _overlayWndProc = new WndProcDelegate(OverlayWndProc);
    var wc = new WNDCLASS();
    wc.lpfnWndProc = Marshal.GetFunctionPointerForDelegate(_overlayWndProc);
    wc.hInstance = GetModuleHandle(null);
    wc.hbrBackground = CreateSolidBrush(0x00000000);
    wc.lpszClassName = OVERLAY_CLASS_NAME;
    RegisterClassW(ref wc);
    _overlayClassRegistered = true;
  }

  public static IntPtr CreateOverlay(int x, int y, int width, int height) {
    EnsureOverlayClassRegistered();
    uint exStyle = WS_EX_TOPMOST | WS_EX_NOACTIVATE | WS_EX_TOOLWINDOW;
    IntPtr hwnd = CreateWindowExW(
      exStyle, OVERLAY_CLASS_NAME, "", WS_POPUP,
      x, y, width, height, IntPtr.Zero, IntPtr.Zero, GetModuleHandle(null), IntPtr.Zero);
    if (hwnd != IntPtr.Zero) ShowWindow(hwnd, SW_SHOWNOACTIVATE);
    return hwnd;
  }

  public static void DestroyOverlay(IntPtr hwnd) {
    if (hwnd != IntPtr.Zero) DestroyWindow(hwnd);
  }
}
`.trim()

// O nome do .dll cacheado carrega um hash do próprio código-fonte — assim,
// se NATIVE_TYPE_SOURCE mudar numa atualização futura do app, o cache antigo
// (compilado a partir da versão anterior da classe) simplesmente não bate
// mais com esse nome e é ignorado, sem risco de carregar um assembly velho
// que não tenha um método novo que o LOGIN_SCRIPT passou a chamar.
const NATIVE_HELPER_VERSION = createHash('sha1').update(NATIVE_TYPE_SOURCE).digest('hex').slice(0, 10)
const NATIVE_HELPER_DLL = join(NATIVE_HELPER_DIR, `EloBoostNativeWin.${NATIVE_HELPER_VERSION}.dll`)

const LOGIN_SCRIPT = `
param([string]$NativeDllPath)
$ErrorActionPreference = 'Stop'

# Tenta carregar o .dll pré-compilado (rápido, sem invocar o compilador do
# .NET) — só recompila na hora (lento) se o cache não existir ou estiver
# corrompido/incompatível.
$loadedFromCache = $false
if ($NativeDllPath -and (Test-Path $NativeDllPath)) {
  try {
    Add-Type -Path $NativeDllPath
    $loadedFromCache = $true
  } catch { }
}
if (-not $loadedFromCache) {
  Add-Type -TypeDefinition @'
${NATIVE_TYPE_SOURCE}
'@
}

# Garante que as coordenadas fisicas de tela usadas aqui (GetWindowRect,
# SetCursorPos) batem com as da janela do Riot Client independente da
# escala de DPI configurada no Windows.
[EloBoostNativeWin]::SetProcessDPIAware() | Out-Null

# Lidas cedo (antes de qualquer espera) pra nao adicionar latencia depois -
# vem por stdin, nunca por argumento de linha de comando (ver comentario no
# topo do arquivo). $coldStart diz se o Riot Client ja estava rodando antes
# deste processo ser iniciado (ver uso mais abaixo).
$username = [Console]::In.ReadLine()
$password = [Console]::In.ReadLine()
$coldStart = [Console]::In.ReadLine()

$riotProcessNames = @('RiotClientUx', 'RiotClientUxRender', 'RiotClientServices', 'Riot Client')
function Get-RiotPids {
  Get-Process -Name $riotProcessNames -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Id
}

function Find-RiotWindow([int]$timeoutMs) {
  $deadline = (Get-Date).AddMilliseconds($timeoutMs)
  while ((Get-Date) -lt $deadline) {
    $riotPids = Get-RiotPids
    if ($riotPids -and $riotPids.Count -gt 0) {
      $pidSet = New-Object 'System.Collections.Generic.HashSet[uint32]'
      foreach ($p in $riotPids) { [void]$pidSet.Add([uint32]$p) }
      $hwnds = [EloBoostNativeWin]::FindTopLevelWindowsByPid($pidSet)
      if ($hwnds.Count -gt 0) { return $hwnds[0] }
    }
    Start-Sleep -Milliseconds 10
  }
  return [IntPtr]::Zero
}

$hwnd = Find-RiotWindow -timeoutMs 45000
if ($hwnd -eq [IntPtr]::Zero) {
  Write-Error 'WINDOW_NOT_FOUND'
  exit 2
}

[EloBoostNativeWin]::ForceForeground($hwnd)
Start-Sleep -Milliseconds 10

# Num "cold start" (Riot Client fechado antes), a janela existe bem antes do
# formulario de login terminar de carregar - ela ainda mostra uma tela de
# splash/carregamento nesse meio tempo, geralmente com um tamanho diferente
# do formulario final. Clicar direto nesse momento erra a posicao. Por isso
# esperamos o tamanho da janela parar de mudar (sinal de que o layout final
# assentou) antes de calcular onde clicar - com Riot Client ja aberto isso
# passa quase instantaneo (o tamanho ja esta estavel desde o primeiro check).
function Get-StableRect([int]$maxWaitMs) {
  $deadline = (Get-Date).AddMilliseconds($maxWaitMs)
  $prev = New-Object EloBoostNativeWin+RECT
  $prev.Left = -99999
  while ((Get-Date) -lt $deadline) {
    $current = New-Object EloBoostNativeWin+RECT
    [EloBoostNativeWin]::GetWindowRect($hwnd, [ref]$current) | Out-Null
    $sameAsPrev = ($current.Left -eq $prev.Left -and $current.Top -eq $prev.Top -and
                   $current.Right -eq $prev.Right -and $current.Bottom -eq $prev.Bottom)
    if ($sameAsPrev -and $current.Right -gt $current.Left -and $current.Bottom -gt $current.Top) {
      return $current
    }
    $prev = $current
    Start-Sleep -Milliseconds 15
  }
  return $current
}

# Só o cold start de verdade precisa da espera de estabilização + folga
# grande: é quando a troca de "tela de carregamento" pro formulario de login
# de verdade acontece DENTRO do mesmo tamanho de janela (Get-StableRect não
# pega essa transição sozinho, só o tamanho parar de mudar). Sintoma
# observado sem essa folga: o campo de usuario erra a posicao mas o de senha
# acerta, porque o formulario so termina de assentar entre um clique e outro.
# Com o prelaunch do Riot Client já na abertura do Booster Launcher (ver
# prelaunchRiotClient) e sem relançar o executável quando já está rodando
# (ver autoLoginToRiotClient), esse é o caminho normal: o client já está de
# pé e estável havia vários segundos quando o booster cola o token — não tem
# nem transição de tamanho pra esperar, então lê o rect direto (sem o loop de
# double-check) e só cobre um repaint pontual com uma folga mínima. O valor
# do cold start é o mais arriscado de cortar (foi calibrado observando o
# sintoma acima) — se voltar a errar a posição do campo de usuário num cold
# start, aumente só esse. Levado ao mínimo a pedido explícito (já foi
# 12000 -> 8000 -> 3000 -> 1500 -> isto): na prática isso trata cold start
# quase como warm start, sem margem real pra transição splash -> formulário.
# Só não é exatamente 0 porque ainda cobre o tempinho de repaint que o warm
# start também cobre. Sem forma de testar aqui contra um Riot Client ao vivo
# - se o sintoma original voltar (campo de usuário errando a posição num
# cold start), esse é o número a aumentar de novo. Mitigado por esse caminho
# agora ser raro: só acontece se o prelaunch (ver prelaunchRiotClient) não
# tiver dado tempo de deixar o client aberto antes do booster colar o token.
if ($coldStart -eq '1') {
  $rect = Get-StableRect -maxWaitMs 30000
  Start-Sleep -Milliseconds 50
} else {
  $rect = New-Object EloBoostNativeWin+RECT
  [EloBoostNativeWin]::GetWindowRect($hwnd, [ref]$rect) | Out-Null
  Start-Sleep -Milliseconds 30
}

$width = $rect.Right - $rect.Left
$height = $rect.Bottom - $rect.Top
if ($width -le 0 -or $height -le 0) {
  Write-Error 'WINDOW_RECT_INVALID'
  exit 2
}

# Proporcoes calculadas a partir da tela de login real (ver comentario no
# topo do arquivo) - nao pixels fixos, pra tolerar a janela em qualquer
# posicao/monitor contanto que o tamanho da janela seja o mesmo.
function Get-AbsPoint([double]$relX, [double]$relY) {
  return @{
    X = $rect.Left + [int]([Math]::Round($width * $relX))
    Y = $rect.Top + [int]([Math]::Round($height * $relY))
  }
}
$userPoint = Get-AbsPoint -relX 0.1309 -relY 0.3256
$passPoint = Get-AbsPoint -relX 0.1309 -relY 0.3998
$loginPoint = Get-AbsPoint -relX 0.1290 -relY 0.7671

# Retangulos (nao so ponto) cobrindo os campos de usuario/senha - usados pra
# tapar o campo com o overlay (ver [EloBoostNativeWin]::CreateOverlay) assim
# que o texto e digitado. Medidos por pixel contra a mesma captura de tela
# usada pra calibrar userPoint/passPoint acima (campo de usuario ~x:[247,536]
# y:[363,412], campo de senha ~x:[247,536] y:[429,478], janela em si
# ~x:[192,1727] y:[110,970]) - por isso cobrem só a largura real do campo
# (a versão anterior cobria até metade da janela, incluindo a arte ao lado,
# por isso ficava torto/grande demais). Fundo/topo com uma folga pequena
# pra garantir cobertura mesmo se a janela do booster tiver proporção um
# pouco diferente da da captura; a base do retangulo de usuario fica bem
# acima de onde passPoint clica, pra nunca tampar o próprio clique no campo
# de senha.
function Get-AbsRect([double]$relX, [double]$relY, [double]$relW, [double]$relH) {
  return @{
    X = $rect.Left + [int]([Math]::Round($width * $relX))
    Y = $rect.Top + [int]([Math]::Round($height * $relY))
    W = [int]([Math]::Round($width * $relW))
    H = [int]([Math]::Round($height * $relH))
  }
}
$userFieldRect = Get-AbsRect -relX 0.025 -relY 0.282 -relW 0.21 -relH 0.078
$passFieldRect = Get-AbsRect -relX 0.025 -relY 0.368 -relW 0.21 -relH 0.075

# Digita via SendInput (EloBoostNativeWin.TypeUnicodeText/SelectAllAndDelete
# — ver comentário no topo do arquivo) em vez do antigo SendKeys: além de ser
# a API que o BlockInput abaixo garante não bloquear pra nossa própria
# thread, evita por completo a necessidade de escapar caracteres especiais
# do mini-idioma do SendKeys (+^%~(){}[]) — cada caractere da senha vai
# literal, sem parser no meio.
#
# CRÍTICO: o overlay tem que subir ANTES de digitar, nunca depois. Se o
# processo for suspenso (ex.: um watcher já rodando em background, chamando
# a API de suspender processo direto — isso não passa pelo BlockInput, que só
# bloqueia entrada de teclado/mouse, não chamadas de outro processo) no meio
# da digitação e só ANTES do overlay existir, o texto fica sentado sem
# nenhuma cobertura na tela — visível/printável — pelo tempo que o processo
# ficar suspenso, e nada no LOGIN_SCRIPT roda pra reagir a isso enquanto
# suspenso (um processo suspenso não executa nenhuma linha, watchdog
# incluso). Por isso o clique acontece separado, num campo ainda vazio (nada
# sensível pra expor mesmo se suspender bem ali), e SÓ DEPOIS o overlay é
# criado e a digitação acontece por baixo dele — nunca existe um instante em
# que o campo tem conteúdo real e está sem cobertura ao mesmo tempo.
function Clear-AndType([string]$text) {
  # Limpa o campo antes de digitar, caso ja tenha algo (ja coberto pelo
  # overlay, que o chamador cria antes de invocar isso).
  [EloBoostNativeWin]::SelectAllAndDelete()
  Start-Sleep -Milliseconds 16
  [EloBoostNativeWin]::TypeUnicodeText($text)
  Start-Sleep -Milliseconds 20
}

# Watchdog contra o processo ser suspenso/pausado no meio do preenchimento
# (ex.: Process Hacker, debugger) pra dar tempo de ler ou revelar a senha
# antes do clique em "Entrar". Um processo suspenso nao executa nada -
# ninguem consegue "ver" a pausa acontecendo -, mas ao ser retomado, o
# relogio de parede (Stopwatch, que continua contando mesmo com a thread
# parada) mostra um intervalo bem maior do que a soma dos Start-Sleep
# esperados, o que entrega a pausa depois do fato. $MAX_CRITICAL_MS e
# generoso (a secao inteira roda normalmente em bem menos de 1s) mas curto
# o bastante pra pegar qualquer pausa deliberada, que precisaria durar pelo
# menos alguns segundos pra alguem ler ou printar a tela.
$criticalWatch = [System.Diagnostics.Stopwatch]::StartNew()
$MAX_CRITICAL_MS = 2000
$overlays = New-Object 'System.Collections.Generic.List[IntPtr]'

# Limpa o que ja foi digitado (usado quando algo falha no meio, nao so no watchdog): sem isso uma excecao deixava
# usuario/senha preenchidos no Riot Client. Melhor esforco, nunca lanca.
$fieldsTouched = 0
function Clear-FilledFields {
  try {
    # Clique e teclas sao cegos (coordenadas de tela): se a janela do Riot fechou, minimizou ou perdeu o foco no meio,
    # NAO envia nada (apagaria outro aplicativo).
    if ([EloBoostNativeWin]::GetForegroundWindow() -ne $hwnd) { return }
    if ($fieldsTouched -ge 1) { [EloBoostNativeWin]::SelectAllAndDelete() }
    if ($fieldsTouched -ge 2) {
      foreach ($h in $overlays) { [EloBoostNativeWin]::DestroyOverlay($h) }
      [EloBoostNativeWin]::ClickAt($userPoint.X, $userPoint.Y)
      [EloBoostNativeWin]::SelectAllAndDelete()
    }
  } catch { }
}

function Clear-OverlaysAndAbort {
  # Limpa os campos ANTES de destravar o mouse/teclado do booster e sair -
  # nunca deixa credenciais visiveis nem submete o formulario num estado que
  # pode ter sido monitorado.
  #
  # O campo mais recente (se algum foi preenchido) ainda esta com o foco de
  # teclado real - da pra limpar direto (SelectAllAndDelete), sem clicar de
  # novo. Clicar de novo NAO funcionaria: acertaria nosso proprio overlay
  # (que ja esta cobrindo esse campo), nao o campo real do Riot por baixo.
  if ($overlays.Count -ge 1) {
    [EloBoostNativeWin]::SelectAllAndDelete()
  }
  # O campo anterior (usuario), se os dois ja tinham sido preenchidos, nao
  # esta mais com foco - precisa clicar pra limpar, o que exige tirar o
  # overlay dele do caminho primeiro. Unico ponto com uma janela de exposicao
  # (breve, so o usuario, so nesse caminho de abort ja incomum).
  if ($overlays.Count -ge 2) {
    [EloBoostNativeWin]::DestroyOverlay($overlays[0])
    [EloBoostNativeWin]::ClickAt($userPoint.X, $userPoint.Y)
    [EloBoostNativeWin]::SelectAllAndDelete()
  }
  [EloBoostNativeWin]::BlockInput($false) | Out-Null
  foreach ($h in $overlays) { [EloBoostNativeWin]::DestroyOverlay($h) }
  # Ja limpou acima: o catch do bloco principal nao limpa de novo (com o input ja liberado).
  $script:fieldsTouched = 0
  Write-Error 'TAMPER_DETECTED'
  exit 4
}

function Confirm-NotTampered {
  if ($criticalWatch.ElapsedMilliseconds -gt $MAX_CRITICAL_MS) {
    Clear-OverlaysAndAbort
  }
}

# BlockInput trava mouse/teclado do Windows inteiro (não só a janela do Riot
# Client) enquanto dura o preenchimento - o booster não consegue clicar em
# nada nem digitar nada nesse intervalo. A exceção documentada é que a MESMA
# thread que chama BlockInput(true) continua conseguindo injetar input via
# SendInput normalmente (por isso ClickAt/TypeUnicodeText/SelectAllAndDelete
# foram migrados de mouse_event/SendKeys pra SendInput - ver comentário no
# topo do arquivo), então nosso próprio preenchimento não é afetado. Isso
# NÃO bloqueia Ctrl+Alt+Del (sequência seguindo desenhada pelo próprio
# Windows pra nunca poder ser bloqueada por nenhum app) - por isso o
# watchdog de timing acima continua necessário como segunda camada contra
# alguém abrindo o Gerenciador de Tarefas por ali pra suspender o processo.
# SEMPRE desligado no finally, mesmo em erro - deixar travado seria pior que
# o problema original (booster com mouse/teclado mortos).
# Se esperar a janela / estabilizar levou tempo demais, aborta ANTES de travar o input: o timeout do Node (mata o
# processo) nunca pode pegar o script no meio da digitacao.
if ($scriptClock.ElapsedMilliseconds -gt ${SCRIPT_START_DEADLINE_MS}) {
  Write-Error 'START_TOO_LATE'
  exit 3
}
[EloBoostNativeWin]::BlockInput($true) | Out-Null
try {
  [EloBoostNativeWin]::ClickAt($userPoint.X, $userPoint.Y)
  Start-Sleep -Milliseconds 20
  $overlays.Add([EloBoostNativeWin]::CreateOverlay($userFieldRect.X, $userFieldRect.Y, $userFieldRect.W, $userFieldRect.H))
  $fieldsTouched = 1
  Clear-AndType -text $username
  Confirm-NotTampered

  [EloBoostNativeWin]::ClickAt($passPoint.X, $passPoint.Y)
  Start-Sleep -Milliseconds 20
  $overlays.Add([EloBoostNativeWin]::CreateOverlay($passFieldRect.X, $passFieldRect.Y, $passFieldRect.W, $passFieldRect.H))
  $fieldsTouched = 2
  Clear-AndType -text $password
  Confirm-NotTampered

  [EloBoostNativeWin]::ClickAt($loginPoint.X, $loginPoint.Y)
  # O SendInput e sincrono: so uma folga curta antes de soltar o BlockInput e os overlays.
  Start-Sleep -Milliseconds 60
} catch {
  # Falha no meio (nao o watchdog, que ja limpa e sai): apaga o que foi digitado e repassa o erro.
  Clear-FilledFields
  throw
} finally {
  [EloBoostNativeWin]::BlockInput($false) | Out-Null
  foreach ($h in $overlays) { [EloBoostNativeWin]::DestroyOverlay($h) }
}
`.trim()

// Proporções calculadas a partir de screenshots reais tiradas pelo usuário:
// logado.png (tela "Início" logo após o login, com o ícone do League na
// barra lateral) e iniciarLOL.png (tela do produto League, já com o botão
// "Jogar" visível). Mesma lógica de proporção de janela do formulário de
// login (ver comentário no topo do arquivo) — não pixel fixo de tela.
// O ícone do League é o segundo da barra (círculo dourado com "L"), logo
// acima do ícone do Valorant — o ícone com moldura escura/crachá
// "NOVIDADES" logo acima dele é o do "LoL Classic", não este.
const LEAGUE_ICON_REL = { x: 0.0261, y: 0.4943 }
const JOGAR_BUTTON_REL = { x: 0.1564, y: 0.8614 }

// Fallback por clique real pra abrir o League quando a API de
// product-launcher (ver launchLeagueClient) não confirma sucesso — em vez de
// só confiar num endpoint não documentado, clica de verdade no ícone do
// League na barra lateral e depois no botão "Jogar", igual um booster faria
// na mão. Os tempos de espera (pedido explícito do usuário) cobrem a
// transição de tela de login pra "Início" e de "Início" pro produto League.
const LAUNCH_LEAGUE_SCRIPT = `
param([string]$NativeDllPath)
$ErrorActionPreference = 'Stop'

$loadedFromCache = $false
if ($NativeDllPath -and (Test-Path $NativeDllPath)) {
  try {
    Add-Type -Path $NativeDllPath
    $loadedFromCache = $true
  } catch { }
}
if (-not $loadedFromCache) {
  Add-Type -TypeDefinition @'
${NATIVE_TYPE_SOURCE}
'@
}

[EloBoostNativeWin]::SetProcessDPIAware() | Out-Null

$riotProcessNames = @('RiotClientUx', 'RiotClientUxRender', 'RiotClientServices', 'Riot Client')
$riotPids = Get-Process -Name $riotProcessNames -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Id
if (-not $riotPids -or $riotPids.Count -eq 0) {
  Write-Error 'WINDOW_NOT_FOUND'
  exit 2
}
$pidSet = New-Object 'System.Collections.Generic.HashSet[uint32]'
foreach ($p in $riotPids) { [void]$pidSet.Add([uint32]$p) }
$hwnds = [EloBoostNativeWin]::FindTopLevelWindowsByPid($pidSet)
if ($hwnds.Count -eq 0) {
  Write-Error 'WINDOW_NOT_FOUND'
  exit 2
}
$hwnd = $hwnds[0]

[EloBoostNativeWin]::ForceForeground($hwnd)

# Espera a UI trocar da tela de login pra "Início" depois que o RSO já
# confirmou o login (a confirmação da API não significa que a UI já
# terminou de trocar de tela).
Start-Sleep -Milliseconds 2000

$rect = New-Object EloBoostNativeWin+RECT
[EloBoostNativeWin]::GetWindowRect($hwnd, [ref]$rect) | Out-Null
$width = $rect.Right - $rect.Left
$height = $rect.Bottom - $rect.Top
if ($width -le 0 -or $height -le 0) {
  Write-Error 'WINDOW_RECT_INVALID'
  exit 2
}

function Get-AbsPoint([double]$relX, [double]$relY) {
  return @{
    X = $rect.Left + [int]([Math]::Round($width * $relX))
    Y = $rect.Top + [int]([Math]::Round($height * $relY))
  }
}

$leagueIconPoint = Get-AbsPoint -relX ${LEAGUE_ICON_REL.x} -relY ${LEAGUE_ICON_REL.y}
$jogarPoint = Get-AbsPoint -relX ${JOGAR_BUTTON_REL.x} -relY ${JOGAR_BUTTON_REL.y}

[EloBoostNativeWin]::ClickAt($leagueIconPoint.X, $leagueIconPoint.Y)
# Espera a tela do produto League carregar (troca de aba dentro da mesma
# janela) antes do botão "Jogar" existir/estar clicável.
Start-Sleep -Milliseconds 1800
[EloBoostNativeWin]::ClickAt($jogarPoint.X, $jogarPoint.Y)
`.trim()

// Processo PowerShell do preenchimento em curso (no maximo um): encerrado ao fechar o app ou por timeout,
// para nunca ficar um filho orfao segurando BlockInput/teclado.
let activeLoginChild: ChildProcess | null = null
// Backstop do Node (o script ja aborta sozinho antes de travar o input, ver SCRIPT_START_DEADLINE_MS no topo).
const LOGIN_TOTAL_TIMEOUT_MS = 75_000

export function killActiveLogin(): void {
  try { activeLoginChild?.kill() } catch { /* ja encerrado */ }
  activeLoginChild = null
}

function simulateCredentialsEntry(username: string, password: string, wasAlreadyRunning: boolean): Promise<void> {
  return new Promise((resolve, reject) => {
    const scriptPath = join(tmpdir(), `eloboost-riot-login-${randomUUID()}.ps1`)
    writeFileSync(scriptPath, LOGIN_SCRIPT, 'utf-8')

    const cleanup = () => {
      try { unlinkSync(scriptPath) } catch { /* melhor esforço — não é crítico */ }
    }

    const nativeDllPath = existsSync(NATIVE_HELPER_DLL) ? NATIVE_HELPER_DLL : ''
    const child = spawn(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', scriptPath, '-NativeDllPath', nativeDllPath],
      { stdio: ['pipe', 'ignore', 'pipe'], windowsHide: true },
    )

    activeLoginChild = child
    const totalTimeout = setTimeout(() => {
      killActiveLogin()
      reject(new Error('O preenchimento no Riot Client demorou demais e foi cancelado. Confira se a tela de login está visível e tente de novo.'))
    }, LOGIN_TOTAL_TIMEOUT_MS)

    let stderr = ''
    child.stderr.on('data', (chunk) => { stderr += chunk.toString() })
    child.on('error', (err) => {
      clearTimeout(totalTimeout)
      activeLoginChild = null
      cleanup()
      reject(err)
    })
    child.on('close', (code) => {
      clearTimeout(totalTimeout)
      if (activeLoginChild === child) activeLoginChild = null
      cleanup()
      if (code === 0) {
        resolve()
      } else if (stderr.includes('TAMPER_DETECTED')) {
        reject(new Error(
          'Login abortado por segurança: o preenchimento foi interrompido ou monitorado de forma anômala.'
          + ' Os campos foram limpos antes de continuar. Tente novamente.',
        ))
      } else if (stderr.includes('START_TOO_LATE')) {
        reject(new Error('O Riot Client demorou demais para abrir a tela de login. Aguarde ele terminar de carregar e tente de novo.'))
      } else if (stderr.includes('WINDOW_NOT_FOUND')) {
        reject(new Error('Não encontrei a janela do Riot Client. Confirme se a tela de login está visível.'))
      } else if (stderr.includes('WINDOW_RECT_INVALID')) {
        reject(new Error('Não consegui ler a posição da janela do Riot Client (pode estar minimizada). Tente de novo com ela visível.'))
      } else {
        reject(new Error(`Falha ao preencher as credenciais no Riot Client (código ${code ?? '?'}).`))
      }
    })

    // Se o PowerShell morrer antes de ler a stdin, o EPIPE nao pode virar excecao nao tratada no processo main.
    child.stdin.on('error', () => { /* o 'close' do filho ja reporta a falha */ })
    child.stdin.write(`${username}\n${password}\n${wasAlreadyRunning ? '1' : '0'}\n`)
    child.stdin.end()
  })
}

// Consulta somente-leitura do estado da sessão RSO — mesma chamada que
// ferramentas de troca de conta usam pra saber se alguém está logado
// (`type === 'needs_authentication'` significa "ninguém logado ainda"). Ao
// contrário do envio de credenciais, essa consulta não é bloqueada pela
// Riot, então dá pra usar como confirmação depois do preenchimento simulado.
async function waitForAuthenticated(lockfile: LockfileInfo, timeoutMs: number): Promise<boolean> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    try {
      const response = await localApiRequest(lockfile, 'POST', '/rso-auth/v2/authorizations', {
        clientId: 'riot-client',
        trustLevels: ['always_trusted'],
      })
      if (response.status >= 200 && response.status < 300) {
        const parsed = JSON.parse(response.body) as { type?: string }
        if (parsed.type && parsed.type !== 'needs_authentication') return true
      }
    } catch {
      // API local pode ainda não estar pronta pra responder logo após o
      // preenchimento — tenta de novo dentro da janela de espera.
    }
    await sleep(AUTH_POLL_INTERVAL_MS)
  }
  return false
}

// Confirmar o login via RSO não faz o Riot Client avançar sozinho pro League
// — os argumentos --launch-product/--launch-patchline passados no spawn só
// valem pra abrir a tela de login com aquela intenção guardada; depois que o
// usuário efetivamente loga, é o clique manual no botão "Jogar" que dispara
// o lançamento de verdade. Pra não depender desse clique (o objetivo aqui é
// o booster não precisar tocar em nada), chamamos diretamente a API local de
// product-launcher, que é o que esse botão aciona por baixo dos panos — não
// documentada oficialmente, mas é o mecanismo replicado por ferramentas de
// troca de conta pra "apertar o Jogar" via código. Tenta POST e, se a Riot
// mudar o verbo aceito num client update futuro, cai pra PUT.
async function launchLeagueClient(lockfile: LockfileInfo): Promise<boolean> {
  const path = '/product-launcher/v1/products/league_of_legends/patchlines/live'
  for (const method of ['POST', 'PUT']) {
    try {
      const response = await localApiRequest(lockfile, method, path, {})
      if (response.status >= 200 && response.status < 300) return true
    } catch {
      // tenta o próximo método
    }
  }
  return false
}

// Fallback pra quando launchLeagueClient não confirma sucesso: em vez de só
// confiar num endpoint não documentado, clica de verdade no ícone do League
// e no botão "Jogar" (ver LAUNCH_LEAGUE_SCRIPT), com coordenadas tiradas de
// screenshots reais da tela do Riot Client.
function clickToLaunchLeague(): Promise<boolean> {
  return new Promise((resolve) => {
    const scriptPath = join(tmpdir(), `eloboost-launch-league-${randomUUID()}.ps1`)
    try {
      writeFileSync(scriptPath, LAUNCH_LEAGUE_SCRIPT, 'utf-8')
    } catch {
      resolve(false)
      return
    }

    const cleanup = () => {
      try { unlinkSync(scriptPath) } catch { /* melhor esforço — não é crítico */ }
    }
    const nativeDllPath = existsSync(NATIVE_HELPER_DLL) ? NATIVE_HELPER_DLL : ''

    try {
      const child = spawn(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', scriptPath, '-NativeDllPath', nativeDllPath],
        { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true },
      )
      child.on('error', () => { cleanup(); resolve(false) })
      child.on('close', (code) => { cleanup(); resolve(code === 0) })
    } catch {
      cleanup()
      resolve(false)
    }
  })
}

export interface RiotClientState {
  wasAlreadyRunning: boolean
  deceiveRunning: boolean
  /** O Riot Client precisaria reiniciar (sem Deceive) mas o jogo esta aberto: parar ANTES de consumir o token. */
  blockedByGame: boolean
  checkedAt: number
}

const STATE_MAX_AGE_MS = 3_000

// Estado do Riot Client antes do login. Roda em paralelo a resolucao das credenciais no servidor (index.ts),
// tirando a checagem do Deceive (tasklist) do caminho critico.
export async function inspectRiotClient(): Promise<RiotClientState> {
  const wasAlreadyRunning = readLockfile() !== null
  const deceiveRunning = wasAlreadyRunning && resolveDeceiveExecutable() ? await isDeceiveRunning() : true
  const needsRestart = wasAlreadyRunning && !deceiveRunning
  const blockedByGame = needsRestart ? await isAnyProcessRunning(GAME_PROCESS_IMAGES) : false
  return { wasAlreadyRunning, deceiveRunning, blockedByGame, checkedAt: Date.now() }
}

export async function autoLoginToRiotClient(
  loginId: string,
  password: string,
  onProgress: (step: string) => void,
  manualExecutablePath?: string | null,
  preflight?: RiotClientState,
): Promise<AutoLoginResult> {
  const executable = findRiotClientExecutable(manualExecutablePath)
  if (!executable) {
    return { ok: false, step: 'find_executable', error: 'Riot Client não encontrado nesta máquina.' }
  }

  // Se o lockfile já existe antes de chamarmos o executável, o Riot Client já
  // está de pé — nesse caso nem chamamos o executável de novo: é um processo
  // inteiro a mais no caminho crítico só pra "focar" a janela, e o próprio
  // LOGIN_SCRIPT já faz isso sozinho (ShowWindow + AppActivate) ao localizar
  // a janela existente via EnumWindows. Sem essa transição splash → formulário
  // de um cold start, o script de preenchimento também usa uma folga de
  // estabilização bem mais curta (ver LOGIN_SCRIPT).
  let state = preflight ?? await inspectRiotClient()
  // O estado pode ter ficado velho enquanto o token era resolvido (o booster pode ter aberto o Riot Client por fora).
  if (Date.now() - state.checkedAt > STATE_MAX_AGE_MS) state = await inspectRiotClient()
  if (state.blockedByGame) return { ok: false, step: 'game_running', error: new GameRunningError().message }
  // O estado pode ter sido lido antes de resolver o token: confirma o lockfile agora (o client pode ter fechado).
  let wasAlreadyRunning = state.wasAlreadyRunning && readLockfile() !== null

  // Mas se esse "já de pé" não passou pelo Deceive (deixado aberto de uma
  // sessão/teste anterior, aberto manualmente pelo booster, etc.), a conexão
  // de presença dele já está direto no servidor real — nada do que fizermos
  // agora esconde isso. Derruba e trata como cold start pra garantir que
  // desta vez o login (e a invisibilidade) passem pelo Deceive.
  if (wasAlreadyRunning && resolveDeceiveExecutable() && !state.deceiveRunning) {
    onProgress('Reiniciando o Riot Client em modo invisível…')
    try {
      await restartRiotClientWithoutDeceive()
    } catch (err) {
      if (err instanceof GameRunningError) return { ok: false, step: 'game_running', error: err.message }
      throw err
    }
    wasAlreadyRunning = false
  }

  let lockfile: LockfileInfo
  if (wasAlreadyRunning) {
    onProgress('Riot Client já aberto…')
    lockfile = readLockfile()!
  } else {
    onProgress('Abrindo o Riot Client…')
    launchRiotClient(executable, ['--launch-product=league_of_legends', '--launch-patchline=live'])

    try {
      onProgress('Aguardando o Riot Client iniciar…')
      lockfile = await waitForLockfile(45_000)
    } catch (err) {
      return { ok: false, step: 'wait_lockfile', error: err instanceof Error ? err.message : 'Timeout' }
    }
  }

  // A UI do Riot Client leva um instante pra montar a tela de login mesmo
  // depois do lockfile existir — o script de preenchimento já espera até 45s
  // pela janela sozinho, então esse delay aqui é só uma folga mínima antes de
  // começar a tentar. No caminho warm (client já rodando havia tempo) nem
  // precisa disso.
  if (!wasAlreadyRunning) {
    await sleep(20)
  }

  onProgress('Preenchendo login…')
  try {
    await simulateCredentialsEntry(loginId, password, wasAlreadyRunning)
  } catch (err) {
    return {
      ok: false,
      step: 'submit_credentials',
      error: err instanceof Error ? err.message : 'Falha ao preencher as credenciais no Riot Client.',
    }
  }

  onProgress('Aguardando confirmação do login…')
  const authenticated = await waitForAuthenticated(lockfile, LOGIN_CONFIRMATION_TIMEOUT_MS)
  if (authenticated) {
    onProgress('Login concluído. Abrindo o League of Legends…')
    let launched = await launchLeagueClient(lockfile)
    if (!launched) {
      launched = await clickToLaunchLeague()
    }
    onProgress(
      launched
        ? 'Pronto! O League está abrindo.'
        : 'Login concluído. Não consegui abrir o League automaticamente — clique em "Jogar" na janela do Riot Client.',
    )
    return { ok: true, step: 'done', leagueLaunched: launched }
  }

  return {
    ok: false,
    step: 'submit_credentials',
    error: 'Não foi possível confirmar o login dentro do tempo esperado.'
      + ' Usuário/senha podem estar incorretos, ou o Riot Client pode estar pedindo'
      + ' uma verificação extra (2FA, captcha) — confira a própria janela do Riot Client.',
  }
}

export function isRiotClientAvailable(manualPath?: string | null): boolean {
  return findRiotClientExecutable(manualPath) !== null
}

// Chamado logo na abertura do Booster Launcher, antes do booster colar
// qualquer token — só pra deixar o Riot Client já de pé (tela de login
// carregada) enquanto o booster está no Discord/colando o token. Quando o
// login de verdade acontecer em autoLoginToRiotClient, o lockfile já vai
// existir e o fluxo entra direto no caminho de "warm start" (sem a folga de
// 8s do cold start). Sem credenciais nesse momento, então sem argumento de
// produto/patchline — o "Jogar" é disparado explicitamente depois do login
// via launchLeagueClient. Silencioso de propósito: se o Riot Client não
// estiver instalado ainda, o erro real e explicado aparece só quando o
// booster efetivamente tentar entrar no jogo.
export async function prelaunchRiotClient(manualExecutablePath?: string | null): Promise<void> {
  const executable = findRiotClientExecutable(manualExecutablePath)
  if (!executable) return

  if (readLockfile()) {
    // Mesmo lógica de restart do autoLoginToRiotClient (ver comentário lá):
    // já aberto sem Deceive não vira invisível só por já estar de pé.
    if (!resolveDeceiveExecutable() || (await isDeceiveRunning())) return
    try {
      await restartRiotClientWithoutDeceive()
    } catch {
      return // jogo aberto: o prelaunch nunca derruba nada; o login explica se precisar
    }
  }

  try {
    launchRiotClient(executable, [])
  } catch {
    // melhor esforço — a tentativa "de verdade" acontece no login
  }
}

// Chamado junto com prelaunchRiotClient na abertura do Booster Launcher —
// compila o helper nativo (ver comentário em NATIVE_HELPER_DLL) uma única
// vez e cacheia o .dll em disco, pra tirar o custo de compilação C# do
// caminho crítico do login. Só roda se o cache ainda não existir (inclusive
// entre reaberturas do app — o .dll sobrevive). Silencioso de propósito: se
// a compilação falhar por qualquer motivo, o LOGIN_SCRIPT recompila inline
// como sempre fez, só que mais devagar.
export function prewarmNativeHelper(): void {
  if (existsSync(NATIVE_HELPER_DLL)) return

  try {
    mkdirSync(NATIVE_HELPER_DIR, { recursive: true })
  } catch {
    return
  }

  const scriptPath = join(tmpdir(), `eloboost-compile-native-${randomUUID()}.ps1`)
  const script = `
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
${NATIVE_TYPE_SOURCE}
'@ -OutputAssembly '${NATIVE_HELPER_DLL.replace(/'/g, "''")}' -OutputType Library
`.trim()

  try {
    writeFileSync(scriptPath, script, 'utf-8')
  } catch {
    return
  }

  try {
    const child = spawn(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', scriptPath],
      { detached: true, stdio: 'ignore', windowsHide: true },
    )
    const cleanup = () => { try { unlinkSync(scriptPath) } catch { /* melhor esforço */ } }
    child.on('exit', cleanup)
    child.on('error', cleanup)
    child.unref()
  } catch {
    try { unlinkSync(scriptPath) } catch { /* melhor esforço */ }
  }
}
