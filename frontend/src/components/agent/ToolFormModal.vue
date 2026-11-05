<script setup lang="ts">
import { reactive, ref, watch } from 'vue'
import { NButton, NFormItem, NInput, NModal, NRadioButton, NRadioGroup, NSpace, useMessage } from 'naive-ui'

import { agentApi } from '@/api/agent'
import type { ToolDto, ToolHttpMethod, ToolPayload } from '@/api/agent'

const props = defineProps<{
  show: boolean
  tool: ToolDto | null
}>()

const emit = defineEmits<{
  (e: 'update:show', value: boolean): void
  (e: 'saved'): void
}>()

const message = useMessage()
const saving = ref(false)

// vue-tsc 模板区 // bug：URL 示例必须放 script 常量
const URL_PLACEHOLDER = 'https://api.example.com/v1/query?city={{city}}'
const BODY_PLACEHOLDER = 'POST 请求的 JSON 模板，支持 {{参数名}} 占位'

const METHODS: ToolHttpMethod[] = ['GET', 'POST', 'PUT', 'DELETE']

const form = reactive({
  display_name: '',
  name: '',
  description: '',
  method: 'GET' as ToolHttpMethod,
  url: '',
  headers_text: '{\n  "Content-Type": "application/json"\n}',
  body_template: '',
})

watch(
  () => props.show,
  (show) => {
    if (!show) return
    const t = props.tool
    Object.assign(form, {
      display_name: t?.display_name ?? '',
      name: t?.name ?? '',
      description: t?.description ?? '',
      method: t?.http_config?.method ?? 'GET',
      url: t?.http_config?.url ?? '',
      headers_text: t?.http_config
        ? JSON.stringify(t.http_config.headers ?? {}, null, 2)
        : '{\n  "Content-Type": "application/json"\n}',
      body_template: t?.http_config?.body_template ?? '',
    })
  },
)

async function save(): Promise<void> {
  if (!form.display_name.trim()) {
    message.warning('请输入工具名称')
    return
  }
  if (!form.name.trim() || !/^[a-z][a-z0-9_]*$/.test(form.name.trim())) {
    message.warning('标识需为小写字母开头的 snake_case（如 weather_query）')
    return
  }
  if (!/^https?:\/\//.test(form.url.trim())) {
    message.warning('请输入合法的 URL（http 或 https）')
    return
  }
  let headers: Record<string, string>
  try {
    const parsed: unknown = JSON.parse(form.headers_text || '{}')
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new Error('not object')
    headers = parsed as Record<string, string>
  } catch {
    message.warning('请求头必须是合法的 JSON 对象')
    return
  }
  const payload: ToolPayload = {
    name: form.name.trim(),
    display_name: form.display_name.trim(),
    description: form.description.trim(),
    http_config: {
      method: form.method,
      url: form.url.trim(),
      headers,
      body_template: form.body_template,
    },
  }
  saving.value = true
  try {
    if (props.tool) await agentApi.updateTool(props.tool.id, payload)
    else await agentApi.createTool(payload)
    message.success(`工具「${payload.display_name}」已保存`)
    emit('saved')
    emit('update:show', false)
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
    :title="tool ? `编辑工具 — ${tool.display_name}` : '新建 HTTP 工具'"
    style="width: 620px"
    @update:show="(v: boolean) => emit('update:show', v)"
  >
    <n-form-item label="名称" label-placement="top">
      <n-input v-model:value="form.display_name" maxlength="30" placeholder="如：天气查询" />
    </n-form-item>
    <n-form-item label="标识（Agent 循环中引用）" label-placement="top">
      <n-input v-model:value="form.name" maxlength="40" placeholder="snake_case，如 weather_query" />
    </n-form-item>
    <n-form-item label="描述（供模型判断何时调用）" label-placement="top">
      <n-input v-model:value="form.description" type="textarea" :rows="2" maxlength="200" placeholder="说明工具用途与参数，模型据此决定是否调用" />
    </n-form-item>
    <n-form-item label="请求方式" label-placement="top">
      <n-radio-group :value="form.method" @update:value="(v: string | number) => (form.method = METHODS.find((m) => m === String(v)) ?? 'GET')">
        <n-radio-button v-for="m in METHODS" :key="m" :value="m">{{ m }}</n-radio-button>
      </n-radio-group>
    </n-form-item>
    <n-form-item label="URL（支持 {{参数}} 占位）" label-placement="top">
      <n-input v-model:value="form.url" :placeholder="URL_PLACEHOLDER" />
    </n-form-item>
    <n-form-item label="请求头（JSON）" label-placement="top">
      <n-input v-model:value="form.headers_text" type="textarea" :rows="4" class="mono-input" />
    </n-form-item>
    <n-form-item v-if="form.method !== 'GET'" label="请求体模板" label-placement="top">
      <n-input v-model:value="form.body_template" type="textarea" :rows="4" class="mono-input" :placeholder="BODY_PLACEHOLDER" />
    </n-form-item>
    <template #footer>
      <n-space justify="end">
        <n-button @click="emit('update:show', false)">取消</n-button>
        <n-button type="primary" :loading="saving" @click="save">保存</n-button>
      </n-space>
    </template>
  </n-modal>
</template>

<style scoped>
.mono-input :deep(textarea) {
  font-family: 'SFMono-Regular', Consolas, 'Liberation Mono', monospace;
  font-size: 12px;
}
</style>
