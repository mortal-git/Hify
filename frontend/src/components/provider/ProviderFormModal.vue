<script setup lang="ts">
import { reactive, ref, watch } from 'vue'
import {
  NButton,
  NCollapse,
  NCollapseItem,
  NForm,
  NFormItem,
  NInput,
  NInputNumber,
  NModal,
  NSpace,
  NSwitch,
  useMessage,
} from 'naive-ui'
import type { FormInst, FormItemRule, FormRules } from 'naive-ui'

import { modelgatewayApi } from '@/api/modelgateway'
import type { ProviderDto, ProviderPayload } from '@/api/modelgateway'

const props = defineProps<{
  show: boolean
  provider: ProviderDto | null // null = 新增
}>()

const emit = defineEmits<{
  (e: 'update:show', value: boolean): void
  (e: 'saved'): void
}>()

const message = useMessage()
const formRef = ref<FormInst | null>(null)
const saving = ref(false)

const form = reactive({
  name: '',
  base_url: '',
  api_key: '',
  enabled: true,
  max_concurrency: null as number | null,
  embedding_batch_size: null as number | null,
  connect_ms: null as number | null,
  total_ms: null as number | null,
  ttft_ms: null as number | null,
  idle_ms: null as number | null,
  failure_threshold: null as number | null,
  open_ms: null as number | null,
})

const rules: FormRules = {
  name: { required: true, message: '请输入名称', trigger: 'blur' },
  base_url: [
    { required: true, message: '请输入 base_url', trigger: 'blur' },
    {
      validator: (_rule: FormItemRule, value: string) => /^https?:\/\//.test(value),
      message: '以 http(s):// 开头',
      trigger: 'blur',
    },
  ],
}

// vue-tsc 3.3.14 bug：template 区出现 “//” 会损坏虚拟代码生成（v-model 检查报伪错误），URL 类字符串必须放 script 常量
const urlPlaceholder = 'https://api.openai.com/v1'

watch(
  () => props.show,
  (show) => {
    if (!show) return
    const p = props.provider
    form.name = p?.name ?? ''
    form.base_url = p?.base_url ?? ''
    form.api_key = ''
    form.enabled = p?.enabled ?? true
    form.max_concurrency = p?.max_concurrency ?? null
    form.embedding_batch_size = p?.embedding_batch_size ?? null
    form.connect_ms = p?.timeout_config?.connect_ms ?? null
    form.total_ms = p?.timeout_config?.total_ms ?? null
    form.ttft_ms = p?.timeout_config?.ttft_ms ?? null
    form.idle_ms = p?.timeout_config?.idle_ms ?? null
    form.failure_threshold = p?.circuit_config?.failure_threshold ?? null
    form.open_ms = p?.circuit_config?.open_ms ?? null
  },
)

function close(): void {
  emit('update:show', false)
}

