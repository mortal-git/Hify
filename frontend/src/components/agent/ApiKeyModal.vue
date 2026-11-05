<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { NButton, NModal, NPopconfirm, NSpace, useMessage } from 'naive-ui'

import { agentApi } from '@/api/agent'
import type { AgentDto } from '@/api/agent'

const props = defineProps<{
  show: boolean
  agent: AgentDto | null
}>()

const emit = defineEmits<{
  (e: 'update:show', value: boolean): void
  (e: 'rotated', agent: AgentDto): void
}>()

const message = useMessage()
const revealed = ref(false)
const rotating = ref(false)

watch(
  () => props.show,
  (show) => {
    if (show) revealed.value = false
  },
)

const maskedKey = computed(() => {
  const key = props.agent?.api_key ?? ''
  return key.length > 8 ? `${key.slice(0, 8)}${'•'.repeat(18)}` : '••••••••'
})

const curlExample = computed(() => {
  const origin = window.location.origin
  const key = props.agent?.api_key ?? ''
  const id = props.agent?.id ?? 0
  return [
    `curl -X POST ${origin}/api/agent/apps/${id}/chat \\`,
    `  -H "Content-Type: application/json" \\`,
    `  -H "X-Api-Key: ${key}" \\`,
    `  -d '{"content": "你的问题", "stream": false}'`,
  ].join('\n')
})

async function copyKey(): Promise<void> {
  const key = props.agent?.api_key
  if (!key) return
  try {
    await navigator.clipboard.writeText(key)
    message.success('已复制到剪贴板')
  } catch {
    message.error('复制失败——请手动选择复制')
  }
}

async function rotate(): Promise<void> {
  if (!props.agent) return
  rotating.value = true
  try {
    const fresh = await agentApi.regenerateApiKey(props.agent.id)
    message.success('API Key 已重置，旧 Key 立即失效')
    revealed.value = true
    emit('rotated', fresh)
  } catch (e) {
    message.error(e instanceof Error ? e.message : '重置失败')
  } finally {
    rotating.value = false
  }
}
</script>

<template>
  <n-modal
    :show="show"
    preset="card"
    :title="`API 访问 — ${agent?.name ?? ''}`"
    style="width: 620px"
    @update:show="(v: boolean) => emit('update:show', v)"
  >
    <div class="key-row">
      <code class="key-value">{{ revealed ? agent?.api_key : maskedKey }}</code>
      <n-button size="small" @click="revealed = !revealed">{{ revealed ? '隐藏' : '显示' }}</n-button>
      <n-button size="small" @click="copyKey">复制</n-button>
    </div>
    <n-space align="center" style="margin-top: 8px">
      <span class="hint">每个应用一个 REST API——外部系统凭此 Key 直接调用，不占用站内会话。</span>
    </n-space>

    <div class="section-title">调用示例</div>
    <pre class="curl-block">{{ curlExample }}</pre>

    <div class="section-title danger">重置</div>
    <n-space align="center">
      <n-popconfirm @positive-click="rotate">
        <template #trigger>
          <n-button size="small" type="warning" secondary :loading="rotating">重置 API Key</n-button>
        </template>
        重置后旧 Key 立即失效，已接入的系统需更新，确认？
      </n-popconfirm>
    </n-space>
  </n-modal>
</template>

<style scoped>
.key-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.key-value {
  flex: 1;
  min-width: 0;
  background: #f6f8fa;
  border-radius: 4px;
  padding: 8px 12px;
  font-size: 13px;
  overflow-x: auto;
  white-space: nowrap;
}

.hint {
  font-size: 12px;
  color: #999;
}

.section-title {
  font-size: 13px;
  font-weight: 600;
  margin: 18px 0 8px;
}

.section-title.danger {
  color: #d9a300;
}

.curl-block {
  background: #f6f8fa;
  border-radius: 6px;
  padding: 10px 14px;
  font-size: 12px;
  line-height: 1.7;
  overflow-x: auto;
  margin: 0;
}
</style>
