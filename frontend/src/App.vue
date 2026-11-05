<script setup lang="ts">
import { dateZhCN, NConfigProvider, NDialogProvider, NMessageProvider, zhCN } from 'naive-ui'
import type { GlobalThemeOverrides } from 'naive-ui'

// WeKnora 同款品牌绿（light 档主色 #07C05F，hover #08DD6E，active #06B04D）
const themeOverrides: GlobalThemeOverrides = {
  common: {
    primaryColor: '#07C05F',
    primaryColorHover: '#08DD6E',
    primaryColorPressed: '#06B04D',
    primaryColorSuppl: '#07C05F',
    borderRadius: '4px',
  },
  // 白底卡片式布局：所有 n-card（含弹窗）统一圆角与细边框
  Card: {
    borderRadius: '10px',
    borderColor: '#e9ebef',
  },
}
</script>

<template>
  <n-config-provider
    :locale="zhCN"
    :date-locale="dateZhCN"
    :theme-overrides="themeOverrides"
    class="app-provider"
  >
    <n-dialog-provider>
      <n-message-provider>
        <router-view />
      </n-message-provider>
    </n-dialog-provider>
  </n-config-provider>
</template>

<style>
/* WeKnora 同款系统字体栈 */
body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue',
    'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', sans-serif;
}
</style>

<style scoped>
.app-provider {
  height: 100%;
}
</style>
