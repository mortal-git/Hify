<script setup lang="ts">
import { computed, h } from 'vue'
import type { Component } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  BookOutline,
  ChatbubblesOutline,
  CubeOutline,
  HardwareChipOutline,
  PeopleOutline,
  ServerOutline,
  StatsChartOutline,
} from '@vicons/ionicons5'
import {
  NIcon,
  NLayout,
  NLayoutContent,
  NLayoutSider,
  NMenu,
} from 'naive-ui'
import type { MenuOption } from 'naive-ui'

import AccountPopover from '@/components/account/AccountPopover.vue'
import { useAuthStore } from '@/stores/auth'

const route = useRoute()
const router = useRouter()
const auth = useAuthStore()

function renderIcon(icon: Component) {
  return () => h(NIcon, null, { default: () => h(icon) })
}

const menuOptions = computed<MenuOption[]>(() => {
  const options: MenuOption[] = [{ label: '聊天', key: '/chat', icon: renderIcon(ChatbubblesOutline) }]
  if (auth.isAdmin) {
    options.push(
      { label: 'Agent 管理', key: '/agents', icon: renderIcon(CubeOutline) },
      { label: '知识库', key: '/knowledge', icon: renderIcon(BookOutline) },
      { label: '模型供应商', key: '/providers', icon: renderIcon(ServerOutline) },
      { label: '用户管理', key: '/users', icon: renderIcon(PeopleOutline) },
      { label: '用量统计', key: '/usage', icon: renderIcon(StatsChartOutline) },
    )
  }
  return options
})

// 详情路由（/knowledge/3）也要点亮一级菜单
const activeKey = computed(() => `/${route.path.split('/')[1] ?? ''}`)
</script>

<template>
  <n-layout has-sider style="height: 100%">
    <n-layout-sider bordered :width="220" content-style="background-color: #f9f9f9;">
      <div class="sider-inner">
        <div class="brand">
          <span class="brand-logo">
            <n-icon :component="HardwareChipOutline" :size="18" />
          </span>
          <span class="brand-text">企业智能体平台</span>
        </div>
        <n-menu
          :value="activeKey"
          :options="menuOptions"
          @update:value="(key: string | number) => router.push(String(key))"
        />
        <div class="sider-foot">
          <account-popover />
        </div>
      </div>
    </n-layout-sider>
    <n-layout style="height: 100%; background-color: #fff">
      <n-layout-content content-style="padding: 24px;">
        <router-view />
      </n-layout-content>
    </n-layout>
  </n-layout>
</template>

<style scoped>
.sider-inner {
  height: 100%;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  padding: 16px 0;
}

.brand {
  display: flex;
  align-items: center;
  gap: 9px;
  margin-bottom: 16px;
  padding: 0 14px;
}

.brand-logo {
  width: 30px;
  height: 30px;
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 8px;
  background: linear-gradient(135deg, #07c05f, #049a4a);
  color: #fff;
}

.brand-text {
  font-size: 17px;
  font-weight: 700;
  color: #222;
  letter-spacing: 0.3px;
  white-space: nowrap;
}

.sider-foot {
  margin-top: auto;
  padding: 8px;
}
</style>
