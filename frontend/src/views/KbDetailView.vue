<script setup lang="ts">
import { ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { NButton, NEmpty, NSpin, NTabPane, NTabs, NTag, useMessage } from 'naive-ui'

import { knowledgeApi } from '@/api/knowledge'
import type { KbDetailDto } from '@/api/knowledge'
import DocumentsTab from '@/components/knowledge/DocumentsTab.vue'
import GraphTab from '@/components/knowledge/GraphTab.vue'
import RecallTestTab from '@/components/knowledge/RecallTestTab.vue'
import SettingsTab from '@/components/knowledge/SettingsTab.vue'
import WikiTab from '@/components/knowledge/WikiTab.vue'

const route = useRoute()
const router = useRouter()
const message = useMessage()

const kb = ref<KbDetailDto | null>(null)
const loading = ref(false)

async function load(): Promise<void> {
  const id = Number(route.params.id)
  if (!Number.isFinite(id)) return
  loading.value = true
  try {
    kb.value = await knowledgeApi.getBase(id)
  } catch (e) {
    message.error(e instanceof Error ? e.message : '加载知识库失败')
  } finally {
    loading.value = false
  }
}

watch(
  () => route.params.id,
  () => {
    if (route.path.startsWith('/knowledge/')) load()
  },
  { immediate: true },
)

function onUpdated(fresh: KbDetailDto): void {
  kb.value = fresh
}

function onDeleted(): void {
  router.push('/knowledge')
}
</script>

<template>
  <div class="kb-detail">
    <n-spin :show="loading && !kb">
      <template v-if="kb">
        <div class="detail-head">
          <n-button size="small" quaternary @click="router.push('/knowledge')">← 返回</n-button>
          <div class="head-main">
            <div class="head-title">
              <span class="kb-name">{{ kb.name }}</span>
              <n-tag size="small" :bordered="false" :type="kb.type === 'FAQ' ? 'info' : 'success'">
                {{ kb.type === 'FAQ' ? 'FAQ 库' : '文档库' }}
              </n-tag>
            </div>
            <div class="head-desc">{{ kb.description || '暂无简介' }}</div>
          </div>
          <div class="head-stats">
            <span>{{ kb.document_count }} 篇文档</span>
            <span>{{ kb.chunk_count.toLocaleString() }} 分块</span>
            <span>{{ kb.word_count.toLocaleString() }} 字</span>
          </div>
        </div>

        <n-tabs type="line" animated>
          <n-tab-pane name="docs" tab="文档">
            <DocumentsTab :kb="kb" @changed="load" />
          </n-tab-pane>
          <n-tab-pane name="recall" tab="召回测试">
            <RecallTestTab :kb="kb" />
          </n-tab-pane>
          <n-tab-pane name="wiki" tab="Wiki">
            <WikiTab v-if="kb.config.wiki_enabled" :kb="kb" />
            <n-empty
              v-else
              description="未启用 Wiki——在「设置」中开启后，文档入库时自动生成为互链页面"
              style="padding: 60px 0"
            />
          </n-tab-pane>
          <n-tab-pane name="graph" tab="图谱">
            <GraphTab v-if="kb.config.graph_enabled" :kb="kb" />
            <n-empty
              v-else
              description="未启用知识图谱——在「设置」中开启后，入库时自动抽取实体与关系"
              style="padding: 60px 0"
            />
          </n-tab-pane>
          <n-tab-pane name="settings" tab="设置">
            <SettingsTab :kb="kb" @updated="onUpdated" @deleted="onDeleted" />
          </n-tab-pane>
        </n-tabs>
      </template>
      <n-empty v-else-if="!loading" description="知识库不存在" style="padding: 80px 0" />
    </n-spin>
  </div>
</template>

<style scoped>
.kb-detail {
  max-width: 1200px;
  margin: 0 auto;
}

.detail-head {
  display: flex;
  align-items: center;
  gap: 14px;
  margin-bottom: 16px;
}

.head-main {
  flex: 1;
  min-width: 0;
}

.head-title {
  display: flex;
  align-items: center;
  gap: 8px;
}

.kb-name {
  font-size: 18px;
  font-weight: 600;
}

.head-desc {
  font-size: 13px;
  color: #999;
  margin-top: 3px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.head-stats {
  display: flex;
  gap: 14px;
  font-size: 12px;
  color: #999;
  flex-shrink: 0;
}
</style>
