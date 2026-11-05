<script setup lang="ts">
import { computed, nextTick, onMounted, reactive, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { ThumbsDownOutline, ThumbsUpOutline } from '@vicons/ionicons5'
import { NButton, NEmpty, NIcon, NInput, NSpin, NTag, useMessage } from 'naive-ui'

import { agentApi } from '@/api/agent'
import type { AgentDto } from '@/api/agent'
import { conversationApi, sendMessage } from '@/api/conversation'
import type { CitationDto, FeedbackValue, SessionSummaryDto } from '@/api/conversation'
import { renderMarkdown } from '@/utils/markdown'
import CitationCards from '@/components/chat/CitationCards.vue'
import SessionList from '@/components/chat/SessionList.vue'

interface ChatMsg {
  id: number
  role: 'USER' | 'ASSISTANT'
  content: string
  citations: CitationDto[]
  feedback: FeedbackValue | null
  input_tokens: number
  output_tokens: number
  elapsed_ms: number
  created_at: string
  streaming?: boolean
  stopped?: boolean
  failed?: boolean
}

const route = useRoute()
const message = useMessage()

const agents = ref<AgentDto[]>([])
const agentId = ref<number | null>(null)
const sessions = ref<SessionSummaryDto[]>([])
const sessionId = ref<number | null>(null)
const messages = ref<ChatMsg[]>([])
const sessionsLoading = ref(false)
const messagesLoading = ref(false)

const input = ref('')
const streaming = ref(false)
const statusLine = ref<string | null>(null)
const abortRef = ref<AbortController | null>(null)
const listRef = ref<HTMLElement | null>(null)

const currentAgent = computed(() => agents.value.find((a) => a.id === agentId.value) ?? null)

function md(content: string): string {
  return renderMarkdown(content, { citeRefs: true })
}

async function loadAgents(): Promise<void> {
  try {
    agents.value = await agentApi.listAgents()
    if (agentId.value == null) agentId.value = agents.value[0]?.id ?? null
  } catch (e) {
    message.error(e instanceof Error ? e.message : 'Agent 列表加载失败')
  }
}

async function loadSessions(): Promise<void> {
  sessionsLoading.value = true
  try {
    sessions.value = agentId.value == null
      ? await conversationApi.listSessions()
      : await conversationApi.listSessions(agentId.value)
  } catch (e) {
    message.error(e instanceof Error ? e.message : '会话列表加载失败')
  } finally {
    sessionsLoading.value = false
  }
}

async function openSession(id: number): Promise<void> {
  if (streaming.value) abortRef.value?.abort()
  sessionId.value = id
  messagesLoading.value = true
  try {
    const list = await conversationApi.listMessages(id)
    messages.value = list.map((m) => ({ ...m }))
  } catch (e) {
    message.error(e instanceof Error ? e.message : '历史消息加载失败')
  } finally {
    messagesLoading.value = false
  }
}

function onNewChat(): void {
  if (streaming.value) abortRef.value?.abort()
  sessionId.value = null
  messages.value = []
}

async function onSessionsChanged(): Promise<void> {
  await loadSessions()
  if (sessionId.value != null && !sessions.value.some((s) => s.id === sessionId.value)) {
    onNewChat()
  }
}

async function send(): Promise<void> {
  const content = input.value.trim()
  if (!content || streaming.value || agentId.value == null) return
  input.value = ''
  let sid = sessionId.value
  if (sid == null) {
    try {
      const s = await conversationApi.createSession(agentId.value)
      sid = s.id
      sessionId.value = s.id
    } catch (e) {
      message.error(e instanceof Error ? e.message : '创建会话失败')
      return
    }
  }
  messages.value.push({
    id: -Date.now(),
    role: 'USER',
    content,
    citations: [],
    feedback: null,
    input_tokens: 0,
    output_tokens: 0,
    elapsed_ms: 0,
    created_at: new Date().toISOString(),
  })
  const assistant = reactive<ChatMsg>({
    id: -Date.now() - 1,
    role: 'ASSISTANT',
    content: '',
    citations: [],
    feedback: null,
    input_tokens: 0,
    output_tokens: 0,
    elapsed_ms: 0,
    created_at: new Date().toISOString(),
    streaming: true,
  })
  messages.value.push(assistant)
  streaming.value = true
  statusLine.value = '正在思考…'
  const controller = new AbortController()
  abortRef.value = controller
  try {
    const done = await sendMessage(
      sid,
      content,
      {
        onDelta: (d) => {
          assistant.content += d
          statusLine.value = null
        },
        onStatus: (s) => {
          statusLine.value = s
        },
        onCitations: (c) => {
          assistant.citations = c
        },
      },
      controller.signal,
    )
    assistant.id = done.message_id
    assistant.content = done.content
    assistant.citations = done.citations
    assistant.input_tokens = done.input_tokens
    assistant.output_tokens = done.output_tokens
    assistant.elapsed_ms = done.elapsed_ms
  } catch (e) {
    if (e instanceof Error && e.name === 'AbortError') {
      assistant.stopped = true
    } else {
      assistant.failed = true
      if (!assistant.content) {
        assistant.content = e instanceof Error ? e.message : '生成失败'
      }
      message.error('生成中断，可重新发送')
    }
  } finally {
    assistant.streaming = false
    streaming.value = false
    statusLine.value = null
    abortRef.value = null
    loadSessions()
  }
}

function stop(): void {
  abortRef.value?.abort()
}

async function sendFeedback(m: ChatMsg, value: FeedbackValue): Promise<void> {
  if (m.id < 0 || m.streaming) return
  const prev = m.feedback
  const next = m.feedback === value ? null : value
  m.feedback = next
  try {
    const fresh = await conversationApi.sendFeedback(m.id, next)
    m.feedback = fresh.feedback
  } catch (e) {
    m.feedback = prev
    message.error(e instanceof Error ? e.message : '反馈失败')
  }
}

function onBodyClick(e: MouseEvent): void {
  const target = e.target as HTMLElement
  const ref = target.closest('sup.cite-ref')
  if (!(ref instanceof HTMLElement)) return
  const n = ref.dataset.cite
  if (!n) return
  const card = listRef.value?.querySelector(`.citation-card[data-cite="${n}"]`)
  if (card instanceof HTMLElement) {
    card.scrollIntoView({ behavior: 'smooth', block: 'center' })
    card.classList.add('flash')
    window.setTimeout(() => card.classList.remove('flash'), 1500)
  }
}

watch(
  messages,
  async () => {
    await nextTick()
    if (listRef.value) {
      listRef.value.scrollTop = listRef.value.scrollHeight
    }
  },
  { deep: true },
)

watch(agentId, () => {
  if (streaming.value) abortRef.value?.abort()
  sessionId.value = null
  messages.value = []
  loadSessions()
})

onMounted(async () => {
  await loadAgents()
  const fromQuery = Number(route.query.session)
  if (Number.isFinite(fromQuery) && fromQuery > 0) {
    try {
      const all = await conversationApi.listSessions()
      const target = all.find((s) => s.id === fromQuery)
      if (target) agentId.value = target.agent_id
    } catch {
      // 定位失败不阻塞，回退默认列表
    }
  }
  await loadSessions()
  const pick = Number.isFinite(fromQuery) && fromQuery > 0 ? fromQuery : sessions.value[0]?.id
  if (pick != null) await openSession(pick)
})
</script>

<template>
  <div class="chat-view">
    <session-list
      :agents="agents"
      :agent-id="agentId"
      :sessions="sessions"
      :session-id="sessionId"
      :loading="sessionsLoading"
      @update:agent-id="agentId = $event"
      @select="openSession"
      @new-chat="onNewChat"
      @changed="onSessionsChanged"
    />

    <div class="chat-main">
      <div class="chat-head">
        <div class="head-name">{{ currentAgent?.name ?? '聊天' }}</div>
        <div class="head-desc">{{ currentAgent?.description || '未选择 Agent' }}</div>
      </div>

      <div ref="listRef" class="chat-list" @click="onBodyClick">
        <n-spin :show="messagesLoading" size="small">
          <div v-if="sessionId == null && currentAgent" class="welcome-card">
            <div class="welcome-name">{{ currentAgent.name }}</div>
            <div v-if="currentAgent.description" class="welcome-desc">{{ currentAgent.description }}</div>
            <div v-if="currentAgent.opening_statement" class="welcome-opening">
              {{ currentAgent.opening_statement }}
            </div>
          </div>

          <n-empty
            v-if="agents.length === 0 && !sessionsLoading"
            description="暂无可用 Agent——请联系管理员在「Agent 管理」中创建"
            style="margin-top: 15vh"
          />

          <div v-for="m in messages" :key="m.id" class="msg-row" :class="m.role === 'USER' ? 'user' : 'ai'">
            <div v-if="m.role === 'USER'" class="msg-bubble">{{ m.content }}</div>
            <template v-else>
              <div class="ai-avatar">AI</div>
              <div class="ai-body">
                <div v-if="m.streaming && statusLine && !m.content" class="status-line">
                  <n-spin :size="12" />
                  <span>{{ statusLine }}</span>
                </div>
                <div v-if="m.content" class="md-body" v-html="md(m.content)"></div>
                <citation-cards :citations="m.citations" />
                <div v-if="!m.streaming" class="msg-footer">
                  <span class="msg-meta">
                    {{ m.input_tokens + m.output_tokens }} tokens · {{ (m.elapsed_ms / 1000).toFixed(1) }}s
                  </span>
                  <n-tag v-if="m.stopped" size="tiny" :bordered="false">已停止</n-tag>
                  <n-tag v-if="m.failed" size="tiny" type="error" :bordered="false">失败</n-tag>
                  <div class="feedback-btns">
                    <n-button
                      quaternary
                      circle
                      size="tiny"
                      :type="m.feedback === 'LIKE' ? 'primary' : 'default'"
                      :disabled="m.id < 0"
                      @click="sendFeedback(m, 'LIKE')"
                    >
                      <template #icon>
                        <n-icon size="14"><thumbs-up-outline /></n-icon>
                      </template>
                    </n-button>
                    <n-button
                      quaternary
                      circle
                      size="tiny"
                      :type="m.feedback === 'DISLIKE' ? 'error' : 'default'"
                      :disabled="m.id < 0"
                      @click="sendFeedback(m, 'DISLIKE')"
                    >
                      <template #icon>
                        <n-icon size="14"><thumbs-down-outline /></n-icon>
                      </template>
                    </n-button>
                  </div>
                </div>
              </div>
            </template>
          </div>
        </n-spin>
      </div>

      <div class="chat-input">
        <n-input
          v-model:value="input"
          type="textarea"
          :autosize="{ minRows: 1, maxRows: 4 }"
          :disabled="streaming"
          placeholder="输入消息，Enter 发送，Shift+Enter 换行"
          @keydown.enter.exact.prevent="send"
        />
        <n-button v-if="streaming" @click="stop">停止</n-button>
        <n-button v-else type="primary" :disabled="!input.trim() || agentId == null" @click="send">
          发送
        </n-button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.chat-view {
  height: 100%;
  display: flex;
  gap: 12px;
  overflow: hidden;
}

.chat-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  background: #fff;
  border: 1px solid #e9ebef;
  border-radius: 10px;
  padding: 14px 20px;
}

