# Hify modelgateway 设计：多 LLM 调用（线程 / 容错 / 超时 / 重试）

> 决策记录（2026-11-03，用户已确认）：
> 1. 四家供应商（OpenAI、Claude、Gemini、Ollama）**统一走 OpenAI 兼容协议**——供应商差异 = `mg_provider` 配置行，不写四套代码
> 2. 模型客户端与 embedding **手写**（JDK HttpClient + Jackson）；Spring AI 仅保留 pgvector 向量存储集成
> 3. 一期**不做自动 fallback**（失败自动换模型）：错误信息带 provider/model 名，用户手动换模型重发

本文件是 modelgateway 模块的实现依据；模型调用部分与 CLAUDE.md、docs/code-structure.md 冲突时以本文件为准。

## 1. 结构总览

调用链：`ModelClientApi`（唯一跨模块入口）→ `ModelGatewayService`（信号量 → 熔断 → 重试的编排层）→ `OpenAiCompatClient`（纯 HTTP）。

```
com.hify.modelgateway
├── api/
│   ├── ModelClientApi.java          # chat / chatStream
│   ├── EmbeddingApi.java            # embed（knowledge 模块用）
│   ├── StreamSink.java              # 流式回调接口，conversation 提供实现（转发给 SseEmitter）
│   ├── ModelCallException.java      # 跨模块异常，携带 category
│   └── dto/                         # ChatCommandDto / ChatResultDto / MessageDto / ToolDto /
│                                    # ToolCallDto / UsageDto / EmbedCommandDto / EmbeddingResultDto
└── internal/
    ├── service/
    │   ├── ModelGatewayService.java     # implements ModelClientApi, EmbeddingApi
    │   └── ProviderRegistry.java        # 按 mg_provider 行构建并缓存 client 实例；
    │                                    #   provider 配置变更事件触发重建；解密后的 key 仅驻内存
    ├── support/
    │   ├── OpenAiCompatClient.java      # 纯 HTTP：chat 流式/非流式、embed；流式 tool_call delta 拼接
    │   ├── ProviderCircuitBreaker.java  # 手写三态熔断器（每 provider 一个）
    │   ├── StreamWatchdog.java          # 首包/空闲超时看门狗（ScheduledExecutor 单线程）
    │   └── RetryPolicy.java             # 分类 + 指数退避 + "是否允许重试"谓词
    ├── controller/                      # provider / model 管理（ADMIN）
    ├── mapper/ ── entity/
    └── config/
```

## 2. 数据模型

`mg_provider`：

| 列 | 类型 | 说明 |
|---|---|---|
| id | bigint | 雪花（BaseEntity） |
| name | varchar | 显示名 |
| base_url | varchar | 如 `https://api.openai.com/v1` |
| api_key_cipher | bytea | AES-GCM 密文（主密钥 `HIFY_MASTER_KEY`）；解密后仅驻内存，禁止落日志 |
| enabled | boolean | |
| max_concurrency | int | 默认 8；该 provider 的信号量 permits |
| timeout_config | jsonb | 可空，覆盖全局默认：`{"connectMs":5000,"totalMs":30000,"ttftMs":30000,"idleMs":60000}` |
| circuit_config | jsonb | 可空：`{"failureThreshold":5,"openMs":30000}` |
| embedding_batch_size | int | 默认 16；本地嵌入模型建议调小 |
| create_time / update_time | | BaseEntity 自动填充 |

`mg_model`：

| 列 | 类型 | 说明 |
|---|---|---|
| id | bigint | |
| provider_id | bigint | → mg_provider.id（同模块内关联，允许） |
| name | varchar | 模型名（API 请求参数用） |
| display_name | varchar | |
| model_type | varchar | `CHAT` / `EMBEDDING` |
| input_price / output_price | decimal(10,4) | 每百万 token 单价；可空 = 不计价 |
| enabled | boolean | |

四家兼容端点（admin 录入示例，具体以各家官方文档为准）：

| 供应商 | base_url |
|---|---|
| OpenAI | `https://api.openai.com/v1` |
| Claude | `https://api.anthropic.com/v1/` |
| Gemini | `https://generativelanguage.googleapis.com/v1beta/openai/` |
| Ollama | `http://localhost:11434/v1` |

## 3. 线程管理

**模型：全程虚拟线程 + 阻塞式代码，禁止异步编排链。** LLM 调用是秒到分钟级长 I/O，20-50 并发下虚拟线程成本为零。

