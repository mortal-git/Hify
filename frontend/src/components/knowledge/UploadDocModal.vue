<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { NButton, NModal, NSpace, NTag, NUpload, useMessage } from 'naive-ui'
import type { UploadFileInfo } from 'naive-ui'

import { knowledgeApi } from '@/api/knowledge'
import type { ChunkPreviewDto, KbDetailDto } from '@/api/knowledge'

const props = defineProps<{
  show: boolean
  kb: KbDetailDto
}>()

const emit = defineEmits<{
  (e: 'update:show', value: boolean): void
  (e: 'uploaded'): void
}>()

const message = useMessage()
const fileList = ref<UploadFileInfo[]>([])
const tagsText = ref('')
const previewing = ref(false)
const preview = ref<ChunkPreviewDto | null>(null)
const uploading = ref(false)

const selectedFile = computed(() => {
  const f = fileList.value[0]?.file
  return f instanceof File ? f : null
})

watch(
  () => props.show,
  (show) => {
    if (!show) return
    fileList.value = []
    tagsText.value = ''
    preview.value = null
  },
)

function onFileListChange(value: UploadFileInfo[]): void {
  fileList.value = value.slice(0, 1)
  preview.value = null
}

async function doPreview(): Promise<void> {
  const file = selectedFile.value
  if (!file) return
  previewing.value = true
  try {
    preview.value = await knowledgeApi.previewDocument(props.kb.id, file)
  } catch (e) {
    message.error(e instanceof Error ? e.message : '预览失败')
  } finally {
    previewing.value = false
  }
}

function parseTags(): string[] {
  return tagsText.value
    .split(/[,，\s]+/)
    .map((t) => t.trim())
    .filter(Boolean)
}

async function handleUpload(): Promise<void> {
  const file = selectedFile.value
  if (!file) return
  uploading.value = true
  try {
    await knowledgeApi.uploadDocument(props.kb.id, file, parseTags())
    message.success(`「${file.name}」已上传，正在处理`)
    emit('uploaded')
    emit('update:show', false)
  } catch (e) {
    message.error(e instanceof Error ? e.message : '上传失败')
  } finally {
    uploading.value = false
  }
}
</script>

<template>
  <n-modal
    :show="show"
    preset="card"
    title="上传文档"
    style="width: 620px"
    @update:show="(v: boolean) => emit('update:show', v)"
  >
    <n-upload
      :file-list="fileList"
      accept=".pdf,.docx,.md,.txt"
      :max="1"
      :default-upload="false"
      @update:file-list="onFileListChange"
    >
      <n-button>选择文件（PDF / DOCX / MD / TXT，≤ 20MB）</n-button>
    </n-upload>

    <div class="form-row">
      <span class="form-label">标签</span>
      <n-input v-model:value="tagsText" placeholder="多个标签用逗号分隔，可留空" />
    </div>

    <div class="preview-block">
      <n-space align="center">
        <n-button size="small" :disabled="!selectedFile" :loading="previewing" @click="doPreview">
          预览分段
        </n-button>
        <span v-if="preview" class="preview-stat">
          共 {{ preview.total_chunks }} 块 · 平均 {{ Math.round(preview.avg_length) }} 字
        </span>
      </n-space>
      <div v-if="preview" class="chunk-list">
        <div v-for="c in preview.chunks" :key="c.seq" class="chunk-item">
          <n-tag size="small" :bordered="false">{{ c.seq }}</n-tag>
          <div class="chunk-content">{{ c.content }}</div>
        </div>
        <div v-if="preview.total_chunks > preview.chunks.length" class="more-hint">
          仅展示前 {{ preview.chunks.length }} 块，共 {{ preview.total_chunks }} 块
        </div>
      </div>
    </div>

    <template #footer>
      <n-space justify="end">
        <n-button @click="emit('update:show', false)">取消</n-button>
        <n-button type="primary" :disabled="!selectedFile" :loading="uploading" @click="handleUpload">
          确认入库
        </n-button>
      </n-space>
    </template>
  </n-modal>
</template>

<style scoped>
.form-row {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: 16px;
}

.form-label {
  flex-shrink: 0;
  font-size: 13px;
  color: #666;
}

.preview-block {
  margin-top: 16px;
}

.preview-stat {
  font-size: 13px;
  color: #666;
}

.chunk-list {
  margin-top: 12px;
  border: 1px solid #eee;
  border-radius: 6px;
  padding: 8px 12px;
  max-height: 260px;
  overflow-y: auto;
}

.chunk-item {
  display: flex;
  gap: 8px;
  padding: 6px 0;
  border-bottom: 1px dashed #f0f0f0;
}

.chunk-item:last-of-type {
  border-bottom: none;
}

.chunk-content {
  flex: 1;
  font-size: 13px;
  line-height: 1.6;
  color: #333;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.more-hint {
  font-size: 12px;
  color: #999;
  padding-top: 6px;
}
</style>
