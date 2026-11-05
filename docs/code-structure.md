# Hify 代码组织规范（后端）

本文件与 CLAUDE.md 配套：CLAUDE.md 定义架构与红线，本文件定义到包和类级别的执行规则。**写任何后端代码前先读本文件**；规则冲突时以本文件为准，改动规则先改本文件。

## 0. 写代码前 30 秒自查

1. 我在哪个模块？→ 决定我能依赖谁（见 §3 的 DAG）
2. 我在写哪一层？→ 决定我能 import 什么（见 §2 的表）
3. 要跨模块拿数据？→ 只能调对方 `api` 包里的 Api 接口；纯展示数据优先用事件快照
4. 要开事务？→ 只能在 service 层；方法内禁止一切外部 I/O（HTTP/LLM/文件解析）；禁止 this 调用

## 1. 包结构模板

所有模块统一使用以下结构。以 `conversation` 模块为例：

```
com.hify.conversation
├── api/                                  # 唯一允许被其他模块依赖的包
│   ├── ChatApi.java                      # 跨模块接口（仅当模块确实被别的模块调用时才建）
│   ├── dto/                              # 跨模块传输对象（record，不可变）
│   │   └── ChatMessageSummaryDto.java
│   └── event/                            # 本模块发布的事件（record，字段自包含）
│       └── MessageCompletedEvent.java
└── internal/                             # 模块私有，ArchUnit 禁止跨模块访问
    ├── controller/
    │   ├── ChatSessionController.java
    │   └── vo/                           # 仅 web 层使用的请求/响应对象（record + 校验注解）
    │       ├── SendMessageRequest.java
    │       └── ChatMessageResponse.java
    ├── service/
    │   ├── ChatSessionService.java       # 内部业务类
    │   └── ChatStreamService.java        # SSE 推流
    ├── mapper/
    │   └── ChatMessageMapper.java        # 继承 BaseMapper<ChatMessageEntity>
    ├── entity/
    │   └── ChatMessageEntity.java        # 表 chat_message
    ├── config/                           # 本模块专属 @Configuration（可选）
    └── support/                          # 技术组件：LLM 客户端、熔断器、重试策略、SSE 工厂、文件解析器等（可选）
```

resources 布局：

```
src/main/resources/
├── mapper/<module>/XxxMapper.xml         # 仅复杂 SQL 写 XML；简单查询用 LambdaQueryWrapper
└── db/migration/V<序号>__<模块前缀>_<描述>.sql   # Flyway，如 V3__kb_chunk_init.sql
```

约束：

- 一个模块 = `com.hify.<module>` 一个顶级包，禁止出现规范之外的子包（要加新子包先改本文件）
- `api` 包里只有接口、record、常量、异常类（跨模块异常如 `ModelCallException`），没有任何实现类
- common 模块例外：它没有 api/internal 之分，全部公开（`com.hify.common.<子包>`）

## 2. 分层职责边界

### 2.1 职责总表

| 层 | 只负责 | 禁止 | 可依赖 |
|---|---|---|---|
| Controller | HTTP 语义：路由、参数绑定、触发校验、`@PreAuthorize`、状态码、vo↔dto 转换、SseEmitter 的建立与返回 | 业务逻辑（分支/循环决策）、`@Transactional`、调用 mapper、调用其他模块、try-catch 业务异常 | 本模块 service、本模块 vo、common（R/BizException/CurrentUser） |
| Service | 业务逻辑、事务边界、entity↔dto 转换、组装查询条件（LambdaQueryWrapper）、调用本模块 mapper、调用其他模块 Api、发布事件 | 出现任何 HTTP 概念（HttpServletRequest、状态码）、访问其他模块的 internal/mapper/entity、事务方法内外部 I/O | 本模块全部、其他模块 `api` 包、common |
| Mapper | 单表 CRUD（BaseMapper 继承）与复杂查询（XML） | 被 controller 调用、组装业务查询条件 | 本模块 entity |
| Entity | 表结构映射 + 公共字段（继承 BaseEntity），纯数据 | 业务方法、离开本模块（出模块前必须转 dto/vo） | common 的 BaseEntity |
| Api 接口 | 跨模块契约：方法签名 + dto + 事件 | 任何实现代码、依赖 internal、dto 上加校验注解 | common、JDK |
| Api 实现 | 位于 internal/service，命名 `XxxService implements XxxApi`，`@Service` | — | 同 Service |

### 2.2 事务规则（service 层）