| 场景 | 线程来源 | 要点 |
|---|---|---|
| 聊天 SSE + Agent 循环 | controller 建 `SseEmitter` 后返回，循环跑在虚拟线程任务上（`spring.threads.virtual.enabled=true` 时 Boot 自动用虚拟线程任务执行器，**禁止**再自定义 `ThreadPoolTaskExecutor` 覆盖） | 一个会话一个虚拟线程，顺序调模型/工具，全程阻塞 |
| 嵌入批处理 | `@Async`（同上自动虚拟线程） | 双层限流见下 |
| 流式看门狗 | `ScheduledExecutorService` 单线程 | 每秒扫描活跃流 |

硬规则：

1. **HTTP 客户端只用 JDK HttpClient（`java.net.http`）**。内部基于 ReentrantLock，JDK 21 虚拟线程无 pinning。**禁止 OkHttp**——连接池用 synchronized，JDK 21 会 pin 载体线程（JDK 24 才修复）。
2. **虚拟线程无界，必须自己设闸门**。每 provider 一把 `Semaphore`（permits = `max_concurrency`）：

```java
Semaphore gate = registry.gateFor(providerId);
gate.acquire();
try {
    return doCall(request);          // 阻塞在虚拟线程上
} finally {
    gate.release();
}
```

3. **嵌入批处理双层限流**：knowledge 侧文档级 `Semaphore(2)`（同时处理几个文档）；gateway 侧全局嵌入 `Semaphore(4)`（对嵌入 API 的总并发）+ provider 信号量。批大小由 knowledge 按 `embedding_batch_size` 切批。
4. 每个 provider 一个 `OpenAiCompatClient` 实例（JDK HttpClient 自带连接复用），由 `ProviderRegistry` 构建缓存，配置变更（模块内 Spring 事件）触发重建。

## 4. 容错

**核心：把 HTTP 错误翻译成四种 category（对应重试 / 不重试 / 拒绝调用三种决策）。**

| category | 判定 | 决策 |
|---|---|---|
| `RETRYABLE` | 429、500/502/503/504、IOException（含各类超时） | 指数退避重试（§6） |
| `RATE_LIMITED` | 429（单列：优先读 `Retry-After` 头） | 同上，退避用 Retry-After |
| `FATAL` | 400/401/403/404/422 | 不重试，直达上层——配置问题（key 错、模型名错）重试无意义 |
| `DEGRADED` | 熔断器 OPEN | 拒绝调用，报"供应商暂不可用" |

机制：

1. `ModelCallException` 字段：category、httpStatus、providerId、modelName、provider 错误体（截断 500 字符、脱敏）。401/403/配额 429 的 message 要能指导 admin 检查 `mg_provider` 配置。
2. **熔断器手写三态**（每 provider 一个，约 50 行）：连续 5 次失败 → OPEN 30s → HALF_OPEN 放行 1 个探测 → 成功 CLOSED / 失败回 OPEN。不引 Resilience4j：per-provider 动态配置下手写更短更可控；需要滑动窗口统计时再换。
3. **两层错误分清**：模型调用失败 → 中断本次回答（本方案管这个）；工具执行失败 → 不中断，错误文本回传模型继续推理（Agent 循环规范管这个）。
4. **客户端断连**：`SseEmitter` 的 onError/onTimeout/onCompletion 置 abort 标志；conversation 的 sink 实现在 emit 时检查 emitter 存活。`emitter.send()` 抛 IOException = 用户离开 → 中止循环（省 token）、保存已生成部分、**不算错误不重试**。
5. **Ollama 特殊性**：内网快但模型冷加载首包可能 >30s——首包超时对本地 provider 放宽（§5 表），这就是超时必须 per-provider 可配的原因。
6. 不做自动 fallback：内部用户在场可自行换模型；自动降级掩盖供应商问题且计费归属混乱。

## 5. 超时

**流式调用禁止总超时**（长回答合法跑几分钟），用"首包 + 空闲"双超时。

| 参数 | 全局默认 | Ollama 建议 | 实现 |
|---|---|---|---|
| connectTimeout | 5s | 2s | HttpClient `connectTimeout` |
| 非流式总超时 | 30s | 60s | `HttpRequest.timeout` |
| 流式首包超时（TTFT） | 30s | 120s（冷加载） | StreamWatchdog |
| 流式 chunk 空闲超时 | 60s | 60s | StreamWatchdog |
| SseEmitter 对客户端 | 15min | 15min | emitter 构造参数 + 心跳 |
| Agent 单次运行护栏 | 5min | 5min | 循环层检查开始时间 |

