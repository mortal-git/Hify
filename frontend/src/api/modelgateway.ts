// M2 后端需按此契约实现 /api/modelgateway/**（含 SSE 无关的纯 REST）
import { http } from './http'

export interface TimeoutConfigDto {
  connect_ms?: number | null
  total_ms?: number | null
  ttft_ms?: number | null
  idle_ms?: number | null
}

export interface CircuitConfigDto {
  failure_threshold?: number | null
  open_ms?: number | null
}

export interface ProviderDto {
  id: number
  name: string
  base_url: string
  enabled: boolean
  key_configured: boolean
  max_concurrency: number
  embedding_batch_size: number
  timeout_config: TimeoutConfigDto | null
  circuit_config: CircuitConfigDto | null
  model_count: number
}

export interface ProviderPayload {
  name?: string
  base_url?: string
  api_key?: string // 仅需更换时携带；Ollama 等本地服务可无 key
  enabled?: boolean
  max_concurrency?: number
  embedding_batch_size?: number
  timeout_config?: TimeoutConfigDto | null
  circuit_config?: CircuitConfigDto | null
}

export type ModelType = 'CHAT' | 'EMBEDDING' | 'RERANK'

export interface ModelDto {
  id: number
  provider_id: number
  name: string
  display_name: string
  model_type: ModelType
  input_price: number | null
  output_price: number | null
  enabled: boolean
  provider_name?: string // 列表接口冗余返回，供跨供应商选择器展示
}

export interface ModelPayload {
  name?: string
  display_name?: string
  model_type?: ModelType
  input_price?: number | null
  output_price?: number | null
  enabled?: boolean
}

export interface TestResultDto {
  success: boolean
  message: string
  latency_ms: number
}

export interface RemoteModelDto {
  name: string
}

export const modelgatewayApi = {
  listProviders: () => http.get<ProviderDto[]>('/api/modelgateway/providers'),
  createProvider: (payload: ProviderPayload) => http.post<ProviderDto>('/api/modelgateway/providers', payload),
  updateProvider: (id: number, payload: ProviderPayload) =>
    http.patch<ProviderDto>(`/api/modelgateway/providers/${id}`, payload),
  deleteProvider: (id: number) => http.delete<null>(`/api/modelgateway/providers/${id}`),
  testProvider: (id: number) => http.put<TestResultDto>(`/api/modelgateway/providers/${id}/test`),
  listRemoteModels: (id: number) => http.get<RemoteModelDto[]>(`/api/modelgateway/providers/${id}/remote-models`),
  listAllModels: () => http.get<ModelDto[]>('/api/modelgateway/models'),

  listModels: (providerId: number) => http.get<ModelDto[]>(`/api/modelgateway/providers/${providerId}/models`),
  createModel: (providerId: number, payload: ModelPayload) =>
    http.post<ModelDto>(`/api/modelgateway/providers/${providerId}/models`, payload),
  updateModel: (id: number, payload: ModelPayload) => http.patch<ModelDto>(`/api/modelgateway/models/${id}`, payload),
  deleteModel: (id: number) => http.delete<null>(`/api/modelgateway/models/${id}`),
  testModel: (id: number) => http.put<TestResultDto>(`/api/modelgateway/models/${id}/test`),
}