1. `@Transactional` 只允许出现在 service（含 Api 实现类）的方法上
2. **事务方法内禁止一切外部 I/O**：HTTP 调用（含 ModelClientApi 的 chat/embed）、LLM 流式读取、文件解析、`Thread.sleep`。含 I/O 的方法不许开事务，需要落库时把 DB 写入拆到独立的 @Transactional 方法
3. **禁止 this 调用事务方法**：Spring 代理下同类内部调用事务不生效。事务方法必须放在独立的 bean 里，通过注入调用
4. 只读方法标 `@Transactional(readOnly = true)`
5. 跨模块 Api 调用与调用方处于同一物理事务（单库 + 默认传播），这是允许的；但 Api 实现必须能脱离调用方事务独立成立，禁止依赖对方的回滚顺序

### 2.3 Controller 细则

1. 路径格式 `/api/<模块>/<资源复数>`，资源用 kebab-case，如 `/api/agent/agent-defs`、`/api/knowledge/documents`
2. 返回统一包装 `R<T>`（`common.web.R`，结构 `{code, message, data}`）；SSE 接口返回 `SseEmitter`，不包装
3. 管理端接口（增删改配置、知识库管理、用量查看）必须加 `@PreAuthorize("hasRole('ADMIN')")`；聊天与读取自己会话的接口登录即可
4. vo 用 record + jakarta.validation 注解，入口参数标 `@Valid`；**校验只做在 vo 上，Api dto 不加校验注解**（跨模块调用是可信调用）
5. 异常不捕获：service 抛 `BizException`，由 `common.web.GlobalExceptionHandler` 统一处理

### 2.4 事件规则

1. 事件是 record，定义在**发布方**的 `api/event` 包，字段自包含（监听方需要什么就带什么快照，如 `userName`，禁止监听方为取名字反查发布方）
2. 发布：注入 `ApplicationEventPublisher` 调 `publishEvent`
3. 监听：`@Async` + `@TransactionalEventListener(phase = AFTER_COMMIT)`——事务提交后才算数，且不阻塞主流程
4. 监听方法整体 try-catch，异常只记日志，禁止向上抛
5. 事件只用于单向通知（统计、审计、缓存失效）；需要返回值的场景一律走 Api 同步调用

### 2.5 MyBatis-Plus 细则

1. 启动类 `@MapperScan("com.hify.**.mapper")`
2. 简单查询：service 里 `LambdaQueryWrapper`，禁止 mapper XML 写业务条件组合
3. 复杂查询（向量检索、聚合统计）：XML 放 `resources/mapper/<module>/`
4. 主键统一 `Long`，`BaseEntity` 里 `@TableId(type = IdType.ASSIGN_ID)`（雪花）
5. `createTime`/`updateTime` 由 `common.config.MybatisPlusMetaObjectHandler` 自动填充，entity 不手动赋值
6. 不使用逻辑删除；需要"停用"语义的字段单独建模（如 `agent_def.status`）

## 3. 跨模块调用规则

### 3.1 依赖方向 DAG（ArchUnit 强制）

```
conversation → agent, modelgateway, knowledge, common
agent        → knowledge, modelgateway, common
knowledge    → modelgateway, common
modelgateway → common
iam          → common
usage        → common
```

- 依赖 = import 对方包里的任何类。**禁止的方向直接不允许 import**，即使只 import 对方的 api 也不行
- 新增依赖方向必须先改本文件 §3.1 和 §5 的 `ALLOWED_DEPS`，再写代码
- `common` 禁止依赖任何业务模块

### 3.2 调用形式

1. 跨模块调用只有一种形式：**注入对方的 Api 接口（构造器注入），调用其方法**
2. 禁止：依赖对方 `internal` 包的任何类；直接查对方的表（包括 JOIN、包括在 XML 里写对方前缀的表名）；通过反射/工具类绕过边界
3. Api 接口设计粒度 = 业务能力，不是 CRUD 镜像。例：`RetrievalApi.retrieve(kbId, query, topK)` 而不是 `ChunkApi.listByKbId()`
4. Api 方法签名只允许出现：dto record、JDK 类型、`List`/`Optional` 包装。entity 出现在签名里 = 违规

### 3.3 数据规则

1. 跨模块只传 dto record，entity 永不出模块
2. 纯展示数据（用户名、模型名等）优先**事件快照**：事件发生时把字段带在事件里；禁止为了展示实时反查别的模块
3. dto 字段名与 vo 一样用 lowerCamelCase（HTTP 序列化由全局 Jackson SNAKE_CASE 配置统一处理，类内命名不受影响）

### 3.4 同步还是事件

- 需要返回值 → Api 同步调用
- 纯通知/统计/审计 → 事件
- 两者都成立时 → Api（简单直接优先）

## 4. 命名规范速查表

