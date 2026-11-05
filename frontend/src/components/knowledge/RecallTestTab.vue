<script setup lang="ts">
import { h, ref } from 'vue'
import {
  NButton,
  NCard,
  NDataTable,
  NInput,
  NInputNumber,
  NTag,
  useMessage,
} from 'naive-ui'
import type { DataTableColumns } from 'naive-ui'

import { knowledgeApi } from '@/api/knowledge'
import type { KbDetailDto, RecallHitDto, RecallTestResultDto } from '@/api/knowledge'

const props = defineProps<{ kb: KbDetailDto }>()

const message = useMessage()
const query = ref('')
const topK = ref(props.kb.config.top_k)
const running = ref(false)
const result = ref<RecallTestResultDto | null>(null)

async function run(): Promise<void> {
  if (!query.value.trim()) {
    message.warning('请输入测试问题')
    return
  }
  running.value = true
  try {
    result.value = await knowledgeApi.recallTest(props.kb.id, {
      query: query.value.trim(),
      top_k: topK.value,
    })
  } catch (e) {
    message.error(e instanceof Error ? e.message : '测试失败')
  } finally {
    running.value = false
  }
}

function fmtScore(v: number | null): string {
  return v == null ? '—' : v.toFixed(4)
}

const PROV_LABEL: Record<string, string> = { VECTOR: '向量', KEYWORD: '全文', WIKI: 'Wiki' }

const columns: DataTableColumns<RecallHitDto> = [
  { title: '#', key: 'fused_rank', width: 52 },
  {
    title: '命中内容',
    key: 'content',
    render: (r) =>
      h('div', { class: 'hit-cell' }, [
        h('div', { class: 'hit-content' }, r.content),
        h('div', { class: 'hit-doc' }, `${r.doc_name} · 第 ${r.seq} 块`),
      ]),
  },
  {
    title: '来源',
    key: 'provenance',
    width: 120,
    render: (r) =>
      h(
        'div',
        { class: 'prov-tags' },
        r.provenance.map((p) =>
          h(NTag, { size: 'tiny', bordered: false, type: p === 'VECTOR' ? 'success' : 'info' }, { default: () => PROV_LABEL[p] ?? p }),
        ),
      ),
  },
  { title: '向量分', key: 'vector_score', width: 90, render: (r) => fmtScore(r.vector_score) },
  { title: '全文分', key: 'keyword_score', width: 90, render: (r) => fmtScore(r.keyword_score) },
  { title: '重排分', key: 'rerank_score', width: 90, render: (r) => fmtScore(r.rerank_score) },
]
</script>

<template>
  <n-card size="small">
    <template #header>召回测试</template>
    <div class="toolbar">
      <n-input
        v-model:value="query"
        class="query-input"
        placeholder="输入问题，检验分块与检索质量"
        clearable
        @keydown.enter="run"
      />
      <n-button type="primary" :loading="running" @click="run">测试</n-button>
      <span class="topk-label">Top-K</span>
      <n-input-number v-model:value="topK" :min="1" :max="20" size="small" style="width: 90px" />
    </div>

    <div v-if="result" class="result">
      <div class="result-summary">
        命中 {{ result.hits.length }} 条 · 耗时 {{ result.elapsed_ms }}ms
        <template v-if="result.hits.length === 0">—— 换个问法或检查文档内容试试</template>
      </div>
      <n-data-table
        v-if="result.hits.length > 0"
        :columns="columns"
        :data="result.hits"
        :row-key="(r: RecallHitDto) => r.chunk_id"
        :bordered="false"
        size="small"
      />
    </div>
    <div v-else class="placeholder">
      输入问题点击「测试」，将执行与 Agent 聊天一致的混合检索（向量 + BM25 → RRF 融合），展示每路得分便于调参。
    </div>
  </n-card>
</template>

<style scoped>
.toolbar {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 16px;
}

.query-input {
  flex: 1;
}

.topk-label {
  margin-left: 8px;
  font-size: 13px;
  color: #666;
}

.result-summary {
  font-size: 13px;
  color: #666;
  margin-bottom: 10px;
}

.placeholder {
  color: #999;
  font-size: 13px;
  padding: 24px 0;
}

.hit-cell {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.hit-content {
  font-size: 13px;
  line-height: 1.6;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.hit-doc {
  font-size: 12px;
  color: #999;
}

.prov-tags {
  display: flex;
  gap: 4px;
}
</style>
