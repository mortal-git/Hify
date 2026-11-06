<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import {
  NAlert,
  NButton,
  NFormItem,
  NInput,
  NInputNumber,
  NModal,
  NRadioButton,
  NRadioGroup,
  NSelect,
  NSpace,
  NStep,
  NSteps,
  NSwitch,
  useMessage,
} from 'naive-ui'
import type { SelectOption } from 'naive-ui'

import { knowledgeApi } from '@/api/knowledge'
import type {
  ChunkMode,
  KbConfigDto,
  KbDetailDto,
  KbType,
  MetadataFieldDef,
  QaIndexMode,
  WikiGranularity,
} from '@/api/knowledge'
import { modelgatewayApi } from '@/api/modelgateway'
import type { ModelDto } from '@/api/modelgateway'
import MetadataSchemaEditor from './MetadataSchemaEditor.vue'

const props = defineProps<{ show: boolean }>()
const emit = defineEmits<{
  (e: 'update:show', value: boolean): void
  (e: 'created', kb: KbDetailDto): void
}>()

const message = useMessage()
const current = ref(1)
const creating = ref(false)
const models = ref<ModelDto[]>([])
const modelsLoading = ref(false)

const form = reactive({
  name: '',
  type: 'DOCUMENT' as KbType,
  description: '',
  chunk_mode: 'GENERAL' as ChunkMode,
  chunk_size: 512,
  chunk_overlap: 80,
  separators: ['\n\n', '\n', '。'] as string[],
  qa_index_mode: 'QUESTION_ANSWER' as QaIndexMode,
  embedding_model_id: null as number | null,
  generation_model_id: null as number | null,
  rerank_model_id: null as number | null,
  vector_enabled: true,
  keyword_enabled: true,
  wiki_enabled: false,
  graph_enabled: false,
  top_k: 5,
  score_threshold: 0,
  rrf_vector_weight: 0.5,
  wiki_granularity: 'STANDARD' as WikiGranularity,
  metadata_schema: [] as MetadataFieldDef[],
})

// 分隔符实际值含换行符，必须放 script（vue-tsc 模板区转义坑）
const separatorOptions: SelectOption[] = [
  { label: '空行', value: '\n\n' },
  { label: '换行', value: '\n' },
  { label: '句号', value: '。' },
  { label: '小数点', value: '.' },
  { label: '分号', value: '；' },
  { label: '问号', value: '？' },
  { label: '感叹号', value: '！' },
]

const CHUNK_MODES: ChunkMode[] = ['GENERAL', 'PARENT_CHILD', 'QA']
const QA_MODES: QaIndexMode[] = ['QUESTION_ONLY', 'QUESTION_ANSWER']
const GRANULARITIES: WikiGranularity[] = ['FOCUSED', 'STANDARD', 'EXHAUSTIVE']

function reset(): void {
  current.value = 1
  Object.assign(form, {
    name: '',
    type: 'DOCUMENT',
    description: '',
    chunk_mode: 'GENERAL',
    chunk_size: 512,
    chunk_overlap: 80,
    separators: ['\n\n', '\n', '。'],
    qa_index_mode: 'QUESTION_ANSWER',
    embedding_model_id: null,
    generation_model_id: null,
    rerank_model_id: null,
    vector_enabled: true,
    keyword_enabled: true,
    wiki_enabled: false,
    graph_enabled: false,
    top_k: 5,
    score_threshold: 0,
    rrf_vector_weight: 0.5,
    wiki_granularity: 'STANDARD',
    metadata_schema: [],
  })
}

watch(
  () => props.show,
  (show) => {
    if (!show) return
    reset()
    loadModels()
  },
)

async function loadModels(): Promise<void> {
  modelsLoading.value = true
  try {
    models.value = await modelgatewayApi.listAllModels()
    if (form.embedding_model_id === null) {
      const emb = models.value.find((m) => m.enabled && m.model_type === 'EMBEDDING')
      if (emb) form.embedding_model_id = emb.id
    }
  } catch (e) {
    message.error(e instanceof Error ? e.message : '模型列表加载失败')
  } finally {
    modelsLoading.value = false
  }
}

function toOption(m: ModelDto): SelectOption {
  return { label: `${m.display_name}（${m.provider_name ?? '未知供应商'}）`, value: m.id }
}

const embeddingOptions = computed(
  () => models.value.filter((m) => m.enabled && m.model_type === 'EMBEDDING').map(toOption),
)
const generationOptions = computed(
  () => models.value.filter((m) => m.enabled && m.model_type === 'CHAT').map(toOption),
)
const rerankOptions = computed(
  () => models.value.filter((m) => m.enabled && m.model_type === 'RERANK').map(toOption),
)

