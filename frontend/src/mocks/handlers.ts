import { delay, http, HttpResponse } from 'msw'

import type {
  ChunkPreviewDto,
  DocStatus,
  FaqImportResultDto,
  FaqRowPayload,
  GraphDataDto,
  KbConfigDto,
  KbCreatePayload,
  KbDetailDto,
  KbDocumentDto,
  KbChunkDto,
  KbSummaryDto,
  KbUpdatePayload,
  RecallHitDto,
  RecallTestResultDto,
  StageName,
  TimelineEventDto,
  WikiPageDto,
  WikiTreeNodeDto,
  WikiVersionDto,
} from '@/api/knowledge'
import type {
  CircuitConfigDto,
  ModelDto,
  ModelPayload,
  ProviderDto,
  ProviderPayload,
  TestResultDto,
  TimeoutConfigDto,
} from '@/api/modelgateway'
import type { AgentDto, AgentPayload, ToolDto, ToolPayload } from '@/api/agent'
import type {
  CitationDto,
  FeedbackValue,
  MessageDto,
  SessionSummaryDto,
} from '@/api/conversation'
import type {
  FeedbackItemDto,
  UsageByAgent,
  UsageByModel,
  UsageDayPoint,
  UsageLogDto,
  UsageSummaryDto,
} from '@/api/usage'
import type { UserDto, UserPatch, UserPayload } from '@/api/iam'

interface MockUser {
  id: number
  user_name: string
  role: 'ADMIN' | 'MEMBER'
  created_at: string
  last_login_at: string | null
}

// MSW handler 运行在页面（或 SW）上下文，Set-Cookie 不可靠，用模块状态模拟会话
let mockUserName: string | null = null

function toUser(name: string): MockUser {
  const u = mockUsers.find((m) => m.user_name === name)
  return {
    id: u?.id ?? 0,
    user_name: name,
    role: u?.role ?? 'MEMBER',
    created_at: u?.created_at ?? '2026-01-01T00:00:00Z',
    last_login_at: u?.last_login_at ?? null,
  }
}

function ok<T>(data: T) {
  return { code: 0, message: 'ok', data }
}

function fail(code: number, message: string) {
  return { code, message, data: null }
}

const encoder = new TextEncoder()

function sse(event: string, data: unknown): Uint8Array {
  return encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
}

// ---------- modelgateway mock ----------

const mockProviders: ProviderDto[] = [
  {
    id: 1,
    name: 'OpenAI',
    base_url: 'https://api.openai.com/v1',
    enabled: true,
    key_configured: false,
    max_concurrency: 8,
    embedding_batch_size: 16,
    timeout_config: null,
    circuit_config: null,
    model_count: 0,
  },
  {
    id: 2,
    name: 'Claude',
    base_url: 'https://api.anthropic.com/v1',
    enabled: true,
    key_configured: false,
    max_concurrency: 8,
    embedding_batch_size: 16,
    timeout_config: null,
    circuit_config: null,
    model_count: 0,
  },
  {
    id: 3,
    name: 'Gemini',
    base_url: 'https://generativelanguage.googleapis.com/v1',
    enabled: false,
    key_configured: false,
    max_concurrency: 8,
    embedding_batch_size: 16,
    timeout_config: null,
    circuit_config: null,
    model_count: 0,
  },
  {
    id: 4,
    name: 'Ollama',
    base_url: 'http://localhost:11434/v1',
    enabled: true,
    key_configured: false,
    max_concurrency: 8,
    embedding_batch_size: 4,
    timeout_config: { connect_ms: 2000, total_ms: 60000, ttft_ms: 120000, idle_ms: null },
    circuit_config: null,
    model_count: 0,
  },
]

const mockModels: ModelDto[] = [
  // 知识库演示种子：挂在 Ollama（id 4）下，供建库向导与设置页选择
  { id: 1, provider_id: 4, name: 'qwen2.5:7b', display_name: 'qwen2.5:7b', model_type: 'CHAT', input_price: null, output_price: null, enabled: true },
  { id: 2, provider_id: 4, name: 'bge-m3', display_name: 'bge-m3', model_type: 'EMBEDDING', input_price: null, output_price: null, enabled: true },
  { id: 3, provider_id: 4, name: 'bge-reranker-v2-m3', display_name: 'bge-reranker-v2-m3', model_type: 'RERANK', input_price: null, output_price: null, enabled: true },
]
let providerSeq = 100
let modelSeq = 1000

const remoteModels: Record<string, string[]> = {
  OpenAI: ['gpt-5.2', 'gpt-5.2-mini', 'gpt-4.1', 'text-embedding-3-large', 'text-embedding-3-small'],
  Claude: ['claude-opus-4-7', 'claude-sonnet-4-6', 'claude-haiku-4-5'],
  Gemini: ['gemini-3-pro', 'gemini-3-flash', 'gemini-2.5-flash', 'text-embedding-004'],
  Ollama: ['qwen2.5:7b', 'bge-m3'],
}

function isLocalUrl(url: string): boolean {
  return /\/\/(localhost|127\.0\.0\.1|host\.docker\.internal)/.test(url)
}

function toProviderDto(p: ProviderDto): ProviderDto {
  return { ...p, model_count: mockModels.filter((m) => m.provider_id === p.id).length }
}

function unauthorized() {
  return HttpResponse.json(fail(401, '未登录'), { status: 401 })
}

function findProvider(id: string): ProviderDto | undefined {
  return mockProviders.find((p) => p.id === Number(id))
}

async function runModelTest(p: ProviderDto, m: ModelDto): Promise<TestResultDto> {
  if (!p.enabled) return { success: false, message: '供应商已停用', latency_ms: 0 }
  if (!m.enabled) return { success: false, message: '模型已停用', latency_ms: 0 }
  const local = isLocalUrl(p.base_url)
  if (!local && !p.key_configured) {
    return { success: false, message: '认证失败（401）：API Key 未配置或无效', latency_ms: 0 }
  }
  const latency = local ? 3 + Math.floor(Math.random() * 18) : 80 + Math.floor(Math.random() * 420)
  await delay(latency)
  return { success: true, message: `连通正常（${m.name}）`, latency_ms: latency }
}

async function runProviderTest(p: ProviderDto): Promise<TestResultDto> {
  if (!p.enabled) return { success: false, message: '供应商已停用', latency_ms: 0 }
  const enabledModels = mockModels.filter((m) => m.provider_id === p.id && m.enabled)
  const target = enabledModels.find((m) => m.model_type === 'CHAT') ?? enabledModels[0]
  if (!target) return { success: false, message: '没有已启用的模型，请先添加并启用模型', latency_ms: 0 }
  return runModelTest(p, target)
}

// ---------- knowledge mock ----------

interface KbStore {
  detail: KbDetailDto
  docs: KbDocumentDto[]
  chunks: KbChunkDto[]
  wikiPages: WikiPageDto[]
  wikiVersions: WikiVersionDto[]
  versionContents: Record<number, string>
  graph: GraphDataDto
}

const kbStores = new Map<number, KbStore>()
let kbSeq = 100
let docSeq = 300
let chunkSeq = 5000
let wikiVersionSeq = 1000 // 种子版本号占用 901-917，从 1000 起避免冲突
let graphNodeSeq = 200
let graphEdgeSeq = 800

function nowIso(): string {
  return new Date().toISOString()
}

function deepCopy<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T
}

function summaryOf(store: KbStore): KbSummaryDto {
  const { detail: kb, docs, chunks } = store
  return {
    id: kb.id,
    name: kb.name,
    type: kb.type,
    description: kb.description,
    document_count: docs.length,
    chunk_count: chunks.length,
    word_count: docs.reduce((acc, d) => acc + d.word_count, 0),
    created_at: kb.created_at,
  }
}

function detailOf(store: KbStore): KbDetailDto {
  return { ...deepCopy(store.detail), ...summaryOf(store) }
}

function findStore(idRaw: string | readonly string[] | undefined): KbStore | undefined {
  return kbStores.get(Number(idRaw))
}

function findDoc(idRaw: string | readonly string[] | undefined): { store: KbStore; doc: KbDocumentDto } | null {
  const id = Number(idRaw)
  for (const store of kbStores.values()) {
    const doc = store.docs.find((d) => d.id === id)
    if (doc) return { store, doc }
  }
  return null
}

function findChunk(id: number): { store: KbStore; chunk: KbChunkDto } | null {
  for (const store of kbStores.values()) {
    const chunk = store.chunks.find((c) => c.id === id)
    if (chunk) return { store, chunk }
  }
  return null
}

function findWikiPage(id: number): { store: KbStore; page: WikiPageDto } | null {
  for (const store of kbStores.values()) {
    const page = store.wikiPages.find((p) => p.id === id)
    if (page) return { store, page }
  }
  return null
}

const STAGE_ORDER: { stage: StageName; processing: DocStatus }[] = [
  { stage: 'PARSE', processing: 'PARSING' },
  { stage: 'CHUNK', processing: 'CHUNKING' },
  { stage: 'EMBED', processing: 'EMBEDDING' },
  { stage: 'WIKI', processing: 'WIKI' },
  { stage: 'GRAPH', processing: 'GRAPH' },
]

// 异步流水线模拟：setTimeout 链推进状态与时间轴，节奏 450-800ms/阶段
function runPipeline(store: KbStore, doc: KbDocumentDto): void {
  const stages = STAGE_ORDER.filter((s) => s.stage !== 'WIKI' || store.detail.config.wiki_enabled).filter(
    (s) => s.stage !== 'GRAPH' || store.detail.config.graph_enabled,
  )
  doc.status = 'QUEUED'
  doc.error = null
  doc.timeline = []
  let t = 0
  for (const s of stages) {
    const dur = 450 + ((doc.id * 37 + s.stage.length * 53) % 350)
    const start = t
    t += dur
    const ev: TimelineEventDto = {
      stage: s.stage,
      status: 'RUNNING',
      started_at: null,
      finished_at: null,
      duration_ms: null,
      error: null,
    }
    setTimeout(() => {
      doc.status = s.processing
      ev.started_at = nowIso()
      doc.timeline.push(ev)
    }, start)
    setTimeout(() => {
      ev.status = 'DONE'
      ev.finished_at = nowIso()
      ev.duration_ms = dur
    }, t)
  }
  setTimeout(() => {
    doc.status = 'READY'
  }, t)
}

function doneTimeline(durs: Partial<Record<StageName, number>>, parseError?: string): TimelineEventDto[] {
  return STAGE_ORDER.map(({ stage }) => {
    const dur = durs[stage]
    if (parseError && stage === 'PARSE') {
      return {
        stage,
        status: 'FAILED',
        started_at: '2026-10-28T02:04:10Z',
        finished_at: '2026-10-28T02:04:12Z',
        duration_ms: dur ?? 1130,
        error: parseError,
      }
    }
    if (dur != null) {
      return {
        stage,
        status: 'DONE',
        started_at: '2026-10-28T02:00:00Z',
        finished_at: '2026-10-28T02:00:02Z',
        duration_ms: dur,
        error: null,
      }
    }
    return { stage, status: 'SKIPPED', started_at: null, finished_at: null, duration_ms: null, error: null }
  })
}