| 对象 | 规则 | 示例 |
|---|---|---|
| 跨模块接口 | `XxxApi` | `RetrievalApi`、`ModelClientApi`、`EmbeddingApi` |
| 业务类 | `XxxService`；实现 Api 时 `implements XxxApi` | `RetrievalService implements RetrievalApi` |
| Controller | `XxxController` | `AgentDefController` |
| 请求/响应对象 | `XxxRequest` / `XxxResponse`，record | `SendMessageRequest` |
| 跨模块 DTO | `XxxDto`，record | `RetrievedChunkDto` |
| 事件 | `XxxEvent`，record | `MessageCompletedEvent` |
| 实体 | `XxxEntity` → 表名去前缀转大驼峰 | `ChatMessageEntity` ↔ `chat_message` |
| Mapper | `XxxMapper` | `ChatMessageMapper` |
| REST 路径 | `/api/<模块>/<资源复数>`，kebab-case | `/api/conversation/sessions` |
| Flyway | `V<序号>__<模块前缀>_<描述>.sql` | `V4__agent_def_init.sql` |

模块与表前缀对照（禁止跨模块外键，外键只能指向本模块的表）：

| 模块 | 表前缀 | 示例表 |
|---|---|---|
| iam | `iam_` | `iam_user` |
| modelgateway | `mg_` | `mg_provider` |
| agent | `agent_` | `agent_def`、`agent_tool` |
| knowledge | `kb_` | `kb_document`、`kb_chunk` |
| conversation | `chat_` | `chat_session`、`chat_message` |
| usage | `usage_` | `usage_log` |
| common | 无表 | — |

## 5. ArchUnit 守护测试

位置：`com.hify.common.arch.ModuleBoundaryArchTest`。新增模块时在 `MODULES` 和 `ALLOWED_DEPS` 里各加一行。

```java
package com.hify.common.arch;

import com.tngtech.archunit.junit.AnalyzeClasses;
import com.tngtech.archunit.junit.ArchTest;
import com.tngtech.archunit.lang.ArchRule;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

import static com.tngtech.archunit.lang.syntax.ArchRuleDefinition.noClasses;

@AnalyzeClasses(packages = "com.hify")
class ModuleBoundaryArchTest {

    private static final List<String> MODULES = List.of(
        "common", "iam", "modelgateway", "agent", "knowledge", "conversation", "usage");

    // 与 §3.1 的 DAG 一一对应，改一处必须同步另一处
    private static final Map<String, List<String>> ALLOWED_DEPS = Map.of(
        "conversation", List.of("agent", "knowledge", "modelgateway", "common"),
        "agent",        List.of("knowledge", "modelgateway", "common"),
        "knowledge",    List.of("modelgateway", "common"),
        "modelgateway", List.of("common"),
        "iam",          List.of("common"),
        "usage",        List.of("common"),
        "common",       List.of());

    @ArchTest
    static List<ArchRule> internal包禁止跨模块访问() {
        List<ArchRule> rules = new ArrayList<>();
        for (String m : MODULES) {
            rules.add(noClasses()
                .that().resideOutsideOfPackage("com.hify." + m + "..")
                .should().dependOnClassesThat()
                .resideInAPackage("com.hify." + m + ".internal..")
                .allowEmptyShould(true)
                .because("internal 是 " + m + " 模块私有，跨模块只能走 api 包"));
        }
        return rules;
    }

    @ArchTest
    static List<ArchRule> 模块依赖方向必须符合DAG() {
        List<ArchRule> rules = new ArrayList<>();
        for (var entry : ALLOWED_DEPS.entrySet()) {
            String m = entry.getKey();
            for (String other : MODULES) {
                if (!other.equals(m) && !entry.getValue().contains(other)) {
                    rules.add(noClasses()
                        .that().resideInAPackage("com.hify." + m + "..")
                        .should().dependOnClassesThat()
                        .resideInAPackage("com.hify." + other + "..")
                        .allowEmptyShould(true)
                        .because(m + " → " + other + " 不在允许的依赖方向上"));
                }
            }
        }
        return rules;
    }

    @ArchTest
    static ArchRule controller禁止依赖mapper =
        noClasses().that().resideInAPackage("..controller..")
            .should().dependOnClassesThat().resideInAPackage("..mapper..")
            .allowEmptyShould(true);

    @ArchTest
    static ArchRule api包禁止依赖internal实现 =
        noClasses().that().resideInAPackage("..api..")
            .should().dependOnClassesThat().resideInAPackage("..internal..")
            .allowEmptyShould(true);
}
```

## 6. 参考实现骨架

### 6.1 knowledge 模块对外暴露检索能力

