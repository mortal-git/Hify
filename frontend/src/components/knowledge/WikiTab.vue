<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import {
  NButton,
  NCard,
  NDrawer,
  NDrawerContent,
  NEmpty,
  NInput,
  NModal,
  NSpace,
  NSpin,
  NTag,
  NTree,
  useMessage,
} from 'naive-ui'
import type { TreeOption } from 'naive-ui'

import { knowledgeApi } from '@/api/knowledge'
import type { WikiEditSource, WikiPageDto, WikiTreeNodeDto, WikiVersionDto } from '@/api/knowledge'
import { renderMarkdown } from '@/utils/markdown'

const props = defineProps<{ kb: { id: number; config: { wiki_enabled: boolean } } }>()

const message = useMessage()

const loading = ref(false)
const tree = ref<WikiTreeNodeDto[]>([])
const slugPageIds = ref<Record<string, number>>({})
const page = ref<WikiPageDto | null>(null)
const pageLoading = ref(false)

const showEdit = ref(false)
const editContent = ref('')
const saving = ref(false)

const showVersions = ref(false)
const versions = ref<WikiVersionDto[]>([])
const versionsLoading = ref(false)

const EDIT_SOURCE_LABEL: Record<WikiEditSource, string> = {
  PIPELINE: '自动生成',
  AGENT: '智能体',
  USER: '人工',
  REVERT: '回滚',
}

function toTreeOptions(nodes: WikiTreeNodeDto[]): TreeOption[] {
  return nodes.map((n) => ({
    key: n.slug,
    label: n.title,
    children: n.children.length > 0 ? toTreeOptions(n.children) : undefined,
  }))
}

function collectIds(nodes: WikiTreeNodeDto[], map: Record<string, number>): void {
  for (const n of nodes) {
    map[n.slug] = n.page_id
    collectIds(n.children, map)
  }
}

function firstPageId(nodes: WikiTreeNodeDto[]): number | null {
  return nodes.length > 0 ? nodes[0].page_id : null
}

const treeOptions = computed(() => toTreeOptions(tree.value))
const selectedKeys = computed(() => (page.value ? [page.value.slug] : []))

const slugTitles = computed<Record<string, string>>(() => {
  const map: Record<string, string> = {}
  const walk = (nodes: WikiTreeNodeDto[]): void => {
    for (const n of nodes) {
      map[n.slug] = n.title
      walk(n.children)
    }
  }
  walk(tree.value)
  return map
})

async function loadTree(): Promise<void> {
  loading.value = true
  try {
    tree.value = await knowledgeApi.getWikiTree(props.kb.id)
    const map: Record<string, number> = {}
    collectIds(tree.value, map)
    slugPageIds.value = map
    if (page.value == null || map[page.value.slug] == null) {
      const first = firstPageId(tree.value)
      if (first != null) await selectPage(first)
    }
  } catch (e) {
    message.error(e instanceof Error ? e.message : '加载 Wiki 目录失败')
  } finally {
    loading.value = false
  }
}

async function selectPage(pageId: number): Promise<void> {
  pageLoading.value = true
  try {
    page.value = await knowledgeApi.getWikiPage(pageId)
  } catch (e) {
    message.error(e instanceof Error ? e.message : '加载页面失败')
  } finally {
    pageLoading.value = false
  }
}

function onTreeSelect(keys: (string | number)[]): void {
  if (keys.length === 0) return
  selectBySlug(String(keys[0]))
}

function selectBySlug(slug: string): void {
  const id = slugPageIds.value[slug]
  if (id == null) {
    message.warning(`页面「${slug}」不存在`)
    return
  }
  if (id !== page.value?.id) selectPage(id)
}

watch(
  () => props.kb.id,
  () => {
    page.value = null
    loadTree()
  },
  { immediate: true },
)

function openEdit(): void {
  if (!page.value) return
  editContent.value = page.value.content_md
  showEdit.value = true
}

async function saveEdit(): Promise<void> {
  const current = page.value
  if (!current || !editContent.value.trim()) {
    message.warning('内容不能为空')
    return
  }
  saving.value = true
  try {
    const fresh = await knowledgeApi.updateWikiPage(current.id, { content_md: editContent.value })
    page.value = fresh
    message.success('已保存')
    showEdit.value = false
  } catch (e) {
    message.error(e instanceof Error ? e.message : '保存失败')
  } finally {
    saving.value = false
  }
}

async function openVersions(): Promise<void> {
  if (!page.value) return
  showVersions.value = true
  versionsLoading.value = true
  try {
    versions.value = await knowledgeApi.listWikiVersions(page.value.id)
  } catch (e) {
    message.error(e instanceof Error ? e.message : '加载版本失败')
  } finally {
    versionsLoading.value = false
  }
}

async function revert(v: WikiVersionDto): Promise<void> {
  const current = page.value
  if (!current) return
  try {
    const fresh = await knowledgeApi.revertWikiPage(current.id, v.id)
    page.value = fresh
    message.success(`已回滚到 v${v.version}`)
    showVersions.value = false
  } catch (e) {
    message.error(e instanceof Error ? e.message : '回滚失败')
  }
}

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleString('zh-CN', { hour12: false })
}

