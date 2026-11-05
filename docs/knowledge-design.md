# Hify 知识库设计（knowledge 模块）

> 决策记录（2026-11-04，用户确认）：
> 1. **范围 = 全量**：WeKnora v0.9 × Dify 功能融合，一期一次落地，不分期（统一配置 / 分块三模式 / 混合检索 / FAQ / Wiki / 知识图谱 / 召回测试 / 元数据过滤）
> 2. **BM25 中文分词 = ParadeDB**：db 镜像从 `pgvector/pgvector:pg17` 换为 `paradedb/paradedb:v0.25.11-pg17`（WeKnora 同款；曾考虑 zhparser 自制镜像——需自己维护 Dockerfile，直接换发行版更省）
> 3. **知识图谱 = PG 邻接表**，禁止 Neo4j（宪法：PG 唯一存储）
> 4. **成本控制靠开关默认值**：vector/keyword 默认开，wiki/graph 默认关（每 chunk 一次 LLM 调用是最贵扇出），建库向导明示成本

本文件是 knowledge 模块的功能与数据设计权威；与 CLAUDE.md 冲突时以 CLAUDE.md 为准。

## 1. 知识库类型

| 类型 | 内容 | 流水线 |
|---|---|---|
| document（文档库） | 上传 PDF/DOCX/MD/TXT | 解析→分块→嵌入→[Wiki]→[图谱] |
| faq（FAQ 库） | 问题-答案对（CSV/Excel 导入或页面录入） | 校验→嵌入→索引 |

Wiki 与知识图谱不是独立类型，是 document 库的索引开关（§2）。

## 2. 统一配置中心

配置存 `kb_knowledge_base.config`（JSONB），建库向导一次配齐，设置页可改。**修改语义 = 触发对应重处理**，前端弹窗确认并显示影响面（涉及文档数）：

| 配置组 | 字段 | 默认值 | 修改后动作 |
|---|---|---|---|
| 分块 | chunk_mode: general/parent_child/qa | general | 重新分块+重嵌入（提示涉及 N 文档） |
| | chunk_size / chunk_overlap | 512 / 80 | 同上 |
| | separators | `\n\n` `\n` `。` `.` | 同上 |
| | qa_index_mode: question_only/question_answer | question_answer | 重索引 |
| 向量 | embedding_model_id | 建库必选 | 全量重嵌入（维度校验） |
| | generation_model_id | wiki/graph/QA-LLM/标签任一开启时必选 | 即时生效 |
| 索引开关 | vector_enabled / keyword_enabled | true / true | 建/删索引 |
| | wiki_enabled / graph_enabled | false / false | 补跑已有文档 |
| 检索 | top_k / score_threshold | 5 / 0 | 即时生效 |
| | rrf_vector_weight | 0.5 | 即时生效 |
| | rerank_model_id（空 = 关） | null | 即时生效 |
| 元数据 | metadata_schema（字段定义数组） | [] | 追加自由；删改需无文档引用 |
| Wiki | wiki_granularity: focused/standard/exhaustive | standard | 重生成 Wiki |
| 图谱 | graph_entity_types / graph_few_shot | 内置默认 | 重抽取图谱 |

## 3. 分块

### 3.1 通用分段（general）

- chunk_size / overlap / 分隔符
- **标题感知**：MD 按标题层级、DOCX 按大纲样式优先切分，默认不跨标题边界（单节超 chunk_size×2 才允许跨），避免段落被拦腰截断
- token 估算只用于成本展示，切分按字符判定（可预测、实现简单）

### 3.2 父子分段（parent_child）

- 父块 ~4096 / 子块 ~384 / 子块 overlap = size/5（WeKnora 参数）
- 子块参与向量 + BM25 检索；命中子块 → 召回父块全文作为上下文（`kb_chunk.parent_chunk_id` 自引用）
- 适合长文档全局语境场景（规章制度、操作手册）

### 3.3 QA 分段（qa）

- 路径 A：上传文档 → LLM 逐段生成 Q-A 对（用 generation_model，提交前成本确认弹窗）
- 路径 B：FAQ 库 CSV/Excel 结构化导入（无 LLM 消耗）
- qa_index_mode：`question_only`（向量召回准、省嵌入）或 `question_answer`（BM25 友好）；FAQ 库复用同一字段
- 命中后 answer 直接作为强上下文返回

