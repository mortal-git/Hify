import { http } from './http'

export interface AgentDto {
  id: number
  name: string
  description: string
  opening_statement: string
  system_prompt: string
  model_id: number
  model_name: string
  temperature: number
  knowledge_base_ids: number[]
  knowledge_base_names: string[]
  tool_ids: number[]
  api_key: string
  created_at: string
  updated_at: string
}

export interface AgentPayload {
  name: string
  description: string
  opening_statement: string
  system_prompt: string
  model_id: number
  temperature: number
  knowledge_base_ids: number[]
  tool_ids: number[]
}

export type ToolType = 'WEB_SEARCH' | 'HTTP'
export type ToolHttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE'

export interface ToolHttpConfig {
  method: ToolHttpMethod
  url: string
  headers: Record<string, string>
  body_template: string
}

export interface ToolDto {
  id: number
  name: string
  display_name: string
  description: string
  type: ToolType
  http_config: ToolHttpConfig | null
  builtin: boolean
  created_at: string
}

export interface ToolPayload {
  name: string
  display_name: string
  description: string
  http_config: ToolHttpConfig
}

export const agentApi = {
  listAgents: () => http.get<AgentDto[]>('/api/agent/agents'),
  createAgent: (body: AgentPayload) => http.post<AgentDto>('/api/agent/agents', body),
  getAgent: (id: number) => http.get<AgentDto>(`/api/agent/agents/${id}`),
  updateAgent: (id: number, body: AgentPayload) => http.patch<AgentDto>(`/api/agent/agents/${id}`, body),
  deleteAgent: (id: number) => http.delete<null>(`/api/agent/agents/${id}`),
  regenerateApiKey: (id: number) => http.post<AgentDto>(`/api/agent/agents/${id}/api-key`),
  listTools: () => http.get<ToolDto[]>('/api/agent/tools'),
  createTool: (body: ToolPayload) => http.post<ToolDto>('/api/agent/tools', body),
  updateTool: (id: number, body: ToolPayload) => http.patch<ToolDto>(`/api/agent/tools/${id}`, body),
  deleteTool: (id: number) => http.delete<null>(`/api/agent/tools/${id}`),
}
