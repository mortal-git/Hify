<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { NCard, NEmpty, NSpin, NTag, useMessage } from 'naive-ui'

import { knowledgeApi } from '@/api/knowledge'
import type { GraphDataDto, GraphEdgeDto, GraphNodeDto } from '@/api/knowledge'

const props = defineProps<{ kb: { id: number; config: { graph_enabled: boolean } } }>()

const message = useMessage()

const W = 860
const H = 580

const TYPE_COLORS = ['#07C05F', '#0052D9', '#D54941', '#E37318', '#7B61FF', '#00A870', '#9254DE', '#E8722C']

const loading = ref(false)
const graph = ref<GraphDataDto | null>(null)
const selectedId = ref<number | null>(null)

const nodeMap = computed(() => new Map((graph.value?.nodes ?? []).map((n) => [n.id, n])))
const types = computed(() => Array.from(new Set((graph.value?.nodes ?? []).map((n) => n.type))))

function typeColor(type: string): string {
  return TYPE_COLORS[types.value.indexOf(type) % TYPE_COLORS.length]
}

// 确定性力导向布局：固定初始位置 + 固定迭代次数，同数据同布局
const positions = computed<Record<number, { x: number; y: number }>>(() => {
  const nodes = graph.value?.nodes ?? []
  const edges = graph.value?.edges ?? []
  const map: Record<number, { x: number; y: number }> = {}
  if (nodes.length === 0) return map

  const pts = nodes.map((n, i) => {
    const angle = (i / nodes.length) * Math.PI * 2
    const r = W * 0.28 * (0.55 + 0.45 * ((i * 7) % 10) / 10)
    return { id: n.id, x: W / 2 + Math.cos(angle) * r, y: H / 2 + Math.sin(angle) * r * 0.72, vx: 0, vy: 0 }
  })
  const idx = new Map(pts.map((p) => [p.id, p]))
  const springs = edges
    .map((e) => ({ s: idx.get(e.source), t: idx.get(e.target) }))
    .filter((p): p is { s: (typeof pts)[number]; t: (typeof pts)[number] } => p.s != null && p.t != null)

  for (let iter = 0; iter < 160; iter++) {
    for (let i = 0; i < pts.length; i++) {
      for (let j = i + 1; j < pts.length; j++) {
        const a = pts[i]
        const b = pts[j]
        let dx = a.x - b.x
        let dy = a.y - b.y
        let d2 = dx * dx + dy * dy
        if (d2 < 1) {
          dx = i - j || 1
          dy = 1
          d2 = dx * dx + dy * dy
        }
        const d = Math.sqrt(d2)
        const f = 2600 / d2
        const fx = (dx / d) * f
        const fy = (dy / d) * f
        a.vx += fx
        a.vy += fy
        b.vx -= fx
        b.vy -= fy
      }
    }
    for (const e of springs) {
      const dx = e.t.x - e.s.x
      const dy = e.t.y - e.s.y
      const d = Math.max(Math.sqrt(dx * dx + dy * dy), 1)
      const f = (d - 130) * 0.05
      const fx = (dx / d) * f
      const fy = (dy / d) * f
      e.s.vx += fx
      e.s.vy += fy
      e.t.vx -= fx
      e.t.vy -= fy
    }
    for (const p of pts) {
      p.vx += (W / 2 - p.x) * 0.004
      p.vy += (H / 2 - p.y) * 0.004
      p.vx = Math.max(-9, Math.min(9, p.vx))
      p.vy = Math.max(-9, Math.min(9, p.vy))
      p.x = Math.max(44, Math.min(W - 44, p.x + p.vx))
      p.y = Math.max(44, Math.min(H - 44, p.y + p.vy))
      p.vx *= 0.85
      p.vy *= 0.85
    }
  }
  for (const p of pts) map[p.id] = { x: p.x, y: p.y }
  return map
})

const neighborIds = computed<Set<number>>(() => {
  const s = new Set<number>()
  if (selectedId.value == null || !graph.value) return s
  for (const e of graph.value.edges) {
    if (e.source === selectedId.value) s.add(e.target)
    if (e.target === selectedId.value) s.add(e.source)
  }
  return s
})

const selectedNode = computed<GraphNodeDto | null>(() =>
  selectedId.value == null ? null : nodeMap.value.get(selectedId.value) ?? null,
)

interface EdgeView {
  edge: GraphEdgeDto
  other: GraphNodeDto
  outgoing: boolean
}

const selectedEdges = computed<EdgeView[]>(() => {
  if (selectedNode.value == null || !graph.value) return []
  const out: EdgeView[] = []
  for (const e of graph.value.edges) {
    if (e.source === selectedNode.value.id) {
      const other = nodeMap.value.get(e.target)
      if (other) out.push({ edge: e, other, outgoing: true })
    } else if (e.target === selectedNode.value.id) {
      const other = nodeMap.value.get(e.source)
      if (other) out.push({ edge: e, other, outgoing: false })
    }
  }
  return out.sort((a, b) => b.edge.weight - a.edge.weight)
})

function radius(n: GraphNodeDto): number {
  return 12 + Math.sqrt(n.weight) * 3.5
}

function shortName(name: string): string {
  return name.length > 8 ? `${name.slice(0, 8)}…` : name
}

function nodeOpacity(id: number): number {
  if (selectedId.value == null || id === selectedId.value) return 1
  return neighborIds.value.has(id) ? 1 : 0.25
}

