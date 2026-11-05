# CLAUDE.md — Hify 项目规范

本文件是项目的唯一权威规范，所有实现决策与之冲突时以本文件为准；范围变更必须先更新本文件再写代码。

## 项目是什么

Hify 是受 Dify 启发的简化版内部 AI Agent 平台：

- **约束**：单人开发；团队内部 20-50 人使用；本地部署（docker-compose）
- **一期核心**：登录权限（admin/member + 平台用户管理：创建/停用/改角色/重置密码 + 个人设置改自己密码）· OpenAI 兼容模型接入 · 配置式 Agent（提示词+模型+工具+知识库）· 聊天界面（会话历史、流式输出）· 知识库（统一配置 + 通用/父子/QA 分段 + 向量/BM25 混合检索 + FAQ 库 + Wiki + 知识图谱 + 召回测试——设计见 `docs/knowledge-design.md`）· 内置工具（web 搜索 + 自定义 HTTP 工具）· 对话日志与用量统计 · 每应用一个 REST API
- **产品形态**：应用类型只有一种——Agent（不挂工具即为聊天助手）

## 技术栈（不要替换）

| 层 | 选型 |
|---|---|
| 后端 | Java 21 + Spring Boot 3（**MVC，非 WebFlux**），开启虚拟线程 `spring.threads.virtual.enabled=true` |
| AI 基座 | 模型调用与 embedding：**手写 OpenAI 兼容客户端**（JDK HttpClient，设计见 `docs/model-gateway-design.md`）。Spring AI——仅用于 pgvector 向量存储集成。**Agent 循环手写**，不用框架的 Agent 抽象 |
| ORM | MyBatis-Plus |
| 数据库 | **ParadeDB**（PostgreSQL 发行版，镜像 `paradedb/paradedb:v0.25.11-pg17`：pgvector HNSW cosine + pg_search BM25 中文分词）——唯一存储，**无 Redis、无 MQ、无 Neo4j** |
| 迁移 | Flyway |
| 前端 | Vue 3 + TypeScript + Vite + Naive UI + Pinia |
| 部署 | docker-compose 两个容器：app（Spring Boot 托管前端静态资源）+ db（ParadeDB），可选 ollama profile——完整部署设计见 `docs/deployment.md` |

## 架构：模块化单体

单 Maven 工程，包级模块划分，**ArchUnit 守护边界**。

> 代码组织详细规范（包结构模板、分层职责边界、跨模块调用规则、ArchUnit 测试代码、参考实现骨架）见 `docs/code-structure.md`——**写任何后端代码前先读它**，规则冲突时以该文件为准。

### 模块清单

```
com.hify
├── common          # ID、错误码、事件定义——保持最小，防大杂烩
├── iam             # 登录、用户、admin/member 角色
├── modelgateway    # 供应商配置、OpenAI 兼容客户端、密钥加密存储、调用计价
├── agent           # Agent 定义、执行循环、工具注册与调用 ← 核心模块
├── knowledge       # 文档解析/分段/嵌入/混合检索/Wiki/知识图谱——向量、BM25 索引与 kb_graph_* 表只有本模块能访问
├── conversation    # 会话、消息、SSE 推流、👍/👎 反馈
└── usage           # 调用日志、token/费用统计——只订阅事件，不做强依赖
```

### 依赖方向（只能自上而下）

```
conversation → agent → knowledge → modelgateway → common
usage → common（与其他模块通过 Spring 事件解耦，如 MessageCompletedEvent）
iam → common
```

### 边界规则

1. 每个模块分 `api/`（接口 + dto + 事件）与 `internal/`（controller/service/mapper/entity）；**跨模块只能依赖对方的 api 包**（ArchUnit 强制）
2. 禁止跨模块访问 Repository / Entity / internal Service（ArchUnit 强制）
3. 数据库表按模块前缀：`iam_`、`mg_`、`agent_`、`kb_`、`chat_`、`usage_`；**禁止跨模块 JOIN 和外键**（约定，靠 review 把关）——要别人的数据走他的接口
4. 跨模块副作用用 Spring 事件解耦，禁止反向调用
5. 新增第三方依赖或中间件前必须更新本文件

## 一期红线（不要建议、不要实现）

- ❌ 可视化工作流画布 / 节点编辑器（包括引入 React Flow 等同类库）
- ❌ 插件体系、插件市场、插件 SDK
- ❌ Redis、消息队列、微服务拆分
- ❌ 多工作空间、SSO/SAML、细粒度 RBAC（角色只有 admin/member）
- ❌ OCR / 扫描件解析（检测到图片型 PDF 明确报错提示不支持）
- ❌ MCP 服务器、Web 应用嵌入、应用市场、触发器、人工介入（均为二期候选）
- ❌ WebFlux / 响应式栈

需求触碰红线时，先与用户确认范围变更，不要直接实现。

## 常用命令

```bash
# 后端（根目录）
./mvnw test                  # 全部测试，含 ArchUnit 边界测试
./mvnw spring-boot:run       # 本地起服务（需本地 PG，Flyway 自动迁移）
./mvnw clean package         # 打包

# 前端（frontend/）
npm run dev
npm run build

# 整体
docker compose up -d
```

## 后端规范

