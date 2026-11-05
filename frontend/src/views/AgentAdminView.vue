<script setup lang="ts">
import { h, onMounted, ref } from 'vue'
import { NButton, NDataTable, NEmpty, NPopconfirm, NSpin, NTabPane, NTabs, NTag, useMessage } from 'naive-ui'
import type { DataTableColumns } from 'naive-ui'

import { agentApi } from '@/api/agent'
import type { AgentDto, ToolDto } from '@/api/agent'
import AgentFormModal from '@/components/agent/AgentFormModal.vue'
import ApiKeyModal from '@/components/agent/ApiKeyModal.vue'
import ToolFormModal from '@/components/agent/ToolFormModal.vue'

const message = useMessage()

const agents = ref<AgentDto[]>([])
const tools = ref<ToolDto[]>([])
const loading = ref(false)

const showAgentForm = ref(false)
const editingAgent = ref<AgentDto | null>(null)
const showApiKey = ref(false)
const apiKeyAgent = ref<AgentDto | null>(null)
const showToolForm = ref(false)
const editingTool = ref<ToolDto | null>(null)

async function load(): Promise<void> {
  loading.value = true
  try {
    const [agentList, toolList] = await Promise.all([agentApi.listAgents(), agentApi.listTools()])
    agents.value = agentList
    tools.value = toolList
  } catch (e) {
    message.error(e instanceof Error ? e.message : '加载失败')
  } finally {
    loading.value = false
  }
}

onMounted(load)

function openCreate(): void {
  editingAgent.value = null
  showAgentForm.value = true
}

function openEdit(a: AgentDto): void {
  editingAgent.value = a
  showAgentForm.value = true
}

function onAgentSaved(saved: AgentDto): void {
  const i = agents.value.findIndex((a) => a.id === saved.id)
  if (i >= 0) agents.value[i] = saved
  else agents.value.push(saved)
}

async function deleteAgent(a: AgentDto): Promise<void> {
  try {
    await agentApi.deleteAgent(a.id)
    message.success(`Agent「${a.name}」已删除`)
    load()
  } catch (e) {
    message.error(e instanceof Error ? e.message : '删除失败')
  }
}

function onRotated(fresh: AgentDto): void {
  apiKeyAgent.value = fresh
  onAgentSaved(fresh)
}

function openToolCreate(): void {
  editingTool.value = null
  showToolForm.value = true
}

function openToolEdit(t: ToolDto): void {
  editingTool.value = t
  showToolForm.value = true
}

async function deleteTool(t: ToolDto): Promise<void> {
  try {
    await agentApi.deleteTool(t.id)
    message.success(`工具「${t.display_name}」已删除`)
    load()
  } catch (e) {
    message.error(e instanceof Error ? e.message : '删除失败')
  }
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString('zh-CN')
}

const toolColumns: DataTableColumns<ToolDto> = [
  {
    title: '名称',
    key: 'display_name',
    width: 180,
    render: (t) =>
      h('div', { class: 'tool-name-cell' }, [
        h('div', { class: 'tool-name' }, t.display_name),
        h('div', { class: 'tool-key' }, t.name),
      ]),
  },
  {
    title: '类型',
    key: 'type',
    width: 110,
    render: (t) =>
      h(
        NTag,
        { size: 'small', bordered: false, type: t.type === 'WEB_SEARCH' ? 'success' : 'info' },
        { default: () => (t.type === 'WEB_SEARCH' ? '内置 · 搜索' : 'HTTP') },
      ),
  },
  { title: '描述', key: 'description', ellipsis: { tooltip: true } },
  {
    title: '配置',
    key: 'config',
    width: 280,
    render: (t) =>
      t.http_config
        ? h('span', { class: 'tool-config', title: t.http_config.url }, `${t.http_config.method} ${t.http_config.url}`)
        : h('span', { class: 'tool-config-none' }, '—'),
  },
  {
    title: '操作',
    key: 'actions',
    width: 130,
    render: (t) =>
      t.builtin
        ? h('span', { class: 'tool-config-none' }, '内置工具')
        : h('div', { class: 'tool-actions' }, [
            h(NButton, { size: 'tiny', quaternary: true, onClick: () => openToolEdit(t) }, { default: () => '编辑' }),
            h(
              NPopconfirm,
              { onPositiveClick: () => deleteTool(t) },
              {
                trigger: () =>
                  h(NButton, { size: 'tiny', quaternary: true, type: 'error' }, { default: () => '删除' }),
                default: () => `删除工具「${t.display_name}」？已配置它的 Agent 将同步移除。`,
              },
            ),
          ]),
  },
]
</script>

