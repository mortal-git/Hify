<script setup lang="ts">
import { computed, h, onMounted, ref } from 'vue'
import {
  NButton,
  NDataTable,
  NEmpty,
  NPopconfirm,
  NSpace,
  NSwitch,
  NTag,
  useMessage,
} from 'naive-ui'
import type { DataTableColumns } from 'naive-ui'

import { modelgatewayApi } from '@/api/modelgateway'
import type { ModelDto, ProviderDto } from '@/api/modelgateway'
import ImportModelsModal from '@/components/provider/ImportModelsModal.vue'
import ModelFormModal from '@/components/provider/ModelFormModal.vue'
import ProviderFormModal from '@/components/provider/ProviderFormModal.vue'

const message = useMessage()

const providers = ref<ProviderDto[]>([])
const providersLoading = ref(false)
const selectedProvider = ref<ProviderDto | null>(null)
const models = ref<ModelDto[]>([])
const modelsLoading = ref(false)

const showProviderForm = ref(false)
const editingProvider = ref<ProviderDto | null>(null)
const showModelForm = ref(false)
const editingModel = ref<ModelDto | null>(null)
const showImport = ref(false)

const togglingProviderId = ref<number | null>(null)
const togglingModelId = ref<number | null>(null)
const testingProviderId = ref<number | null>(null)
const testingModelId = ref<number | null>(null)

function isLocalUrl(url: string): boolean {
  return /\/\/(localhost|127\.0\.0\.1|host\.docker\.internal)/.test(url)
}

async function loadProviders(): Promise<void> {
  providersLoading.value = true
  try {
    providers.value = await modelgatewayApi.listProviders()
    if (selectedProvider.value) {
      const fresh = providers.value.find((p) => p.id === selectedProvider.value?.id)
      if (fresh) {
        selectedProvider.value = fresh
      } else {
        selectedProvider.value = null
        models.value = []
      }
    }
  } catch (e) {
    message.error(e instanceof Error ? e.message : '加载供应商失败')
  } finally {
    providersLoading.value = false
  }
}

async function loadModels(): Promise<void> {
  const p = selectedProvider.value
  if (!p) return
  modelsLoading.value = true
  try {
    models.value = await modelgatewayApi.listModels(p.id)
  } catch (e) {
    message.error(e instanceof Error ? e.message : '加载模型失败')
  } finally {
    modelsLoading.value = false
  }
}

function openCreateProvider(): void {
  editingProvider.value = null
  showProviderForm.value = true
}

function openEditProvider(p: ProviderDto): void {
  editingProvider.value = p
  showProviderForm.value = true
}

function selectProvider(p: ProviderDto): void {
  selectedProvider.value = p
  loadModels()
}

async function toggleProvider(p: ProviderDto, enabled: boolean): Promise<void> {
  togglingProviderId.value = p.id
  try {
    const fresh = await modelgatewayApi.updateProvider(p.id, { enabled })
    Object.assign(p, fresh)
    if (selectedProvider.value?.id === p.id) selectedProvider.value = fresh
  } catch (e) {
    message.error(e instanceof Error ? e.message : '操作失败')
  } finally {
    togglingProviderId.value = null
  }
}

async function testProvider(p: ProviderDto): Promise<void> {
  testingProviderId.value = p.id
  try {
    const r = await modelgatewayApi.testProvider(p.id)
    if (r.success) {
      message.success(`${r.message}，耗时 ${r.latency_ms}ms`)
    } else {
      message.error(r.message)
    }
  } catch (e) {
    message.error(e instanceof Error ? e.message : '测试失败')
  } finally {
    testingProviderId.value = null
  }
}

async function deleteProvider(p: ProviderDto): Promise<void> {
  try {
    await modelgatewayApi.deleteProvider(p.id)
    message.success('已删除')
  } catch (e) {
    message.error(e instanceof Error ? e.message : '删除失败')
    return
  }
  await loadProviders()
}

function openCreateModel(): void {
  editingModel.value = null
  showModelForm.value = true
}

