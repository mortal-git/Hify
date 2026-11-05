// M5 后端需按此契约实现 /api/knowledge/**（设计见 docs/knowledge-design.md §12）
// 枚举值统一大写，对齐 modelgateway 的 model_type 风格
import { http } from './http'

export type KbType = 'DOCUMENT' | 'FAQ'
export type ChunkMode = 'GENERAL' | 'PARENT_CHILD' | 'QA'
export type QaIndexMode = 'QUESTION_ONLY' | 'QUESTION_ANSWER'
export type WikiGranularity = 'FOCUSED' | 'STANDARD' | 'EXHAUSTIVE'

export interface MetadataFieldDef {
  key: string
  label: string
  type: 'STRING' | 'NUMBER' | 'DATE' | 'ENUM'
  options?: string[] // ENUM 的候选值
}

export interface KbConfigDto {
  chunk_mode: ChunkMode
  chunk_size: number
  chunk_overlap: number
  separators: string[]
  qa_index_mode: QaIndexMode
  embedding_model_id: number
  embedding_model_name: string // 冗余展示用
  generation_model_id: number | null
  generation_model_name: string | null
  rerank_model_id: number | null
  rerank_model_name: string | null
  vector_enabled: boolean
  keyword_enabled: boolean
  wiki_enabled: boolean
  graph_enabled: boolean
  top_k: number
  score_threshold: number
  rrf_vector_weight: number
  metadata_schema: MetadataFieldDef[]
  wiki_granularity: WikiGranularity
}

export interface KbSummaryDto {
  id: number
  name: string
  type: KbType
  description: string
  document_count: number
  chunk_count: number
  word_count: number
  created_at: string
}

export interface KbDetailDto extends KbSummaryDto {
  config: KbConfigDto
}

export interface KbCreatePayload {
  name: string
  type: KbType
  description?: string
  config: KbConfigDto
}

export interface KbUpdatePayload {
  name?: string
  description?: string
  config?: KbConfigDto
}

export interface KbUpdateResultDto {
  kb: KbDetailDto
  impact: string | null // 触发的重处理说明；null = 仅即时生效
}

export type DocStatus = 'QUEUED' | 'PARSING' | 'CHUNKING' | 'EMBEDDING' | 'WIKI' | 'GRAPH' | 'READY' | 'FAILED'
export type StageStatus = 'RUNNING' | 'DONE' | 'FAILED' | 'SKIPPED'
export type StageName = 'PARSE' | 'CHUNK' | 'EMBED' | 'WIKI' | 'GRAPH'

export interface TimelineEventDto {
  stage: StageName
  status: StageStatus
  started_at: string | null
  finished_at: string | null
  duration_ms: number | null
  error: string | null
}

export interface KbDocumentDto {
  id: number
  kb_id: number
  filename: string
  mime: string
  status: DocStatus
  error: string | null
  word_count: number
  chunk_count: number
  tags: string[]
  metadata: Record<string, string | number | null>
  created_at: string
  timeline: TimelineEventDto[]
}

export interface ChunkPreviewDto {
  chunks: { seq: number; content: string; token_count: number }[]
  total_chunks: number
  avg_length: number
}

export type ChunkSource = 'DOCUMENT' | 'FAQ' | 'WIKI'

export interface KbChunkDto {
  id: number
  doc_id: number
  seq: number
  content: string
  source: ChunkSource
  is_qa: boolean
  question: string | null
  answer: string | null
  token_count: number
  has_parent: boolean
}

export interface RecallHitDto {
  chunk_id: number
  doc_id: number
  doc_name: string
  seq: number
  content: string
  vector_score: number | null
  keyword_score: number | null
  fused_rank: number
  rerank_score: number | null
  provenance: ('VECTOR' | 'KEYWORD' | 'WIKI')[]
}

export interface RecallTestResultDto {
  query: string
  elapsed_ms: number
  hits: RecallHitDto[]
}

export interface WikiTreeNodeDto {
  slug: string
  title: string
  page_id: number
  children: WikiTreeNodeDto[]
}

export type WikiEditSource = 'PIPELINE' | 'AGENT' | 'USER' | 'REVERT'