function appendChunks(store: KbStore, doc: KbDocumentDto, text: string): void {
  const size = Math.max(store.detail.config.chunk_size, 100)
  const overlap = Math.min(store.detail.config.chunk_overlap, size - 1)
  const pieces: string[] = []
  if (text.trim()) {
    for (let start = 0; start < text.length; start += size - overlap) {
      const piece = text.slice(start, start + size).trim()
      if (piece) pieces.push(piece)
      if (start + size >= text.length) break
    }
  } else {
    for (let i = 1; i <= 3; i++) {
      pieces.push(
        `${doc.filename} 第 ${i} 段（二进制文档解析占位）：本块内容来自解析流水线，此处为 mock 生成的占位文本，接入真实后端后展示实际分段结果。`,
      )
    }
  }
  pieces.forEach((content, i) => {
    store.chunks.push({
      id: ++chunkSeq,
      doc_id: doc.id,
      seq: i + 1,
      content,
      source: 'DOCUMENT',
      is_qa: false,
      question: null,
      answer: null,
      token_count: Math.ceil(content.length * 0.6),
      has_parent: store.detail.config.chunk_mode === 'PARENT_CHILD',
    })
  })
  doc.chunk_count = pieces.length
}

function buildWikiTree(store: KbStore): WikiTreeNodeDto[] {
  const byParent = new Map<string | null, WikiPageDto[]>()
  for (const p of store.wikiPages) {
    const list = byParent.get(p.parent_slug) ?? []
    list.push(p)
    byParent.set(p.parent_slug, list)
  }
  const build = (parent: string | null): WikiTreeNodeDto[] =>
    (byParent.get(parent) ?? []).map((p) => ({
      slug: p.slug,
      title: p.title,
      page_id: p.id,
      children: build(p.slug),
    }))
  return build(null)
}

// 召回打分：bigram 重合度模拟向量/关键词相似度，RRF 融合，确定性输出
function bigrams(s: string): string[] {
  const clean = s.replace(/[\s，。？！；：、,.?!;:()（）]/g, '')
  const res: string[] = []
  for (let i = 0; i < clean.length - 1; i++) res.push(clean.slice(i, i + 2))
  return res
}

function overlapScore(query: string, target: string): number {
  const qb = bigrams(query)
  const db = new Set(bigrams(target))
  if (qb.length === 0 || db.size === 0) return 0
  return qb.filter((g) => db.has(g)).length / qb.length
}

function seedKnowledge(): void {
  // ---- KB1：文档库（Wiki + 图谱开启）----
  const kb1Config: KbConfigDto = {
    chunk_mode: 'GENERAL',
    chunk_size: 512,
    chunk_overlap: 80,
    separators: ['\n\n', '\n', '。'],
    qa_index_mode: 'QUESTION_ANSWER',
    embedding_model_id: 2,
    embedding_model_name: 'bge-m3',
    generation_model_id: 1,
    generation_model_name: 'qwen2.5:7b',
    rerank_model_id: 3,
    rerank_model_name: 'bge-reranker-v2-m3',
    vector_enabled: true,
    keyword_enabled: true,
    wiki_enabled: true,
    graph_enabled: true,
    top_k: 5,
    score_threshold: 0,
    rrf_vector_weight: 0.5,
    metadata_schema: [{ key: 'department', label: '部门', type: 'ENUM', options: ['产品', '研发', '运维'] }],
    wiki_granularity: 'STANDARD',
  }

  const mkChunk = (docId: number, seq: number, content: string): KbChunkDto => ({
    id: ++chunkSeq,
    doc_id: docId,
    seq,
    content,
    source: 'DOCUMENT',
    is_qa: false,
    question: null,
    answer: null,
    token_count: Math.ceil(content.length * 0.6),
    has_parent: false,
  })

  const doc101: KbDocumentDto = {
    id: 101,
    kb_id: 1,
    filename: 'Hify-产品说明.md',
    mime: 'text/markdown',
    status: 'READY',
    error: null,
    word_count: 1840,
    chunk_count: 4,
    tags: ['产品', 'v1.0'],
    metadata: { department: '产品' },
    created_at: '2026-10-28T02:00:00Z',
    timeline: doneTimeline({ PARSE: 320, CHUNK: 480, EMBED: 1560, WIKI: 4200, GRAPH: 6800 }),
  }
  const doc102: KbDocumentDto = {
    id: 102,
    kb_id: 1,
    filename: 'Hify-部署手册.md',
    mime: 'text/markdown',
    status: 'READY',
    error: null,
    word_count: 2210,
    chunk_count: 4,
    tags: ['部署'],
    metadata: { department: '运维' },
    created_at: '2026-10-28T02:00:00Z',
    timeline: doneTimeline({ PARSE: 290, CHUNK: 510, EMBED: 1720, WIKI: 4600, GRAPH: 7100 }),
  }
  const doc103: KbDocumentDto = {
    id: 103,
    kb_id: 1,
    filename: '架构设计 v0.3.pdf',
    mime: 'application/pdf',
    status: 'FAILED',
    error: '解析失败：检测到扫描件（图片型 PDF），一期不支持 OCR——请转存为文字版后重试',
    word_count: 0,
    chunk_count: 0,
    tags: [],
    metadata: {},
    created_at: '2026-10-28T02:04:10Z',
    timeline: doneTimeline({ PARSE: 1130 }, '检测到扫描件（图片型 PDF），一期不支持 OCR'),
  }

  const kb1Chunks: KbChunkDto[] = [
    mkChunk(
      101,
      1,
      'Hify 是受 Dify 启发的简化版内部 AI Agent 平台，面向 20-50 人团队、docker-compose 本地部署。核心理念：单应用容器 + 单数据库，运维成本压到最低，pg_dump 即全量备份。',
    ),
    mkChunk(
      101,
      2,
      '应用类型只有 Agent 一种：提示词 + 模型 + 工具 + 知识库的组合即为一个应用；不挂工具与知识库时即为纯聊天助手。一期不做可视化工作流画布与插件体系。',
    ),
    mkChunk(
      101,
      3,
      '内置工具两类：web 搜索与自定义 HTTP 工具。Agent 执行为手写 ReAct 循环：最大步数默认 8，每步工具调用写日志，工具执行错误回传给模型处理而不是中断会话。',
    ),
    mkChunk(
      101,
      4,
      '权限只有 admin / member 两种角色：admin 负责构建应用、知识库与模型接入；member 仅使用聊天与会话历史。对话支持点赞点踩反馈，用量按应用统计 token 与费用。',
    ),
    mkChunk(
      102,
      1,
      '部署采用 docker-compose 双容器：app（Spring Boot 托管前端静态资源）与 db（ParadeDB）。执行 docker compose up -d 启动全栈，Flyway 自动完成数据库迁移。',
    ),
    mkChunk(
      102,
      2,
      '数据库是 ParadeDB（PostgreSQL 发行版）：pgvector 提供 HNSW 向量索引（cosine），pg_search 提供 BM25 中文全文检索。无 Redis、无消息队列、无 Neo4j。',
    ),
    mkChunk(
      102,
      3,
      '模型接入走 OpenAI 兼容协议：填写 base_url 与 API Key 即可，本地 Ollama 与云端供应商均可。API Key 以 AES-GCM 加密落库，主密钥来自环境变量 HIFY_MASTER_KEY，日志一律脱敏。',
    ),
    mkChunk(
      102,
      4,
      '备份策略：PostgreSQL 是唯一持久化存储，定期 pg_dump 即完成全量备份。上传文档以 bytea 存库，单文件上限 20MB；会话走 Spring Session JDBC，重启不掉线。',
    ),
  ]

  const wikiOverviewV1 = `## Hify 知识库总览

本页汇总 Hify 产品的核心知识，由入库流水线自动生成。

### 核心主题
- [[architecture]]：模块化单体的分层设计与依赖方向
- [[deployment]]：docker-compose 双容器部署与备份策略
- [[faq-common]]：高频问题速查`

  const wikiOverviewV2 = `## Hify 知识库总览

本页汇总 Hify 产品的核心知识，由入库流水线自动生成，人工补充快速导航。

### 核心主题
- [[architecture]]：模块化单体的分层设计与依赖方向
- [[deployment]]：docker-compose 双容器部署与备份策略
- [[faq-common]]：高频问题速查

### 快速定位
- 想了解检索原理 → 阅读 [[storage]]
- 想排查流式输出问题 → 阅读 [[streaming]]
- 想创建第一个 Agent → 从 [[getting-started]] 开始`

  const mkPage = (
    id: number,
    slug: string,
    title: string,
    parentSlug: string | null,
    content: string,
    sourceChunkIds: number[],
  ): WikiPageDto => ({
    id,
    kb_id: 1,
    slug,
    title,
    parent_slug: parentSlug,
    content_md: content,
    source_chunk_ids: sourceChunkIds,
    version: 1,
    updated_at: '2026-10-28T02:05:00Z',
  })

  const wikiArchitecture = `## 系统架构

Hify 是**模块化单体**：单 Maven 工程、包级模块划分、ArchUnit 守护边界。

### 模块与依赖方向
- conversation → agent → knowledge → modelgateway → common
- usage 只订阅事件，不做强依赖

### 关键约束
- Agent 循环手写（ReAct / function-calling），不引入框架抽象
- 模型调用一律走 modelgateway 的 ModelClientApi
- 知识库的 pgvector 表只有 knowledge 模块能访问

数据库选型见 [[storage]]。`

  const wikiStorage = `## 存储与检索

数据库是 **ParadeDB**（PostgreSQL 发行版）：pgvector 提供 HNSW 向量索引，pg_search 提供 BM25 中文全文检索。

### 混合检索流程
1. 向量路与全文路各自取 top-k
2. RRF 融合：score(d) = Σ w_i / (60 + rank_i(d))
3. 可选 Rerank 精排

### 表前缀约定
- iam_ / mg_ / agent_ / kb_ / chat_ / usage_
- 禁止跨模块 JOIN 与外键，要别人的数据走接口`

  const wikiStreaming = `## 流式输出

聊天采用 SSE 推流：SseEmitter + 显式超时 + 断连处理，响应头 X-Accel-Buffering: no。

### 前端约定
- fetch + ReadableStream 解析（不用 EventSource，需 POST 与鉴权头）
- 增量 markdown 渲染，打字机效果下处理代码高亮

### 超时策略
- 流式调用：首包 + chunk 空闲双超时，禁止总超时
- 已向用户输出内容后禁止自动重试`

  const wikiDeployment = `## 部署指南

两条命令启动全栈：

\`\`\`bash
docker compose up -d
\`\`\`

### 容器职责
- app：Spring Boot 托管前端静态资源
- db：ParadeDB（pgvector + pg_search）

### 备份
PG 是唯一持久化存储，定期 \`pg_dump\` 即完成全量备份；上传文档以 bytea 存库，单文件上限 20MB。

排查部署问题见 [[faq-common]]。`

  const wikiGettingStarted = `## 快速上手

1. 管理员在「模型供应商」添加 OpenAI 兼容端点（或启用 Ollama profile）
2. 创建 Agent：提示词 + 模型 + 工具 + 知识库
3. member 直接进入聊天页使用

系统全貌见 [[overview]]。`

  const wikiFaqCommon = `## 常见问题

- 忘记密码 → 联系管理员重置，一期不支持自助找回
- 图片型 PDF 报错 → 一期不做 OCR，转成文字版后重新上传
- 检索不命中 → 检查分块参数与 top_k，用「召回测试」逐路看分

更多运维问题在「运维 FAQ」知识库中。`

  const kb1WikiPages: WikiPageDto[] = [
    { ...mkPage(11, 'overview', 'Hify 知识库总览', null, wikiOverviewV2, [5001, 5002, 5005, 5006]), version: 2, updated_at: '2026-10-29T06:20:00Z' },
    mkPage(12, 'architecture', '系统架构', 'overview', wikiArchitecture, [5002, 5004, 5006]),
    mkPage(13, 'storage', '存储与检索', 'architecture', wikiStorage, [5006, 5007, 5008]),
    mkPage(14, 'streaming', '流式输出', 'architecture', wikiStreaming, [5003]),
    mkPage(15, 'deployment', '部署指南', 'overview', wikiDeployment, [5005, 5006, 5008]),
    mkPage(16, 'getting-started', '快速上手', null, wikiGettingStarted, [5001]),
    mkPage(17, 'faq-common', '常见问题', null, wikiFaqCommon, [5004]),
  ]

  const mkVersion = (id: number, pageId: number, version: number, source: WikiVersionDto['edit_source'], editor: string, summary: string): WikiVersionDto => ({
    id,
    page_id: pageId,
    version,
    edit_source: source,
    editor_name: editor,
    summary,
    created_at: version === 1 ? '2026-10-28T02:05:00Z' : '2026-10-29T06:20:00Z',
  })

  const pageContents: Record<number, string> = {
    12: wikiArchitecture,
    13: wikiStorage,
    14: wikiStreaming,
    15: wikiDeployment,
    16: wikiGettingStarted,
    17: wikiFaqCommon,
  }
  const kb1Versions: WikiVersionDto[] = [
    mkVersion(901, 11, 1, 'PIPELINE', 'hify-pipeline', '入库时自动生成'),
    mkVersion(902, 11, 2, 'USER', 'admin', '补充快速导航'),
    ...kb1WikiPages
      .filter((p) => p.id !== 11)
      .map((p) => mkVersion(900 + p.id, p.id, 1, 'PIPELINE', 'hify-pipeline', '入库时自动生成')),
  ]
  const kb1VersionContents: Record<number, string> = { 901: wikiOverviewV1, 902: wikiOverviewV2 }
  for (const [pageId, content] of Object.entries(pageContents)) {
    kb1VersionContents[900 + Number(pageId)] = content
  }

  const gn = (name: string, type: string, weight: number) => ({ id: ++graphNodeSeq, name, type, weight })
  const ge = (source: number, target: number, relation: string, weight: number) => ({
    id: ++graphEdgeSeq,
    source,
    target,
    relation,
    weight,
  })
  const nHify = gn('Hify', '产品', 9)
  const nAgent = gn('Agent', '模块', 8)
  const nKb = gn('知识库', '模块', 7)
  const nMg = gn('模型网关', '模块', 6)
  const nConv = gn('会话', '模块', 5)
  const nTool = gn('工具调用', '模块', 5)
  const nPgvector = gn('pgvector', '存储', 4)
  const nParade = gn('ParadeDB', '存储', 5)
  const nBm25 = gn('BM25 全文检索', '检索', 4)
  const nRrf = gn('RRF 融合', '检索', 4)
  const nHnsw = gn('HNSW 索引', '检索', 3)
  const nSse = gn('SSE 流式', '协议', 3)
  const nFlyway = gn('Flyway 迁移', '工程', 2)
  const nCompose = gn('docker-compose 部署', '工程', 3)
  const kb1Graph: GraphDataDto = {
    nodes: [nHify, nAgent, nKb, nMg, nConv, nTool, nPgvector, nParade, nBm25, nRrf, nHnsw, nSse, nFlyway, nCompose],
    edges: [
      ge(nHify.id, nAgent.id, '包含', 3),
      ge(nHify.id, nKb.id, '包含', 2),
      ge(nHify.id, nMg.id, '包含', 2),
      ge(nHify.id, nConv.id, '包含', 2),
      ge(nAgent.id, nTool.id, '使用', 3),
      ge(nAgent.id, nKb.id, '检索', 3),
      ge(nKb.id, nPgvector.id, '依赖', 2),
      ge(nKb.id, nParade.id, '依赖', 2),
      ge(nParade.id, nBm25.id, '提供', 2),
      ge(nPgvector.id, nHnsw.id, '提供', 2),
      ge(nBm25.id, nRrf.id, '融合于', 2),
      ge(nHnsw.id, nRrf.id, '融合于', 2),
      ge(nRrf.id, nKb.id, '服务于', 3),
      ge(nConv.id, nSse.id, '推送', 2),
      ge(nHify.id, nFlyway.id, '使用', 1),
      ge(nHify.id, nCompose.id, '部署于', 2),
    ],
  }

  kbStores.set(1, {
    detail: {
      id: 1,
      name: 'Hify 产品手册',
      type: 'DOCUMENT',
      description: '产品说明、部署手册与架构设计，含 Wiki 导览与知识图谱',
      document_count: 3,
      chunk_count: 8,
      word_count: 4050,
      created_at: '2026-10-27T08:00:00Z',
      config: kb1Config,
    },
    docs: [doc101, doc102, doc103],
    chunks: kb1Chunks,
    wikiPages: kb1WikiPages,
    wikiVersions: kb1Versions,
    versionContents: kb1VersionContents,
    graph: kb1Graph,
  })

  // ---- KB2：FAQ 库 ----
  const kb2Config: KbConfigDto = {
    chunk_mode: 'QA',
    chunk_size: 512,
    chunk_overlap: 0,
    separators: ['\n'],
    qa_index_mode: 'QUESTION_ONLY',
    embedding_model_id: 2,
    embedding_model_name: 'bge-m3',
    generation_model_id: null,
    generation_model_name: null,
    rerank_model_id: null,
    rerank_model_name: null,
    vector_enabled: true,
    keyword_enabled: true,
    wiki_enabled: false,
    graph_enabled: false,
    top_k: 5,
    score_threshold: 0,
    rrf_vector_weight: 0.5,
    metadata_schema: [],
    wiki_granularity: 'STANDARD',
  }
  const doc201: KbDocumentDto = {
    id: 201,
    kb_id: 2,
    filename: '标准运维问答.csv',
    mime: 'text/csv',
    status: 'READY',
    error: null,
    word_count: 960,
    chunk_count: 8,
    tags: ['运维'],
    metadata: {},
    created_at: '2026-10-27T09:00:00Z',
    timeline: doneTimeline({ PARSE: 80, CHUNK: 140, EMBED: 640 }),
  }
  const faqRows: [string, string][] = [
    ['忘记密码怎么办？', '联系管理员在用户管理中重置，一期不支持自助找回。'],
    ['知识库支持哪些文件格式？', '文本型 PDF / DOCX / MD / TXT；检测到图片型 PDF 会明确报错提示不支持 OCR。'],
    ['如何添加新的模型？', '管理员在「模型供应商」页配置 base_url 与 API Key，再从远程模型列表导入或手动添加。'],
    ['知识库检索支持全文匹配吗？', '支持。BM25 中文全文 + 向量语义混合检索，RRF 融合排序，可选 Rerank 精排。'],
    ['数据存储在哪里？', '全部在 PostgreSQL（ParadeDB）中，定期 pg_dump 即完成全量备份。'],
    ['聊天记录可以导出吗？', '一期不支持导出，可在对话日志页按会话查看与点赞点踩反馈。'],
    ['member 角色能创建知识库吗？', '不能。知识库与 Agent 构建是 admin 权限，member 仅使用聊天。'],
    ['服务重启后正在聊天的会话会丢吗？', '不会。会话由 Spring Session JDBC 持久化在 PG 中，重启不掉线。'],
  ]
  const kb2Chunks: KbChunkDto[] = faqRows.map(([q, a], i) => ({
    id: ++chunkSeq,
    doc_id: 201,
    seq: i + 1,
    content: `${q}\n${a}`,
    source: 'FAQ',
    is_qa: true,
    question: q,
    answer: a,
    token_count: Math.ceil((q.length + a.length) * 0.6),
    has_parent: false,
  }))

  kbStores.set(2, {
    detail: {
      id: 2,
      name: '运维 FAQ',
      type: 'FAQ',
      description: '客服与运维高频问答，仅索引问题向量，命中精准、嵌入减半',
      document_count: 1,
      chunk_count: 8,
      word_count: 960,
      created_at: '2026-10-27T09:00:00Z',
      config: kb2Config,
    },
    docs: [doc201],
    chunks: kb2Chunks,
    wikiPages: [],
    wikiVersions: [],
    versionContents: {},
    graph: { nodes: [], edges: [] },
  })
}

