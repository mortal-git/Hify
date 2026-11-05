<script setup lang="ts">
import { computed, ref } from 'vue'
import { AddOutline, CreateOutline, TrashOutline } from '@vicons/ionicons5'
import { NButton, NIcon, NInput, NModal, NPopconfirm, NSelect, NSpin, useMessage } from 'naive-ui'
import type { SelectOption } from 'naive-ui'

import { conversationApi } from '@/api/conversation'
import type { SessionSummaryDto } from '@/api/conversation'
import type { AgentDto } from '@/api/agent'

const props = defineProps<{
  agents: AgentDto[]
  agentId: number | null
  sessions: SessionSummaryDto[]
  sessionId: number | null
  loading: boolean
}>()

const emit = defineEmits<{
  (e: 'update:agentId', value: number | null): void
  (e: 'select', sessionId: number): void
  (e: 'new-chat'): void
  (e: 'changed'): void
}>()

const message = useMessage()
const renameTarget = ref<SessionSummaryDto | null>(null)
const renameTitle = ref('')
const renaming = ref(false)

const agentOptions = computed<SelectOption[]>(() =>
  props.agents.map((a) => ({ label: a.name, value: a.id })),
)

function fmtShort(iso: string): string {
  const d = new Date(iso)
  const now = new Date()
  const sameDay = d.toDateString() === now.toDateString()
  const pad = (n: number): string => String(n).padStart(2, '0')
  return sameDay ? `${pad(d.getHours())}:${pad(d.getMinutes())}` : `${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function onAgentChange(v: string | number | null): void {
  emit('update:agentId', v == null ? null : Number(v))
}

function openRename(s: SessionSummaryDto): void {
  renameTarget.value = s
  renameTitle.value = s.title
}

async function confirmRename(): Promise<void> {
  const target = renameTarget.value
  const title = renameTitle.value.trim()
  if (!target || !title) return
  renaming.value = true
  try {
    await conversationApi.renameSession(target.id, title)
    message.success('已重命名')
    renameTarget.value = null
    emit('changed')
  } catch (e) {
    message.error(e instanceof Error ? e.message : '重命名失败')
  } finally {
    renaming.value = false
  }
}

async function remove(s: SessionSummaryDto): Promise<void> {
  try {
    await conversationApi.deleteSession(s.id)
    message.success('会话已删除')
    emit('changed')
  } catch (e) {
    message.error(e instanceof Error ? e.message : '删除失败')
  }
}
</script>

<template>
  <div class="session-list">
    <n-select
      :value="agentId"
      :options="agentOptions"
      size="small"
      placeholder="选择 Agent"
      @update:value="onAgentChange"
    />
    <n-button class="new-btn" type="primary" size="small" @click="emit('new-chat')">
      <template #icon>
        <n-icon><add-outline /></n-icon>
      </template>
      新建会话
    </n-button>

    <n-spin :show="loading" size="small" style="width: 100%">
      <div class="session-scroll">
        <div
          v-for="s in sessions"
          :key="s.id"
          class="session-item"
          :class="{ active: s.id === sessionId }"
          @click="emit('select', s.id)"
        >
          <div class="session-title">{{ s.title }}</div>
          <div class="session-meta">{{ s.message_count }} 条 · {{ fmtShort(s.updated_at) }}</div>
          <div class="session-actions" @click.stop>
            <n-button quaternary circle size="tiny" @click="openRename(s)">
              <template #icon>
                <n-icon size="13"><create-outline /></n-icon>
              </template>
            </n-button>
            <n-popconfirm @positive-click="remove(s)">
              <template #trigger>
                <n-button quaternary circle size="tiny">
                  <template #icon>
                    <n-icon size="13"><trash-outline /></n-icon>
                  </template>
                </n-button>
              </template>
              删除会话「{{ s.title }}」？
            </n-popconfirm>
          </div>
        </div>
        <div v-if="!loading && sessions.length === 0" class="session-empty">暂无会话</div>
      </div>
    </n-spin>

    <n-modal
      :show="renameTarget != null"
      preset="card"
      title="重命名会话"
      style="width: 420px"
      @update:show="(v: boolean) => (renameTarget = v ? renameTarget : null)"
    >
      <n-input v-model:value="renameTitle" maxlength="60" placeholder="会话标题" @keydown.enter="confirmRename" />
      <template #footer>
        <n-button type="primary" :loading="renaming" @click="confirmRename">保存</n-button>
      </template>
    </n-modal>
  </div>
</template>

<style scoped>
.session-list {
  width: 248px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
  background: #fff;
  border: 1px solid #e9ebef;
  border-radius: 10px;
  padding: 12px;
  height: 100%;
  overflow: hidden;
}

.new-btn {
  width: 100%;
}

.session-scroll {
  overflow-y: auto;
  min-height: 120px;
  max-height: calc(100vh - 220px);
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.session-item {
  padding: 8px 10px;
  border-radius: 4px;
  cursor: pointer;
  position: relative;
}

.session-item:hover {
  background: #f2f3f5;
}

.session-item.active {
  background: #e9f8ec;
}

.session-title {
  font-size: 13px;
  color: #333;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  padding-right: 44px;
}

.session-meta {
  font-size: 12px;
  color: #999;
  margin-top: 2px;
}

.session-actions {
  position: absolute;
  right: 6px;
  top: 50%;
  transform: translateY(-50%);
  display: none;
  gap: 2px;
}

.session-item:hover .session-actions {
  display: flex;
}

.session-empty {
  font-size: 13px;
  color: #999;
  text-align: center;
  padding: 24px 0;
}
</style>
