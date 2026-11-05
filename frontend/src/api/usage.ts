import { http } from './http'

import type { FeedbackValue } from './conversation'

export interface UsageLogDto {
  id: number
  created_at: string
  user_name: string
  agent_id: number
  agent_name: string
  model_name: string
  input_tokens: number
  output_tokens: number
  cost: number
  elapsed_ms: number
  success: boolean
  error_message: string | null
}

export interface UsageDayPoint {
  date: string
  calls: number
  tokens: number
  cost: number
}

export interface UsageByAgent {
  agent_id: number
  agent_name: string
  calls: number
  tokens: number
  cost: number
}

export interface UsageByModel {
  model_name: string
  calls: number
  tokens: number
  cost: number
}

export interface UsageSummaryDto {
  total_calls: number
  total_input_tokens: number
  total_output_tokens: number
  total_cost: number
  success_rate: number
  by_day: UsageDayPoint[]
  by_agent: UsageByAgent[]
  by_model: UsageByModel[]
}

export interface FeedbackItemDto {
  message_id: number
  session_id: number
  agent_name: string
  user_name: string
  feedback: FeedbackValue
  content_snippet: string
  created_at: string
}

export interface PageDto<T> {
  items: T[]
  total: number
  page: number
  page_size: number
}

export interface UsageLogQuery {
  page?: number
  page_size?: number
  agent_id?: number
  success?: boolean
}

export interface FeedbackQuery {
  page?: number
  page_size?: number
}

export const usageApi = {
  getSummary: (days = 14) => http.get<UsageSummaryDto>(`/api/usage/summary?days=${days}`),
  listLogs: (q: UsageLogQuery = {}) => {
    const params = new URLSearchParams()
    if (q.page != null) params.set('page', String(q.page))
    if (q.page_size != null) params.set('page_size', String(q.page_size))
    if (q.agent_id != null) params.set('agent_id', String(q.agent_id))
    if (q.success != null) params.set('success', String(q.success))
    const qs = params.toString()
    return http.get<PageDto<UsageLogDto>>(qs ? `/api/usage/logs?${qs}` : '/api/usage/logs')
  },
  listFeedbacks: (q: FeedbackQuery = {}) => {
    const params = new URLSearchParams()
    if (q.page != null) params.set('page', String(q.page))
    if (q.page_size != null) params.set('page_size', String(q.page_size))
    const qs = params.toString()
    return http.get<PageDto<FeedbackItemDto>>(qs ? `/api/usage/feedbacks?${qs}` : '/api/usage/feedbacks')
  },
}