### 3.4 分段预览

上传后调 preview API：返回前 20 块（含首尾）+ 统计（块数/平均长度/超限截断数），确认后才提交正式入库。预览结果不落库。

## 4. 向量与嵌入

- 模型从 modelgateway 已启用的 EMBEDDING 模型中选（bge-m3，1024 维；宪法禁纯英文嵌入模型）
- `kb_chunk.embedding vector(1024)` + HNSW（cosine，m=16，ef_construction=64，ef_search=40）——1024 < pgvector 2000 维索引上限，用 `vector` 不必 `halfvec`
- 批量嵌入按 provider 的 embedding_batch_size 分批，受 modelgateway 每 provider 信号量约束
- 换模型 → 维度校验 → 全量重嵌入任务（@Async + kb_task，幂等：先清后写）

## 5. 检索与索引

### 5.1 向量检索

pgvector HNSW + cosine，`ORDER BY embedding <=> :qv LIMIT :k`。

### 5.2 全文检索（BM25，pg_search）

- `kb_chunk.content` 上建 pg_search bm25 索引，content 字段 tokenizer 配 **chinese（jieba）**
- 查询走 `@@@` 操作符，`paradedb.score()` 取分
- 具体索引 DDL 以 v0.25.11 官方文档为准，实现时在 Flyway 迁移脚本内落地并集成测试验证

### 5.3 混合检索（RRF 融合）

```
score(d) = Σ w_i / (60 + rank_i(d))    // i ∈ {vector, keyword}，w_vector 默认 0.5
```

- 两路各取 top_k×2 候选 → 融合去重排序 → 截断 top_k
- 仅一路开启时退化为单路检索
- **score_threshold 只在单路向量模式生效**（cosine 相似度 0-1）；混合/Rerank 模式下忽略阈值只取 top-k（RRF 分值无绝对意义）——简化设计，避免跨模式语义混乱

### 5.4 Rerank（可选）

- modelgateway 增加 **RERANK 模型类型**（Cohere 兼容：`POST {base}/rerank`，body `{model, query, documents, top_n}`）；`api/modelgateway.ts` 的 ModelType 枚举随之扩展为 CHAT/EMBEDDING/RERANK
- 融合后取前 top_k×4 送 rerank，截断回 top_k
- Rerank 调用同样走 modelgateway，正常计费进 usage

### 5.5 元数据过滤

- schema 字段类型：string（等值/in）、number（等值/范围）、date（范围）、enum（等值/in）
- 值存 `kb_document.metadata` JSONB；过滤条件参数化 SQL（防注入）
- Agent 编排时可在库默认值之上覆盖；召回测试可传过滤条件

### 5.6 召回测试

`POST /api/knowledge/bases/{id}/recall-test`：

- 入参：query + 可选过滤/top_k 覆盖
- 返回：命中块列表，每块带 `{vector_score, keyword_score, fused_rank, rerank_score, 来源文档, provenance(vector/keyword/wiki)}`
- 命中快照存 `kb_recall_test`，调参后可回归对比

## 6. FAQ 库

- 页面逐条录入 + CSV（UTF-8）/Excel（.xlsx）批量导入，列：`question, answer, [元数据字段...]`，单文件 ≤ 20MB
- 导入即校验（必填、长度上限 2000 字），错误行带行号回显
- 检索：按 qa_index_mode 嵌入问题（或问答全文），命中返回 answer
- FAQ 属结构化导入，不受"文档解析四格式"限制（那是 Tika 解析路径的约束）

## 7. Wiki

- `wiki_enabled` 开启后，文档嵌入完成追加 Wiki 生成阶段：
  1. LLM 读全文 chunks → 产出大纲（目录树）+ 页面草案（Markdown）
  2. 每页 front-matter：`slug / parent_slug / source_chunk_ids`（来源引用）
  3. 页间互链 `[[slug]]`