async function handleSave(): Promise<void> {
  try {
    await formRef.value?.validate()
  } catch {
    return
  }
  const t = { connect_ms: form.connect_ms, total_ms: form.total_ms, ttft_ms: form.ttft_ms, idle_ms: form.idle_ms }
  const c = { failure_threshold: form.failure_threshold, open_ms: form.open_ms }
  const payload: ProviderPayload = {
    name: form.name,
    base_url: form.base_url,
    enabled: form.enabled,
    timeout_config: Object.values(t).some((v) => v != null) ? t : null,
    circuit_config: Object.values(c).some((v) => v != null) ? c : null,
  }
  if (form.api_key) payload.api_key = form.api_key
  if (form.max_concurrency != null) payload.max_concurrency = form.max_concurrency
  if (form.embedding_batch_size != null) payload.embedding_batch_size = form.embedding_batch_size
  saving.value = true
  try {
    if (props.provider) {
      await modelgatewayApi.updateProvider(props.provider.id, payload)
    } else {
      await modelgatewayApi.createProvider(payload)
    }
    message.success(props.provider ? '已保存' : '已创建')
    emit('saved')
    close()
  } catch (e) {
    message.error(e instanceof Error ? e.message : '保存失败')
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <n-modal
    :show="show"
    preset="card"
    :title="provider ? '编辑供应商' : '新增供应商'"
    style="width: 580px"
    @update:show="(v: boolean) => emit('update:show', v)"
  >
    <n-form ref="formRef" :model="form" :rules="rules" label-placement="left" label-width="90">
      <n-form-item label="名称" path="name">
        <n-input v-model:value="form.name" placeholder="如 OpenAI、公司中转站" />
      </n-form-item>
      <n-form-item label="base_url" path="base_url">
        <n-input v-model:value="form.base_url" :placeholder="urlPlaceholder" />
      </n-form-item>
      <n-form-item label="API Key">
        <n-input
          v-model:value="form.api_key"
          type="password"
          show-password-on="click"
          :placeholder="provider?.key_configured ? '已配置——留空保持不变' : '未配置——Ollama 等本地服务可留空'"
        />
      </n-form-item>
      <n-form-item label="启用">
        <n-switch v-model:value="form.enabled" />
      </n-form-item>
      <n-collapse
        :default-expanded-names="provider?.timeout_config || provider?.circuit_config ? ['adv'] : []"
      >
        <n-collapse-item title="高级设置（留空使用全局默认）" name="adv">
          <div class="grid2">
            <n-form-item label="并发上限" :show-feedback="false">
              <n-input-number v-model:value="form.max_concurrency" :min="1" placeholder="默认 8" style="width: 100%" />
            </n-form-item>
            <n-form-item label="嵌入批大小" :show-feedback="false">
              <n-input-number v-model:value="form.embedding_batch_size" :min="1" placeholder="默认 16" style="width: 100%" />
            </n-form-item>
          </div>
          <div class="section-title">超时覆盖（毫秒）</div>
          <div class="grid2">
            <n-form-item label="连接" :show-feedback="false">
              <n-input-number v-model:value="form.connect_ms" :min="100" :step="500" placeholder="默认 5000" style="width: 100%" />
            </n-form-item>
            <n-form-item label="总超时" :show-feedback="false">
              <n-input-number v-model:value="form.total_ms" :min="100" :step="1000" placeholder="默认 30000（非流式）" style="width: 100%" />
            </n-form-item>
            <n-form-item label="流式首包" :show-feedback="false">
              <n-input-number v-model:value="form.ttft_ms" :min="100" :step="1000" placeholder="默认 30000" style="width: 100%" />
            </n-form-item>
            <n-form-item label="流式空闲" :show-feedback="false">
              <n-input-number v-model:value="form.idle_ms" :min="100" :step="1000" placeholder="默认 60000" style="width: 100%" />
            </n-form-item>
          </div>
          <div class="section-title">熔断覆盖</div>
          <div class="grid2">
            <n-form-item label="失败阈值" :show-feedback="false">
              <n-input-number v-model:value="form.failure_threshold" :min="1" placeholder="默认 5 次" style="width: 100%" />
            </n-form-item>
            <n-form-item label="打开时长" :show-feedback="false">
              <n-input-number v-model:value="form.open_ms" :min="1000" :step="1000" placeholder="默认 30000ms" style="width: 100%" />
            </n-form-item>
          </div>
        </n-collapse-item>
      </n-collapse>
    </n-form>
    <template #footer>
      <n-space justify="end">
        <n-button @click="close">取消</n-button>
        <n-button type="primary" :loading="saving" @click="handleSave">保存</n-button>
      </n-space>
    </template>
  </n-modal>
</template>

<style scoped>
.grid2 {
  display: grid;
  grid-template-columns: 1fr 1fr;
  column-gap: 16px;
  row-gap: 12px;
}

.section-title {
  font-size: 12px;
  color: #999;
  margin: 12px 0 8px;
}
</style>
