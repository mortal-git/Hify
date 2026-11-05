<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { NButton, NCheckbox, NModal, NSelect, NSpace, NSpin, NTag, useMessage } from 'naive-ui'
import type { SelectOption } from 'naive-ui'

import { modelgatewayApi } from '@/api/modelgateway'
import type { ModelType, ProviderDto, RemoteModelDto } from '@/api/modelgateway'

const props = defineProps<{
  show: boolean
  provider: ProviderDto | null
  existingNames: string[]
}>()

const emit = defineEmits<{
  (e: 'update:show', value: boolean): void
  (e: 'imported'): void
}>()

const message = useMessage()
const loading = ref(false)
const loadError = ref<string | null>(null)
const candidates = ref<RemoteModelDto[]>([])
const checked = reactive<Record<string, boolean>>({})
const types = reactive<Record<string, ModelType>>({})
const importing = ref(false)

const typeOptions: SelectOption[] = [
  { label: 'CHAT', value: 'CHAT' },
  { label: 'EMBEDDING', value: 'EMBEDDING' },
  { label: 'RERANK', value: 'RERANK' },
]

const MODEL_TYPES: ModelType[] = ['CHAT', 'EMBEDDING', 'RERANK']

function inferType(name: string): ModelType {
  if (/embed|bge(?!.*rerank)/i.test(name)) return 'EMBEDDING'
  if (/rerank/i.test(name)) return 'RERANK'
  return 'CHAT'
}

function onTypeChange(name: string, v: string | number): void {
  types[name] = MODEL_TYPES.find((t) => t === String(v)) ?? 'CHAT'
}

function isExisting(name: string): boolean {
  return props.existingNames.includes(name)
}

const importableCount = computed(
  () => candidates.value.filter((c) => checked[c.name] && !isExisting(c.name)).length,
)

const allChecked = computed(() => {
  const importable = candidates.value.filter((c) => !isExisting(c.name))
  return importable.length > 0 && importable.every((c) => checked[c.name])
})

watch(
  () => props.show,
  (show) => {
    if (show) load()
  },
)

async function load(): Promise<void> {
  const provider = props.provider
  if (!provider) return
  loading.value = true
  loadError.value = null
  try {
    candidates.value = await modelgatewayApi.listRemoteModels(provider.id)
    for (const c of candidates.value) {
      checked[c.name] = false
      types[c.name] = inferType(c.name)
    }
  } catch (e) {
    loadError.value = e instanceof Error ? e.message : '拉取失败'
  } finally {
    loading.value = false
  }
}

function toggleAll(value: boolean): void {
  for (const c of candidates.value) {
    if (!isExisting(c.name)) checked[c.name] = value
  }
}

function close(): void {
  emit('update:show', false)
}

async function handleImport(): Promise<void> {
  const provider = props.provider
  if (!provider || importableCount.value === 0) return
  const targets = candidates.value.filter((c) => checked[c.name] && !isExisting(c.name))
  importing.value = true
  try {
    await Promise.all(
      targets.map((c) =>
        modelgatewayApi.createModel(provider.id, {
          name: c.name,
          display_name: c.name,
          model_type: types[c.name] ?? 'CHAT',
          enabled: true,
        }),
      ),
    )
    message.success(`已导入 ${targets.length} 个模型`)
  } catch (e) {
    message.error(e instanceof Error ? e.message : '导入失败')
  } finally {
    importing.value = false
    emit('imported')
    close()
  }
}
</script>

<template>
  <n-modal
    :show="show"
    preset="card"
    title="从 API 拉取模型"
    style="width: 560px"
    @update:show="(v: boolean) => emit('update:show', v)"
  >
    <n-spin :show="loading">
      <div v-if="loadError" class="load-error">
        <div>{{ loadError }}</div>
        <n-button size="small" @click="load">重试</n-button>
      </div>
      <template v-else>
        <div class="list-toolbar">
          <n-checkbox :checked="allChecked" @update:checked="(v: boolean) => toggleAll(v)">全选</n-checkbox>
        </div>
        <div class="candidate-list">
          <div
            v-for="c in candidates"
            :key="c.name"
            class="candidate-row"
            :class="{ existing: isExisting(c.name) }"
          >
            <n-checkbox
              :checked="checked[c.name] ?? false"
              :disabled="isExisting(c.name)"
              @update:checked="(v: boolean) => (checked[c.name] = v)"
            />
            <span class="name">{{ c.name }}</span>
            <n-tag v-if="isExisting(c.name)" size="small" :bordered="false">已存在</n-tag>
            <n-select
              class="type-select"
              size="small"
              :value="types[c.name] ?? 'CHAT'"
              :options="typeOptions"
              :disabled="isExisting(c.name)"
              @update:value="(v: string | number) => onTypeChange(c.name, v)"
            />
          </div>
        </div>
      </template>
    </n-spin>
    <template #footer>
      <n-space justify="space-between" align="center">
        <span class="hint">已选 {{ importableCount }} 个</span>
        <n-space>
          <n-button @click="close">取消</n-button>
          <n-button type="primary" :loading="importing" :disabled="importableCount === 0" @click="handleImport">
            导入
          </n-button>
        </n-space>
      </n-space>
    </template>
  </n-modal>
</template>

<style scoped>
.load-error {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  padding: 32px 0;
  color: #d03050;
}

.list-toolbar {
  padding-bottom: 8px;
  border-bottom: 1px solid #efeff5;
}

.candidate-list {
  max-height: 320px;
  overflow-y: auto;
}

.candidate-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 6px 0;
}

.candidate-row .name {
  flex: 1;
}

.candidate-row.existing .name {
  color: #999;
}

.type-select {
  width: 140px;
}

.hint {
  font-size: 13px;
  color: #666;
}
</style>
