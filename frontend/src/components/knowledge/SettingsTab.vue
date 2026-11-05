<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import {
  NButton,
  NCard,
  NForm,
  NFormItem,
  NInput,
  NInputNumber,
  NPopconfirm,
  NRadio,
  NRadioButton,
  NRadioGroup,
  NSelect,
  NSlider,
  NSpace,
  NSwitch,
  useDialog,
  useMessage,
} from 'naive-ui'

import { knowledgeApi } from '@/api/knowledge'
import { modelgatewayApi } from '@/api/modelgateway'
import type { ModelDto } from '@/api/modelgateway'
import type { KbConfigDto, KbDetailDto } from '@/api/knowledge'
import MetadataSchemaEditor from './MetadataSchemaEditor.vue'

const props = defineProps<{ kb: KbDetailDto }>()

const emit = defineEmits<{
  (e: 'updated', kb: KbDetailDto): void
  (e: 'deleted'): void
}>()

const message = useMessage()
const dialog = useDialog()

const SEPARATOR_OPTIONS = [
  { label: '空行', value: '\n\n' },
  { label: '换行', value: '\n' },
  { label: '中文句号', value: '。' },
  { label: '英文句号', value: '.' },
  { label: '分号', value: ';' },
  { label: '问号', value: '?' },
  { label: '感叹号', value: '!' },
]

interface SettingsForm {
  name: string
  description: string
  config: KbConfigDto
}

let baseline = ''

const form = ref<SettingsForm>(makeForm())

function makeForm(): SettingsForm {
  return JSON.parse(
    JSON.stringify({ name: props.kb.name, description: props.kb.description, config: props.kb.config }),
  ) as SettingsForm
}

function initForm(): void {
  form.value = makeForm()
  baseline = JSON.stringify(form.value)
}

watch(
  () => props.kb,
  () => initForm(),
  { immediate: true },
)

const models = ref<ModelDto[]>([])

onMounted(async () => {
  try {
    models.value = await modelgatewayApi.listAllModels()
  } catch (e) {
    message.error(e instanceof Error ? e.message : '加载模型列表失败')
  }
})

const embeddingOptions = computed(() =>
  models.value.filter((m) => m.model_type === 'EMBEDDING').map((m) => ({ label: m.display_name, value: m.id })),
)
const generationOptions = computed(() =>
  models.value.filter((m) => m.model_type === 'CHAT').map((m) => ({ label: m.display_name, value: m.id })),
)
const rerankOptions = computed(() =>
  models.value.filter((m) => m.model_type === 'RERANK').map((m) => ({ label: m.display_name, value: m.id })),
)

const dirty = computed(() => JSON.stringify(form.value) !== baseline)

function computeImpact(): string | null {
  const oldC = props.kb.config
  const c = form.value.config
  const n = props.kb.document_count
  const parts: string[] = []
  const chunkChanged =
    c.chunk_mode !== oldC.chunk_mode ||
    c.chunk_size !== oldC.chunk_size ||
    c.chunk_overlap !== oldC.chunk_overlap ||
    JSON.stringify(c.separators) !== JSON.stringify(oldC.separators)
  if (chunkChanged) {
    parts.push(`重新分块并重嵌入 ${n} 篇文档`)
  } else if (c.embedding_model_id !== oldC.embedding_model_id) {
    parts.push(`切换向量模型，全量重嵌入 ${n} 篇文档`)
  }
  if (!oldC.wiki_enabled && c.wiki_enabled) parts.push(`为 ${n} 篇文档补跑 Wiki 生成`)
  if (c.wiki_enabled && c.wiki_granularity !== oldC.wiki_granularity) parts.push('按新粒度重生成 Wiki 页面')
  if (!oldC.graph_enabled && c.graph_enabled) parts.push(`为 ${n} 篇文档补跑图谱抽取（LLM 消耗较大）`)
  return parts.length > 0 ? parts.join('；') : null
}

function withModelNames(config: KbConfigDto): KbConfigDto {
  const byId = new Map(models.value.map((m) => [m.id, m]))
  return {
    ...config,
    embedding_model_name: byId.get(config.embedding_model_id)?.display_name ?? config.embedding_model_name,
    generation_model_name:
      config.generation_model_id != null
        ? byId.get(config.generation_model_id)?.display_name ?? config.generation_model_name
        : null,
    rerank_model_name:
      config.rerank_model_id != null
        ? byId.get(config.rerank_model_id)?.display_name ?? config.rerank_model_name
        : null,
  }
}

const saving = ref(false)

