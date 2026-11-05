# Hify 部署架构设计（一期）

> 决策记录（2026-11-03，用户确认）：
> 1. 数据库 = **PostgreSQL + pgvector**（曾考虑 MySQL——pgvector 是 PG 专属扩展，MySQL 上不成立）
> 2. **无 Redis**：session 走 Spring Session JDBC、任务队列用 PG `SKIP LOCKED`、限流用 JVM 信号量，Redis 的每个用途都有 PG 原生替代
> 3. 生产部署 = **docker-compose 单实例**（曾考虑 K8s——公司无现成平台托管集群，50 人规模单实例 + 快重启的可用性足够；K8s 迁移路径见 §12）
> 4. （2026-11-04）db 镜像 = **ParadeDB** `paradedb/paradedb:v0.25.11-pg17`——知识库 BM25 中文检索需要 pg_search（WeKnora 同款；曾考虑 zhparser 自制镜像，需自己维护 Dockerfile 故弃）

本文件定义一期的部署组件、请求流转与运维约定；与 CLAUDE.md 冲突时以本文件为准（部署部分）。

## 1. 拓扑总览

```
                       内网（公司网络）
  ┌──────────────────────────────────────────────────────┐
  │   浏览器（20-50 用户，Vue SPA）                        │
  └──────────────┬───────────────────────────────────────┘
                 │ HTTP :8080（唯一入口端口）
  ┌──────────────▼───────────────────────────────────────┐
  │  hify-app（Spring Boot 单实例，虚拟线程）               │
  │  · Vue 静态资源  · REST API  · SSE 流式               │
  │  · Agent 循环    · RAG 管道  · Spring Session         │
  └───────┬──────────────────────────┬───────────────────┘
          │ :5432（compose 内网）     │ 出站 HTTPS（唯一外网出口）
  ┌───────▼────────┐   ┌─────────────▼──────────┐   ┌─────────────────┐
  │ hify-db        │   │ 云端 LLM API            │   │ hify-ollama      │
  │ PG17+ParadeDB  │   │ OpenAI/Claude/Gemini    │   │ (可选 profile)   │
  │ 唯一持久化存储  │   └────────────────────────┘   │ bge-m3 嵌入/本地  │
  └────────────────┘                                └─────────────────┘
```

组件清单：

| 组件 | 形态 | 状态 | 说明 |
|---|---|---|---|
| hify-app | 容器，1 副本 | 无状态（session 在 PG） | 唯一入口，唯一外网出口 |
| hify-db | 容器 | **唯一有状态**，挂卷 | 业务表 + 向量 + BM25 索引 + session 表 + 文件字节 |
| hify-ollama | 容器，可选 profile | 有状态（模型卷） | 本地嵌入模型，默认不启用 |
| 宿主机 cron | 一行 pg_dump | — | 每日备份，见 §6 |

## 2. 组件职责

### 2.1 hify-app

**职责**：

1. 托管 Vue 构建产物（`classpath:/static`，SPA 路由刷新 fallback 到 index.html）
2. REST API（`/api/**`，各模块 controller）+ Actuator `/actuator/health`
3. SSE 流式推送（SseEmitter + 15s 心跳，见 model-gateway-design.md §5）
4. Agent 执行循环、RAG 管道（Tika 解析 → 分段 → 嵌入 → 混合检索，含 Wiki/图谱生成——详见 knowledge-design.md）
5. Spring Session JDBC（session 落 PG，重启不掉线）
6. 启动时执行 Flyway 迁移（前向迁移，不自动回滚）
7. **所有对 LLM 供应商的出站调用**（modelgateway 是唯一出口，其余组件不触外网）

**约定**：端口 `8080:8080`；`restart: unless-stopped`；`depends_on: db(service_healthy)`；JVM `MaxRAMPercentage=75`；运行用户非 root；日志打 stdout（JSON 格式，`docker logs` 查看）。

**环境变量**：`HIFY_MASTER_KEY`（主密钥，AES-GCM 加解密供应商 key，**绝不进镜像**）、`SPRING_DATASOURCE_URL/USERNAME/PASSWORD`。

### 2.2 hify-db

**职责**：

1. 全部业务表（`iam_`/`mg_`/`agent_`/`kb_`/`chat_`/`usage_`）+ Spring Session 表（Flyway 管理 schema）
2. 向量存储与检索：`kb_chunk.embedding`（pgvector，HNSW + cosine）
3. 全文检索：`kb_chunk.content` 上的 pg_search BM25 索引（chinese/jieba 分词），知识库混合检索用
4. 知识图谱邻接表：`kb_graph_node` / `kb_graph_edge`（不引 Neo4j）
5. 上传文件的原始字节（`kb_document`，bytea——**PG 是唯一持久化存储**，备份即全覆盖）
6. 嵌入任务队列的领任务锁（`SELECT ... FOR UPDATE SKIP LOCKED`）

**约定**：镜像 `paradedb/paradedb:v0.25.11-pg17`（PostgreSQL 发行版，含 pgvector + pg_search，WeKnora 同款）；卷 `pgdata`；**不向宿主机发布端口**（管理走 `docker compose exec db psql`）；健康检查 `pg_isready`；50 人规模用默认配置，不做调优。

