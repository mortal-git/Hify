import { ApiError, http } from './http'
import { postSse } from './sse'

export interface SessionSummaryDto {
  id: number
  agent_id: number
  agent_name: string
  title: string
  message_count: number
  created_at: string
  updated_at: string
}

export interface CitationDto {
  kb_id: number
  kb_name: string
  doc_name: string
  chunk_seq: number
  content: string
  score: number
}

export type FeedbackValue = 'LIKE' | 'DISLIKE'

export interface MessageDto {
  id: number
  role: 'USER' | 'ASSISTANT'
  content: string
  citations: CitationDto[]
  feedback: FeedbackValue | null
  input_tokens: number
  output_tokens: number
  elapsed_ms: number
  created_at: string
}

export interface MessageDone {
  message_id: number
  content: string
  citations: CitationDto[]
  input_tokens: number
  output_tokens: number
  elapsed_ms: number
}

export interface MessageError {
  code: string
  message: string
}

export interface SendMessageHandlers {
  onDelta: (delta: string) => void
  onStatus?: (status: string) => void
  onCitations?: (citations: CitationDto[]) => void
}

export const conversationApi = {
  listSessions: (agentId?: number) =>
    http.get<SessionSummaryDto[]>(
      agentId == null ? '/api/conversation/sessions' : `/api/conversation/sessions?agent_id=${agentId}`,
    ),
  createSession: (agentId: number) => http.post<SessionSummaryDto>('/api/conversation/sessions', { agent_id: agentId }),
  renameSession: (id: number, title: string) =>
    http.patch<SessionSummaryDto>(`/api/conversation/sessions/${id}`, { title }),
  deleteSession: (id: number) => http.delete<null>(`/api/conversation/sessions/${id}`),
  listMessages: (sessionId: number) => http.get<MessageDto[]>(`/api/conversation/sessions/${sessionId}/messages`),
  sendFeedback: (messageId: number, feedback: FeedbackValue | null) =>
    http.post<MessageDto>(`/api/conversation/messages/${messageId}/feedback`, { feedback }),
}

export async function sendMessage(
  sessionId: number,
  content: string,
  handlers: SendMessageHandlers,
  signal?: AbortSignal,
): Promise<MessageDone> {
  const result: { done?: MessageDone; error?: MessageError } = {}
  await postSse(
    `/api/conversation/sessions/${sessionId}/messages`,
    { content },
    (message) => {
      if (message.event === 'delta') {
        handlers.onDelta(JSON.parse(message.data) as string)
      } else if (message.event === 'status') {
        handlers.onStatus?.(JSON.parse(message.data) as string)
      } else if (message.event === 'citations') {
        handlers.onCitations?.(JSON.parse(message.data) as CitationDto[])
      } else if (message.event === 'done') {
        result.done = JSON.parse(message.data) as MessageDone
      } else if (message.event === 'error') {
        result.error = JSON.parse(message.data) as MessageError
      }
    },
    signal,
  )
  if (result.error) {
    throw new ApiError(result.error.code, result.error.message)
  }
  if (!result.done) {
    throw new ApiError('STREAM_BROKEN', '回复流异常结束')
  }
  return result.done
}