实现：

1. 流式用 `BodyHandlers.ofInputStream()` 手动读循环，每次读到数据更新 `lastChunkAt`（AtomicLong）；注册到 `StreamWatchdog`（首包 deadline 在注册时设定），超时 → close 底层流 → read 循环抛 IOException → 统一错误路径。
2. **客户端侧心跳**：conversation 的 ChatStreamService 每 15s 发 SSE 注释行 `: keepalive\n\n`（客户端无感）。没有它 nginx 的 `proxy_read_timeout`（默认 60s）会在模型长时间思考时掐断连接——与 `X-Accel-Buffering: no` 同级必设。
3. token 统计取流式最终 chunk 的 usage（请求带 `stream_options.include_usage`；Ollama 不支持则该 provider 标记无 usage，计费按字符估算或标记未知）。
4. 所有超时值支持 `mg_provider.timeout_config` 覆盖全局默认。

## 6. 重试

**核心原则：只有"什么都没发生"时才能自动重试。** 流式一旦向用户输出了内容，重试 = 重复输出 + 双倍计费，禁止。

| 调用形态 | 策略 |
|---|---|
| 非流式（embedding、健康检查） | RETRYABLE/RATE_LIMITED 时指数退避重试 2 次（1s、4s，±20% 抖动）；429 优先 `Retry-After` |
| 流式，未收到任何 chunk | 自动重试 1 次（用户零感知） |
| 流式，已输出内容后中断 | **不重试**；SSE 发错误事件，前端"生成中断，一键重发"（语义上是新消息） |
| 嵌入批处理 | 单批失败记 `kb_ingest_task` 失败偏移，批次结束统计，支持从失败点续跑；不为单批阻塞整任务 |

```java
// RetryPolicy 骨架
boolean retryable(ModelCallException e, RetryContext ctx) {
    return switch (e.getCategory()) {
        case RETRYABLE, RATE_LIMITED -> !ctx.anythingEmitted();   // 唯一判据
        case FATAL, DEGRADED -> false;
    };
}
```

`anythingEmitted` 的实现：gateway 用计数包装器包住调用方的 `StreamSink`，emit 过一次即置位。

配套规则：

1. 重试封装在 `RetryPolicy` 内，Agent 循环与嵌入管道不感知。
2. 只在同 provider 同 model 上重试，不跨供应商。
3. 每次尝试写日志（attempt、延迟、category）；`usage_log` 记 attempt 数——重试率 = 供应商质量数据。
4. `chatStream` 在调用线程上阻塞直到流结束，delta 实时回调 sink，返回最终聚合结果（含拼接完成的 tool_calls 与 usage）。

## 7. 跨模块接口契约

```java
public interface ModelClientApi {
    ChatResultDto chat(ChatCommandDto cmd);                          // 非流式：健康检查、短调用
    ChatResultDto chatStream(ChatCommandDto cmd, StreamSink sink);   // 流式：阻塞至结束
}

public interface EmbeddingApi {
    EmbeddingResultDto embed(EmbedCommandDto cmd);                   // 一批文本一次调用
}

public interface StreamSink {
    void emit(String delta);     // conversation 的实现：转发给 SseEmitter，并做断连检查
}
```

```java
public record ChatCommandDto(Long providerId, String model, List<MessageDto> messages,
                             List<ToolDto> tools, Double temperature, Integer maxTokens) {}
public record MessageDto(String role, String content, List<ToolCallDto> toolCalls, String toolCallId) {}
public record ToolDto(String name, String description, Map<String, Object> parameters) {}
public record ToolCallDto(String id, String name, String arguments) {}   // arguments 为 JSON 字符串
public record ChatResultDto(String content, List<ToolCallDto> toolCalls,
                            UsageDto usage, String finishReason) {}
public record UsageDto(int inputTokens, int outputTokens) {}
public record EmbedCommandDto(Long providerId, String model, List<String> inputs) {}
public record EmbeddingResultDto(List<float[]> vectors) {}
```

流式 tool_call delta 的拼接（同一 tool call 的 arguments 分多个 chunk 到达）是 `OpenAiCompatClient` 的内部职责，调用方拿到的永远是完整聚合结果。

错误码（BizException code，前端按此提示）：