### 2.3 hify-ollama（可选，profile `local-models`）

**职责**：本地模型服务。一期主要承载 bge-m3 嵌入模型（中文检索质量的关键），也可注册为聊天 provider。

**约定**：卷 `ollama`（模型文件）；仅在 `docker compose --profile local-models up -d` 时启动；它不可用时由 provider 熔断兜底，不影响其他供应商。

### 2.4 备份 cron（宿主机）

每日 `pg_dump` 导出压缩 SQL 至宿主机目录，保留最近 14 份（见 §6 命令）。这是唯一放在 compose 之外的运维动作。

## 3. 请求流转

### 3.1 页面加载与登录

```
浏览器 GET /            → app 返回 index.html + 带指纹的静态资源（浏览器长缓存）
SPA 启动 GET /api/iam/me → 校验 session → 返回用户/角色
POST /api/iam/login     → Spring Security 认证 → session 写 PG(spring_session) → Set-Cookie
```

### 3.2 聊天流式（核心流）

```
① 浏览器 fetch POST /api/conversation/sessions/{id}/messages（ReadableStream 读 SSE）
② app：Tomcat 虚拟线程 → Security 过滤链 → 建 SseEmitter（15min 超时 + 15s 心跳）
③ Agent 循环（虚拟线程任务）：
   ├─ 有知识库 → knowledge 混合检索：向量 + BM25 → RRF 融合（app→db，详见 knowledge-design.md）
   └─ modelgateway：provider 信号量 → 熔断 → 重试 → 出站 HTTPS 云端 LLM（或 ollama）
④ 每个 chunk：sink.emit → SseEmitter → 原路回流浏览器 → 增量 markdown 渲染
⑤ 流结束：消息落库（事务）→ MessageCompletedEvent(AFTER_COMMIT+@Async) → usage 异步写日志
⑥ emitter complete，浏览器关流
断连：emitter.send 抛 IOException → 置 abort → 循环中止、部分内容保存、不算错误
```

### 3.3 知识库导入（异步流）

```
① POST /api/knowledge/documents（multipart，类型/大小校验）→ 文件字节存 PG → 返回 documentId(PENDING)
② 前端轮询 GET /api/knowledge/documents/{id}
③ app 内 @Async 虚拟线程：SKIP LOCKED 领任务 → Tika 解析 → 分段 → 分批 embed（gateway 出站）
   → 写 kb_chunk(embedding)；状态机 QUEUED→PARSING→CHUNKING→EMBEDDING→[WIKI]→[GRAPH]→READY / FAILED
   （各阶段时间轴、卡住检测与重试语义见 docs/knowledge-design.md）
④ FAILED 可重试，幂等：重跑先清该文档旧分段
```

### 3.4 管理流（admin）

`/api/modelgateway/providers` 等 CRUD → 保存后发模块内事件 → `ProviderRegistry` 重建对应 client（不停机生效）。

### 3.5 升级流

`git pull → docker compose build → docker compose up -d`：app 容器替换 → Flyway 前向迁移 → 就绪探活。session 在 PG 不丢失；**进行中的 SSE 流会断**，前端提示"连接中断，点击重发"。

## 4. 网络与安全

1. **端口最小暴露**：只有 `app:8080` 发布到宿主机；db/ollama 仅 compose 内网可达
2. `HIFY_MASTER_KEY` 与 DB 密码放宿主机 `.env`（chmod 600），不进镜像、不进 git（`.env.example` 提供模板）
3. TLS：内网 HTTP 直连即可；若公司要求 HTTPS，优先挂公司统一网关，其次 Spring Boot 直配 SSL
4. app 是唯一外网出口组件；若内网需代理出网，配 `HTTP_PROXY` 环境变量（JDK HttpClient 支持）
5. 日志脱敏由代码规范保障（API key、密文不落日志）

## 5. SSE 注意事项

- **直连无缓冲问题**：当前拓扑（浏览器 → app）不经过 nginx，SSE 天然直通；`X-Accel-Buffering: no` 响应头是给未来可能的前置代理准备的，代码里保留
- **若挂公司网关**（nginx 类）：必须 `proxy_buffering off` + `proxy_read_timeout ≥ 300s`，否则流式会被缓冲成"一次性出结果"或长思考被掐断——这是接入公司网关时最常踩的坑
- 心跳（15s `: keepalive`）已覆盖网关空闲断连场景

## 6. 数据与备份

- **唯一备份对象 = pgdata 卷**。文件字节在 PG、session 在 PG、向量在 PG——`pg_dump` 一条命令覆盖全部
- 每日备份（宿主机 crontab）：

```bash
0 2 * * * docker exec hify-db-1 pg_dump -U hify -d hify | gzip > /backup/hify-$(date +\%F).sql.gz && find /backup -name "hify-*.sql.gz" -mtime +14 -delete
```

- **升级前手动执行一次同样的 pg_dump**（Flyway 只前向迁移，回滚 = 恢复备份）
- 恢复演练：`gunzip -c backup.sql.gz | docker compose exec -T db psql -U hify -d hify`——每季度跑一次，没验证过的备份等于没有备份

