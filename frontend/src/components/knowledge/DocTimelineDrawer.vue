<script setup lang="ts">
import { computed } from 'vue'
import { NDrawer, NDrawerContent, NTag, NTimeline, NTimelineItem } from 'naive-ui'

import type { KbDocumentDto, StageName, StageStatus, TimelineEventDto } from '@/api/knowledge'

const props = defineProps<{
  show: boolean
  doc: KbDocumentDto | null
}>()

const emit = defineEmits<{ (e: 'update:show', value: boolean): void }>()

const STAGE_LABELS: Record<StageName, string> = {
  PARSE: '解析',
  CHUNK: '分块',
  EMBED: '嵌入',
  WIKI: 'Wiki 生成',
  GRAPH: '图谱抽取',
}

function timelineType(status: StageStatus): 'success' | 'info' | 'error' | 'default' {
  if (status === 'DONE') return 'success'
  if (status === 'RUNNING') return 'info'
  if (status === 'FAILED') return 'error'
  return 'default'
}

function statusText(status: StageStatus): string {
  if (status === 'DONE') return '完成'
  if (status === 'RUNNING') return '进行中'
  if (status === 'FAILED') return '失败'
  return '跳过'
}

function fmtDuration(ms: number | null): string {
  if (ms == null) return ''
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`
}

const items = computed<TimelineEventDto[]>(() => props.doc?.timeline ?? [])
</script>

<template>
  <n-drawer :show="show" :width="420" @update:show="(v: boolean) => emit('update:show', v)">
    <n-drawer-content :title="doc ? `处理时间轴 — ${doc.filename}` : '处理时间轴'" closable>
      <n-timeline v-if="doc">
        <n-timeline-item
          v-for="ev in items"
          :key="ev.stage"
          :type="timelineType(ev.status)"
          :title="STAGE_LABELS[ev.stage]"
        >
          <div class="event-body">
            <n-tag size="small" :bordered="false" :type="timelineType(ev.status)">{{ statusText(ev.status) }}</n-tag>
            <span v-if="ev.duration_ms != null" class="duration">{{ fmtDuration(ev.duration_ms) }}</span>
            <div v-if="ev.error" class="error">{{ ev.error }}</div>
          </div>
        </n-timeline-item>
      </n-timeline>
      <div v-if="doc?.error" class="doc-error">文档处理失败：{{ doc.error }}</div>
    </n-drawer-content>
  </n-drawer>
</template>

<style scoped>
.event-body {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
}

.duration {
  color: #999;
}

.error {
  width: 100%;
  color: #d03050;
  font-size: 12px;
  margin-top: 4px;
}

.doc-error {
  margin-top: 16px;
  padding: 8px 12px;
  border-radius: 6px;
  background: #fff5f6;
  color: #d03050;
  font-size: 13px;
}
</style>