const needsGeneration = computed(
  () => form.wiki_enabled || form.graph_enabled || (form.type === 'DOCUMENT' && form.chunk_mode === 'QA'),
)

function onModeChange(v: string | number): void {
  const mode = CHUNK_MODES.find((m) => m === String(v)) ?? 'GENERAL'
  form.chunk_mode = mode
  if (mode === 'PARENT_CHILD') {
    form.chunk_size = 384
    form.chunk_overlap = 76
  }
}

function validateStep(step: number): string | null {
  if (step === 1 && !form.name.trim()) return '请输入知识库名称'
  if (step === 2 && form.type === 'DOCUMENT' && form.chunk_mode !== 'QA') {
    if (form.chunk_size < 50 || form.chunk_size > 4000) return '分段长度需在 50-4000 之间'
    if (form.chunk_overlap < 0 || form.chunk_overlap >= form.chunk_size) return '分段重叠需小于分段长度'
  }
  if (step === 3) {
    if (form.embedding_model_id === null) return '请选择嵌入模型（向量检索必需）'
    if (needsGeneration.value && form.generation_model_id === null) {
      return '已开启 Wiki / 图谱 / QA 生成，需选择生成模型'
    }
  }
  return null
}

function next(): void {
  const err = validateStep(current.value)
  if (err) {
    message.warning(err)
    return
  }
  current.value = Math.min(5, current.value + 1)
}

async function create(): Promise<void> {
  const err = validateStep(1) ?? validateStep(3)
  if (err) {
    message.warning(err)
    return
  }
  const emb = models.value.find((m) => m.id === form.embedding_model_id)
  const gen = models.value.find((m) => m.id === form.generation_model_id)
  const rr = models.value.find((m) => m.id === form.rerank_model_id)
  const config: KbConfigDto = {
    chunk_mode: form.type === 'FAQ' ? 'QA' : form.chunk_mode,
    chunk_size: form.chunk_size,
    chunk_overlap: form.chunk_overlap,
    separators: form.separators,
    qa_index_mode: form.qa_index_mode,
    embedding_model_id: form.embedding_model_id ?? 0,
    embedding_model_name: emb?.display_name ?? '',
    generation_model_id: form.generation_model_id,
    generation_model_name: gen?.display_name ?? null,
    rerank_model_id: form.rerank_model_id,
    rerank_model_name: rr?.display_name ?? null,
    vector_enabled: form.vector_enabled,
    keyword_enabled: form.keyword_enabled,
    wiki_enabled: form.wiki_enabled,
    graph_enabled: form.graph_enabled,
    top_k: form.top_k,
    score_threshold: form.score_threshold,
    rrf_vector_weight: form.rrf_vector_weight,
    metadata_schema: form.metadata_schema.filter((f) => f.key.trim()),
    wiki_granularity: form.wiki_granularity,
  }
  creating.value = true
  try {
    const kb = await knowledgeApi.createBase({
      name: form.name.trim(),
      type: form.type,
      description: form.description.trim(),
      config,
    })
    message.success(`知识库「${kb.name}」已创建`)
    emit('created', kb)
    emit('update:show', false)
  } catch (e) {
    message.error(e instanceof Error ? e.message : '创建失败')
  } finally {
    creating.value = false
  }
}
</script>