## 7. 镜像构建（多阶段 Dockerfile）

```dockerfile
# 1) 前端构建
FROM node:22-alpine AS fe
WORKDIR /web
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build                       # 产物 /web/dist

# 2) 后端构建（前端产物打进 jar）
FROM maven:3.9-eclipse-temurin-21 AS be
WORKDIR /build
COPY pom.xml ./
RUN mvn -q dependency:go-offline
COPY src ./src
COPY --from=fe /web/dist ./src/main/resources/static
RUN mvn -q clean package -DskipTests   # 测试在 CI 跑，不进镜像构建

# 3) 运行时
FROM eclipse-temurin:21-jre
RUN apt-get update && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/*     # curl 供 healthcheck 用
COPY --from=be /build/target/hify.jar /app/hify.jar
USER 1000
ENTRYPOINT ["java", "-jar", "/app/hify.jar"]
```

产物：**一个镜像包含前后端**（对齐"app 托管前端静态资源"的宪法决策），发布 = 推一个 tag。

## 8. docker-compose.yml（骨架）

```yaml
services:
  app:
    image: hify-app:${TAG:-latest}
    build: .
    ports: ["8080:8080"]
    environment:
      HIFY_MASTER_KEY: ${HIFY_MASTER_KEY}
      SPRING_DATASOURCE_URL: jdbc:postgresql://db:5432/hify
      SPRING_DATASOURCE_USERNAME: ${DB_USER}
      SPRING_DATASOURCE_PASSWORD: ${DB_PASSWORD}
      JAVA_TOOL_OPTIONS: "-XX:MaxRAMPercentage=75"
    depends_on:
      db: { condition: service_healthy }
    healthcheck:
      test: ["CMD", "curl", "-fsS", "http://localhost:8080/actuator/health"]
      interval: 30s
      timeout: 5s
      retries: 3
    restart: unless-stopped
    networks: [hify-net]

  db:
    image: paradedb/paradedb:v0.25.11-pg17
    environment:
      POSTGRES_DB: hify
      POSTGRES_USER: ${DB_USER}
      POSTGRES_PASSWORD: ${DB_PASSWORD}
    volumes: [pgdata:/var/lib/postgresql/data]
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ${DB_USER} -d hify"]
      interval: 10s
      timeout: 5s
      retries: 5
    restart: unless-stopped
    networks: [hify-net]

  ollama:
    image: ollama/ollama:latest
    profiles: [local-models]
    volumes: [ollama:/root/.ollama]
    restart: unless-stopped
    networks: [hify-net]

volumes: { pgdata: {}, ollama: {} }
networks: { hify-net: {} }
```

`.env.example`：

```bash
TAG=latest
DB_USER=hify
DB_PASSWORD=<openssl rand -base64 24 生成>
HIFY_MASTER_KEY=<openssl rand -base64 32 生成，丢失即供应商密钥不可解密>
```

## 9. 资源估算

| 组件 | 内存 | CPU | 依据 |
|---|---|---|---|
| app | 1.5-2 GB | 0.5-1 核 | 50 并发 SSE 流靠虚拟线程（不占内存），heap 主要给嵌入批处理 |
| db | 1 GB | 0.5 核 | 默认配置；存储大头是 kb_chunk 向量与文档字节 |
| ollama（可选） | 4 GB+ | 视模型 | bge-m3 约 2 GB |

单台 8GB 的虚机即可承载全部组件（含 ollama）。

## 10. 单实例可用性哲学

一期**不做**：多副本、负载均衡、蓝绿发布、熔断切流。可用性由三个便宜的事实保障：

1. `restart: unless-stopped` + 宿主机 docker 服务自启 → 崩溃后分钟内自愈
2. 冷启动 < 1 分钟（Flyway + Spring Boot 单体）
3. session 在 PG → 重启/升级用户不掉线，只断进行中的 SSE 流（前端有重发按钮）

## 11. 升级与回滚

1. 升级：备份 → `docker compose build && docker compose up -d` → 观察 `/actuator/health` 与日志
2. Flyway 约定：只加不改——改列走"加新列 → 双写 → 删旧列"两段式发布，保证迁移可前向执行
3. 回滚：镜像 tag 切回上一版 `up -d`；若 Flyway 已跑，**不回滚数据库**（新列对旧代码无害），只在新列导致问题时恢复备份

## 12. 二期 K8s 迁移预留（现在不做，只留好路）

如果将来公司提供平台托管的 K8s 集群，当前设计迁移成本低，因为：

- **已就绪**：app 无状态、session 已在 PG（多副本天然共享）、任务领取已用 `SKIP LOCKED`（多副本安全）、健康检查端点已有
- **迁移时要做的**：Ingress 给 SSE 加注解（`proxy-buffering: off`、`proxy-read-timeout: 3600`）；Flyway 改为 initContainer/Job 先行；`HIFY_MASTER_KEY` 改 K8s Secret；per-provider 信号量 permits 按副本数除以 2 配置
- **不变的**：镜像本身一个字不用改——compose 与 K8s 只是同一镜像的两种编排