- 粒度三档：focused（少页粗粒度）/ standard / exhaustive（多页细粒度）——控制 LLM 输出量
- **Wiki 页同时作为 chunk（source=wiki）进入向量 + BM25 索引**，可被检索命中——复用同一条流水线，零额外机制
- 浏览：库详情 Wiki tab——左侧目录树 + 页面 Markdown 渲染 + 页面链接图视图；member 只读
- 编辑：admin 可编辑（产生新版本）；版本软上限 50，超出滚动清理；版本记录 edit_source: pipeline/agent/user/revert
- 重新生成 = pipeline 版本覆盖；页面被人工编辑过则提示确认后再覆盖

## 8. 知识图谱

- `graph_enabled` 开启后，分块完成后**逐 chunk** LLM 抽取实体与关系：
  - prompt：内置 schema（实体名/类型/关系三元组）+ 可配 few-shot 示例 + 实体类型白名单
  - 输出 JSON；解析失败重试 1 次后跳过该块并记录（不阻塞流水线）
- **实体归并**：同库内按 normalization_key（小写、去空白；可配别名表）合并节点，关系累计 weight、source_chunk_ids 追加
- **存储（PG 邻接表，禁 Neo4j）**：
  - `kb_graph_node`：kb_id, name, norm_key, type —— `(kb_id, norm_key)` 唯一
  - `kb_graph_edge`：kb_id, from_node_id, to_node_id, relation, weight, source_chunk_ids —— `(kb_id, from, to, relation)` 唯一
- **检索增强**：向量/BM25 命中块 → 取其关联实体 → 递归 CTE 展开 1 跳邻居 → 相邻实体与关系文本化注入上下文（上限 20 实体 / ~2000 token，防上下文爆炸）
- 可视化：库详情图谱 tab（力导向子图，admin 维护用）
- **成本模型**：LLM 调用数 = chunk 数。开关开启时弹窗估算（chunk 数 × 平均 1.5k token）；这是全流水线最贵的扇出——默认关的原因

## 9. 文档管理

- 状态机：`QUEUED → PARSING → CHUNKING → EMBEDDING → [WIKI] → [GRAPH] → READY`，任一阶段可 `FAILED`（可重试；幂等：重跑从失败阶段开始，前序产物保留）
- 处理时间轴：kb_task 阶段事件落库（阶段/attempt/起止/错误），前端时间轴组件渲染；**卡住检测**：阶段超时阈值（默认 parsing 10min、embedding 30min、wiki/graph 60min）标红可重试
- 块级编辑：改块文本 → 单块重嵌入（BM25 索引自动同步）；只留最新版本，无块版本历史（简化决策）
- 自动标签：入库时 LLM 生成 3-5 个标签（用 generation_model，1 次调用/文档，可与图谱抽取并行）
- AI 知识库简介：库详情一键生成/刷新（LLM 读抽样块），存 config.description

## 10. 数据模型（kb_ 前缀，knowledge 模块私有）

| 表 | 关键列 |
|---|---|
| kb_knowledge_base | id, name, type(document/faq), description, config JSONB |
| kb_document | id, kb_id, filename, mime, status, error, word_count, tags text[], metadata JSONB, file_bytes bytea |
| kb_chunk | id, doc_id, kb_id, seq, content, parent_chunk_id, source(document/faq/wiki), is_qa, question, answer, embedding vector(1024), token_count |
| kb_wiki_page | id, kb_id, doc_id, slug, title, parent_slug, content_md, source_chunk_ids bigint[] |
| kb_wiki_page_version | id, page_id, version, content_md, edit_source, editor_id, created_at |
| kb_graph_node | id, kb_id, name, norm_key, type —— unique(kb_id, norm_key) |
| kb_graph_edge | id, kb_id, from_node_id, to_node_id, relation, weight, source_chunk_ids —— unique(kb_id, from, to, relation) |
| kb_task | id, doc_id, stage, status, attempt, error, started_at, finished_at（时间轴事件追加写入） |
| kb_recall_test | id, kb_id, query, request JSONB, hits JSONB, created_by, created_at |

- 向量 HNSW 建在 `kb_chunk.embedding`，BM25（pg_search）建在 `kb_chunk.content`
- 跨模块禁 JOIN（宪法）——agent/conversation 经 `knowledge.api.KnowledgeApi` 取数