seedKnowledge()

// ---------- agent / conversation / usage / iam-users mock ----------

function daysAgoIso(days: number, hour = 10, minute = 0): string {
  const d = new Date()
  d.setDate(d.getDate() - days)
  d.setHours(hour, minute, 0, 0)
  return d.toISOString()
}

function localKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function isAdmin(): boolean {
  return mockUsers.find((m) => m.user_name === mockUserName)?.role === 'ADMIN'
}

function forbidden() {
  return HttpResponse.json(fail(403, '需要管理员权限'), { status: 403 })
}

const mockUsers: UserDto[] = [
  { id: 1, user_name: 'admin', role: 'ADMIN', enabled: true, created_at: '2026-10-01T09:00:00Z', last_login_at: daysAgoIso(0, 8, 52) },
  { id: 2, user_name: 'zhangsan', role: 'MEMBER', enabled: true, created_at: '2026-10-12T14:30:00Z', last_login_at: daysAgoIso(1, 16, 20) },
  { id: 3, user_name: 'lisi', role: 'MEMBER', enabled: true, created_at: '2026-10-20T10:10:00Z', last_login_at: daysAgoIso(3, 9, 5) },
  { id: 4, user_name: 'wangwu', role: 'MEMBER', enabled: false, created_at: '2026-10-25T11:00:00Z', last_login_at: null },
]
let userSeq = 100

const mockTools: ToolDto[] = [
  {
    id: 1,
    name: 'web_search',
    display_name: 'Web 搜索',
    description: '内置搜索引擎工具，按关键词检索公开网页并返回摘要结果',
    type: 'WEB_SEARCH',
    http_config: null,
    builtin: true,
    created_at: '2026-10-15T08:00:00Z',
  },
  {
    id: 2,
    name: 'weather_query',
    display_name: '天气查询',
    description: '查询指定城市的实时天气（GET 型自定义 HTTP 工具示例）',
    type: 'HTTP',
    http_config: { method: 'GET', url: 'https://api.weather.example.com/v1/now', headers: {}, body_template: '' },
    builtin: false,
    created_at: '2026-10-18T09:30:00Z',
  },
  {
    id: 3,
    name: 'inventory_lookup',
    display_name: '库存查询',
    description: '按 SKU 查询 ERP 库存（POST + 请求体模板示例）',
    type: 'HTTP',
    http_config: { method: 'POST', url: 'https://erp.internal.example.com/api/inventory', headers: {}, body_template: '{"sku": "{{sku}}"}' },
    builtin: false,
    created_at: '2026-10-22T13:45:00Z',
  },
]
let toolSeq = 100

function genApiKey(): string {
  return `hify-agt-${Math.random().toString(36).slice(2, 12)}`
}

function kbBinding(ids: number[]): { knowledge_base_ids: number[]; knowledge_base_names: string[] } {
  const valid = ids.filter((id) => kbStores.has(id))
  return { knowledge_base_ids: valid, knowledge_base_names: valid.map((id) => kbStores.get(id)!.detail.name) }
}

