<script setup lang="ts">
import { computed, h, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { NButton, NDataTable, NRadioButton, NRadioGroup, NSelect, NSpin, NTabPane, NTabs, NTag, useMessage } from 'naive-ui'
import type { DataTableColumns } from 'naive-ui'

import { usageApi } from '@/api/usage'
import type { FeedbackItemDto, UsageDayPoint, UsageLogDto } from '@/api/usage'
import type { FeedbackValue } from '@/api/conversation'

const router = useRouter()
const message = useMessage()

const summary = ref<Awaited<ReturnType<typeof usageApi.getSummary>> | null>(null)
const summaryLoading = ref(false)

const logs = ref<UsageLogDto[]>([])
const logsTotal = ref(0)
const logsPage = ref(1)
const logsLoading = ref(false)
const LOGS_PAGE_SIZE = 15
const agentFilter = ref<number | null>(null)
const successFilter = ref<boolean | null>(null)

const feedbacks = ref<FeedbackItemDto[]>([])
const feedbacksTotal = ref(0)
const feedbacksPage = ref(1)
const feedbacksLoading = ref(false)
const FEEDBACK_PAGE_SIZE = 10

type Metric = 'calls' | 'tokens' | 'cost'
const metric = ref<Metric>('calls')

const CHART_W = 720
const PLOT_H = 160

function metricValue(p: UsageDayPoint): number {
  return metric.value === 'calls' ? p.calls : metric.value === 'tokens' ? p.tokens : p.cost
}

const bars = computed(() => {
  const pts = summary.value?.by_day ?? []
  const values = pts.map(metricValue)
  const max = Math.max(...values, 1)
  const n = pts.length || 1
  const slot = CHART_W / n
  const barW = Math.min(32, slot * 0.55)
  return pts.map((p, i) => {
    const v = metricValue(p)
    const bh = (v / max) * PLOT_H
    return {
      x: i * slot + (slot - barW) / 2,
      y: 185 - bh,
      w: barW,
      h: Math.max(bh, v > 0 ? 2 : 0),
      label: p.date.slice(5),
      title: `${p.date}：${formatMetric(v)}`,
    }
  })
})

function formatMetric(v: number): string {
  return metric.value === 'cost' ? `¥${v.toFixed(2)}` : v.toLocaleString()
}

const statCards = computed(() => {
  const s = summary.value
  return [
    { label: '总调用', value: s ? s.total_calls.toLocaleString() : '—', sub: s ? `成功率 ${(s.success_rate * 100).toFixed(1)}%` : '' },
    {
      label: 'Token 消耗',
      value: s ? (s.total_input_tokens + s.total_output_tokens).toLocaleString() : '—',
      sub: s ? `输入 ${(s.total_input_tokens / 1000).toFixed(1)}k · 输出 ${(s.total_output_tokens / 1000).toFixed(1)}k` : '',
    },
    { label: '总费用', value: s ? `¥${s.total_cost.toFixed(2)}` : '—', sub: '按模型计价汇总' },
    { label: '日均调用', value: s && s.by_day.length > 0 ? (s.total_calls / s.by_day.length).toFixed(1) : '—', sub: '最近 14 天' },
  ]
})

async function loadSummary(): Promise<void> {
  summaryLoading.value = true
  try {
    summary.value = await usageApi.getSummary(14)
  } catch (e) {
    message.error(e instanceof Error ? e.message : '统计加载失败')
  } finally {
    summaryLoading.value = false
  }
}

async function loadLogs(): Promise<void> {
  logsLoading.value = true
  try {
    const page = await usageApi.listLogs({
      page: logsPage.value,
      page_size: LOGS_PAGE_SIZE,
      agent_id: agentFilter.value ?? undefined,
      success: successFilter.value ?? undefined,
    })
    logs.value = page.items
    logsTotal.value = page.total
  } catch (e) {
    message.error(e instanceof Error ? e.message : '日志加载失败')
  } finally {
    logsLoading.value = false
  }
}

async function loadFeedbacks(): Promise<void> {
  feedbacksLoading.value = true
  try {
    const page = await usageApi.listFeedbacks({ page: feedbacksPage.value, page_size: FEEDBACK_PAGE_SIZE })
    feedbacks.value = page.items
    feedbacksTotal.value = page.total
  } catch (e) {
    message.error(e instanceof Error ? e.message : '反馈加载失败')
  } finally {
    feedbacksLoading.value = false
  }
}

onMounted(() => {
  loadSummary()
  loadLogs()
  loadFeedbacks()
})

const agentOptions = computed(() =>
  (summary.value?.by_agent ?? []).map((a) => ({ label: a.agent_name, value: a.agent_id })),
)

const RESULT_OPTIONS = [
  { label: '全部结果', value: 'all' },
  { label: '仅成功', value: 'ok' },
  { label: '仅失败', value: 'fail' },
]

function onFilterChange(): void {
  logsPage.value = 1
  loadLogs()
}

function onResultChange(v: string | number): void {
  successFilter.value = v === 'ok' ? true : v === 'fail' ? false : null
  onFilterChange()
}

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleString('zh-CN', { hour12: false })
}