## 11. 处理流水线

```
上传（校验：类型 / 20MB）→ file_bytes 存 PG
  → PARSE（Tika：PDF/DOCX/MD/TXT；图片型 PDF 明确报错不支持）
  → CHUNK（按 chunk_mode；预览在确认前不继续）
  → EMBED（批量，走 modelgateway 信号量）
  → [WIKI]（若启用）
  → [GRAPH]（若启用；与 WIKI 并行——独立任务行）
  → READY
```

- 每阶段一行 kb_task，@Async 虚拟线程执行，`SELECT ... FOR UPDATE SKIP LOCKED` 领任务（阶段间并发安全）
- 失败重试只从失败阶段重跑；改库配置触发的重处理走同一任务机制（阶段粒度）
- 所有 LLM 阶段（QA 生成/Wiki/图谱/标签/简介）都调 modelgateway → 正常计费进 usage 统计

## 12. 模块 API（knowledge.api，跨模块唯一入口）

```java
interface KnowledgeApi {
  RetrieveResult retrieve(RetrieveCommand cmd);  // agent 循环调用
  // RetrieveCommand: kbIds, query, topK/scoreThreshold/元数据过滤 覆盖项
  // RetrievedChunk: content, sourceDocId, parentContent, score 明细, provenance(vector/keyword/wiki)
}
```

REST 管理面（`/api/knowledge`，snake_case）：

```
POST   /bases                              建库（向导提交）
GET    /bases                              列表
GET    /bases/{id}                         详情 + 统计
PATCH  /bases/{id}                         改配置（返回影响面提示）
DELETE /bases/{id}                         删库（级联清 chunk/索引/Wiki/图谱）
POST   /bases/{id}/documents               上传（multipart）
POST   /bases/{id}/documents/preview       分段预览（不落库）
GET    /documents/{id}                     详情 + 时间轴
DELETE /documents/{id}
GET    /documents/{id}/chunks
PATCH  /chunks/{id}                        块编辑
POST   /bases/{id}/recall-test             召回测试
GET    /bases/{id}/wiki-tree               目录树
GET    /wiki/pages/{id}                    页面详情
PATCH  /wiki/pages/{id}                    编辑（admin）
GET    /wiki/pages/{id}/versions           版本列表
POST   /wiki/pages/{id}/revert             回滚
GET    /bases/{id}/graph                   图谱数据（节点+边，限量返回）
POST   /bases/{id}/faq/import              FAQ 批量导入
POST   /bases/{id}/profile/regenerate      AI 简介重生成
```

## 13. 前端（KnowledgeAdmin 扩展）

- 库列表页：卡片（类型徽标 / 文档数 / 开关状态徽标 / 简介）
- 建库向导：n-steps——类型 → 分块（模式+参数）→ 向量/生成模型 → 索引开关（成本提示）→ 元数据 schema
- 库详情 Tabs：**文档**（列表+状态+时间轴抽屉）｜**分块**（选中文档的块表+编辑）｜**召回测试**｜**Wiki**（目录树+阅读+编辑）｜**图谱**｜**设置**（配置+影响面确认）
- 组件目录 `components/knowledge/`（向导、时间轴、召回结果表、wiki 编辑器、图谱视图）
- MSW mock 顺延 M2 契约先行模式：先定 `api/knowledge.ts` 契约 + mock，后端就绪删 handler

## 14. 部署与测试联动

- db 镜像：`paradedb/paradedb:v0.25.11-pg17`（WeKnora 同款；替换 pgvector/pgvector:pg17，其余 compose 不变）
- Testcontainers 集成测试镜像同步替换；pg_search 索引 DDL 进 Flyway 后由集成测试验证
- 开发机 docker-compose.dev.yml 同步换镜像
- 详见 docs/deployment.md §2.2 / §8

## 15. 明确不做（防 scope creep）

- 块版本历史（块编辑只留最新）
- 可视化分段编辑器 / 知识流水线画布（宪法红线）
- WeKnora 的 parser_engine_rules 高级解析规则
- Dify 的 Agent 知识库（AI 自动整理——一期已砍）
- Neo4j / Qdrant / Milvus 等外部向量或图存储
