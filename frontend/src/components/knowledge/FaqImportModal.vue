<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { NButton, NInput, NModal, NSpace, NUpload, useMessage } from 'naive-ui'
import type { UploadFileInfo } from 'naive-ui'

import { knowledgeApi } from '@/api/knowledge'
import type { FaqImportResultDto, FaqRowPayload, KbDetailDto } from '@/api/knowledge'

const props = defineProps<{
  show: boolean
  kb: KbDetailDto
}>()

const emit = defineEmits<{
  (e: 'update:show', value: boolean): void
  (e: 'imported'): void
}>()

const message = useMessage()
const text = ref('')
const importing = ref(false)
const lastResult = ref<FaqImportResultDto | null>(null)

watch(
  () => props.show,
  (show) => {
    if (!show) return
    text.value = ''
    lastResult.value = null
  },
)

const rowCount = computed(() => parseRows().length)

function parseRows(): FaqRowPayload[] {
  return text.value
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((line) => {
      const i = line.indexOf(',')
      if (i < 0) return { question: line, answer: '' }
      return { question: line.slice(0, i).trim(), answer: line.slice(i + 1).trim() }
    })
}

function onFileListChange(value: UploadFileInfo[]): void {
  const f = value[0]?.file
  if (f instanceof File) {
    f.text().then(
      (content) => {
        text.value = content
        lastResult.value = null
      },
      () => message.error('文件读取失败'),
    )
  }
}

async function handleImport(): Promise<void> {
  const rows = parseRows()
  if (rows.length === 0) {
    message.warning('请先粘贴或导入问答内容')
    return
  }
  importing.value = true
  try {
    const result = await knowledgeApi.importFaq(props.kb.id, rows)
    if (result.failed === 0) {
      message.success(`已导入 ${result.imported} 条问答`)
      emit('imported')
      emit('update:show', false)
    } else {
      lastResult.value = result
      message.warning(`${result.imported} 条成功，${result.failed} 条失败`)
      emit('imported')
    }
  } catch (e) {
    message.error(e instanceof Error ? e.message : '导入失败')
  } finally {
    importing.value = false
  }
}
</script>

<template>
  <n-modal
    :show="show"
    preset="card"
    title="导入问答"
    style="width: 620px"
    @update:show="(v: boolean) => emit('update:show', v)"
  >
    <n-space vertical size="large">
      <n-upload accept=".csv,.txt" :max="1" :default-upload="false" @update:file-list="onFileListChange">
        <n-button>选择 CSV 文件（每行：问题,答案）</n-button>
      </n-upload>
      <n-input
        v-model:value="text"
        type="textarea"
        :rows="10"
        placeholder="也可直接粘贴，每行一条：问题,答案（首个逗号前为问题）"
      />
      <div v-if="lastResult && lastResult.errors.length > 0" class="import-errors">
        <div v-for="err in lastResult.errors" :key="err.row" class="error-line">第 {{ err.row }} 行：{{ err.message }}</div>
      </div>
    </n-space>
    <template #footer>
      <n-space justify="space-between" align="center">
        <span class="row-hint">共解析 {{ rowCount }} 条</span>
        <n-space>
          <n-button @click="emit('update:show', false)">取消</n-button>
          <n-button type="primary" :loading="importing" :disabled="rowCount === 0" @click="handleImport">
            导入
          </n-button>
        </n-space>
      </n-space>
    </template>
  </n-modal>
</template>

<style scoped>
.import-errors {
  border: 1px solid #fdecee;
  background: #fff5f6;
  border-radius: 6px;
  padding: 8px 12px;
  max-height: 120px;
  overflow-y: auto;
}

.error-line {
  font-size: 12px;
  color: #d03050;
  line-height: 1.8;
}

.row-hint {
  font-size: 13px;
  color: #666;
}
</style>