const logsColumns: DataTableColumns<UsageLogDto> = [
  { title: '时间', key: 'created_at', width: 150, render: (r) => fmtTime(r.created_at) },
  { title: '用户', key: 'user_name', width: 90 },
  { title: 'Agent', key: 'agent_name', width: 110, ellipsis: { tooltip: true } },
  { title: '模型', key: 'model_name', width: 110, ellipsis: { tooltip: true } },
  { title: '输入', key: 'input_tokens', width: 70, render: (r) => r.input_tokens.toLocaleString() },
  { title: '输出', key: 'output_tokens', width: 70, render: (r) => r.output_tokens.toLocaleString() },
  { title: '费用', key: 'cost', width: 80, render: (r) => `¥${r.cost.toFixed(4)}` },
  { title: '耗时', key: 'elapsed_ms', width: 76, render: (r) => `${(r.elapsed_ms / 1000).toFixed(1)}s` },
  {
    title: '状态',
    key: 'success',
    width: 90,
    render: (r) =>
      r.success
        ? h(NTag, { size: 'small', bordered: false, type: 'success' }, { default: () => '成功' })
        : h(
            NTag,
            { size: 'small', bordered: false, type: 'error', title: r.error_message ?? '' },
            { default: () => '失败' },
          ),
  },
]

const feedbackColumns: DataTableColumns<FeedbackItemDto> = [
  {
    title: '反馈',
    key: 'feedback',
    width: 76,
    render: (r) =>
      h(
        NTag,
        { size: 'small', bordered: false, type: r.feedback === 'LIKE' ? 'success' : 'error' },
        { default: () => (r.feedback === 'LIKE' ? '👍 有用' : '👎 无用') },
      ),
  },
  { title: '内容摘录', key: 'content_snippet', ellipsis: { tooltip: true } },
  { title: 'Agent', key: 'agent_name', width: 120, ellipsis: { tooltip: true } },
  { title: '用户', key: 'user_name', width: 90 },
  { title: '时间', key: 'created_at', width: 150, render: (r) => fmtTime(r.created_at) },
  {
    title: '操作',
    key: 'actions',
    width: 90,
    render: (r) =>
      h(
        NButton,
        { size: 'tiny', quaternary: true, type: 'primary', onClick: () => router.push({ path: '/chat', query: { session: String(r.session_id) } }) },
        { default: () => '查看会话' },
      ),
  },
]

const FEEDBACK_LABEL: Record<FeedbackValue, string> = { LIKE: '👍', DISLIKE: '👎' }
</script>