export interface WikiPageDto {
  id: number
  kb_id: number
  slug: string
  title: string
  parent_slug: string | null
  content_md: string
  source_chunk_ids: number[]
  version: number
  updated_at: string
}

export interface WikiVersionDto {
  id: number
  page_id: number
  version: number
  edit_source: WikiEditSource
  editor_name: string
  summary: string
  created_at: string
}

export interface GraphNodeDto {
  id: number
  name: string
  type: string
  weight: number
}

export interface GraphEdgeDto {
  id: number
  source: number
  target: number
  relation: string
  weight: number
}

export interface GraphDataDto {
  nodes: GraphNodeDto[]
  edges: GraphEdgeDto[]
}

export interface FaqRowPayload {
  question: string
  answer: string
  metadata?: Record<string, string | number | null>
}

export interface FaqImportResultDto {
  imported: number
  failed: number
  errors: { row: number; message: string }[]
}

export const knowledgeApi = {
  listBases: () => http.get<KbSummaryDto[]>('/api/knowledge/bases'),
  createBase: (payload: KbCreatePayload) => http.post<KbDetailDto>('/api/knowledge/bases', payload),
  getBase: (id: number) => http.get<KbDetailDto>(`/api/knowledge/bases/${id}`),
  updateBase: (id: number, payload: KbUpdatePayload) =>
    http.patch<KbUpdateResultDto>(`/api/knowledge/bases/${id}`, payload),
  deleteBase: (id: number) => http.delete<null>(`/api/knowledge/bases/${id}`),

  listDocuments: (kbId: number) => http.get<KbDocumentDto[]>(`/api/knowledge/bases/${kbId}/documents`),
  uploadDocument: (kbId: number, file: File, tags: string[]) => {
    const form = new FormData()
    form.append('file', file)
    form.append('tags', JSON.stringify(tags))
    return http.postForm<KbDocumentDto>(`/api/knowledge/bases/${kbId}/documents`, form)
  },
  previewDocument: (kbId: number, file: File) => {
    const form = new FormData()
    form.append('file', file)
    return http.postForm<ChunkPreviewDto>(`/api/knowledge/bases/${kbId}/documents/preview`, form)
  },
  retryDocument: (id: number) => http.post<KbDocumentDto>(`/api/knowledge/documents/${id}/retry`),
  deleteDocument: (id: number) => http.delete<null>(`/api/knowledge/documents/${id}`),

  listChunks: (docId: number) => http.get<KbChunkDto[]>(`/api/knowledge/documents/${docId}/chunks`),
  updateChunk: (id: number, payload: { content: string }) =>
    http.patch<KbChunkDto>(`/api/knowledge/chunks/${id}`, payload),

  recallTest: (kbId: number, payload: { query: string; top_k?: number }) =>
    http.post<RecallTestResultDto>(`/api/knowledge/bases/${kbId}/recall-test`, payload),

  getWikiTree: (kbId: number) => http.get<WikiTreeNodeDto[]>(`/api/knowledge/bases/${kbId}/wiki-tree`),
  getWikiPage: (pageId: number) => http.get<WikiPageDto>(`/api/knowledge/wiki/pages/${pageId}`),
  updateWikiPage: (pageId: number, payload: { content_md: string }) =>
    http.patch<WikiPageDto>(`/api/knowledge/wiki/pages/${pageId}`, payload),
  listWikiVersions: (pageId: number) => http.get<WikiVersionDto[]>(`/api/knowledge/wiki/pages/${pageId}/versions`),
  revertWikiPage: (pageId: number, versionId: number) =>
    http.post<WikiPageDto>(`/api/knowledge/wiki/pages/${pageId}/revert`, { version_id: versionId }),

  getGraph: (kbId: number) => http.get<GraphDataDto>(`/api/knowledge/bases/${kbId}/graph`),

  importFaq: (kbId: number, rows: FaqRowPayload[]) =>
    http.post<FaqImportResultDto>(`/api/knowledge/bases/${kbId}/faq/import`, { rows }),

  regenerateProfile: (kbId: number) => http.post<KbDetailDto>(`/api/knowledge/bases/${kbId}/profile/regenerate`),
}