function openEditModel(m: ModelDto): void {
  editingModel.value = m
  showModelForm.value = true
}

async function toggleModel(m: ModelDto, enabled: boolean): Promise<void> {
  togglingModelId.value = m.id
  try {
    const fresh = await modelgatewayApi.updateModel(m.id, { enabled })
    Object.assign(m, fresh)
  } catch (e) {
    message.error(e instanceof Error ? e.message : '操作失败')
  } finally {
    togglingModelId.value = null
  }
}

async function testModel(m: ModelDto): Promise<void> {
  testingModelId.value = m.id
  try {
    const r = await modelgatewayApi.testModel(m.id)
    if (r.success) {
      message.success(`${r.message}，耗时 ${r.latency_ms}ms`)
    } else {
      message.error(r.message)
    }
  } catch (e) {
    message.error(e instanceof Error ? e.message : '测试失败')
  } finally {
    testingModelId.value = null
  }
}

async function deleteModel(m: ModelDto): Promise<void> {
  try {
    await modelgatewayApi.deleteModel(m.id)
    message.success('已删除')
  } catch (e) {
    message.error(e instanceof Error ? e.message : '删除失败')
    return
  }
  await Promise.all([loadModels(), loadProviders()])
}

function onProviderSaved(): void {
  loadProviders()
}

function onModelSaved(): void {
  loadModels()
  loadProviders()
}

function onImported(): void {
  loadModels()
  loadProviders()
}

const providerColumns = computed<DataTableColumns<ProviderDto>>(() => [
  {
    title: '名称',
    key: 'name',
    render: (p) =>
      h('div', { class: 'provider-cell' }, [
        h('span', { class: 'provider-name' }, p.name),
        h('span', { class: 'provider-url' }, p.base_url),
      ]),
  },
  {
    title: '启用',
    key: 'enabled',
    width: 80,
    render: (p) =>
      h(NSwitch, {
        value: p.enabled,
        loading: togglingProviderId.value === p.id,
        'onUpdate:value': (v: string | number | boolean) => toggleProvider(p, v === true),
      }),
  },
  {
    title: '密钥',
    key: 'key_configured',
    width: 90,
    render: (p) =>
      isLocalUrl(p.base_url) || p.key_configured
        ? h(NTag, { size: 'small', bordered: false, type: p.key_configured ? 'success' : 'default' }, { default: () => (isLocalUrl(p.base_url) ? '无需' : '已配置') })
        : h(NTag, { size: 'small', bordered: false, type: 'warning' }, { default: () => '未配置' }),
  },
  {
    title: '模型',
    key: 'model_count',
    width: 80,
    render: (p) =>
      h(
        NButton,
        {
          text: true,
          type: p.id === selectedProvider.value?.id ? 'primary' : 'info',
          onClick: () => selectProvider(p),
        },
        { default: () => `${p.model_count} 个` },
      ),
  },
  {
    title: '操作',
    key: 'actions',
    width: 220,
    render: (p) =>
      h(NSpace, { size: 8, wrap: false }, {
        default: () => [
          h(
            NButton,
            {
              size: 'small',
              loading: testingProviderId.value === p.id,
              onClick: () => testProvider(p),
            },
            { default: () => '测试' },
          ),
          h(NButton, { size: 'small', onClick: () => openEditProvider(p) }, { default: () => '编辑' }),
          h(
            NPopconfirm,
            { positiveText: '确认', negativeText: '取消', onPositiveClick: () => deleteProvider(p) },
            {
              trigger: () =>
                h(NButton, { size: 'small', type: 'error', ghost: true }, { default: () => '删除' }),
              default: () => `删除供应商「${p.name}」？`,
            },
          ),
        ],
      }),
  },
])