<template>
  <div class="usage-admin">
    <n-tabs type="line" animated>
      <n-tab-pane name="overview" tab="总览">
        <div class="stat-row">
          <div v-for="c in statCards" :key="c.label" class="page-card">
            <div class="stat-value">{{ c.value }}</div>
            <div class="stat-label">{{ c.label }}</div>
            <div class="stat-sub">{{ c.sub }}</div>
          </div>
        </div>

        <n-spin :show="summaryLoading">
          <div class="page-card chart-card">
            <div class="chart-head">
              <span class="section-title">最近 14 天趋势</span>
              <n-radio-group
                :value="metric"
                size="small"
                @update:value="(v: string | number) => (metric = v as Metric)"
              >
                <n-radio-button value="calls">调用次数</n-radio-button>
                <n-radio-button value="tokens">Token</n-radio-button>
                <n-radio-button value="cost">费用</n-radio-button>
              </n-radio-group>
            </div>
            <svg :viewBox="`0 0 ${CHART_W} 215`" class="chart-svg" preserveAspectRatio="xMidYMid meet">
              <line x1="0" y1="185.5" x2="720" y2="185.5" stroke="#e5e7eb" />
              <line x1="0" y1="105.5" x2="720" y2="105.5" stroke="#f0f1f3" stroke-dasharray="4 4" />
              <line x1="0" y1="25.5" x2="720" y2="25.5" stroke="#f0f1f3" stroke-dasharray="4 4" />
              <g v-for="b in bars" :key="b.label">
                <rect :x="b.x" :y="b.y" :width="b.w" :height="b.h" rx="2" fill="#07c05f" class="bar">
                  <title>{{ b.title }}</title>
                </rect>
                <text v-if="bars.length <= 14" :x="b.x + b.w / 2" y="205" text-anchor="middle" class="bar-label">
                  {{ b.label }}
                </text>
              </g>
            </svg>
          </div>

          <div class="breakdown-row">
            <div class="page-card">
              <div class="section-title">按 Agent</div>
              <table class="mini-table">
                <thead>
                  <tr><th>Agent</th><th>调用</th><th>Token</th><th>费用</th></tr>
                </thead>
                <tbody>
                  <tr v-for="a in summary?.by_agent ?? []" :key="a.agent_id">
                    <td class="ellipsis">{{ a.agent_name }}</td>
                    <td>{{ a.calls }}</td>
                    <td>{{ a.tokens.toLocaleString() }}</td>
                    <td>¥{{ a.cost.toFixed(2) }}</td>
                  </tr>
                  <tr v-if="!summary?.by_agent.length"><td colspan="4" class="empty-cell">暂无数据</td></tr>
                </tbody>
              </table>
            </div>
            <div class="page-card">
              <div class="section-title">按模型</div>
              <table class="mini-table">
                <thead>
                  <tr><th>模型</th><th>调用</th><th>Token</th><th>费用</th></tr>
                </thead>
                <tbody>
                  <tr v-for="m in summary?.by_model ?? []" :key="m.model_name">
                    <td class="ellipsis">{{ m.model_name }}</td>
                    <td>{{ m.calls }}</td>
                    <td>{{ m.tokens.toLocaleString() }}</td>
                    <td>¥{{ m.cost.toFixed(2) }}</td>
                  </tr>
                  <tr v-if="!summary?.by_model.length"><td colspan="4" class="empty-cell">暂无数据</td></tr>
                </tbody>
              </table>
            </div>
          </div>
        </n-spin>
      </n-tab-pane>

      <n-tab-pane name="logs" tab="调用日志">
        <div class="page-card">
          <div class="filter-bar">
            <n-select
              :value="agentFilter"
              clearable
              size="small"
              :options="agentOptions"
              placeholder="全部 Agent"
              style="width: 200px"
              @update:value="(v: string | number | null) => { agentFilter = v == null ? null : Number(v); onFilterChange() }"
            />
            <n-radio-group
              :value="successFilter == null ? 'all' : successFilter ? 'ok' : 'fail'"
              size="small"
              @update:value="onResultChange"
            >
              <n-radio-button v-for="o in RESULT_OPTIONS" :key="o.value" :value="o.value">{{ o.label }}</n-radio-button>
            </n-radio-group>
          </div>
          <n-data-table
            remote
            size="small"
            :columns="logsColumns"
            :data="logs"
            :loading="logsLoading"
            :row-key="(r: UsageLogDto) => r.id"
            :pagination="{
              page: logsPage,
              pageSize: LOGS_PAGE_SIZE,
              itemCount: logsTotal,
              pageSlot: 7,
              onChange: (p: number) => { logsPage = p; loadLogs() },
            }"
          />
        </div>
      </n-tab-pane>

      <n-tab-pane name="feedback" tab="反馈">
        <div class="page-card">
          <div class="feedback-hint">
            会话中用户对回复的 👍/👎 反馈（{{ FEEDBACK_LABEL.LIKE }} 有用 / {{ FEEDBACK_LABEL.DISLIKE }} 无用），用于定位低质量回复。
          </div>
          <n-data-table
            remote
            size="small"
            :columns="feedbackColumns"
            :data="feedbacks"
            :loading="feedbacksLoading"
            :row-key="(r: FeedbackItemDto) => r.message_id"
            :pagination="{
              page: feedbacksPage,
              pageSize: FEEDBACK_PAGE_SIZE,
              itemCount: feedbacksTotal,
              pageSlot: 7,
              onChange: (p: number) => { feedbacksPage = p; loadFeedbacks() },
            }"
          />
        </div>
      </n-tab-pane>
    </n-tabs>
  </div>
</template>

<style scoped>
.usage-admin {
  max-width: 1100px;
  margin: 0 auto;
}

.stat-row {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 12px;
  margin-bottom: 14px;
}

.stat-value {
  font-size: 24px;
  font-weight: 700;
  color: #07c05f;
}

.stat-label {
  font-size: 13px;
  color: #666;
  margin-top: 2px;
}

.stat-sub {
  font-size: 12px;
  color: #aaa;
  margin-top: 4px;
}

.chart-card {
  margin-bottom: 14px;
}

.chart-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}

.section-title {
  font-size: 14px;
  font-weight: 600;
}

.chart-svg {
  width: 100%;
  height: auto;
  display: block;
}

.bar {
  cursor: pointer;
}

.bar:hover {
  fill: #08dd6e;
}

.bar-label {
  font-size: 10px;
  fill: #999;
}

.breakdown-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}

.mini-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
  margin-top: 8px;
}

.mini-table th {
  text-align: left;
  font-weight: 500;
  color: #999;
  padding: 6px 4px;
  border-bottom: 1px solid #f0f0f0;
}

.mini-table td {
  padding: 7px 4px;
  border-bottom: 1px solid #f7f7f7;
}

.mini-table td:not(:first-child) {
  text-align: right;
  color: #555;
  white-space: nowrap;
}

.ellipsis {
  max-width: 140px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.empty-cell {
  text-align: center !important;
  color: #bbb !important;
  padding: 18px 0 !important;
}

.filter-bar {
  display: flex;
  align-items: center;
  gap: 14px;
  margin-bottom: 12px;
}

.feedback-hint {
  font-size: 13px;
  color: #999;
  margin-bottom: 12px;
}
</style>