async function doSave(): Promise<void> {
  saving.value = true
  try {
    const res = await knowledgeApi.updateBase(props.kb.id, {
      name: form.value.name.trim(),
      description: form.value.description,
      config: withModelNames(form.value.config),
    })
    message.info(res.impact ?? '配置已保存')
    emit('updated', res.kb)
  } catch (e) {
    message.error(e instanceof Error ? e.message : '保存失败')
  } finally {
    saving.value = false
  }
}

async function save(): Promise<void> {
  if (!form.value.name.trim()) {
    message.warning('名称不能为空')
    return
  }
  if (form.value.config.chunk_overlap >= form.value.config.chunk_size) {
    message.warning('分段重叠必须小于分段长度')
    return
  }
  const impact = computeImpact()
  if (impact) {
    dialog.warning({
      title: '保存将触发重处理',
      content: impact,
      positiveText: '继续',
      negativeText: '取消',
      onPositiveClick: () => {
        void doSave()
      },
    })
  } else {
    await doSave()
  }
}

const regenerating = ref(false)

async function regenerate(): Promise<void> {
  regenerating.value = true
  try {
    const kb = await knowledgeApi.regenerateProfile(props.kb.id)
    message.success('简介已重新生成')
    emit('updated', kb)
  } catch (e) {
    message.error(e instanceof Error ? e.message : '生成失败')
  } finally {
    regenerating.value = false
  }
}

const deleting = ref(false)

async function remove(): Promise<void> {
  deleting.value = true
  try {
    await knowledgeApi.deleteBase(props.kb.id)
    message.success('知识库已删除')
    emit('deleted')
  } catch (e) {
    message.error(e instanceof Error ? e.message : '删除失败')
  } finally {
    deleting.value = false
  }
}
</script>

