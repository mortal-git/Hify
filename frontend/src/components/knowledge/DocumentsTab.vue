<script setup lang="ts">
import { computed, h, onMounted, onUnmounted, ref, watch } from 'vue'
import {
  NButton,
  NCard,
  NDataTable,
  NEmpty,
  NPopconfirm,
  NSpace,
  NTag,
  useMessage,
} from 'naive-ui'
import type { DataTableColumns } from 'naive-ui'

import { knowledgeApi } from '@/api/knowledge'
import type { DocStatus, KbDetailDto, KbDocumentDto } from '@/api/knowledge'
import ChunkDrawer from './ChunkDrawer.vue'
import DocTimelineDrawer from './DocTimelineDrawer.vue'
import FaqImportModal from './FaqImportModal.vue'
import UploadDocModal from './UploadDocModal.vue'

const props = defineProps<{ kb: KbDetailDto }>()
const emit = defineEmits<{ (e: 'changed'): void }>()

const message = useMessage()
const docs = ref<KbDocumentDto[]>([])
const loading = ref(false)
let timer: ReturnType<typeof setInterval> | null = null

const showUpload = ref(false)
const showFaqImport = ref(false)
const showTimeline = ref(false)
const timelineDocId = ref<number | null>(null)
const showChunks = ref(false)
const chunkDocId = ref<number | null>(null)

const PROCESSING: DocStatus[] = ['QUEUED', 'PARSING', 'CHUNKING', 'EMBEDDING', 'WIKI', 'GRAPH']
const hasProcessing = computed(() => docs.value.some((d) => PROCESSING.includes(d.status)))

const STATUS_LABEL: Record<DocStatus, string> = {
  QUEUED: '排队中',
  PARSING: '解析中',
  CHUNKING: '分块中',
  EMBEDDING: '嵌入中',
  WIKI: 'Wiki 生成中',
  GRAPH: '图谱抽取中',
  READY: '已就绪',
  FAILED: '失败',
}

function statusType(s: DocStatus): 'success' | 'error' | 'info' {
  if (s === 'READY') return 'success'
  if (s === 'FAILED') return 'error'
  return 'info'
}

const timelineDoc = computed(() => docs.value.find((d) => d.id === timelineDocId.value) ?? null)
const chunkDoc = computed(() => docs.value.find((d) => d.id === chunkDocId.value) ?? null)

async function load(): Promise<void> {
  loading.value = true
  try {
    docs.value = await knowledgeApi.listDocuments(props.kb.id)
  } catch (e) {
    message.error(e instanceof Error ? e.message : '加载文档失败')
  } finally {
    loading.value = false
  }
}

watch(
  () => props.kb.id,
  () => load(),
)

onMounted(() => {
  load()
  timer = setInterval(() => {
    if (hasProcessing.value) load()
  }, 1000)
})

onUnmounted(() => {
  if (timer) clearInterval(timer)
})

function onChanged(): void {
  load()
  emit('changed')
}

async function retry(doc: KbDocumentDto): Promise<void> {
  try {
    await knowledgeApi.retryDocument(doc.id)
    message.success('已重新入队')
    onChanged()
  } catch (e) {
    message.error(e instanceof Error ? e.message : '重试失败')
  }
}

async function remove(doc: KbDocumentDto): Promise<void> {
  try {
    await knowledgeApi.deleteDocument(doc.id)
    message.success('已删除')
    onChanged()
  } catch (e) {
    message.error(e instanceof Error ? e.message : '删除失败')
  }
}

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleString('zh-CN', { hour12: false })
}

const columns = computed<DataTableColumns<KbDocumentDto>>(() => [
  {
    title: '文件名',
    key: 'filename',
    minWidth: 220,
    render: (d) =>
      h('div', { class: 'doc-cell' }, [
        h('span', { class: 'doc-name' }, d.filename),
        d.tags.length > 0
          ? h(
              'div',
              { class: 'doc-tags' },
              d.tags.map((t) => h(NTag, { size: 'tiny', bordered: false, class: 'doc-tag' }, { default: () => t })),
            )
          : null,
      ]),
  },
  {
    title: '状态',
    key: 'status',
    width: 120,
    render: (d) =>
      h(NTag, { size: 'small', bordered: false, type: statusType(d.status) }, { default: () => STATUS_LABEL[d.status] }),
  },
  { title: '分块', key: 'chunk_count', width: 70 },
  {
    title: '字数',
    key: 'word_count',
    width: 80,
    render: (d) => d.word_count.toLocaleString(),
  },
  {
    title: '上传时间',
    key: 'created_at',
    width: 150,
    render: (d) => fmtTime(d.created_at),
  },
  {
    title: '操作',
    key: 'actions',
    width: 240,
    render: (d) =>
      h(NSpace, { size: 4, wrap: false }, {
        default: () => [
          h(
            NButton,
            { size: 'tiny', quaternary: true, type: 'primary', onClick: () => { chunkDocId.value = d.id; showChunks.value = true } },
            { default: () => '分块' },
          ),
          h(
            NButton,
            { size: 'tiny', quaternary: true, onClick: () => { timelineDocId.value = d.id; showTimeline.value = true } },
            { default: () => '时间轴' },
          ),
          d.status === 'FAILED'
            ? h(
                NButton,
                { size: 'tiny', quaternary: true, type: 'warning', onClick: () => retry(d) },
                { default: () => '重试' },
              )
            : null,
          h(
            NPopconfirm,
            { positiveText: '确认', negativeText: '取消', onPositiveClick: () => remove(d) },
            {
              trigger: () =>
                h(NButton, { size: 'tiny', quaternary: true, type: 'error' }, { default: () => '删除' }),
              default: () => `删除「${d.filename}」及其分块？`,
            },
          ),
        ],
      }),
  },
])
</script>

<template>
  <div class="documents-tab">
    <n-card size="small">
      <template #header>
        文档
        <n-tag v-if="hasProcessing" size="small" type="info" :bordered="false" class="proc-tag">
          处理中，自动刷新…
        </n-tag>
      </template>
      <template #header-extra>
        <n-button v-if="kb.type === 'FAQ'" size="small" type="primary" @click="showFaqImport = true">
          导入问答
        </n-button>
        <n-button v-else size="small" type="primary" @click="showUpload = true">上传文档</n-button>
      </template>
      <n-data-table
        v-if="docs.length > 0"
        :columns="columns"
        :data="docs"
        :loading="loading"
        :row-key="(d: KbDocumentDto) => d.id"
        :bordered="false"
        size="small"
      />
      <n-empty v-else-if="!loading" description="暂无文档——上传后自动分段、嵌入" style="padding: 32px 0" />
    </n-card>

    <UploadDocModal v-model:show="showUpload" :kb="kb" @uploaded="onChanged" />
    <FaqImportModal v-model:show="showFaqImport" :kb="kb" @imported="onChanged" />
    <DocTimelineDrawer v-model:show="showTimeline" :doc="timelineDoc" />
    <ChunkDrawer v-model:show="showChunks" :doc="chunkDoc" />
  </div>
</template>

<style scoped>
.doc-cell {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.doc-name {
  font-weight: 500;
}

.doc-tags {
  display: flex;
  gap: 4px;
}

.proc-tag {
  margin-left: 8px;
}
</style>
