// 后端统一响应包装 R：code === 0 表示成功；JSON 字段 snake_case
export interface R<T> {
  code: number
  message: string
  data: T
}

export class ApiError extends Error {
  constructor(
    readonly code: number | string,
    message: string,
    readonly status = 0,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  let resp: Response
  try {
    resp = await fetch(path, {
      credentials: 'same-origin',
      ...init,
      headers: {
        // FormData 不能预设 Content-Type（浏览器需自动生成 boundary）
        ...(init.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
        ...((init.headers as Record<string, string>) ?? {}),
      },
    })
  } catch {
    throw new ApiError('NETWORK_ERROR', '网络错误，请检查连接')
  }
  if (resp.status === 401) {
    throw new ApiError(401, '未登录或会话已过期', 401)
  }
  const body = (await resp.json().catch(() => null)) as R<T> | null
  if (!body) {
    throw new ApiError(resp.status, `请求失败（HTTP ${resp.status}）`, resp.status)
  }
  if (body.code !== 0) {
    throw new ApiError(body.code, body.message, resp.status)
  }
  return body.data
}

export const http = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, body === undefined ? { method: 'POST' } : { method: 'POST', body: JSON.stringify(body) }),
  put: <T>(path: string, body?: unknown) =>
    request<T>(path, body === undefined ? { method: 'PUT' } : { method: 'PUT', body: JSON.stringify(body) }),
  patch: <T>(path: string, body?: unknown) =>
    request<T>(path, body === undefined ? { method: 'PATCH' } : { method: 'PATCH', body: JSON.stringify(body) }),
  delete: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
  postForm: <T>(path: string, form: FormData) => request<T>(path, { method: 'POST', body: form }),
}