<template>
  <div class="settings-tab">
    <n-card size="small">
      <template #header>设置</template>
      <template #header-extra>
        <n-space :size="10" align="center">
          <span v-if="dirty" class="dirty-hint">有未保存修改</span>
          <n-button size="small" type="primary" :disabled="!dirty" :loading="saving" @click="save">保存</n-button>
        </n-space>
      </template>

      <n-form label-placement="left" label-width="110" size="small" :show-feedback="false" class="settings-form">
        <div class="section-title">基础信息</div>
        <n-form-item label="名称">
          <n-input v-model:value="form.name" placeholder="知识库名称" />
        </n-form-item>
        <n-form-item label="简介">
          <div class="desc-row">
            <n-input v-model:value="form.description" type="textarea" :rows="2" placeholder="用途说明，可由 AI 根据内容生成" />
            <n-button size="small" :loading="regenerating" @click="regenerate">AI 生成</n-button>
          </div>
        </n-form-item>

        <div class="section-title">分块配置</div>
        <template v-if="kb.type !== 'FAQ'">
          <n-form-item label="分段模式">
            <n-radio-group v-model:value="form.config.chunk_mode">
              <n-radio value="GENERAL">通用分段</n-radio>
              <n-radio value="PARENT_CHILD">父子分段</n-radio>
              <n-radio value="QA">问答分段</n-radio>
            </n-radio-group>
          </n-form-item>
          <n-form-item label="分段长度">
            <div class="num-row">
              <n-input-number v-model:value="form.config.chunk_size" :min="100" :max="4000" :step="100" />
              <span class="unit">字（修改后全量重嵌入）</span>
            </div>
          </n-form-item>
          <n-form-item label="分段重叠">
            <div class="num-row">
              <n-input-number v-model:value="form.config.chunk_overlap" :min="0" :max="512" :step="16" />
              <span class="unit">字</span>
            </div>
          </n-form-item>
          <n-form-item label="分隔符">
            <n-select v-model:value="form.config.separators" multiple :options="SEPARATOR_OPTIONS" />
          </n-form-item>
        </template>
        <n-form-item v-else label="索引方式">
          <n-radio-group v-model:value="form.config.qa_index_mode">
            <n-radio value="QUESTION_ONLY">仅问题</n-radio>
            <n-radio value="QUESTION_ANSWER">问题 + 答案</n-radio>
          </n-radio-group>
        </n-form-item>

        <div class="section-title">模型</div>
        <n-form-item label="向量模型" required>
          <n-select v-model:value="form.config.embedding_model_id" :options="embeddingOptions" filterable />
        </n-form-item>
        <n-form-item label="生成模型">
          <n-select
            v-model:value="form.config.generation_model_id"
            :options="generationOptions"
            clearable
            filterable
            placeholder="Wiki / 图谱 / QA 抽取使用"
          />
        </n-form-item>
        <n-form-item label="重排模型">
          <n-select
            v-model:value="form.config.rerank_model_id"
            :options="rerankOptions"
            clearable
            filterable
            placeholder="可选，检索结果精排"
          />
        </n-form-item>

        <div class="section-title">检索与索引</div>
        <n-form-item label="向量检索">
          <div class="switch-row">
            <n-switch v-model:value="form.config.vector_enabled" />
            <span class="switch-hint">{{ form.config.vector_enabled ? '启用（pgvector HNSW cosine）' : '关闭' }}</span>
          </div>
        </n-form-item>
        <n-form-item label="全文检索">
          <div class="switch-row">
            <n-switch v-model:value="form.config.keyword_enabled" />
            <span class="switch-hint">{{ form.config.keyword_enabled ? '启用（BM25 中文分词）' : '关闭' }}</span>
          </div>
        </n-form-item>
        <n-form-item label="Wiki 页面">
          <div class="switch-row">
            <n-switch v-model:value="form.config.wiki_enabled" />
            <span class="switch-hint">{{ form.config.wiki_enabled ? '文档处理时生成互链页面' : '关闭' }}</span>
          </div>
        </n-form-item>
        <n-form-item v-if="form.config.wiki_enabled" label="Wiki 粒度">
          <n-radio-group v-model:value="form.config.wiki_granularity" size="small">
            <n-radio-button value="FOCUSED">精简</n-radio-button>
            <n-radio-button value="STANDARD">标准</n-radio-button>
            <n-radio-button value="EXHAUSTIVE">详尽</n-radio-button>
          </n-radio-group>
        </n-form-item>
        <n-form-item label="知识图谱">
          <div class="switch-row">
            <n-switch v-model:value="form.config.graph_enabled" />
            <span class="switch-hint">{{ form.config.graph_enabled ? '分块级实体关系抽取（LLM 消耗较大）' : '关闭' }}</span>
          </div>
        </n-form-item>
        <n-form-item label="Top-K">
          <n-input-number v-model:value="form.config.top_k" :min="1" :max="20" />
        </n-form-item>
        <n-form-item label="相似度阈值">
          <n-input-number v-model:value="form.config.score_threshold" :min="0" :max="1" :step="0.05" />
        </n-form-item>
        <n-form-item label="向量权重">
          <div class="slider-row">
            <n-slider v-model:value="form.config.rrf_vector_weight" :min="0" :max="1" :step="0.1" />
            <span class="slider-value">{{ form.config.rrf_vector_weight.toFixed(1) }}</span>
          </div>
        </n-form-item>

        <div class="section-title">元数据字段</div>
        <MetadataSchemaEditor
          :fields="form.config.metadata_schema"
          @update:fields="form.config.metadata_schema = $event"
        />
      </n-form>
    </n-card>

    <n-card size="small" class="danger-card">
      <template #header>危险操作</template>
      <div class="danger-row">
        <span>删除知识库及其所有文档、分块、Wiki 与图谱数据，不可恢复。</span>
        <n-popconfirm @positive-click="remove">
          <template #trigger>
            <n-button size="small" type="error" :loading="deleting">删除知识库</n-button>
          </template>
          确认删除「{{ kb.name }}」？所有数据将不可恢复。
        </n-popconfirm>
      </div>
    </n-card>
  </div>
</template>

<style scoped>
.settings-tab {
  display: flex;
  flex-direction: column;
  gap: 12px;
  max-width: 860px;
}

.settings-form {
  --n-feedback-height: 0px;
}

.section-title {
  font-size: 13px;
  font-weight: 600;
  color: #333;
  margin: 22px 0 12px;
  padding-left: 8px;
  border-left: 3px solid #07c05f;
}

.settings-form > :first-child {
  margin-top: 0;
}

.dirty-hint {
  font-size: 12px;
  color: #e37318;
}

.desc-row {
  display: flex;
  gap: 8px;
  width: 100%;
  align-items: flex-start;
}

.num-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.unit {
  font-size: 12px;
  color: #999;
}

.switch-row {
  display: flex;
  align-items: center;
  gap: 10px;
}

.switch-hint {
  font-size: 12px;
  color: #999;
}

.slider-row {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 260px;
}

.slider-value {
  font-size: 13px;
  color: #07c05f;
  font-variant-numeric: tabular-nums;
}

.danger-card :deep(.n-card-header__main) {
  color: #d03050;
}

.danger-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  font-size: 13px;
  color: #666;
}
</style>
