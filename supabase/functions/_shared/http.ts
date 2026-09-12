export class HttpError extends Error {
  constructor(message: string, readonly status: number) {
    super(message)
  }
}

export async function readJsonBody(req: Request, maxBytes = 32 * 1024): Promise<unknown> {
  const contentType = req.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase()
  if (contentType !== 'application/json') throw new HttpError('Content-Type must be application/json', 415)

  const declaredLength = Number(req.headers.get('content-length') ?? 0)
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) throw new HttpError('Payload too large', 413)

  const text = await req.text()
  if (new TextEncoder().encode(text).byteLength > maxBytes) throw new HttpError('Payload too large', 413)
  try {
    return JSON.parse(text)
  } catch {
    throw new HttpError('Invalid JSON', 400)
  }
}

export async function fetchWithTimeout(
  input: string | URL | Request,
  init: RequestInit = {},
  timeoutMs = 10_000,
): Promise<Response> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(input, { ...init, signal: controller.signal })
  } finally {
    clearTimeout(timeout)
  }
}
