<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { NButton, NFormItem, NInput, NModal, NSelect, NSlider, NSpace, useMessage } from 'naive-ui'
import type { SelectOption } from 'naive-ui'

import { agentApi } from '@/api/agent'
import type { AgentDto, AgentPayload } from '@/api/agent'
import { knowledgeApi } from '@/api/knowledge'
import type { KbSummaryDto } from '@/api/knowledge'
import { modelgatewayApi } from '@/api/modelgateway'
import type { ModelDto } from '@/api/modelgateway'

const props = defineProps<{
  show: boolean
  agent: AgentDto | null
}>()

const emit = defineEmits<{
  (e: 'update:show', value: boolean): void
  (e: 'saved', agent: AgentDto): void
}>()

const message = useMessage()
const saving = ref(false)
const models = ref<ModelDto[]>([])
const kbs = ref<KbSummaryDto[]>([])
const tools = ref<{ id: number; label: string }[]>([])
const optionsLoading = ref(false)

const DEFAULT_PROMPT = '你是团队内部的智能助手。请基于已有知识准确回答问题，无法确定时明确说明，不要编造。'

const form = reactive({
  name: '',
  description: '',
  opening_statement: '',
  system_prompt: DEFAULT_PROMPT,
  model_id: null as number | null,
  temperature: 0.7,
  knowledge_base_ids: [] as number[],
  tool_ids: [] as number[],
})

watch(
  () => props.show,
  (show) => {
    if (!show) return
    const a = props.agent
    Object.assign(form, {
      name: a?.name ?? '',
      description: a?.description ?? '',
      opening_statement: a?.opening_statement ?? '',
      system_prompt: a?.system_prompt ?? DEFAULT_PROMPT,
      model_id: a?.model_id ?? null,
      temperature: a?.temperature ?? 0.7,
      knowledge_base_ids: a ? [...a.knowledge_base_ids] : [],
      tool_ids: a ? [...a.tool_ids] : [],
    })
    loadOptions()
  },
)

async function loadOptions(): Promise<void> {
  optionsLoading.value = true
  try {
    const [modelList, kbList, toolList] = await Promise.all([
      modelgatewayApi.listAllModels(),
      knowledgeApi.listBases(),
      agentApi.listTools(),
    ])
    models.value = modelList
    kbs.value = kbList
    tools.value = toolList.map((t) => ({
      id: t.id,
      label: t.builtin ? `${t.display_name}（内置）` : t.display_name,
    }))
    if (form.model_id === null) {
      const chat = models.value.find((m) => m.enabled && m.model_type === 'CHAT')
      if (chat) form.model_id = chat.id
    }
  } catch (e) {
    message.error(e instanceof Error ? e.message : '选项加载失败')
  } finally {
    optionsLoading.value = false
  }
}

const modelOptions = computed<SelectOption[]>(() =>
  models.value.filter((m) => m.enabled && m.model_type === 'CHAT').map((m) => ({
    label: `${m.display_name}（${m.provider_name ?? '未知供应商'}）`,
    value: m.id,
  })),
)
const kbOptions = computed<SelectOption[]>(() =>
  kbs.value.map((k) => ({ label: k.name, value: k.id })),
)
const toolOptions = computed<SelectOption[]>(() =>
  tools.value.map((t) => ({ label: t.label, value: t.id })),
)

async function save(): Promise<void> {
  if (!form.name.trim()) {
    message.warning('请输入 Agent 名称')
    return
  }
  if (form.model_id === null) {
    message.warning('请选择模型')
    return
  }
  const payload: AgentPayload = {
    name: form.name.trim(),
    description: form.description.trim(),
    opening_statement: form.opening_statement.trim(),
    system_prompt: form.system_prompt,
    model_id: form.model_id,
    temperature: form.temperature,
    knowledge_base_ids: form.knowledge_base_ids,
    tool_ids: form.tool_ids,
  }
  saving.value = true
  try {
    const saved = props.agent
      ? await agentApi.updateAgent(props.agent.id, payload)
      : await agentApi.createAgent(payload)
    message.success(`Agent「${saved.name}」已保存`)
    emit('saved', saved)
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
    :title="agent ? `编辑 Agent — ${agent.name}` : '新建 Agent'"
    style="width: 680px"
    @update:show="(v: boolean) => emit('update:show', v)"
  >
    <n-form-item label="名称" label-placement="top">
      <n-input v-model:value="form.name" maxlength="50" placeholder="如：产品问答助手" />
    </n-form-item>
    <n-form-item label="描述" label-placement="top">
      <n-input v-model:value="form.description" type="textarea" :rows="2" maxlength="200" placeholder="一句话说明用途（可留空）" />
    </n-form-item>
    <n-form-item label="开场白" label-placement="top">
      <n-input v-model:value="form.opening_statement" type="textarea" :rows="2" maxlength="200" placeholder="新会话开始时展示的欢迎语（可留空）" />
    </n-form-item>
    <n-form-item label="系统提示词" label-placement="top">
      <n-input v-model:value="form.system_prompt" type="textarea" :rows="7" placeholder="Agent 的角色设定与行为约束" />
    </n-form-item>
    <div class="param-row">
      <n-form-item label="模型" label-placement="top" class="param-item">
        <n-select v-model:value="form.model_id" :options="modelOptions" :loading="optionsLoading" filterable placeholder="必选" />
      </n-form-item>
      <n-form-item label="温度（temperature）" label-placement="top" class="param-item">
        <div class="temp-row">
          <n-slider v-model:value="form.temperature" :min="0" :max="1" :step="0.1" />
          <span class="temp-value">{{ form.temperature.toFixed(1) }}</span>
        </div>
      </n-form-item>
    </div>
    <n-form-item label="关联知识库（检索增强）" label-placement="top">
      <n-select
        v-model:value="form.knowledge_base_ids"
        multiple
        clearable
        :options="kbOptions"
        :loading="optionsLoading"
        placeholder="可多选；不选则纯对话"
      />
    </n-form-item>
    <n-form-item label="工具" label-placement="top">
      <n-select
        v-model:value="form.tool_ids"
        multiple
        clearable
        :options="toolOptions"
        :loading="optionsLoading"
        placeholder="Agent 循环中可调用的工具"
      />
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
.param-row {
  display: flex;
  gap: 16px;
}

.param-item {
  flex: 1;
}

.temp-row {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  padding: 0 2px;
}

.temp-value {
  font-size: 13px;
  color: #666;
  flex-shrink: 0;
  min-width: 22px;
  text-align: right;
}
</style>
