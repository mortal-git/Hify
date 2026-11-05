<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { NButton, NEmpty, NSpin, NTag, useMessage } from 'naive-ui'

import { knowledgeApi } from '@/api/knowledge'
import type { KbDetailDto, KbSummaryDto } from '@/api/knowledge'
import CreateKbWizard from '@/components/knowledge/CreateKbWizard.vue'

const router = useRouter()
const message = useMessage()

const bases = ref<KbSummaryDto[]>([])
const loading = ref(false)
const showCreate = ref(false)

async function load(): Promise<void> {
  loading.value = true
  try {
    bases.value = await knowledgeApi.listBases()
  } catch (e) {
    message.error(e instanceof Error ? e.message : '加载知识库失败')
  } finally {
    loading.value = false
  }
}

onMounted(load)

function open(kb: KbSummaryDto): void {
  router.push(`/knowledge/${kb.id}`)
}

function onCreated(kb: KbDetailDto): void {
  router.push(`/knowledge/${kb.id}`)
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString('zh-CN')
}
</script>

<template>
  <div class="kb-admin">
    <div class="page-head">
      <div>
        <div class="page-title">知识库</div>
        <div class="page-desc">上传文档自动分段、嵌入与混合检索，为 Agent 提供专属知识</div>
      </div>
      <n-button type="primary" @click="showCreate = true">新建知识库</n-button>
    </div>

    <n-spin :show="loading">
      <div v-if="bases.length > 0" class="kb-grid">
        <div v-for="kb in bases" :key="kb.id" class="kb-card" @click="open(kb)">
          <div class="kb-card-head">
            <n-tag size="small" :bordered="false" :type="kb.type === 'FAQ' ? 'info' : 'success'">
              {{ kb.type === 'FAQ' ? 'FAQ 库' : '文档库' }}
            </n-tag>
            <span class="kb-time">{{ fmtDate(kb.created_at) }}</span>
          </div>
          <div class="kb-name">{{ kb.name }}</div>
          <div class="kb-desc">{{ kb.description || '暂无简介' }}</div>
          <div class="kb-stats">
            <span>{{ kb.document_count }} 篇文档</span>
            <span>{{ kb.chunk_count.toLocaleString() }} 分块</span>
            <span>{{ kb.word_count.toLocaleString() }} 字</span>
          </div>
        </div>
      </div>
      <n-empty v-else-if="!loading" description="暂无知识库——点击右上角「新建知识库」开始" style="padding: 80px 0" />
    </n-spin>

    <CreateKbWizard v-model:show="showCreate" @created="onCreated" />
  </div>
</template>

<style scoped>
.kb-admin {
  max-width: 1200px;
  margin: 0 auto;
}

.page-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  margin-bottom: 20px;
}

.page-title {
  font-size: 18px;
  font-weight: 600;
}

.page-desc {
  font-size: 13px;
  color: #999;
  margin-top: 4px;
}

.kb-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: 12px;
}

.kb-card {
  background: #fff;
  border: 1px solid #e9ebef;
  border-radius: 10px;
  padding: 16px;
  cursor: pointer;
  transition: box-shadow 0.2s, transform 0.2s;
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-height: 150px;
}

.kb-card:hover {
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.08);
  transform: translateY(-2px);
}

.kb-card-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.kb-time {
  font-size: 12px;
  color: #bbb;
}

.kb-name {
  font-size: 16px;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.kb-desc {
  font-size: 13px;
  color: #666;
  line-height: 1.5;
  flex: 1;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.kb-stats {
  display: flex;
  gap: 14px;
  font-size: 12px;
  color: #999;
  padding-top: 8px;
  border-top: 1px solid #f0f0f0;
}
</style>