const mockAgents: AgentDto[] = [
  {
    id: 1,
    name: '产品问答助手',
    description: '基于 Hify 产品文档回答部署、功能与使用问题',
    opening_statement: '你好，我是产品问答助手，可以问我 Hify 的部署方式、功能边界和使用方法。',
    system_prompt: '你是 Hify 平台的产品支持助手。回答必须基于知识库检索内容，引用来源时标注 [n]，知识库没有的信息要明确说明不知道。',
    model_id: 1,
    model_name: 'qwen2.5:7b',
    temperature: 0.3,
    ...kbBinding([1]),
    tool_ids: [],
    api_key: 'hify-agt-8f3kq2mw7x',
    created_at: '2026-10-16T10:00:00Z',
    updated_at: daysAgoIso(2, 15, 0),
  },
  {
    id: 2,
    name: '运维值班助手',
    description: '运维 FAQ 检索 + 天气 / Web 搜索工具，值班答疑',
    opening_statement: '你好，我是运维值班助手。可以咨询账号、部署等运维问题，也可以让我查天气或搜索资料。',
    system_prompt: '你是 Hify 平台的运维值班助手。优先检索运维 FAQ，必要时调用工具补充信息，引用来源时标注 [n]。',
    model_id: 1,
    model_name: 'qwen2.5:7b',
    temperature: 0.2,
    ...kbBinding([2]),
    tool_ids: [1, 2],
    api_key: 'hify-agt-p4n8vcxq1z',
    created_at: '2026-10-17T11:20:00Z',
    updated_at: daysAgoIso(1, 10, 30),
  },
  {
    id: 3,
    name: '通用助手',
    description: '无知识库的轻量助手，仅挂 Web 搜索工具',
    opening_statement: '你好，我是通用助手，随便聊聊，也可以帮你搜索网上的资料。',
    system_prompt: '你是 Hify 平台的通用助手，友好、简洁，必要时调用 web_search 工具。',
    model_id: 1,
    model_name: 'qwen2.5:7b',
    temperature: 0.7,
    ...kbBinding([]),
    tool_ids: [1],
    api_key: 'hify-agt-t7r2ybd5ke',
    created_at: '2026-10-19T09:00:00Z',
    updated_at: daysAgoIso(5, 14, 10),
  },
]
let agentSeq = 100

function toCitation(kbId: number, chunk: KbChunkDto, score: number): CitationDto {
  const store = kbStores.get(kbId)
  const doc = store?.docs.find((d) => d.id === chunk.doc_id)
  return {
    kb_id: kbId,
    kb_name: store?.detail.name ?? '',
    doc_name: doc?.filename ?? '未知文档',
    chunk_seq: chunk.seq,
    content: chunk.content.slice(0, 160),
    score,
  }
}

interface MockSession {
  session: SessionSummaryDto
  messages: MessageDto[]
  owner: string
}

const kb1Chunks = kbStores.get(1)?.chunks ?? []
const kb2Chunks = kbStores.get(2)?.chunks ?? []

const mockSessions: MockSession[] = [
  {
    session: {
      id: 1,
      agent_id: 1,
      agent_name: '产品问答助手',
      title: 'Hify 怎么部署？',
      message_count: 2,
      created_at: daysAgoIso(2, 10, 12),
      updated_at: daysAgoIso(2, 10, 13),
    },
    owner: 'admin',
    messages: [
      { id: 2001, role: 'USER', content: 'Hify 怎么部署？需要哪些中间件？', citations: [], feedback: null, input_tokens: 0, output_tokens: 0, elapsed_ms: 0, created_at: daysAgoIso(2, 10, 12) },
      {
        id: 2002,
        role: 'ASSISTANT',
        content: [
          'Hify 采用 **docker-compose 单机部署**，只有两个容器：',
          '',
          '- `app`：Spring Boot 应用（内置前端静态资源）',
          '- `db`：ParadeDB（PostgreSQL + pgvector + BM25）',
          '',
          '不需要 Redis、消息队列等额外中间件 [1]。',
          '',
          '> 数据全部存在 PostgreSQL 中，`pg_dump` 即可完成全量备份 [2]。',
        ].join('\n'),
        citations: [
          toCitation(1, kb1Chunks[0]!, 0.872),
          toCitation(1, kb1Chunks[1]!, 0.794),
        ],
        feedback: 'LIKE',
        input_tokens: 412,
        output_tokens: 356,
        elapsed_ms: 2400,
        created_at: daysAgoIso(2, 10, 13),
      },
    ],
  },
  {
    session: {
      id: 2,
      agent_id: 2,
      agent_name: '运维值班助手',
      title: 'member 用户忘记密码',
      message_count: 2,
      created_at: daysAgoIso(1, 16, 30),
      updated_at: daysAgoIso(1, 16, 31),
    },
    owner: 'zhangsan',
    messages: [
      { id: 2003, role: 'USER', content: 'member 用户忘记密码了怎么办？', citations: [], feedback: null, input_tokens: 0, output_tokens: 0, elapsed_ms: 0, created_at: daysAgoIso(1, 16, 30) },
      {
        id: 2004,
        role: 'ASSISTANT',
        content: '请联系管理员在「用户管理」页重置密码：管理员进入用户管理，找到对应账号点击「重置密码」，设置不少于 6 位的新密码即可 [1]。',
        citations: [toCitation(2, kb2Chunks[3]!, 0.815)],
        feedback: 'DISLIKE',
        input_tokens: 298,
        output_tokens: 210,
        elapsed_ms: 1800,
        created_at: daysAgoIso(1, 16, 31),
      },
    ],
  },
]
let sessionSeq = 100
let messageSeq = 2000

function findSession(idRaw: string | readonly string[] | undefined): MockSession | undefined {
  return mockSessions.find((s) => s.session.id === Number(idRaw))
}

function buildChatAnswer(q: string, citations: CitationDto[], webSearch: boolean, agentName: string): string {
  if (citations.length > 0) {
    const lines = [`根据知识库检索结果，回答你的问题「${q}」：`, '']
    citations.forEach((c, i) => {
      lines.push(`${i + 1}. **${c.doc_name}（第 ${c.chunk_seq} 块，相关度 ${c.score.toFixed(3)}）**：${c.content.slice(0, 60)}… [${i + 1}]`)
    })
    lines.push('', '> 以上内容来自知识库混合检索（向量 + BM25，RRF 融合），点击引用标注可跳转查看完整片段。')
    return lines.join('\n')
  }
  if (webSearch) {
    return [
      `（${agentName} mock 回复）我没有在知识库中找到直接相关的内容，已调用 **web_search** 工具补充：`,
      '',
      '1. 工具返回了若干公开网页摘要（mock）',
      '2. 结合你的问题「' + q + '」，建议优先参考官方文档',
      '',
      '```bash',
      '# 工具调用记录（mock）',
      'web_search(query="' + q.slice(0, 20) + '") -> 3 results',
      '```',
      '',
      '当前为 MSW mock 流式输出演示，接入真实后端后此处为模型回答。',
    ].join('\n')
  }
  return [
    `（${agentName} mock 回复）已收到你的消息：「${q}」`,
    '',
    '| 能力 | 状态 |',
    '| --- | --- |',
    '| 流式输出 | 已生效（SSE 分块推送） |',
    '| Markdown 渲染 | 表格 / 列表 / 代码块 / 引用 |',
    '| 停止生成 | 点击「停止」中断流 |',
    '',
    '接入真实后端后，将 `.env.development` 中的 `VITE_ENABLE_MSW` 改为 `false` 即可切换到 vite 代理。',
  ].join('\n')
}

// ---------- usage mock ----------

const USAGE_MODELS: { name: string; inPrice: number; outPrice: number }[] = [
  { name: 'qwen2.5:7b', inPrice: 0.0008, outPrice: 0.0016 },
  { name: 'deepseek-v3', inPrice: 0.001, outPrice: 0.002 },
]

let usageSeq = 1
const usageLogs: UsageLogDto[] = []

function seedUsage(): void {
  const users = ['admin', 'zhangsan', 'lisi']
  const agents = [mockAgents[0]!, mockAgents[1]!, mockAgents[2]!]
  for (let day = 13; day >= 0; day--) {
    const calls = 2 + ((day * 7 + 3) % 4)
    for (let i = 0; i < calls; i++) {
      const agent = agents[(day + i) % agents.length]!
      const model = USAGE_MODELS[(day + i) % USAGE_MODELS.length]!
      const inTok = 180 + ((day * 31 + i * 57) % 420)
      const outTok = 90 + ((day * 17 + i * 43) % 380)
      const failed = (day * 3 + i * 5) % 19 === 0
      usageLogs.push({
        id: usageSeq++,
        created_at: daysAgoIso(day, 9 + ((i * 3) % 9), (i * 17) % 60),
        user_name: users[(day + i) % users.length]!,
        agent_id: agent.id,
        agent_name: agent.name,
        model_name: model.name,
        input_tokens: inTok,
        output_tokens: failed ? 0 : outTok,
        cost: failed ? 0 : inTok * model.inPrice + outTok * model.outPrice,
        elapsed_ms: failed ? 30120 : 900 + ((day * 13 + i * 29) % 2600),
        success: !failed,
        error_message: failed ? '模型调用超时（首包 30s 未返回）' : null,
      })
    }
  }
}

seedUsage()

function computeSummary(days: number): UsageSummaryDto {
  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - days)
  cutoff.setHours(0, 0, 0, 0)
  const logs = usageLogs.filter((l) => new Date(l.created_at) >= cutoff)
  const byDay = new Map<string, UsageDayPoint>()
  const byAgent = new Map<number, UsageByAgent>()
  const byModel = new Map<string, UsageByModel>()
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date()
    d.setDate(d.getDate() - i)
    byDay.set(localKey(d), { date: localKey(d), calls: 0, tokens: 0, cost: 0 })
  }
  let inTok = 0
  let outTok = 0
  let cost = 0
  let okCount = 0
  for (const l of logs) {
    const dayPoint = byDay.get(localKey(new Date(l.created_at)))
    if (dayPoint) {
      dayPoint.calls++
      dayPoint.tokens += l.input_tokens + l.output_tokens
      dayPoint.cost += l.cost
    }
    inTok += l.input_tokens
    outTok += l.output_tokens
    cost += l.cost
    if (l.success) okCount++
    const a = byAgent.get(l.agent_id) ?? { agent_id: l.agent_id, agent_name: l.agent_name, calls: 0, tokens: 0, cost: 0 }
    a.calls++
    a.tokens += l.input_tokens + l.output_tokens
    a.cost += l.cost
    byAgent.set(l.agent_id, a)
    const m = byModel.get(l.model_name) ?? { model_name: l.model_name, calls: 0, tokens: 0, cost: 0 }
    m.calls++
    m.tokens += l.input_tokens + l.output_tokens
    m.cost += l.cost
    byModel.set(l.model_name, m)
  }
  return {
    total_calls: logs.length,
    total_input_tokens: inTok,
    total_output_tokens: outTok,
    total_cost: cost,
    success_rate: logs.length > 0 ? okCount / logs.length : 1,
    by_day: [...byDay.values()],
    by_agent: [...byAgent.values()].sort((x, y) => y.calls - x.calls),
    by_model: [...byModel.values()].sort((x, y) => y.calls - x.calls),
  }
}