function edgeOpacity(e: GraphEdgeDto): number {
  if (selectedId.value == null) return 1
  return e.source === selectedId.value || e.target === selectedId.value ? 1 : 0.12
}

function selectNode(id: number): void {
  selectedId.value = selectedId.value === id ? null : id
}

async function load(): Promise<void> {
  loading.value = true
  try {
    graph.value = await knowledgeApi.getGraph(props.kb.id)
    selectedId.value = null
  } catch (e) {
    message.error(e instanceof Error ? e.message : '加载图谱失败')
  } finally {
    loading.value = false
  }
}

watch(
  () => props.kb.id,
  () => load(),
  { immediate: true },
)
</script>

<template>
  <div class="graph-tab">
    <n-card size="small" class="graph-main">
      <template #header>知识图谱</template>
      <template #header-extra>
        <div class="legend">
          <span v-for="t in types" :key="t" class="legend-item">
            <span class="legend-dot" :style="{ background: typeColor(t) }"></span>{{ t }}
          </span>
        </div>
      </template>
      <n-spin :show="loading">
        <svg
          v-if="graph && graph.nodes.length > 0"
          :viewBox="`0 0 ${W} ${H}`"
          class="graph-svg"
          @click="selectedId = null"
        >
          <g v-for="e in graph.edges" :key="e.id" :opacity="edgeOpacity(e)">
            <line
              :x1="positions[e.source]?.x ?? 0"
              :y1="positions[e.source]?.y ?? 0"
              :x2="positions[e.target]?.x ?? 0"
              :y2="positions[e.target]?.y ?? 0"
              :stroke="e.source === selectedId || e.target === selectedId ? '#07C05F' : '#c9cdd4'"
              :stroke-width="1 + e.weight * 0.4"
            />
            <title>{{ nodeMap.get(e.source)?.name }} —{{ e.relation }}→ {{ nodeMap.get(e.target)?.name }}</title>
          </g>
          <g
            v-for="n in graph.nodes"
            :key="n.id"
            class="graph-node"
            :opacity="nodeOpacity(n.id)"
            @click.stop="selectNode(n.id)"
          >
            <circle
              :cx="positions[n.id]?.x ?? 0"
              :cy="positions[n.id]?.y ?? 0"
              :r="radius(n)"
              :fill="typeColor(n.type)"
              :stroke="n.id === selectedId ? '#333' : 'none'"
              :stroke-width="2"
            />
            <text
              :x="positions[n.id]?.x ?? 0"
              :y="(positions[n.id]?.y ?? 0) + radius(n) + 15"
              text-anchor="middle"
              class="node-label"
            >{{ shortName(n.name) }}</text>
            <title>{{ n.name }}（{{ n.type }} · 权重 {{ n.weight }}）</title>
          </g>
        </svg>
        <n-empty
          v-else-if="!loading"
          description="暂无图谱数据——在设置中开启图谱抽取，待文档处理完成后生成"
          style="padding: 80px 0"
        />
      </n-spin>
    </n-card>

    <n-card v-if="selectedNode" size="small" class="graph-detail" :title="selectedNode.name">
      <template #header-extra>
        <n-tag size="small" :bordered="false" :color="{ color: '#f4f4f5', textColor: typeColor(selectedNode.type) }">
          {{ selectedNode.type }}
        </n-tag>
      </template>
      <div class="detail-row">节点度数（权重）：{{ selectedNode.weight }}</div>
      <div class="detail-title">关联关系（{{ selectedEdges.length }}）</div>
      <div
        v-for="ev in selectedEdges"
        :key="ev.edge.id"
        class="edge-row"
        @click="selectNode(ev.other.id)"
      >
        <span class="edge-dir">{{ ev.outgoing ? '→' : '←' }}</span>
        <span class="edge-relation">{{ ev.edge.relation }}</span>
        <span class="edge-node">{{ ev.other.name }}</span>
        <span class="edge-weight">{{ ev.edge.weight }}</span>
      </div>
    </n-card>
  </div>
</template>

<style scoped>
.graph-tab {
  display: flex;
  gap: 12px;
  align-items: flex-start;
}

.graph-main {
  flex: 1;
  min-width: 0;
}

.graph-svg {
  width: 100%;
  height: auto;
  display: block;
  background: #fafbfa;
  border-radius: 4px;
  cursor: default;
}

.graph-node {
  cursor: pointer;
}

.node-label {
  font-size: 12px;
  fill: #333;
  pointer-events: none;
}

.legend {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
}

.legend-item {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 12px;
  color: #666;
}

.legend-dot {
  width: 9px;
  height: 9px;
  border-radius: 50%;
}

.graph-detail {
  width: 280px;
  flex-shrink: 0;
}

.detail-row {
  font-size: 13px;
  color: #666;
  margin-bottom: 14px;
}

.detail-title {
  font-size: 13px;
  font-weight: 600;
  margin-bottom: 8px;
}

.edge-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 5px 8px;
  border-radius: 4px;
  font-size: 13px;
  cursor: pointer;
}

.edge-row:hover {
  background: #f4f9f5;
}

.edge-dir {
  color: #999;
}

.edge-relation {
  color: #07c05f;
  flex-shrink: 0;
}

.edge-node {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.edge-weight {
  color: #999;
  font-size: 12px;
}
</style>
