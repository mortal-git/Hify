import { ApiError } from './http'

export interface SseMessage {
  event: string
  data: string
}

// POST + ReadableStream 解析 SSE（不用 EventSource：需要 POST 与鉴权头）
// 事件约定：delta 的 data 为 JSON 字符串；done / error 的 data 为 JSON 对象；
// `: keepalive` 注释行由解析器忽略
export async function postSse(
  path: string,
  body: unknown,
  onMessage: (message: SseMessage) => void,
  signal?: AbortSignal,
): Promise<void> {
  const resp = await fetch(path, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
    body: JSON.stringify(body),
    signal,
  })
  if (!resp.ok || !resp.body) {
    throw new ApiError(resp.status, `SSE 连接失败（HTTP ${resp.status}）`, resp.status)
  }
  const reader = resp.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    let separator = buffer.indexOf('\n\n')
    while (separator >= 0) {
      const block = buffer.slice(0, separator)
      buffer = buffer.slice(separator + 2)
      const message = parseBlock(block)
      if (message) onMessage(message)
      separator = buffer.indexOf('\n\n')
    }
  }
}

function parseBlock(block: string): SseMessage | null {
  let event = 'message'
  const dataLines: string[] = []
  for (const line of block.split('\n')) {
    if (line.startsWith(':')) continue
    if (line.startsWith('event:')) {
      event = line.slice('event:'.length).trim()
    } else if (line.startsWith('data:')) {
      dataLines.push(line.slice('data:'.length).replace(/^ /, ''))
    }
  }
  if (dataLines.length === 0) return null
  return { event, data: dataLines.join('\n') }
}