function feedbackItems(): FeedbackItemDto[] {
  const items: FeedbackItemDto[] = []
  for (const s of mockSessions) {
    for (const m of s.messages) {
      if (!m.feedback) continue
      items.push({
        message_id: m.id,
        session_id: s.session.id,
        agent_name: s.session.agent_name,
        user_name: s.owner,
        feedback: m.feedback,
        content_snippet: m.content.replace(/[#>*`\n]+/g, ' ').slice(0, 80),
        created_at: m.created_at,
      })
    }
  }
  return items.sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
}

export const handlers = [
  http.get('/api/iam/me', () => {
    if (!mockUserName) {
      return HttpResponse.json(fail(401, '未登录'), { status: 401 })
    }
    return HttpResponse.json(ok(toUser(mockUserName)))
  }),

  http.post('/api/iam/login', async ({ request }) => {
    const body = (await request.json().catch(() => null)) as { user_name?: string; password?: string } | null
    if (!body?.user_name || !body?.password) {
      return HttpResponse.json(fail(1001, '用户名或密码错误'))
    }
    const existing = mockUsers.find((m) => m.user_name === body.user_name)
    if (existing && !existing.enabled) {
      return HttpResponse.json(fail(1002, '该账号已被停用，请联系管理员'))
    }
    mockUserName = body.user_name
    if (existing) existing.last_login_at = nowIso()
    return HttpResponse.json(ok(toUser(body.user_name)))
  }),

  http.post('/api/iam/logout', () => {
    mockUserName = null
    return HttpResponse.json(ok(null))
  }),

  http.post('/api/iam/me/password', async ({ request }) => {
    if (!mockUserName) return unauthorized()
    const body = (await request.json().catch(() => null)) as
      | { old_password?: string; new_password?: string }
      | null
    if (!body?.old_password) return HttpResponse.json(fail(1001, '旧密码不能为空'))
    if ((body.new_password ?? '').length < 6) return HttpResponse.json(fail(1002, '新密码至少 6 位'))
    return HttpResponse.json(ok(null))
  }),

  // ---------- conversation ----------

  http.get('/api/conversation/sessions', ({ request }) => {
    if (!mockUserName) return unauthorized()
    const agentId = new URL(request.url).searchParams.get('agent_id')
    let list = mockSessions.map((s) => deepCopy(s.session))
    if (agentId != null && agentId !== '') list = list.filter((s) => s.agent_id === Number(agentId))
    return HttpResponse.json(ok(list.sort((a, b) => (a.updated_at < b.updated_at ? 1 : -1))))
  }),

  http.post('/api/conversation/sessions', async ({ request }) => {
    if (!mockUserName) return unauthorized()
    const body = (await request.json().catch(() => null)) as { agent_id?: number } | null
    const agent = mockAgents.find((a) => a.id === body?.agent_id)
    if (!agent) return HttpResponse.json(fail(1001, 'Agent 不存在或已删除'))
    const s: SessionSummaryDto = {
      id: ++sessionSeq,
      agent_id: agent.id,
      agent_name: agent.name,
      title: '新会话',
      message_count: 0,
      created_at: nowIso(),
      updated_at: nowIso(),
    }
    mockSessions.push({ session: s, messages: [], owner: mockUserName })
    return HttpResponse.json(ok(deepCopy(s)))
  }),

  http.patch('/api/conversation/sessions/:id', async ({ request, params }) => {
    if (!mockUserName) return unauthorized()
    const target = findSession(params.id)
    if (!target) return HttpResponse.json(fail(404, '会话不存在'), { status: 404 })
    const body = (await request.json().catch(() => null)) as { title?: string } | null
    if (!body?.title?.trim()) return HttpResponse.json(fail(1001, '标题不能为空'))
    target.session.title = body.title.trim()
    return HttpResponse.json(ok(deepCopy(target.session)))
  }),

  http.delete('/api/conversation/sessions/:id', ({ params }) => {
    if (!mockUserName) return unauthorized()
    const idx = mockSessions.findIndex((s) => s.session.id === Number(params.id))
    if (idx < 0) return HttpResponse.json(fail(404, '会话不存在'), { status: 404 })
    mockSessions.splice(idx, 1)
    return HttpResponse.json(ok(null))
  }),

  http.get('/api/conversation/sessions/:id/messages', ({ params }) => {
    if (!mockUserName) return unauthorized()
    const target = findSession(params.id)
    if (!target) return HttpResponse.json(fail(404, '会话不存在'), { status: 404 })
    return HttpResponse.json(ok(deepCopy(target.messages)))
  }),

  http.post('/api/conversation/messages/:id/feedback', async ({ request, params }) => {
    if (!mockUserName) return unauthorized()
    const body = (await request.json().catch(() => null)) as { feedback?: FeedbackValue | null } | null
    let updated: MessageDto | null = null
    for (const s of mockSessions) {
      const m = s.messages.find((x) => x.id === Number(params.id))
      if (m && m.role === 'ASSISTANT') {
        m.feedback = body?.feedback ?? null
        updated = m
        break
      }
    }
    if (!updated) return HttpResponse.json(fail(404, '消息不存在'), { status: 404 })
    return HttpResponse.json(ok(deepCopy(updated)))
  }),

  http.post('/api/conversation/sessions/:id/messages', async ({ request, params }) => {
    if (!mockUserName) return unauthorized()
    const target = findSession(params.id)
    if (!target) return new HttpResponse('Not Found', { status: 404 })
    const body = (await request.json().catch(() => null)) as { content?: string } | null
    const userContent = (body?.content ?? '').trim()
    if (!userContent) return HttpResponse.json(fail(1001, '消息不能为空'))
    const agent = mockAgents.find((a) => a.id === target.session.agent_id)

    // 检索：对 Agent 绑定的知识库逐块打分（FAQ 块按问题匹配），取 top-3
    const hits: { citation: CitationDto; raw: number }[] = []
    for (const kbId of agent?.knowledge_base_ids ?? []) {
      const store = kbStores.get(kbId)
      if (!store) continue
      for (const chunk of store.chunks) {
        const text = chunk.is_qa && chunk.question ? chunk.question : chunk.content
        const raw = overlapScore(userContent, text)
        if (raw > 0) hits.push({ citation: toCitation(kbId, chunk, raw), raw })
      }
    }
    hits.sort((x, y) => y.raw - x.raw)
    const citations = hits.slice(0, 3).map((h) => ({ ...h.citation, score: Math.min(0.95, 0.6 + h.raw) }))
    const useWebSearch = agent?.tool_ids.includes(1) ?? false
    const answer = buildChatAnswer(userContent, citations, useWebSearch, agent?.name ?? '助手')
    const startedAt = Date.now()

    const inputTokens = Math.ceil(userContent.length * 0.6) + 380
    const outputTokens = Math.ceil(answer.length * 0.6)
    const elapsedMs = 1100 + answer.length * 4

    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        try {
          controller.enqueue(encoder.encode(': keepalive\n\n'))
          if ((agent?.knowledge_base_ids.length ?? 0) > 0) {
            controller.enqueue(sse('status', '正在检索知识库…'))
            await delay(400)
          }
          if (citations.length > 0) controller.enqueue(sse('citations', citations))
          if (useWebSearch && citations.length === 0) {
            controller.enqueue(sse('status', '正在调用工具：web_search…'))
            await delay(500)
          } else if ((agent?.knowledge_base_ids.length ?? 0) === 0 && !useWebSearch) {
            controller.enqueue(sse('status', '正在思考…'))
            await delay(300)
          }
          // 后台标签页 setTimeout 被 Chrome 节流到 ≥1s，逐块 delay 会让流假死——按批 delay
          const pieces = answer.match(/[\s\S]{1,24}/g) ?? []
          for (let i = 0; i < pieces.length; i++) {
            controller.enqueue(sse('delta', pieces[i]!))
            if (i % 6 === 5) await delay(50)
          }
          const userMsg: MessageDto = {
            id: ++messageSeq,
            role: 'USER',
            content: userContent,
            citations: [],
            feedback: null,
            input_tokens: 0,
            output_tokens: 0,
            elapsed_ms: 0,
            created_at: nowIso(),
          }
          const assistantMsg: MessageDto = {
            id: ++messageSeq,
            role: 'ASSISTANT',
            content: answer,
            citations: deepCopy(citations),
            feedback: null,
            input_tokens: inputTokens,
            output_tokens: outputTokens,
            elapsed_ms: elapsedMs,
            created_at: nowIso(),
          }
          target.messages.push(userMsg, assistantMsg)
          target.session.message_count += 2
          target.session.updated_at = nowIso()
          if (target.session.title === '新会话') target.session.title = userContent.slice(0, 20)
          usageLogs.push({
            id: usageSeq++,
            created_at: nowIso(),
            user_name: mockUserName ?? 'unknown',
            agent_id: target.session.agent_id,
            agent_name: target.session.agent_name,
            model_name: agent?.model_name ?? 'qwen2.5:7b',
            input_tokens: inputTokens,
            output_tokens: outputTokens,
            cost: inputTokens * 0.0008 + outputTokens * 0.0016,
            elapsed_ms: Date.now() - startedAt,
            success: true,
            error_message: null,
          })
          controller.enqueue(
            sse('done', {
              message_id: assistantMsg.id,
              content: answer,
              citations,
              input_tokens: inputTokens,
              output_tokens: outputTokens,
              elapsed_ms: elapsedMs,
            }),
          )
          controller.close()
        } catch {
          // 客户端断开（停止生成）时 controller 已取消，直接放弃
        }
      },
    })
    return new HttpResponse(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'X-Accel-Buffering': 'no',
      },
    })
  }),

  // ---------- agent ----------

  http.get('/api/agent/agents', () => {
    if (!mockUserName) return unauthorized()
    return HttpResponse.json(ok(deepCopy(mockAgents)))
  }),

  http.post('/api/agent/agents', async ({ request }) => {
    if (!mockUserName) return unauthorized()
    if (!isAdmin()) return forbidden()
    const body = (await request.json().catch(() => null)) as AgentPayload | null
    if (!body?.name?.trim()) return HttpResponse.json(fail(1001, '名称不能为空'))
    const model = mockModels.find((m) => m.id === body.model_id)
    if (!model) return HttpResponse.json(fail(1002, '模型不存在'))
    const binding = kbBinding(body.knowledge_base_ids ?? [])
    const now = nowIso()
    const a: AgentDto = {
      id: ++agentSeq,
      name: body.name.trim(),
      description: body.description ?? '',
      opening_statement: body.opening_statement ?? '',
      system_prompt: body.system_prompt ?? '',
      model_id: model.id,
      model_name: model.name,
      temperature: body.temperature ?? 0.7,
      ...binding,
      tool_ids: (body.tool_ids ?? []).filter((id) => mockTools.some((t) => t.id === id)),
      api_key: genApiKey(),
      created_at: now,
      updated_at: now,
    }
    mockAgents.push(a)
    return HttpResponse.json(ok(deepCopy(a)))
  }),

  http.get('/api/agent/agents/:id', ({ params }) => {
    if (!mockUserName) return unauthorized()
    const a = mockAgents.find((x) => x.id === Number(params.id))
    if (!a) return HttpResponse.json(fail(404, 'Agent 不存在'), { status: 404 })
    return HttpResponse.json(ok(deepCopy(a)))
  }),

  http.patch('/api/agent/agents/:id', async ({ request, params }) => {
    if (!mockUserName) return unauthorized()
    if (!isAdmin()) return forbidden()
    const a = mockAgents.find((x) => x.id === Number(params.id))
    if (!a) return HttpResponse.json(fail(404, 'Agent 不存在'), { status: 404 })
    const body = (await request.json().catch(() => null)) as AgentPayload | null
    if (!body?.name?.trim()) return HttpResponse.json(fail(1001, '名称不能为空'))
    const model = mockModels.find((m) => m.id === body.model_id)
    if (!model) return HttpResponse.json(fail(1002, '模型不存在'))
    const binding = kbBinding(body.knowledge_base_ids ?? [])
    a.name = body.name.trim()
    a.description = body.description ?? ''
    a.opening_statement = body.opening_statement ?? ''
    a.system_prompt = body.system_prompt ?? ''
    a.model_id = model.id
    a.model_name = model.name
    a.temperature = body.temperature ?? 0.7
    a.knowledge_base_ids = binding.knowledge_base_ids
    a.knowledge_base_names = binding.knowledge_base_names
    a.tool_ids = (body.tool_ids ?? []).filter((id) => mockTools.some((t) => t.id === id))
    a.updated_at = nowIso()
    return HttpResponse.json(ok(deepCopy(a)))
  }),

  http.delete('/api/agent/agents/:id', ({ params }) => {
    if (!mockUserName) return unauthorized()
    if (!isAdmin()) return forbidden()
    const idx = mockAgents.findIndex((a) => a.id === Number(params.id))
    if (idx < 0) return HttpResponse.json(fail(404, 'Agent 不存在'), { status: 404 })
    mockAgents.splice(idx, 1)
    return HttpResponse.json(ok(null))
  }),

  http.post('/api/agent/agents/:id/api-key', ({ params }) => {
    if (!mockUserName) return unauthorized()
    if (!isAdmin()) return forbidden()
    const a = mockAgents.find((x) => x.id === Number(params.id))
    if (!a) return HttpResponse.json(fail(404, 'Agent 不存在'), { status: 404 })
    a.api_key = genApiKey()
    a.updated_at = nowIso()
    return HttpResponse.json(ok(deepCopy(a)))
  }),

  // ---------- agent tools ----------

  http.get('/api/agent/tools', () => {
    if (!mockUserName) return unauthorized()
    return HttpResponse.json(ok(deepCopy(mockTools)))
  }),

  http.post('/api/agent/tools', async ({ request }) => {
    if (!mockUserName) return unauthorized()
    if (!isAdmin()) return forbidden()
    const body = (await request.json().catch(() => null)) as ToolPayload | null
    if (!body?.name?.trim() || !body?.display_name?.trim()) {
      return HttpResponse.json(fail(1001, '工具名与显示名不能为空'))
    }
    if (!/^[a-z][a-z0-9_]*$/.test(body.name)) {
      return HttpResponse.json(fail(1002, '工具名仅允许小写字母、数字与下划线，且以字母开头'))
    }
    if (mockTools.some((t) => t.name === body.name)) {
      return HttpResponse.json(fail(1003, `同名工具「${body.name}」已存在`))
    }
    if (!body.http_config?.url) return HttpResponse.json(fail(1001, 'URL 不能为空'))
    const t: ToolDto = {
      id: ++toolSeq,
      name: body.name,
      display_name: body.display_name,
      description: body.description ?? '',
      type: 'HTTP',
      http_config: deepCopy(body.http_config),
      builtin: false,
      created_at: nowIso(),
    }
    mockTools.push(t)
    return HttpResponse.json(ok(deepCopy(t)))
  }),

  http.patch('/api/agent/tools/:id', async ({ request, params }) => {
    if (!mockUserName) return unauthorized()
    if (!isAdmin()) return forbidden()
    const t = mockTools.find((x) => x.id === Number(params.id))
    if (!t) return HttpResponse.json(fail(404, '工具不存在'), { status: 404 })
    if (t.builtin) return HttpResponse.json(fail(1004, '内置工具不可编辑'))
    const body = (await request.json().catch(() => null)) as ToolPayload | null
    if (!body?.name?.trim() || !body?.display_name?.trim()) {
      return HttpResponse.json(fail(1001, '工具名与显示名不能为空'))
    }
    if (!/^[a-z][a-z0-9_]*$/.test(body.name)) {
      return HttpResponse.json(fail(1002, '工具名仅允许小写字母、数字与下划线，且以字母开头'))
    }
    if (mockTools.some((x) => x.name === body.name && x.id !== t.id)) {
      return HttpResponse.json(fail(1003, `同名工具「${body.name}」已存在`))
    }
    if (!body.http_config?.url) return HttpResponse.json(fail(1001, 'URL 不能为空'))
    t.name = body.name
    t.display_name = body.display_name
    t.description = body.description ?? ''
    t.http_config = deepCopy(body.http_config)
    return HttpResponse.json(ok(deepCopy(t)))
  }),

  http.delete('/api/agent/tools/:id', ({ params }) => {
    if (!mockUserName) return unauthorized()
    if (!isAdmin()) return forbidden()
    const t = mockTools.find((x) => x.id === Number(params.id))
    if (!t) return HttpResponse.json(fail(404, '工具不存在'), { status: 404 })
    if (t.builtin) return HttpResponse.json(fail(1004, '内置工具不可删除'))
    mockTools.splice(mockTools.indexOf(t), 1)
    for (const a of mockAgents) {
      a.tool_ids = a.tool_ids.filter((id) => id !== t.id)
    }
    return HttpResponse.json(ok(null))
  }),

  // ---------- iam users ----------

  http.get('/api/iam/users', () => {
    if (!mockUserName) return unauthorized()
    if (!isAdmin()) return forbidden()
    return HttpResponse.json(ok(deepCopy(mockUsers)))
  }),

  http.post('/api/iam/users', async ({ request }) => {
    if (!mockUserName) return unauthorized()
    if (!isAdmin()) return forbidden()
    const body = (await request.json().catch(() => null)) as UserPayload | null
    if (!body?.user_name?.trim()) return HttpResponse.json(fail(1001, '用户名不能为空'))
    if (!body?.password || body.password.length < 6) return HttpResponse.json(fail(1002, '密码至少 6 位'))
    if (mockUsers.some((u) => u.user_name === body.user_name!.trim())) {
      return HttpResponse.json(fail(1003, `用户名「${body.user_name.trim()}」已存在`))
    }
    const u: UserDto = {
      id: ++userSeq,
      user_name: body.user_name.trim(),
      role: body.role === 'ADMIN' ? 'ADMIN' : 'MEMBER',
      enabled: true,
      created_at: nowIso(),
      last_login_at: null,
    }
    mockUsers.push(u)
    return HttpResponse.json(ok(deepCopy(u)))
  }),

  http.patch('/api/iam/users/:id', async ({ request, params }) => {
    if (!mockUserName) return unauthorized()
    if (!isAdmin()) return forbidden()
    const u = mockUsers.find((x) => x.id === Number(params.id))
    if (!u) return HttpResponse.json(fail(404, '用户不存在'), { status: 404 })
    const body = (await request.json().catch(() => null)) as UserPatch | null
    if (!body) return HttpResponse.json(fail(1001, '请求体不能为空'))
    if (body.role != null && u.user_name === 'admin') {
      return HttpResponse.json(fail(1004, '不能修改内置 admin 账号的角色'))
    }
    if (body.enabled != null && u.id === toUser(mockUserName ?? '').id) {
      return HttpResponse.json(fail(1005, '不能停用自己的账号'))
    }
    if (body.role != null) u.role = body.role
    if (body.enabled != null) u.enabled = body.enabled
    return HttpResponse.json(ok(deepCopy(u)))
  }),

  http.post('/api/iam/users/:id/reset-password', async ({ request, params }) => {
    if (!mockUserName) return unauthorized()
    if (!isAdmin()) return forbidden()
    const u = mockUsers.find((x) => x.id === Number(params.id))
    if (!u) return HttpResponse.json(fail(404, '用户不存在'), { status: 404 })
    const body = (await request.json().catch(() => null)) as { password?: string } | null
    if (!body?.password || body.password.length < 6) return HttpResponse.json(fail(1002, '密码至少 6 位'))
    return HttpResponse.json(ok(null))
  }),

  http.delete('/api/iam/users/:id', ({ params }) => {
    if (!mockUserName) return unauthorized()
    if (!isAdmin()) return forbidden()
    const u = mockUsers.find((x) => x.id === Number(params.id))
    if (!u) return HttpResponse.json(fail(404, '用户不存在'), { status: 404 })
    if (u.user_name === 'admin') return HttpResponse.json(fail(1004, '不能删除内置 admin 账号'))
    if (u.id === toUser(mockUserName ?? '').id) return HttpResponse.json(fail(1005, '不能删除自己'))
    mockUsers.splice(mockUsers.indexOf(u), 1)
    return HttpResponse.json(ok(null))
  }),

  // ---------- usage ----------

  http.get('/api/usage/summary', ({ request }) => {
    if (!mockUserName) return unauthorized()
    if (!isAdmin()) return forbidden()
    const days = Number(new URL(request.url).searchParams.get('days') ?? '14') || 14
    return HttpResponse.json(ok(computeSummary(days)))
  }),

  http.get('/api/usage/logs', ({ request }) => {
    if (!mockUserName) return unauthorized()
    if (!isAdmin()) return forbidden()
    const sp = new URL(request.url).searchParams
    const page = Math.max(1, Number(sp.get('page') ?? '1') || 1)
    const pageSize = Math.max(1, Number(sp.get('page_size') ?? '15') || 15)
    const agentId = sp.get('agent_id')
    const success = sp.get('success')
    let list = deepCopy(usageLogs).sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
    if (agentId != null && agentId !== '') list = list.filter((l) => l.agent_id === Number(agentId))
    if (success != null && success !== '') list = list.filter((l) => l.success === (success === 'true'))
    const total = list.length
    return HttpResponse.json(
      ok({ items: list.slice((page - 1) * pageSize, page * pageSize), total, page, page_size: pageSize }),
    )
  }),

  http.get('/api/usage/feedbacks', ({ request }) => {
    if (!mockUserName) return unauthorized()
    if (!isAdmin()) return forbidden()
    const sp = new URL(request.url).searchParams
    const page = Math.max(1, Number(sp.get('page') ?? '1') || 1)
    const pageSize = Math.max(1, Number(sp.get('page_size') ?? '10') || 10)
    const all = feedbackItems()
    return HttpResponse.json(
      ok({ items: all.slice((page - 1) * pageSize, page * pageSize), total: all.length, page, page_size: pageSize }),
    )
  }),

  // ---------- modelgateway ----------

  http.get('/api/modelgateway/providers', () => {
    if (!mockUserName) return unauthorized()
    return HttpResponse.json(ok(mockProviders.map(toProviderDto)))
  }),

  http.post('/api/modelgateway/providers', async ({ request }) => {
    if (!mockUserName) return unauthorized()
    const body = (await request.json().catch(() => null)) as ProviderPayload | null
    if (!body?.name || !body?.base_url) return HttpResponse.json(fail(1001, '名称和 base_url 不能为空'))
    if (mockProviders.some((p) => p.name === body.name)) {
      return HttpResponse.json(fail(1002, `同名供应商「${body.name}」已存在`))
    }
    const p: ProviderDto = {
      id: ++providerSeq,
      name: body.name,
      base_url: body.base_url,
      enabled: body.enabled ?? true,
      key_configured: Boolean(body.api_key),
      max_concurrency: body.max_concurrency ?? 8,
      embedding_batch_size: body.embedding_batch_size ?? 16,
      timeout_config: body.timeout_config ?? null,
      circuit_config: body.circuit_config ?? null,
      model_count: 0,
    }
    mockProviders.push(p)
    return HttpResponse.json(ok(toProviderDto(p)))
  }),

  http.patch('/api/modelgateway/providers/:id', async ({ request, params }) => {
    if (!mockUserName) return unauthorized()
    const p = findProvider(String(params.id))
    if (!p) return HttpResponse.json(fail(1004, '供应商不存在'))
    const body = (await request.json().catch(() => null)) as ProviderPayload | null
    if (!body) return HttpResponse.json(fail(1001, '请求体无效'))
    if (body.name !== undefined) p.name = body.name
    if (body.base_url !== undefined) p.base_url = body.base_url
    if (body.api_key) p.key_configured = true
    if (body.enabled !== undefined) p.enabled = body.enabled
    if (body.max_concurrency !== undefined) p.max_concurrency = body.max_concurrency
    if (body.embedding_batch_size !== undefined) p.embedding_batch_size = body.embedding_batch_size
    if (body.timeout_config !== undefined) p.timeout_config = body.timeout_config as TimeoutConfigDto | null
    if (body.circuit_config !== undefined) p.circuit_config = body.circuit_config as CircuitConfigDto | null
    return HttpResponse.json(ok(toProviderDto(p)))
  }),

  http.delete('/api/modelgateway/providers/:id', ({ params }) => {
    if (!mockUserName) return unauthorized()
    const p = findProvider(String(params.id))
    if (!p) return HttpResponse.json(fail(1004, '供应商不存在'))
    const count = mockModels.filter((m) => m.provider_id === p.id).length
    if (count > 0) {
      return HttpResponse.json(fail(1003, `删除失败：该供应商下还有 ${count} 个模型，请先删除模型`))
    }
    mockProviders.splice(mockProviders.indexOf(p), 1)
    return HttpResponse.json(ok(null))
  }),

  http.put('/api/modelgateway/providers/:id/test', async ({ params }) => {
    if (!mockUserName) return unauthorized()
    const p = findProvider(String(params.id))
    if (!p) return HttpResponse.json(fail(1004, '供应商不存在'))
    return HttpResponse.json(ok(await runProviderTest(p)))
  }),

  http.get('/api/modelgateway/providers/:id/remote-models', ({ params }) => {
    if (!mockUserName) return unauthorized()
    const p = findProvider(String(params.id))
    if (!p) return HttpResponse.json(fail(1004, '供应商不存在'))
    const names = remoteModels[p.name] ?? ['demo-model-a', 'demo-model-b', 'demo-embedding-model']
    return HttpResponse.json(ok(names.map((name) => ({ name }))))
  }),

  http.get('/api/modelgateway/providers/:id/models', ({ params }) => {
    if (!mockUserName) return unauthorized()
    const pid = Number(params.id)
    if (!findProvider(String(params.id))) return HttpResponse.json(fail(1004, '供应商不存在'))
    return HttpResponse.json(ok(mockModels.filter((m) => m.provider_id === pid).map((m) => ({ ...m }))))
  }),

  http.post('/api/modelgateway/providers/:id/models', async ({ request, params }) => {
    if (!mockUserName) return unauthorized()
    const pid = Number(params.id)
    const p = findProvider(String(params.id))
    if (!p) return HttpResponse.json(fail(1004, '供应商不存在'))
    const body = (await request.json().catch(() => null)) as ModelPayload | null
    if (!body?.name) return HttpResponse.json(fail(1001, '模型名不能为空'))
    if (mockModels.some((m) => m.provider_id === pid && m.name === body.name)) {
      return HttpResponse.json(fail(1002, `同名模型「${body.name}」已存在`))
    }
    const m: ModelDto = {
      id: ++modelSeq,
      provider_id: pid,
      name: body.name,
      display_name: body.display_name || body.name,
      model_type: body.model_type ?? 'CHAT',
      input_price: body.input_price ?? null,
      output_price: body.output_price ?? null,
      enabled: body.enabled ?? true,
    }
    mockModels.push(m)
    return HttpResponse.json(ok({ ...m }))
  }),

  http.patch('/api/modelgateway/models/:id', async ({ request, params }) => {
    if (!mockUserName) return unauthorized()
    const m = mockModels.find((x) => x.id === Number(params.id))
    if (!m) return HttpResponse.json(fail(1004, '模型不存在'))
    const body = (await request.json().catch(() => null)) as ModelPayload | null
    if (!body) return HttpResponse.json(fail(1001, '请求体无效'))
    if (body.name !== undefined) m.name = body.name
    if (body.display_name !== undefined) m.display_name = body.display_name || m.name
    if (body.model_type !== undefined) m.model_type = body.model_type
    if (body.input_price !== undefined) m.input_price = body.input_price
    if (body.output_price !== undefined) m.output_price = body.output_price
    if (body.enabled !== undefined) m.enabled = body.enabled
    return HttpResponse.json(ok({ ...m }))
  }),

  http.delete('/api/modelgateway/models/:id', ({ params }) => {
    if (!mockUserName) return unauthorized()
    const idx = mockModels.findIndex((x) => x.id === Number(params.id))
    if (idx < 0) return HttpResponse.json(fail(1004, '模型不存在'))
    mockModels.splice(idx, 1)
    return HttpResponse.json(ok(null))
  }),

  http.put('/api/modelgateway/models/:id/test', async ({ params }) => {
    if (!mockUserName) return unauthorized()
    const m = mockModels.find((x) => x.id === Number(params.id))
    if (!m) return HttpResponse.json(fail(1004, '模型不存在'))
    const p = findProvider(String(m.provider_id))
    if (!p) return HttpResponse.json(fail(1004, '供应商不存在'))
    return HttpResponse.json(ok(await runModelTest(p, m)))
  }),

  // 跨供应商模型列表（建库向导 / 知识库设置用）
  http.get('/api/modelgateway/models', () => {
    if (!mockUserName) return unauthorized()
    return HttpResponse.json(
      ok(mockModels.map((m) => ({ ...m, provider_name: mockProviders.find((p) => p.id === m.provider_id)?.name }))),
    )
  }),

  // ---------- knowledge ----------

  http.get('/api/knowledge/bases', () => {
    if (!mockUserName) return unauthorized()
    return HttpResponse.json(ok([...kbStores.values()].map(summaryOf)))
  }),

  http.post('/api/knowledge/bases', async ({ request }) => {
    if (!mockUserName) return unauthorized()
    const body = (await request.json().catch(() => null)) as KbCreatePayload | null
    if (!body?.name?.trim()) return HttpResponse.json(fail(1001, '名称不能为空'))
    if (!body.config?.embedding_model_id) return HttpResponse.json(fail(1001, '必须选择嵌入模型'))
    const id = ++kbSeq
    const detail: KbDetailDto = {
      id,
      name: body.name.trim(),
      type: body.type === 'FAQ' ? 'FAQ' : 'DOCUMENT',
      description: body.description ?? '',
      document_count: 0,
      chunk_count: 0,
      word_count: 0,
      created_at: nowIso(),
      config: body.config,
    }
    kbStores.set(id, {
      detail,
      docs: [],
      chunks: [],
      wikiPages: [],
      wikiVersions: [],
      versionContents: {},
      graph: { nodes: [], edges: [] },
    })
    return HttpResponse.json(ok(deepCopy(detail)))
  }),

  http.get('/api/knowledge/bases/:id', ({ params }) => {
    if (!mockUserName) return unauthorized()
    const store = findStore(params.id)
    if (!store) return HttpResponse.json(fail(1004, '知识库不存在'))
    return HttpResponse.json(ok(detailOf(store)))
  }),

  http.patch('/api/knowledge/bases/:id', async ({ request, params }) => {
    if (!mockUserName) return unauthorized()
    const store = findStore(params.id)
    if (!store) return HttpResponse.json(fail(1004, '知识库不存在'))
    const body = (await request.json().catch(() => null)) as KbUpdatePayload | null
    if (!body) return HttpResponse.json(fail(1001, '请求体无效'))
    if (body.name !== undefined) store.detail.name = body.name
    if (body.description !== undefined) store.detail.description = body.description
    let impact: string | null = null
    if (body.config) {
      const oldC = store.detail.config
      const newC = body.config
      const parts: string[] = []
      const chunkChanged =
        newC.chunk_mode !== oldC.chunk_mode ||
        newC.chunk_size !== oldC.chunk_size ||
        newC.chunk_overlap !== oldC.chunk_overlap ||
        JSON.stringify(newC.separators) !== JSON.stringify(oldC.separators)
      if (chunkChanged) parts.push(`已重新入队 ${store.docs.length} 篇文档（重新分块并重嵌入）`)
      else if (newC.embedding_model_id !== oldC.embedding_model_id) {
        parts.push(`已触发全量重嵌入 ${store.docs.length} 篇文档`)
      }
      if (!oldC.wiki_enabled && newC.wiki_enabled) parts.push('已开始补跑 Wiki 生成')
      if (newC.wiki_enabled && newC.wiki_granularity !== oldC.wiki_granularity) parts.push('已重生成 Wiki 页面')
      if (!oldC.graph_enabled && newC.graph_enabled) parts.push('已开始补跑图谱抽取')
      impact = parts.length > 0 ? parts.join('；') : null
      store.detail.config = newC
      if (impact && store.docs.length > 0) store.docs.forEach((d) => runPipeline(store, d))
    }
    return HttpResponse.json(ok({ kb: detailOf(store), impact }))
  }),

  http.delete('/api/knowledge/bases/:id', ({ params }) => {
    if (!mockUserName) return unauthorized()
    const store = findStore(params.id)
    if (!store) return HttpResponse.json(fail(1004, '知识库不存在'))
    kbStores.delete(store.detail.id)
    return HttpResponse.json(ok(null))
  }),

  http.get('/api/knowledge/bases/:id/documents', ({ params }) => {
    if (!mockUserName) return unauthorized()
    const store = findStore(params.id)
    if (!store) return HttpResponse.json(fail(1004, '知识库不存在'))
    return HttpResponse.json(ok(store.docs.map((d) => deepCopy(d))))
  }),

  http.post('/api/knowledge/bases/:id/documents', async ({ request, params }) => {
    if (!mockUserName) return unauthorized()
    const store = findStore(params.id)
    if (!store) return HttpResponse.json(fail(1004, '知识库不存在'))
    if (store.detail.type === 'FAQ') return HttpResponse.json(fail(1005, 'FAQ 库请使用「导入问答」'))
    const form = await request.formData().catch(() => null)
    const file = form?.get('file')
    if (!(file instanceof File)) return HttpResponse.json(fail(1001, '缺少文件'))
    let tags: string[] = []
    try {
      const parsed = JSON.parse(String(form?.get('tags') ?? '[]'))
      if (Array.isArray(parsed)) tags = parsed.filter((t): t is string => typeof t === 'string')
    } catch {
      // tags 解析失败按空处理
    }
    const text = /\.(md|txt)$/i.test(file.name) ? await file.text() : ''
    const doc: KbDocumentDto = {
      id: ++docSeq,
      kb_id: store.detail.id,
      filename: file.name,
      mime: file.type || 'application/octet-stream',
      status: 'QUEUED',
      error: null,
      word_count: text ? text.replace(/\s/g, '').length : 1200 + (file.size % 2600),
      chunk_count: 0,
      tags,
      metadata: {},
      created_at: nowIso(),
      timeline: [],
    }
    store.docs.push(doc)
    appendChunks(store, doc, text)
    runPipeline(store, doc)
    return HttpResponse.json(ok(deepCopy(doc)))
  }),

  http.post('/api/knowledge/bases/:id/documents/preview', async ({ request, params }) => {
    if (!mockUserName) return unauthorized()
    const store = findStore(params.id)
    if (!store) return HttpResponse.json(fail(1004, '知识库不存在'))
    const form = await request.formData().catch(() => null)
    const file = form?.get('file')
    if (!(file instanceof File)) return HttpResponse.json(fail(1001, '缺少文件'))
    const text = /\.(md|txt)$/i.test(file.name) ? await file.text() : null
    const size = Math.max(store.detail.config.chunk_size, 100)
    const overlap = Math.min(store.detail.config.chunk_overlap, size - 1)
    const pieces: string[] = []
    if (text && text.trim()) {
      for (let start = 0; start < text.length; start += size - overlap) {
        const piece = text.slice(start, start + size).trim()
        if (piece) pieces.push(piece)
        if (start + size >= text.length) break
      }
    } else {
      pieces.push('（二进制文档预览占位）接入真实后端后将展示解析后的实际分段内容。')
    }
    const result: ChunkPreviewDto = {
      chunks: pieces.slice(0, 12).map((content, i) => ({
        seq: i + 1,
        content,
        token_count: Math.ceil(content.length * 0.6),
      })),
      total_chunks: pieces.length,
      avg_length: Math.round(pieces.reduce((a, p) => a + p.length, 0) / pieces.length),
    }
    return HttpResponse.json(ok(result))
  }),

  http.post('/api/knowledge/documents/:id/retry', ({ params }) => {
    if (!mockUserName) return unauthorized()
    const found = findDoc(params.id)
    if (!found) return HttpResponse.json(fail(1004, '文档不存在'))
    runPipeline(found.store, found.doc)
    return HttpResponse.json(ok(deepCopy(found.doc)))
  }),

  http.delete('/api/knowledge/documents/:id', ({ params }) => {
    if (!mockUserName) return unauthorized()
    const found = findDoc(params.id)
    if (!found) return HttpResponse.json(fail(1004, '文档不存在'))
    found.store.docs = found.store.docs.filter((d) => d.id !== found.doc.id)
    found.store.chunks = found.store.chunks.filter((c) => c.doc_id !== found.doc.id)
    return HttpResponse.json(ok(null))
  }),

  http.get('/api/knowledge/documents/:id/chunks', ({ params }) => {
    if (!mockUserName) return unauthorized()
    const found = findDoc(params.id)
    if (!found) return HttpResponse.json(fail(1004, '文档不存在'))
    return HttpResponse.json(ok(found.store.chunks.filter((c) => c.doc_id === found.doc.id).map((c) => ({ ...c }))))
  }),

  http.patch('/api/knowledge/chunks/:id', async ({ request, params }) => {
    if (!mockUserName) return unauthorized()
    const found = findChunk(Number(params.id))
    if (!found) return HttpResponse.json(fail(1004, '分块不存在'))
    const body = (await request.json().catch(() => null)) as { content?: string } | null
    if (!body?.content?.trim()) return HttpResponse.json(fail(1001, '内容不能为空'))
    found.chunk.content = body.content
    found.chunk.token_count = Math.ceil(body.content.length * 0.6)
    return HttpResponse.json(ok({ ...found.chunk }))
  }),

  http.post('/api/knowledge/bases/:id/recall-test', async ({ request, params }) => {
    if (!mockUserName) return unauthorized()
    const store = findStore(params.id)
    if (!store) return HttpResponse.json(fail(1004, '知识库不存在'))
    const body = (await request.json().catch(() => null)) as { query?: string; top_k?: number } | null
    if (!body?.query?.trim()) return HttpResponse.json(fail(1001, '查询不能为空'))
    const q = body.query.trim()
    const cfg = store.detail.config
    const topK = body.top_k ?? cfg.top_k
    const scored = store.chunks.map((c) => {
      const text = c.is_qa ? `${c.question ?? ''} ${c.answer ?? ''}` : c.content
      const ov = overlapScore(q, text)
      return {
        c,
        ov,
        vec: cfg.vector_enabled ? 0.41 + ov * 0.52 : null,
        kw: cfg.keyword_enabled ? Math.min(1, ov * 1.2) : null,
      }
    })
    const vecRank = scored
      .filter((s) => s.vec != null)
      .sort((a, b) => (b.vec ?? 0) - (a.vec ?? 0))
      .slice(0, 20)
    const kwRank = scored
      .filter((s) => (s.kw ?? 0) > 0.02)
      .sort((a, b) => (b.kw ?? 0) - (a.kw ?? 0))
      .slice(0, 20)
    const w = cfg.rrf_vector_weight
    const fused = new Map<number, number>()
    vecRank.forEach((s, i) => fused.set(s.c.id, (fused.get(s.c.id) ?? 0) + (w * 100) / (60 + i + 1)))
    kwRank.forEach((s, i) => fused.set(s.c.id, (fused.get(s.c.id) ?? 0) + ((1 - w) * 100) / (60 + i + 1)))
    const provVec = new Set(vecRank.slice(0, 8).map((s) => s.c.id))
    const provKw = new Set(kwRank.slice(0, 8).map((s) => s.c.id))
    const hits: RecallHitDto[] = [...fused.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, topK)
      .map(([chunkId], i) => {
        const s = scored.find((x) => x.c.id === chunkId)
        if (!s) return null
        const doc = store.docs.find((d) => d.id === s.c.doc_id)
        const provenance: RecallHitDto['provenance'] = []
        if (s.vec != null && provVec.has(chunkId)) provenance.push('VECTOR')
        if (s.kw != null && provKw.has(chunkId)) provenance.push('KEYWORD')
        if (provenance.length === 0) provenance.push(s.vec != null ? 'VECTOR' : 'KEYWORD')
        return {
          chunk_id: chunkId,
          doc_id: s.c.doc_id,
          doc_name: doc?.filename ?? '未知文档',
          seq: s.c.seq,
          content: s.c.content,
          vector_score: s.vec != null ? Number(s.vec.toFixed(4)) : null,
          keyword_score: s.kw != null ? Number(s.kw.toFixed(4)) : null,
          fused_rank: i + 1,
          rerank_score: cfg.rerank_model_id != null ? Number((0.55 + s.ov * 0.4).toFixed(4)) : null,
          provenance,
        }
      })
      .filter((h): h is RecallHitDto => h != null)
    const result: RecallTestResultDto = { query: q, elapsed_ms: 14 + ((q.length * 7) % 42), hits }
    return HttpResponse.json(ok(result))
  }),

  http.get('/api/knowledge/bases/:id/wiki-tree', ({ params }) => {
    if (!mockUserName) return unauthorized()
    const store = findStore(params.id)
    if (!store) return HttpResponse.json(fail(1004, '知识库不存在'))
    return HttpResponse.json(ok(buildWikiTree(store)))
  }),

  http.get('/api/knowledge/wiki/pages/:id', ({ params }) => {
    if (!mockUserName) return unauthorized()
    const found = findWikiPage(Number(params.id))
    if (!found) return HttpResponse.json(fail(1004, '页面不存在'))
    return HttpResponse.json(ok({ ...found.page }))
  }),

  http.patch('/api/knowledge/wiki/pages/:id', async ({ request, params }) => {
    if (!mockUserName) return unauthorized()
    const found = findWikiPage(Number(params.id))
    if (!found) return HttpResponse.json(fail(1004, '页面不存在'))
    const body = (await request.json().catch(() => null)) as { content_md?: string } | null
    if (!body?.content_md?.trim()) return HttpResponse.json(fail(1001, '内容不能为空'))
    found.page.content_md = body.content_md
    found.page.version += 1
    found.page.updated_at = nowIso()
    const v: WikiVersionDto = {
      id: ++wikiVersionSeq,
      page_id: found.page.id,
      version: found.page.version,
      edit_source: 'USER',
      editor_name: mockUserName ?? 'unknown',
      summary: '人工编辑',
      created_at: nowIso(),
    }
    found.store.wikiVersions.push(v)
    found.store.versionContents[v.id] = body.content_md
    return HttpResponse.json(ok({ ...found.page }))
  }),

  http.get('/api/knowledge/wiki/pages/:id/versions', ({ params }) => {
    if (!mockUserName) return unauthorized()
    const found = findWikiPage(Number(params.id))
    if (!found) return HttpResponse.json(fail(1004, '页面不存在'))
    return HttpResponse.json(
      ok(
        found.store.wikiVersions
          .filter((v) => v.page_id === found.page.id)
          .slice()
          .reverse()
          .map((v) => ({ ...v })),
      ),
    )
  }),

  http.post('/api/knowledge/wiki/pages/:id/revert', async ({ request, params }) => {
    if (!mockUserName) return unauthorized()
    const found = findWikiPage(Number(params.id))
    if (!found) return HttpResponse.json(fail(1004, '页面不存在'))
    const body = (await request.json().catch(() => null)) as { version_id?: number } | null
    const target = found.store.wikiVersions.find((v) => v.id === body?.version_id)
    const content = body?.version_id != null ? found.store.versionContents[body.version_id] : undefined
    if (!target || content === undefined) return HttpResponse.json(fail(1004, '目标版本不存在'))
    found.page.content_md = content
    found.page.version += 1
    found.page.updated_at = nowIso()
    const v: WikiVersionDto = {
      id: ++wikiVersionSeq,
      page_id: found.page.id,
      version: found.page.version,
      edit_source: 'REVERT',
      editor_name: mockUserName ?? 'unknown',
      summary: `回滚到 v${target.version}`,
      created_at: nowIso(),
    }
    found.store.wikiVersions.push(v)
    found.store.versionContents[v.id] = content
    return HttpResponse.json(ok({ ...found.page }))
  }),

  http.get('/api/knowledge/bases/:id/graph', ({ params }) => {
    if (!mockUserName) return unauthorized()
    const store = findStore(params.id)
    if (!store) return HttpResponse.json(fail(1004, '知识库不存在'))
    return HttpResponse.json(ok(deepCopy(store.graph)))
  }),

  http.post('/api/knowledge/bases/:id/faq/import', async ({ request, params }) => {
    if (!mockUserName) return unauthorized()
    const store = findStore(params.id)
    if (!store) return HttpResponse.json(fail(1004, '知识库不存在'))
    if (store.detail.type !== 'FAQ') return HttpResponse.json(fail(1005, '仅 FAQ 类型知识库支持导入问答'))
    const body = (await request.json().catch(() => null)) as { rows?: FaqRowPayload[] } | null
    if (!body?.rows?.length) return HttpResponse.json(fail(1001, '没有可导入的问答'))
    const errors: { row: number; message: string }[] = []
    const valid: FaqRowPayload[] = []
    body.rows.forEach((r, i) => {
      if (!r.question?.trim()) {
        errors.push({ row: i + 1, message: '问题不能为空' })
      } else if (!r.answer?.trim()) {
        errors.push({ row: i + 1, message: '答案不能为空' })
      } else {
        valid.push(r)
      }
    })
    if (valid.length > 0) {
      const doc: KbDocumentDto = {
        id: ++docSeq,
        kb_id: store.detail.id,
        filename: `问答导入 ${new Date().toLocaleDateString('zh-CN')}`,
        mime: 'text/csv',
        status: 'READY',
        error: null,
        word_count: valid.reduce((a, r) => a + r.question.length + r.answer.length, 0),
        chunk_count: valid.length,
        tags: [],
        metadata: {},
        created_at: nowIso(),
        timeline: doneTimeline({ PARSE: 60, CHUNK: 90, EMBED: 100 + valid.length * 60 }),
      }
      valid.forEach((r, i) => {
        store.chunks.push({
          id: ++chunkSeq,
          doc_id: doc.id,
          seq: i + 1,
          content: `${r.question}\n${r.answer}`,
          source: 'FAQ',
          is_qa: true,
          question: r.question.trim(),
          answer: r.answer.trim(),
          token_count: Math.ceil((r.question.length + r.answer.length) * 0.6),
          has_parent: false,
        })
      })
      store.docs.push(doc)
    }
    const result: FaqImportResultDto = { imported: valid.length, failed: errors.length, errors }
    return HttpResponse.json(ok(result))
  }),

  http.post('/api/knowledge/bases/:id/profile/regenerate', ({ params }) => {
    if (!mockUserName) return unauthorized()
    const store = findStore(params.id)
    if (!store) return HttpResponse.json(fail(1004, '知识库不存在'))
    const words = store.docs.reduce((a, d) => a + d.word_count, 0)
    const isFaq = store.detail.type === 'FAQ'
    const retrieval = store.detail.config.vector_enabled && store.detail.config.keyword_enabled
      ? '向量 + BM25 混合召回'
      : store.detail.config.vector_enabled
        ? '向量语义召回'
        : 'BM25 全文召回'
    store.detail.description = `（AI 生成）本库收录 ${store.docs.length} 篇${isFaq ? '问答' : '文档'}、${store.chunks.length} 个分块、约 ${words} 字，${isFaq ? '面向客服与运维高频问题' : '覆盖产品、部署与架构知识'}，检索采用${retrieval}。`
    return HttpResponse.json(ok(detailOf(store)))
  }),
]
