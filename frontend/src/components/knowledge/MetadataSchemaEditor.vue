<script setup lang="ts">
import { NButton, NInput, NSelect } from 'naive-ui'
import type { SelectOption } from 'naive-ui'

import type { MetadataFieldDef } from '@/api/knowledge'

const props = defineProps<{ fields: MetadataFieldDef[] }>()
const emit = defineEmits<{ (e: 'update:fields', value: MetadataFieldDef[]): void }>()

const typeOptions: SelectOption[] = [
  { label: '文本', value: 'STRING' },
  { label: '数字', value: 'NUMBER' },
  { label: '日期', value: 'DATE' },
  { label: '枚举', value: 'ENUM' },
]

const FIELD_TYPES = ['STRING', 'NUMBER', 'DATE', 'ENUM'] as const

function update(idx: number, patch: Partial<MetadataFieldDef>): void {
  emit('update:fields', props.fields.map((f, i) => (i === idx ? { ...f, ...patch } : f)))
}

function onTypeChange(idx: number, v: string | number): void {
  const type = FIELD_TYPES.find((t) => t === String(v)) ?? 'STRING'
  update(idx, { type, options: type === 'ENUM' ? (props.fields[idx]?.options ?? []) : undefined })
}

function onOptionsChange(idx: number, v: string): void {
  update(idx, { options: v.split(',').map((s) => s.trim()).filter(Boolean) })
}

function add(): void {
  emit('update:fields', [...props.fields, { key: '', label: '', type: 'STRING' }])
}

function remove(idx: number): void {
  emit('update:fields', props.fields.filter((_, i) => i !== idx))
}
</script>

<template>
  <div class="schema-editor">
    <div v-if="fields.length === 0" class="empty">暂无元数据字段——定义后文档可携带结构化信息，检索时可按字段过滤</div>
    <div v-for="(f, idx) in fields" :key="idx" class="field-row">
      <n-input
        size="small"
        :value="f.key"
        placeholder="字段名（英文）"
        class="col-key"
        @update:value="(v: string) => update(idx, { key: v })"
      />
      <n-input
        size="small"
        :value="f.label"
        placeholder="显示名"
        class="col-label"
        @update:value="(v: string) => update(idx, { label: v })"
      />
      <n-select
        size="small"
        :value="f.type"
        :options="typeOptions"
        class="col-type"
        @update:value="(v: string | number) => onTypeChange(idx, v)"
      />
      <n-input
        v-if="f.type === 'ENUM'"
        size="small"
        :value="(f.options ?? []).join(',')"
        placeholder="枚举值，逗号分隔"
        class="col-options"
        @update:value="(v: string) => onOptionsChange(idx, v)"
      />
      <n-button size="small" quaternary type="error" @click="remove(idx)">删除</n-button>
    </div>
    <n-button size="small" dashed block @click="add">添加字段</n-button>
  </div>
</template>

<style scoped>
.schema-editor {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.empty {
  font-size: 13px;
  color: #999;
  padding: 4px 0;
}

.field-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.col-key {
  width: 180px;
}

.col-label {
  width: 140px;
}

.col-type {
  width: 110px;
}

.col-options {
  flex: 1;
}
</style>
