<script setup lang="ts">
import { reactive, ref, watch } from 'vue'
import {
  NButton,
  NForm,
  NFormItem,
  NInput,
  NInputNumber,
  NModal,
  NRadioButton,
  NRadioGroup,
  NSpace,
  NSwitch,
  useMessage,
} from 'naive-ui'
import type { FormInst, FormRules } from 'naive-ui'

import { modelgatewayApi } from '@/api/modelgateway'
import type { ModelDto, ModelPayload, ModelType } from '@/api/modelgateway'

const props = defineProps<{
  show: boolean
  providerId: number
  model: ModelDto | null // null = 新增
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
  display_name: '',
  model_type: 'CHAT' as ModelType,
  input_price: null as number | null,
  output_price: null as number | null,
  enabled: true,
})

const MODEL_TYPES: ModelType[] = ['CHAT', 'EMBEDDING', 'RERANK']

function onTypeChange(v: string | number | boolean): void {
  form.model_type = MODEL_TYPES.find((t) => t === String(v)) ?? 'CHAT'
}

const rules: FormRules = {
  name: { required: true, message: '请输入模型名', trigger: 'blur' },
}

watch(
  () => props.show,
  (show) => {
    if (!show) return
    const m = props.model
    form.name = m?.name ?? ''
    form.display_name = m?.display_name ?? ''
    form.model_type = m?.model_type ?? 'CHAT'
    form.input_price = m?.input_price ?? null
    form.output_price = m?.output_price ?? null
    form.enabled = m?.enabled ?? true
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
  const payload: ModelPayload = {
    name: form.name,
    display_name: form.display_name || form.name,
    model_type: form.model_type,
    input_price: form.input_price,
    output_price: form.output_price,
    enabled: form.enabled,
  }
  saving.value = true
  try {
    if (props.model) {
      await modelgatewayApi.updateModel(props.model.id, payload)
    } else {
      await modelgatewayApi.createModel(props.providerId, payload)
    }
    message.success(props.model ? '已保存' : '已添加')
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
    :title="model ? '编辑模型' : '添加模型'"
    style="width: 480px"
    @update:show="(v: boolean) => emit('update:show', v)"
  >
    <n-form ref="formRef" :model="form" :rules="rules" label-placement="left" label-width="90">
      <n-form-item label="模型名" path="name">
        <n-input v-model:value="form.name" placeholder="API 参数用，如 gpt-5.2" />
      </n-form-item>
      <n-form-item label="显示名">
        <n-input v-model:value="form.display_name" placeholder="留空则同模型名" />
      </n-form-item>
      <n-form-item label="类型">
        <n-radio-group :value="form.model_type" @update:value="onTypeChange">
          <n-radio-button value="CHAT">聊天</n-radio-button>
          <n-radio-button value="EMBEDDING">嵌入</n-radio-button>
          <n-radio-button value="RERANK">重排</n-radio-button>
        </n-radio-group>
      </n-form-item>
      <n-form-item label="输入单价">
        <n-input-number v-model:value="form.input_price" :min="0" placeholder="每百万 token，留空不计价" style="width: 100%" />
      </n-form-item>
      <n-form-item label="输出单价">
        <n-input-number v-model:value="form.output_price" :min="0" placeholder="每百万 token，留空不计价" style="width: 100%" />
      </n-form-item>
      <n-form-item label="启用">
        <n-switch v-model:value="form.enabled" />
      </n-form-item>
    </n-form>
    <template #footer>
      <n-space justify="end">
        <n-button @click="close">取消</n-button>
        <n-button type="primary" :loading="saving" @click="handleSave">保存</n-button>
      </n-space>
    </template>
  </n-modal>
</template>