<template>
  <n-modal
    :show="show"
    preset="card"
    title="新建知识库"
    style="width: 720px"
    @update:show="(v: boolean) => emit('update:show', v)"
  >
    <n-steps :current="current" size="small" class="wizard-steps">
      <n-step title="基础信息" />
      <n-step title="分块" />
      <n-step title="模型" />
      <n-step title="索引与检索" />
      <n-step title="元数据" />
    </n-steps>

    <div class="step-body">
      <!-- 步骤 1：类型与名称 -->
      <template v-if="current === 1">
        <n-form-item label="名称" label-placement="top">
          <n-input v-model:value="form.name" placeholder="如：产品手册、运维 FAQ" maxlength="50" />
        </n-form-item>
        <n-form-item label="类型" label-placement="top">
          <div class="type-cards">
            <div class="type-card" :class="{ active: form.type === 'DOCUMENT' }" @click="form.type = 'DOCUMENT'">
              <div class="type-title">文档库</div>
              <div class="type-desc">上传 PDF / DOCX / MD / TXT，自动分段、嵌入，可选 Wiki 与知识图谱</div>
            </div>
            <div class="type-card" :class="{ active: form.type === 'FAQ' }" @click="form.type = 'FAQ'">
              <div class="type-title">FAQ 库</div>
              <div class="type-desc">问题-答案对，批量导入或逐条录入，适合客服与运维问答</div>
            </div>
          </div>
        </n-form-item>
        <n-form-item label="描述" label-placement="top">
          <n-input
            v-model:value="form.description"
            type="textarea"
            :rows="2"
            maxlength="200"
            placeholder="一句话说明知识库用途（可留空，后续可 AI 生成）"
          />
        </n-form-item>
      </template>

      <!-- 步骤 2：分块 -->
      <template v-else-if="current === 2">
        <template v-if="form.type === 'FAQ'">
          <n-form-item label="索引内容" label-placement="top">
            <n-radio-group :value="form.qa_index_mode" @update:value="(v: string | number) => (form.qa_index_mode = QA_MODES.find((m) => m === String(v)) ?? 'QUESTION_ANSWER')">
              <n-radio-button value="QUESTION_ONLY">仅索引问题</n-radio-button>
              <n-radio-button value="QUESTION_ANSWER">问题 + 答案</n-radio-button>
            </n-radio-group>
          </n-form-item>
          <n-alert type="info" :show-icon="false">
            仅索引问题：向量召回更准、嵌入消耗减半；问题 + 答案：全文检索更友好。FAQ 库导入即结构化数据，无需分段。
          </n-alert>
        </template>
        <template v-else>
          <n-form-item label="分段模式" label-placement="top">
            <n-radio-group :value="form.chunk_mode" @update:value="onModeChange">
              <n-radio-button value="GENERAL">通用分段</n-radio-button>
              <n-radio-button value="PARENT_CHILD">父子分段</n-radio-button>
              <n-radio-button value="QA">QA 分段</n-radio-button>
            </n-radio-group>
          </n-form-item>
          <n-alert v-if="form.chunk_mode === 'GENERAL'" type="info" :show-icon="false">
            按固定长度滑窗切分，标题感知（不跨标题截断）。适合大多数文档。
          </n-alert>
          <n-alert v-else-if="form.chunk_mode === 'PARENT_CHILD'" type="info" :show-icon="false">
            父块约 4096 字、子块约 384 字：检索命中子块、召回父块整段上下文，适合规章制度、操作手册等长文档。参数自动配置。
          </n-alert>
          <n-alert v-else type="info" :show-icon="false">
            由生成模型把文档内容改写为问题-答案对（消耗 LLM 调用）；FAQ 库则可跳过生成直接导入。
          </n-alert>
          <template v-if="form.chunk_mode !== 'QA'">
            <div class="param-row">
              <n-form-item label="分段长度（chunk size）" label-placement="top" class="param-item">
                <n-input-number v-model:value="form.chunk_size" :min="50" :max="4000" :step="64" style="width: 100%" />
              </n-form-item>
              <n-form-item label="分段重叠（overlap）" label-placement="top" class="param-item">
                <n-input-number v-model:value="form.chunk_overlap" :min="0" :max="500" :step="10" style="width: 100%" />
              </n-form-item>
            </div>
            <n-form-item label="分隔符" label-placement="top">
              <n-select v-model:value="form.separators" multiple :options="separatorOptions" placeholder="优先按分隔符切分" />
            </n-form-item>
          </template>
        </template>
      </template>

      <!-- 步骤 3：模型 -->
      <template v-else-if="current === 3">
        <n-alert v-if="!modelsLoading && embeddingOptions.length === 0" type="warning" :show-icon="false" class="mb">
          没有可用的嵌入模型——请先到「模型供应商」页面添加并启用 EMBEDDING 模型（推荐 bge-m3）。
        </n-alert>
        <n-form-item label="嵌入模型（向量检索用）" label-placement="top">
          <n-select
            v-model:value="form.embedding_model_id"
            :options="embeddingOptions"
            :loading="modelsLoading"
            placeholder="必选"
          />
        </n-form-item>
        <n-form-item label="生成模型（QA 生成 / Wiki / 图谱 / 标签用）" label-placement="top">
          <n-select
            v-model:value="form.generation_model_id"
            :options="generationOptions"
            :loading="modelsLoading"
            clearable
            :placeholder="needsGeneration ? '已开启相关能力，必选' : '可留空'"
          />
        </n-form-item>
        <n-form-item label="Rerank 模型（可选，混合检索后精排）" label-placement="top">
          <n-select
            v-model:value="form.rerank_model_id"
            :options="rerankOptions"
            :loading="modelsLoading"
            clearable
            placeholder="暂无可选项可留空"
          />
        </n-form-item>
      </template>

      <!-- 步骤 4：索引开关与检索参数 -->
      <template v-else-if="current === 4">
        <div class="switch-row">
          <div class="switch-info">
            <div class="switch-label">向量检索</div>
            <div class="switch-desc">pgvector HNSW + cosine 语义召回</div>
          </div>
          <n-switch v-model:value="form.vector_enabled" />
        </div>
        <div class="switch-row">
          <div class="switch-info">
            <div class="switch-label">全文检索</div>
            <div class="switch-desc">pg_search BM25 + 中文分词，关键词召回</div>
          </div>
          <n-switch v-model:value="form.keyword_enabled" />
        </div>
        <div class="switch-row">
          <div class="switch-info">
            <div class="switch-label">Wiki 自动生成</div>
            <div class="switch-desc">入库时用 LLM 组织为互链 Wiki 页面，含目录树与来源引用</div>
          </div>
          <n-switch v-model:value="form.wiki_enabled" />
        </div>
        <n-alert v-if="form.wiki_enabled" type="warning" :show-icon="false" class="mb">
          Wiki 生成会对每篇文档调用 LLM，请留意 token 消耗。
        </n-alert>
        <div class="switch-row">
          <div class="switch-info">
            <div class="switch-label">知识图谱</div>
            <div class="switch-desc">入库时逐分块抽取实体与关系（PG 邻接表存储），检索时图遍历扩展上下文</div>
          </div>
          <n-switch v-model:value="form.graph_enabled" />
        </div>
        <n-alert v-if="form.graph_enabled" type="warning" :show-icon="false" class="mb">
          图谱抽取是最贵的入库扇出——每个分块一次 LLM 调用，成本随文档量线性增长。
        </n-alert>
        <template v-if="form.wiki_enabled">
          <n-form-item label="Wiki 提取粒度" label-placement="top">
            <n-radio-group :value="form.wiki_granularity" @update:value="(v: string | number) => (form.wiki_granularity = GRANULARITIES.find((g) => g === String(v)) ?? 'STANDARD')">
              <n-radio-button value="FOCUSED">精简</n-radio-button>
              <n-radio-button value="STANDARD">标准</n-radio-button>
              <n-radio-button value="EXHAUSTIVE">详尽</n-radio-button>
            </n-radio-group>
          </n-form-item>
        </template>
        <div class="param-row">
          <n-form-item label="Top-K" label-placement="top" class="param-item">
            <n-input-number v-model:value="form.top_k" :min="1" :max="20" style="width: 100%" />
          </n-form-item>
          <n-form-item label="Score 阈值（仅单路向量模式生效）" label-placement="top" class="param-item">
            <n-input-number v-model:value="form.score_threshold" :min="0" :max="1" :step="0.05" style="width: 100%" />
          </n-form-item>
          <n-form-item label="RRF 向量权重" label-placement="top" class="param-item">
            <n-input-number v-model:value="form.rrf_vector_weight" :min="0" :max="1" :step="0.1" style="width: 100%" />
          </n-form-item>
        </div>
      </template>

      <!-- 步骤 5：元数据 -->
      <template v-else>
        <MetadataSchemaEditor v-model:fields="form.metadata_schema" />
      </template>
    </div>

    <template #footer>
      <n-space justify="space-between" align="center">
        <span class="step-hint">第 {{ current }} / 5 步</span>
        <n-space>
          <n-button v-if="current > 1" @click="current -= 1">上一步</n-button>
          <n-button v-if="current < 5" type="primary" @click="next">下一步</n-button>
          <n-button v-else type="primary" :loading="creating" @click="create">创建知识库</n-button>
        </n-space>
      </n-space>
    </template>
  </n-modal>
</template>

<style scoped>
.wizard-steps {
  margin-bottom: 24px;
}

.step-body {
  min-height: 300px;
}

.type-cards {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
  width: 100%;
}

.type-card {
  border: 1px solid #dcdcdc;
  border-radius: 8px;
  padding: 14px;
  cursor: pointer;
  transition: border-color 0.2s, background-color 0.2s;
}

.type-card:hover {
  border-color: #07c05f;
}

.type-card.active {
  border-color: #07c05f;
  background-color: #e9f8ec;
}

.type-title {
  font-weight: 600;
  margin-bottom: 6px;
}

.type-desc {
  font-size: 12px;
  color: #666;
  line-height: 1.6;
}

.param-row {
  display: flex;
  gap: 16px;
}

.param-item {
  flex: 1;
}

.switch-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 12px;
  border: 1px solid #eee;
  border-radius: 6px;
  margin-bottom: 10px;
}

.switch-label {
  font-weight: 500;
}

.switch-desc {
  font-size: 12px;
  color: #999;
  margin-top: 2px;
}

.step-hint {
  font-size: 13px;
  color: #999;
}

.mb {
  margin-bottom: 12px;
}
</style>