<template>
  <div class="agent-admin">
    <n-tabs type="line" animated>
      <n-tab-pane name="agents" tab="Agent 列表">
        <div class="page-head">
          <div>
            <div class="page-title">Agent 列表</div>
            <div class="page-desc">配置式 Agent：提示词 + 模型 + 工具 + 知识库，不挂工具即为聊天助手</div>
          </div>
          <n-button type="primary" @click="openCreate">新建 Agent</n-button>
        </div>
        <n-spin :show="loading">
          <div v-if="agents.length > 0" class="agent-grid">
            <div v-for="a in agents" :key="a.id" class="agent-card">
              <div class="agent-head">
                <span class="agent-name">{{ a.name }}</span>
                <n-tag size="small" :bordered="false">{{ a.model_name }}</n-tag>
              </div>
              <div class="agent-desc">{{ a.description || '暂无描述' }}</div>
              <div class="agent-tags">
                <n-tag v-if="a.knowledge_base_ids.length > 0" size="tiny" type="success" :bordered="false">
                  知识库 × {{ a.knowledge_base_ids.length }}
                </n-tag>
                <n-tag v-if="a.tool_ids.length > 0" size="tiny" type="info" :bordered="false">
                  工具 × {{ a.tool_ids.length }}
                </n-tag>
                <n-tag size="tiny" :bordered="false">温度 {{ a.temperature.toFixed(1) }}</n-tag>
              </div>
              <div class="agent-foot">
                <span class="agent-time">更新于 {{ fmtDate(a.updated_at) }}</span>
                <div class="agent-actions">
                  <n-button size="tiny" quaternary @click="apiKeyAgent = a; showApiKey = true">API</n-button>
                  <n-button size="tiny" quaternary @click="openEdit(a)">编辑</n-button>
                  <n-popconfirm @positive-click="deleteAgent(a)">
                    <template #trigger>
                      <n-button size="tiny" quaternary type="error">删除</n-button>
                    </template>
                    删除 Agent「{{ a.name }}」？其会话也将一并删除。
                  </n-popconfirm>
                </div>
              </div>
            </div>
          </div>
          <n-empty v-else-if="!loading" description="暂无 Agent——点击右上角创建第一个" style="padding: 60px 0" />
        </n-spin>
      </n-tab-pane>

      <n-tab-pane name="tools" tab="工具箱">
        <div class="page-head">
          <div>
            <div class="page-title">工具箱</div>
            <div class="page-desc">内置 web 搜索 + 自定义 HTTP 工具，供 Agent 循环调用</div>
          </div>
          <n-button type="primary" @click="openToolCreate">新建工具</n-button>
        </div>
        <div class="page-card">
          <n-data-table
            :columns="toolColumns"
            :data="tools"
            :row-key="(t: ToolDto) => t.id"
            :bordered="false"
            size="small"
          />
        </div>
      </n-tab-pane>
    </n-tabs>

    <agent-form-modal v-model:show="showAgentForm" :agent="editingAgent" @saved="onAgentSaved" />
    <api-key-modal v-model:show="showApiKey" :agent="apiKeyAgent" @rotated="onRotated" />
    <tool-form-modal v-model:show="showToolForm" :tool="editingTool" @saved="load" />
  </div>
</template>

<style scoped>
.agent-admin {
  max-width: 1100px;
  margin: 0 auto;
}

.agent-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
  gap: 12px;
}

.agent-card {
  background: #fff;
  border-radius: 10px;
  border: 1px solid #e9ebef;
  padding: 14px 16px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  transition: box-shadow 0.2s;
}

.agent-card:hover {
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.06);
}

.agent-head {
  display: flex;
  align-items: center;
  gap: 8px;
}

.agent-name {
  font-size: 15px;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.agent-desc {
  font-size: 12px;
  color: #888;
  line-height: 1.6;
  min-height: 38px;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.agent-tags {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}

.agent-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 4px;
  padding-top: 8px;
  border-top: 1px dashed #f0f0f0;
}

.agent-time {
  font-size: 12px;
  color: #bbb;
}

.agent-actions {
  display: flex;
  gap: 2px;
}

.tool-name-cell {
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.tool-name {
  font-size: 13px;
  font-weight: 500;
}

.tool-key {
  font-size: 12px;
  color: #999;
}

.tool-config {
  font-size: 12px;
  color: #666;
  display: inline-block;
  max-width: 260px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  vertical-align: middle;
}

.tool-config-none {
  color: #ccc;
  font-size: 12px;
}

.tool-actions {
  display: flex;
  gap: 2px;
}
</style>