const rendered = computed(() =>
  page.value ? renderMarkdown(page.value.content_md, { linkTitles: slugTitles.value }) : '',
)

function onBodyClick(e: MouseEvent): void {
  const target = e.target as HTMLElement
  const link = target.closest('a[data-slug]')
  if (link instanceof HTMLElement) selectBySlug(link.dataset.slug ?? '')
}
</script>

<template>
  <div class="wiki-tab">
    <div class="wiki-sider">
      <div class="sider-title">页面目录</div>
      <n-spin :show="loading">
        <n-tree
          v-if="treeOptions.length > 0"
          :data="treeOptions"
          :selected-keys="selectedKeys"
          :default-expanded-keys="Object.keys(slugPageIds)"
          block-line
          @update:selected-keys="onTreeSelect"
        />
        <n-empty v-else-if="!loading" description="暂无页面——文档处理完成后自动生成" size="small" style="padding: 24px 0" />
      </n-spin>
    </div>

    <n-card size="small" class="wiki-main">
      <template #header>
        <n-spin v-if="pageLoading" :size="14" />
        <template v-else>{{ page?.title ?? 'Wiki' }}</template>
      </template>
      <template #header-extra>
        <n-space :size="8">
          <n-button size="small" :disabled="!page" @click="openVersions">版本历史</n-button>
          <n-button size="small" type="primary" :disabled="!page" @click="openEdit">编辑</n-button>
        </n-space>
      </template>
      <div v-if="page" class="page-meta">
        v{{ page.version }} · 更新于 {{ fmtTime(page.updated_at) }} · 引用 {{ page.source_chunk_ids.length }} 个分块
      </div>
      <div v-if="page" class="md-body" v-html="rendered" @click="onBodyClick"></div>
      <n-empty
        v-else-if="!loading && !pageLoading"
        description="左侧选择页面查看内容"
        style="padding: 48px 0"
      />
    </n-card>

    <n-modal v-model:show="showEdit" preset="card" :title="`编辑 — ${page?.title ?? ''}`" style="width: 720px">
      <n-input v-model:value="editContent" type="textarea" :rows="18" placeholder="支持 Markdown，用 [[页面名]] 链接其他页面" />
      <template #footer>
        <n-space justify="end">
          <n-button @click="showEdit = false">取消</n-button>
          <n-button type="primary" :loading="saving" @click="saveEdit">保存（生成新版本）</n-button>
        </n-space>
      </template>
    </n-modal>

    <n-drawer :show="showVersions" :width="440" @update:show="(v: boolean) => (showVersions = v)">
      <n-drawer-content :title="`版本历史 — ${page?.title ?? ''}`" closable>
        <n-spin :show="versionsLoading">
          <div class="version-list">
            <div v-for="v in versions" :key="v.id" class="version-item">
              <div class="version-head">
                <span class="version-no">v{{ v.version }}</span>
                <n-tag size="tiny" :bordered="false">{{ EDIT_SOURCE_LABEL[v.edit_source] ?? v.edit_source }}</n-tag>
                <span class="version-editor">{{ v.editor_name }}</span>
                <span class="version-time">{{ fmtTime(v.created_at) }}</span>
                <n-button
                  v-if="page && v.version < page.version"
                  size="tiny"
                  type="warning"
                  secondary
                  @click="revert(v)"
                >
                  回滚
                </n-button>
              </div>
              <div v-if="v.summary" class="version-summary">{{ v.summary }}</div>
            </div>
            <n-empty v-if="!versionsLoading && versions.length === 0" description="暂无版本" size="small" />
          </div>
        </n-spin>
      </n-drawer-content>
    </n-drawer>
  </div>
</template>

<style scoped>
.wiki-tab {
  display: flex;
  gap: 12px;
  align-items: stretch;
}

.wiki-sider {
  width: 260px;
  flex-shrink: 0;
  background: #fff;
  border: 1px solid #e9ebef;
  border-radius: 10px;
  padding: 12px;
  overflow: auto;
}

.sider-title {
  font-size: 13px;
  font-weight: 600;
  color: #666;
  margin-bottom: 8px;
}

.wiki-main {
  flex: 1;
  min-width: 0;
}

.page-meta {
  font-size: 12px;
  color: #999;
  margin-bottom: 12px;
  padding-bottom: 10px;
  border-bottom: 1px solid #efefef;
}

.version-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.version-item {
  border: 1px solid #efefef;
  border-radius: 4px;
  padding: 8px 10px;
}

.version-head {
  display: flex;
  align-items: center;
  gap: 8px;
}

.version-no {
  font-weight: 600;
}

.version-editor {
  font-size: 13px;
  color: #333;
}

.version-time {
  font-size: 12px;
  color: #999;
  flex: 1;
}

.version-summary {
  font-size: 12px;
  color: #666;
  margin-top: 6px;
}
</style>