.chat-head {
  padding-bottom: 10px;
  border-bottom: 1px solid #efefef;
  flex-shrink: 0;
}

.head-name {
  font-size: 15px;
  font-weight: 600;
}

.head-desc {
  font-size: 12px;
  color: #999;
  margin-top: 2px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.chat-list {
  flex: 1;
  overflow-y: auto;
  padding: 14px 4px;
}

.welcome-card {
  background: #f9fdfa;
  border: 1px solid #e3f2e7;
  border-radius: 8px;
  padding: 20px 24px;
  margin: 6vh auto 0;
  max-width: 460px;
  text-align: center;
}

.welcome-name {
  font-size: 17px;
  font-weight: 600;
}

.welcome-desc {
  font-size: 13px;
  color: #888;
  margin-top: 6px;
}

.welcome-opening {
  font-size: 13px;
  color: #555;
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px dashed #e3f2e7;
}

.msg-row.user {
  display: flex;
  justify-content: flex-end;
  margin-bottom: 14px;
}

.msg-bubble {
  background: #e9f8ec;
  border-radius: 8px;
  padding: 8px 12px;
  max-width: 72%;
  white-space: pre-wrap;
  word-break: break-word;
  font-size: 14px;
  line-height: 1.7;
}

.msg-row.ai {
  display: flex;
  gap: 10px;
  margin-bottom: 18px;
  align-items: flex-start;
}

.ai-avatar {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  background: #07c05f;
  color: #fff;
  font-size: 11px;
  font-weight: 600;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.ai-body {
  flex: 1;
  min-width: 0;
}

.status-line {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  color: #999;
  padding: 4px 0;
}

.msg-footer {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 8px;
}

.msg-meta {
  font-size: 12px;
  color: #bbb;
}

.feedback-btns {
  display: flex;
  gap: 2px;
}

:deep(.citation-card.flash) {
  border-color: #07c05f;
  box-shadow: 0 0 0 3px rgba(7, 192, 95, 0.25);
}

.chat-input {
  display: flex;
  gap: 10px;
  align-items: flex-end;
  padding-top: 12px;
  border-top: 1px solid #efefef;
  flex-shrink: 0;
}
</style>