```java
// com.hify.knowledge.api.RetrievalApi
public interface RetrievalApi {
    List<RetrievedChunkDto> retrieve(Long kbId, String query, int topK);
}

// com.hify.knowledge.api.dto.RetrievedChunkDto
public record RetrievedChunkDto(String content, String docTitle, double score) {}

// com.hify.knowledge.internal.service.RetrievalService —— 其他模块看不到这个类
@Service
public class RetrievalService implements RetrievalApi {

    private final KbChunkMapper chunkMapper;      // 本模块 mapper
    private final EmbeddingApi embeddingApi;      // modelgateway 的 api，构造器注入

    public RetrievalService(KbChunkMapper chunkMapper, EmbeddingApi embeddingApi) {
        this.chunkMapper = chunkMapper;
        this.embeddingApi = embeddingApi;
    }

    @Override
    public List<RetrievedChunkDto> retrieve(Long kbId, String query, int topK) {
        var qv = embeddingApi.embed(new EmbedCommandDto(kb.embedProviderId(), kb.embedModel(), List.of(query))).vectors().get(0);
        return chunkMapper.searchByVector(kbId, qv, topK)   // 向量检索 SQL 在 XML
            .stream()
            .map(c -> new RetrievedChunkDto(c.getContent(), c.getDocTitle(), c.getScore()))
            .toList();
    }
}
```

### 6.2 agent 模块执行循环（示范事务与外部 I/O 分离）

```java
// com.hify.agent.internal.service.AgentLoopService
@Service
public class AgentLoopService {

    private final ModelClientApi modelClient;     // modelgateway api
    private final RetrievalApi retrieval;         // knowledge api
    private final AgentStepRecorder stepRecorder; // 本模块独立 bean，事务落库

    public AgentLoopService(ModelClientApi modelClient, RetrievalApi retrieval,
                            AgentStepRecorder stepRecorder) { /* 赋值省略 */ }

    // 故意没有 @Transactional：整个循环包含 LLM 调用（外部 I/O）
    public String run(AgentDefDto agent, String userInput, StreamSink sink) {
        var ctx = buildContext(agent, userInput);
        for (int step = 0; step < agent.maxSteps(); step++) {
            var resp = modelClient.chatStream(ctx.toCommand(agent), sink);
            if (!resp.toolCalls().isEmpty()) {
                var result = executeTool(resp.toolCalls().get(0));
                ctx.appendToolResult(resp.toolCalls().get(0), result);
                stepRecorder.save(agent.id(), step, resp, result);  // 事务方法在另一个 bean
                continue;
            }
            return resp.content();   // delta 已通过 sink 实时推给用户
        }
        throw new BizException("AGENT_STEPS_EXCEEDED", "达到最大步数限制");
    }
}
```

```java
// com.hify.agent.internal.service.AgentStepRecorder —— 单独的 bean 承载事务
@Service
public class AgentStepRecorder {
    private final AgentStepMapper stepMapper;

    @Transactional
    public void save(Long agentId, int step, ChatResponse resp, String toolResult) {
        // entity 组装 + insert，仅 DB 操作
    }
}
```

### 6.3 conversation 发布事件、usage 监听

```java
// com.hify.conversation.api.event.MessageCompletedEvent —— 字段自包含
public record MessageCompletedEvent(
    Long messageId, Long agentId, Long userId, String userName,
    String modelId, int inputTokens, int outputTokens) {}

// conversation 的 service 里发布
eventPublisher.publishEvent(new MessageCompletedEvent(
    id, agentId, CurrentUser.userId(), CurrentUser.userName(),
    modelId, in, out));

// com.hify.usage.internal.service.UsageRecorder
@Component
public class UsageRecorder {
    @Async
    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
    public void on(MessageCompletedEvent e) {
        try {
            usageLogMapper.insert(toEntity(e));
        } catch (Exception ex) {
            log.error("usage 记录失败 messageId={}", e.messageId(), ex);
        }
    }
}
```

## 7. 强制 vs 约定清单

| 规则 | 保障手段 |
|---|---|
| internal 包禁止跨模块访问 | ArchUnit，CI 必挂 |
| 模块依赖方向符合 DAG | ArchUnit，CI 必挂 |
| controller 禁止依赖 mapper | ArchUnit，CI 必挂 |
| api 包禁止依赖 internal | ArchUnit，CI 必挂 |
| entity 不出现在 Api 签名 / 不出模块 | ArchUnit 间接覆盖（api 不依赖 internal）+ 人工 |
| 事务方法内禁止外部 I/O | 约定，人工把关 |
| 事务方法禁止 this 调用 | 约定，人工把关 |
| 跨模块 JOIN / 外键 | 约定，SQL review 时检查 XML 与 Flyway 脚本 |
| dto 不加校验注解 | 约定 |
