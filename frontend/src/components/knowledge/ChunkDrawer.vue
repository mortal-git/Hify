<script setup lang="ts">
import { h, ref, watch } from 'vue'
import {
  NButton,
  NDrawer,
  NDrawerContent,
  NInput,
  NModal,
  NSpace,
  NDataTable,
  NTag,
  useMessage,
} from 'naive-ui'
import type { DataTableColumns } from 'naive-ui'

import { knowledgeApi } from '@/api/knowledge'
import type { KbChunkDto, KbDocumentDto } from '@/api/knowledge'

const props = defineProps<{
  show: boolean
  doc: KbDocumentDto | null
}>()

const emit = defineEmits<{ (e: 'update:show', value: boolean): void }>()

const message = useMessage()
const chunks = ref<KbChunkDto[]>([])
const loading = ref(false)
const showEdit = ref(false)
const editing = ref<KbChunkDto | null>(null)
const editContent = ref('')
const saving = ref(false)

watch(
  () => props.show,
  (show) => {
    if (show && props.doc) load()
  },
)

async function load(): Promise<void> {
  if (!props.doc) return
  loading.value = true
  try {
    chunks.value = await knowledgeApi.listChunks(props.doc.id)
  } catch (e) {
    message.error(e instanceof Error ? e.message : '加载分块失败')
  } finally {
    loading.value = false
  }
}

function openEdit(chunk: KbChunkDto): void {
  editing.value = chunk
  editContent.value = chunk.content
  showEdit.value = true
}

async function saveEdit(): Promise<void> {
  const chunk = editing.value
  if (!chunk || !editContent.value.trim()) {
    message.warning('内容不能为空')
    return
  }
  saving.value = true
  try {
    const fresh = await knowledgeApi.updateChunk(chunk.id, { content: editContent.value })
    const idx = chunks.value.findIndex((c) => c.id === fresh.id)
    if (idx >= 0) chunks.value[idx] = fresh
    message.success('分块已更新（已重新嵌入）')
    showEdit.value = false
  } catch (e) {
    message.error(e instanceof Error ? e.message : '保存失败')
  } finally {
    saving.value = false
  }
}

const sourceLabel: Record<string, string> = { DOCUMENT: '文档', FAQ: 'FAQ', WIKI: 'Wiki' }

const columns: DataTableColumns<KbChunkDto> = [
  { title: '#', key: 'seq', width: 56 },
  {
    title: '内容',
    key: 'content',
    render: (c) =>
      h('div', { class: 'chunk-content' }, [
        c.is_qa && c.question ? h('div', { class: 'chunk-q' }, `Q：${c.question}`) : null,
        h('div', { class: 'chunk-text' }, c.answer ? `A：${c.answer}` : c.content),
      ]),
  },
  {
    title: '来源',
    key: 'source',
    width: 76,
    render: (c) =>
      h(NTag, { size: 'small', bordered: false }, { default: () => sourceLabel[c.source] ?? c.source }),
  },
  { title: 'Token', key: 'token_count', width: 80 },
  {
    title: '操作',
    key: 'actions',
    width: 80,
    render: (c) =>
      h(
        NButton,
        { size: 'small', onClick: () => openEdit(c) },
        { default: () => '编辑' },
      ),
  },
]
</script>

<template>
  <n-drawer :show="show" :width="640" @update:show="(v: boolean) => emit('update:show', v)">
    <n-drawer-content :title="doc ? `分块 — ${doc.filename}（${doc.chunk_count} 块）` : '分块'" closable>
      <n-data-table
        :columns="columns"
        :data="chunks"
        :loading="loading"
        :row-key="(c: KbChunkDto) => c.id"
        :bordered="false"
        size="small"
      />
    </n-drawer-content>
  </n-drawer>

  <n-modal
    v-model:show="showEdit"
    preset="card"
    title="编辑分块"
    style="width: 640px"
  >
    <n-input v-model:value="editContent" type="textarea" :rows="12" />
    <template #footer>
      <n-space justify="end">
        <n-button @click="showEdit = false">取消</n-button>
        <n-button type="primary" :loading="saving" @click="saveEdit">保存并重嵌入</n-button>
      </n-space>
    </template>
  </n-modal>
</template>

<style scoped>
.chunk-q {
  font-weight: 500;
  margin-bottom: 2px;
}

.chunk-text {
  font-size: 13px;
  color: #333;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  line-height: 1.6;
}
</style>