- **Agent 循环**：手写 ReAct / function-calling while 循环；最大步数限制（默认 8）；每步工具调用写日志；工具执行错误回传给模型处理而不是中断会话
- **模型调用**：一律走 `modelgateway` 的 `ModelClientApi` 接口；禁止在其他模块直接创建 HTTP 客户端调模型
- **LLM 调用健壮性**（详见 `docs/model-gateway-design.md`）：HTTP 客户端只用 JDK HttpClient，**禁止 OkHttp**（JDK 21 虚拟线程 pinning）；流式调用用首包 + chunk 空闲双超时，**禁止总超时**；已向用户输出内容后**禁止自动重试**；每 provider 信号量限流；一期不做自动 fallback
- **SSE**：SseEmitter + 显式超时 + 客户端断连处理；响应头加 `X-Accel-Buffering: no`
- **Session 与文件存储**：session 用 Spring Session JDBC（PG 表，重启不掉线）；上传文档的字节存 PG（bytea，一期单文件上限 20MB）——PG 是唯一持久化存储，`pg_dump` 即全量备份
- **长任务**（文档解析/嵌入）：@Async + 任务表记录状态，保证幂等，可重试
- **密钥安全**：模型 API Key 用 AES-GCM 加密落库（主密钥来自环境变量 `HIFY_MASTER_KEY`）；日志输出一律脱敏
- **测试**：单元测试 + ArchUnit 走 Surefire（不依赖 Docker，日常秒级）；需要数据库的集成测试一律 **Testcontainers**（ParadeDB 镜像）走 Failsafe（`mvn verify`）；**禁止 H2/嵌入式数据库替代**（跑不了 pgvector、方言不同）；modelgateway 的重试/超时逻辑用 WireMock 假端点测（可模拟 429/慢首包/断流）；单元测试用 Mockito mock 各模块 api 接口或 Mapper——api 包即 mock 缝隙；**mock 不得用于验收**：RAG 质量、流式体验、超时重试必须真链路验证
- REST 路径 `/api/<模块>/<资源>`；JSON 字段 snake_case；时间 UTC 存储前端本地化显示

## 前端规范

- **聊天流式**：用 `fetch + ReadableStream` 解析 SSE（不用 EventSource——需要 POST 和鉴权头）
- 增量 markdown 渲染，注意打字机效果下的代码高亮
- 目录：`api/`（HTTP + SSE 封装，`api/modelgateway.ts` 即 M2、`api/knowledge.ts` 即 M5 后端契约）、`utils/`（markdown 渲染等纯函数）、`stores/`、`router/`、`views/`（Chat、AgentAdmin、KnowledgeAdmin、KbDetail、ProviderAdmin、UsageAdmin、UserAdmin）、`components/`（AppLayout 布局 + 按页面分组的子目录：`chat/` 会话列表与引用卡片；`agent/` Agent 表单 / API Key / 工具表单；`provider/` 表单弹窗；`knowledge/` 建库向导与库内页签）
- **登录页已移除（2026-11-05）**：路由守卫在无会话时默认以 admin 自动登录，账号弹窗仅保留个人设置——iam 契约（登录/登出/me/改密）与角色逻辑完整保留；接真后端时恢复 /login 页、守卫跳转与退出登录入口
- **后端未就绪时用 MSW mock** `/api/**`（含 SSE：ReadableStream 模拟分块输出）；main.ts 里 mock 分支带 SW 保活（visibilitychange 重发 `MOCK_ACTIVATE` + 20s 心跳，防 SW 空闲重启后请求穿透 502）；接真后端时只删 handler 与 mock 分支，不改业务代码
- **vue-tsc 3.3.14 已知 bug**：`.vue` 的 template 区（静态属性值或绑定表达式）出现 `//` 会损坏虚拟代码生成，导致该行之后所有 `v-model` 报 "Property 'value' does not exist" 伪错误——URL 等含 `//` 的字符串必须放 script 常量（如 `ProviderFormModal.vue` 的 `urlPlaceholder`）；含真实换行/特殊字符的选项值同理（如 `CreateKbWizard.vue` 的 `separatorOptions`）

## RAG / 知识库规范

> 详细设计（数据模型、流水线、API、配置语义）见 `docs/knowledge-design.md`——2026-11-04 范围确认：WeKnora × Dify 全量融合，一期一次落地，不分期。

- **统一配置**：分块、向量模型、生成模型、检索索引开关（向量/全文/Wiki/图谱）、元数据 schema 均为知识库级配置；修改触发对应重处理（换向量模型 = 全量重嵌入）
- **分块**：通用（size/overlap/分隔符 + 标题感知）+ 父子（父~4096/子~384，命中子块召回父块）+ QA（问题-答案对）；入库前分段预览；不提供可视化流水线
- **中文嵌入模型**：bge-m3（Ollama / Xinference）或 API 方案；**禁止纯英文嵌入模型**
- **检索**：pgvector HNSW + cosine（top-k 默认 5）与 pg_search BM25（chinese/jieba tokenizer）混合，RRF 加权融合；可选 Rerank（modelgateway 增加 RERANK 模型类型）；score 阈值；元数据过滤；召回测试
- **FAQ 库**：独立类型，问题-答案对 CSV/Excel 批量导入，索引模式仅问题/问答——结构化导入不受"文档四格式"限制
- **Wiki**：入库时 LLM 生成互链 Markdown 页（来源引用、精简/标准/详尽三档粒度），目录树 + 链接图；admin 可编辑 + 版本历史，member 只读；Wiki 页本身作为 chunk 可被检索
- **知识图谱**：入库时 LLM 实体/关系抽取；**PG 邻接表存储（kb_graph_node/kb_graph_edge + 递归 CTE），禁止 Neo4j**；检索时图遍历扩展上下文；开关默认关（每 chunk 一次 LLM 调用，最贵扇出）
- **文档管理**：处理时间轴（解析→分块→嵌入→Wiki→图谱）+ 卡住检测；块级编辑单块重嵌入；自动标签；AI 知识库简介
- 文档解析仅支持文本型 PDF / DOCX / MD / TXT

## 安全底线

- Spring Security session 认证；admin 可构建管理，member 仅使用
- 服务端存储团队 LLM 密钥：加密落库 + 日志脱敏——内部工具不做豁免