const modelColumns = computed<DataTableColumns<ModelDto>>(() => [
  {
    title: '模型',
    key: 'name',
    render: (m) =>
      h('div', { class: 'provider-cell' }, [
        h('span', { class: 'provider-name' }, m.display_name || m.name),
        h('span', { class: 'provider-url' }, m.name),
      ]),
  },
  {
    title: '类型',
    key: 'model_type',
    width: 90,
    render: (m) =>
      h(
        NTag,
        { size: 'small', bordered: false, type: m.model_type === 'EMBEDDING' ? 'success' : 'info' },
        { default: () => (m.model_type === 'EMBEDDING' ? '嵌入' : '聊天') },
      ),
  },
  {
    title: '单价（/百万 token）',
    key: 'input_price',
    width: 180,
    render: (m) => {
      if (m.input_price == null && m.output_price == null) return '—'
      return `in ${m.input_price ?? '—'} / out ${m.output_price ?? '—'}`
    },
  },
  {
    title: '启用',
    key: 'enabled',
    width: 80,
    render: (m) =>
      h(NSwitch, {
        value: m.enabled,
        loading: togglingModelId.value === m.id,
        'onUpdate:value': (v: string | number | boolean) => toggleModel(m, v === true),
      }),
  },
  {
    title: '操作',
    key: 'actions',
    width: 220,
    render: (m) =>
      h(NSpace, { size: 8, wrap: false }, {
        default: () => [
          h(
            NButton,
            {
              size: 'small',
              loading: testingModelId.value === m.id,
              onClick: () => testModel(m),
            },
            { default: () => '测试' },
          ),
          h(NButton, { size: 'small', onClick: () => openEditModel(m) }, { default: () => '编辑' }),
          h(
            NPopconfirm,
            { positiveText: '确认', negativeText: '取消', onPositiveClick: () => deleteModel(m) },
            {
              trigger: () =>
                h(NButton, { size: 'small', type: 'error', ghost: true }, { default: () => '删除' }),
              default: () => `删除模型「${m.name}」？`,
            },
          ),
        ],
      }),
  },
])

onMounted(loadProviders)
</script>

<template>
  <div class="provider-admin">
    <div class="page-head">
      <div>
        <div class="page-title">模型供应商</div>
        <div class="page-desc">OpenAI 兼容端点统一接入，密钥加密存储，四家供应商均走兼容协议</div>
      </div>
      <n-button type="primary" @click="openCreateProvider">新增供应商</n-button>
    </div>

    <div class="page-card">
      <n-data-table
        :columns="providerColumns"
        :data="providers"
        :loading="providersLoading"
        :row-key="(p: ProviderDto) => p.id"
        :bordered="false"
        size="small"
      />
    </div>

    <div v-if="selectedProvider" class="page-card models-card">
      <div class="models-head">
        <div class="models-title">
          模型
          <n-tag size="small" :bordered="false">{{ selectedProvider.name }}</n-tag>
        </div>
        <n-space>
          <n-button size="small" @click="showImport = true">从 API 拉取</n-button>
          <n-button size="small" type="primary" @click="openCreateModel">添加模型</n-button>
        </n-space>
      </div>
      <n-data-table
        v-if="models.length > 0"
        :columns="modelColumns"
        :data="models"
        :loading="modelsLoading"
        :row-key="(m: ModelDto) => m.id"
        :bordered="false"
        size="small"
      />
      <n-empty v-else-if="!modelsLoading" description="暂无模型——可从 API 拉取或手动添加" style="padding: 24px 0" />
    </div>

    <ProviderFormModal v-model:show="showProviderForm" :provider="editingProvider" @saved="onProviderSaved" />
    <ModelFormModal
      v-model:show="showModelForm"
      :provider-id="selectedProvider?.id ?? 0"
      :model="editingModel"
      @saved="onModelSaved"
    />
    <ImportModelsModal
      v-model:show="showImport"
      :provider="selectedProvider"
      :existing-names="models.map((m) => m.name)"
      @imported="onImported"
    />
  </div>
</template>

<style scoped>
.provider-admin {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.provider-cell {
  display: flex;
  flex-direction: column;
}

.provider-cell .provider-name {
  font-weight: 500;
}

.provider-cell .provider-url {
  font-size: 12px;
  color: #999;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.models-card {
  border-left: 3px solid #07c05f;
}

.models-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 12px;
}

.models-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 14px;
  font-weight: 600;
  color: #222;
}
</style>