| code | 语义 | 前端提示方向 |
|---|---|---|
| MG_PROVIDER_UNAVAILABLE | 熔断 OPEN | 供应商暂不可用，稍后再试或换模型 |
| MG_CONNECT_TIMEOUT / MG_MODEL_TIMEOUT | 超时（重试耗尽） | 网络超时，请重试 |
| MG_RATE_LIMITED | 限流（重试耗尽） | 触发限流，稍后再试 |
| MG_AUTH_FAILED | 401/403 | 管理员检查供应商密钥 |
| MG_QUOTA_EXCEEDED | 配额 429 | 配额不足，联系管理员 |
| MG_BAD_REQUEST | 400/404/422 | 模型名或参数错误，检查 Agent 配置 |
| MG_STREAM_BROKEN | 已输出后中断 | 生成中断，一键重发 |

## 8. 配置

```yaml
hify:
  modelgateway:
    defaults:
      connect-timeout: 5s
      total-timeout: 30s        # 非流式
      ttft-timeout: 30s         # 流式首包
      idle-timeout: 60s         # 流式 chunk 空闲
      max-concurrency: 8        # 每 provider
    embedding:
      max-concurrent-calls: 4   # 全局嵌入并发
    retry:
      max-attempts: 2           # 非流式重试次数
      stream-first-chunk-retries: 1
      backoff-initial: 1s
      backoff-multiplier: 4
    agent:
      run-hard-limit: 5m        # Agent 循环护栏
```

Ollama 的 provider 行示例（覆盖项）：`timeout_config = {"connectMs":2000,"ttftMs":120000,"totalMs":60000}`。

## 9. 端到端时序

**聊天流式**：

1. 前端 `POST /api/conversation/sessions/{id}/messages`（fetch + ReadableStream 读取）
2. conversation controller 建 SseEmitter（15min）并注册心跳，提交虚拟线程任务运行 ChatStreamService
3. ChatStreamService → AgentLoopService（agent 模块）→ 知识检索（knowledge）→ 组装 ChatCommandDto → `modelClientApi.chatStream(cmd, sink)`
4. gateway：provider 信号量 → 熔断检查 → RetryPolicy 包裹 → 发请求 → 逐 chunk：更新 lastChunkAt、计数 sink.emit(delta)、拼接 tool_call delta
5. 流结束返回 ChatResultDto → agent 记录步骤/工具结果 → 循环下一步或完成
6. 完成：消息落库（事务方法）→ 发布 MessageCompletedEvent（usage 取自 result）→ emitter complete

**断连路径**：emitter.send 抛 IOException → sink 置 abort → gateway 读循环与 agent 循环在每次 emit/调用前检查 → 中止、保存部分内容、静默结束。

**嵌入批处理**：

1. knowledge 上传文档 → 解析分段 → 建 `kb_ingest_task`（PENDING）
2. @Async 虚拟线程取任务（文档级 Semaphore 2）→ 按 embedding_batch_size 切批 → `embeddingApi.embed(cmd)`
3. gateway：全局嵌入 Semaphore(4) + provider 信号量 → 调 API → 回传向量 → knowledge 写 kb_chunk
4. 单批失败记失败偏移可续跑；全部完成 → task DONE

## 10. 上线前冒烟清单

- [ ] 四家各跑：非流式 chat、流式 chat、带工具调用 chat、embedding（云端三家；Ollama 跑本地模型）
- [ ] 流式中途断开客户端（curl --no-buffer + Ctrl-C）：验证服务端中止、无报错日志刷屏、部分消息已保存
- [ ] 指向不存在端口：connect timeout 生效且错误码正确
- [ ] 慢速 mock（首包 >30s / chunk 间隔 >60s）：TTFT 与空闲超时分别触发
- [ ] mock 429（带/不带 Retry-After）与 500：重试次数、退避、日志 attempt 序号正确
- [ ] 连续失败 5 次：熔断 OPEN，30s 后 HALF_OPEN 放行探测
- [ ] 并发 20 路 chat：信号量限流生效、无 OkHttp/线程池告警
- [ ] provider 配置修改后：Registry 重建生效，无需重启

## 11. 一期不做清单

自动 fallback（二期候选，需先想清楚计费归属）、跨 provider 重试、Resilience4j、OkHttp/其他 HTTP 客户端、WebFlux、熔断指标面板（重试率先看日志与 usage_log）、流式响应中途续传。
