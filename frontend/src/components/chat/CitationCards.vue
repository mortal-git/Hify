<script setup lang="ts">
import { ref } from 'vue'
import { NTag } from 'naive-ui'

import type { CitationDto } from '@/api/conversation'

const props = defineProps<{ citations: CitationDto[] }>()

const expanded = ref<Set<number>>(new Set())

function toggle(i: number): void {
  const next = new Set(expanded.value)
  if (next.has(i)) next.delete(i)
  else next.add(i)
  expanded.value = next
}
</script>

<template>
  <div v-if="citations.length > 0" class="citation-cards">
    <div class="citation-title">引用来源（{{ citations.length }}）</div>
    <div
      v-for="(c, i) in citations"
      :key="i"
      class="citation-card"
      :data-cite="i + 1"
      @click="toggle(i)"
    >
      <div class="citation-head">
        <span class="citation-no">[{{ i + 1 }}]</span>
        <span class="citation-doc">{{ c.doc_name }} · 第 {{ c.chunk_seq }} 块</span>
        <n-tag size="tiny" :bordered="false" type="success">{{ c.kb_name }}</n-tag>
        <span class="citation-score">{{ c.score.toFixed(3) }}</span>
      </div>
      <div v-if="expanded.has(i)" class="citation-content">{{ c.content }}</div>
    </div>
  </div>
</template>

<style scoped>
.citation-cards {
  margin-top: 10px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.citation-title {
  font-size: 12px;
  color: #999;
}

.citation-card {
  border: 1px solid #ebeef0;
  border-radius: 6px;
  padding: 7px 10px;
  cursor: pointer;
  transition: border-color 0.2s;
}

.citation-card:hover {
  border-color: #07c05f;
}

.citation-head {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
}

.citation-no {
  color: #07c05f;
  font-weight: 600;
}

.citation-doc {
  color: #555;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.citation-score {
  color: #999;
  margin-left: auto;
  flex-shrink: 0;
}

.citation-content {
  font-size: 12px;
  color: #666;
  line-height: 1.7;
  margin-top: 6px;
  padding-top: 6px;
  border-top: 1px dashed #eee;
  white-space: pre-wrap;
  word-break: break-word;
}
</style>
