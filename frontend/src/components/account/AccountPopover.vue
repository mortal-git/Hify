<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import { ChevronUpOutline, SettingsOutline } from '@vicons/ionicons5'
import { NButton, NIcon, NInput, NModal, NPopover, NTag, useMessage } from 'naive-ui'

import { iamApi } from '@/api/iam'
import { useAuthStore } from '@/stores/auth'

const auth = useAuthStore()
const message = useMessage()

const showProfile = ref(false)
const saving = ref(false)
const pwdForm = reactive({ old_password: '', new_password: '', confirm: '' })

const initial = computed(() => (auth.user?.user_name ?? '?').slice(0, 1).toUpperCase())

function openProfile(): void {
  pwdForm.old_password = ''
  pwdForm.new_password = ''
  pwdForm.confirm = ''
  showProfile.value = true
}

async function changePassword(): Promise<void> {
  const f = pwdForm
  if (!f.old_password) {
    message.warning('请输入旧密码')
    return
  }
  if (f.new_password.length < 6) {
    message.warning('新密码至少 6 位')
    return
  }
  if (f.new_password !== f.confirm) {
    message.warning('两次输入的新密码不一致')
    return
  }
  saving.value = true
  try {
    await iamApi.changePassword({ old_password: f.old_password, new_password: f.new_password })
    message.success('密码已修改，下次登录请使用新密码')
    showProfile.value = false
  } catch (e) {
    message.error(e instanceof Error ? e.message : '修改失败')
  } finally {
    saving.value = false
  }
}

function fmtTime(iso: string | null): string {
  return iso ? new Date(iso).toLocaleString('zh-CN', { hour12: false }) : '—'
}
</script>

<template>
  <n-popover trigger="click" placement="top-start" raw :show-arrow="false">
    <template #trigger>
      <button type="button" class="account-entry">
        <span class="avatar">{{ initial }}</span>
        <span class="entry-main">
          <span class="entry-name">{{ auth.user?.user_name }}</span>
          <span class="entry-role">{{ auth.isAdmin ? '管理员' : '成员' }}</span>
        </span>
        <n-icon size="14" class="entry-arrow"><chevron-up-outline /></n-icon>
      </button>
    </template>

    <div class="account-pop">
      <div class="pop-head">
        <span class="avatar big">{{ initial }}</span>
        <div class="pop-user">
          <span class="pop-name">{{ auth.user?.user_name }}</span>
          <n-tag size="small" :bordered="false" :type="auth.isAdmin ? 'error' : 'default'">
            {{ auth.isAdmin ? 'admin' : 'member' }}
          </n-tag>
        </div>
      </div>
      <div v-if="auth.user?.last_login_at" class="pop-meta">最近登录 {{ fmtTime(auth.user.last_login_at) }}</div>
      <div class="pop-divider" />
      <button type="button" class="pop-item" @click="openProfile">
        <n-icon size="15"><settings-outline /></n-icon>
        <span>个人设置</span>
      </button>
    </div>
  </n-popover>

  <n-modal v-model:show="showProfile" preset="card" title="个人设置" style="width: 420px">
    <div class="section-title">账号信息</div>
    <div class="info-list">
      <div class="info-row">
        <span class="info-label">用户名</span>
        <span class="info-value">{{ auth.user?.user_name }}</span>
      </div>
      <div class="info-row">
        <span class="info-label">角色</span>
        <span class="info-value">{{ auth.isAdmin ? '管理员（可构建）' : '成员（仅使用）' }}</span>
      </div>
      <div class="info-row">
        <span class="info-label">创建时间</span>
        <span class="info-value">{{ fmtTime(auth.user?.created_at ?? null) }}</span>
      </div>
      <div class="info-row">
        <span class="info-label">最近登录</span>
        <span class="info-value">{{ fmtTime(auth.user?.last_login_at ?? null) }}</span>
      </div>
    </div>

    <div class="section-title">修改密码</div>
    <n-input
      v-model:value="pwdForm.old_password"
      type="password"
      show-password-on="click"
      placeholder="旧密码"
    />
    <n-input
      v-model:value="pwdForm.new_password"
      type="password"
      show-password-on="click"
      placeholder="新密码（至少 6 位）"
      style="margin-top: 10px"
    />
    <n-input
      v-model:value="pwdForm.confirm"
      type="password"
      show-password-on="click"
      placeholder="确认新密码"
      style="margin-top: 10px"
      @keydown.enter="changePassword"
    />
    <template #footer>
      <n-button type="primary" :loading="saving" @click="changePassword">保存新密码</n-button>
    </template>
  </n-modal>
</template>

<style scoped>
.account-entry {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
  border: none;
  border-radius: 8px;
  background: transparent;
  cursor: pointer;
  font: inherit;
  text-align: left;
}

.account-entry:hover {
  background: #f0f1f3;
}

.avatar {
  width: 32px;
  height: 32px;
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 8px;
  background: linear-gradient(135deg, #07c05f, #049a4a);
  color: #fff;
  font-size: 15px;
  font-weight: 700;
}

.avatar.big {
  width: 40px;
  height: 40px;
  font-size: 18px;
}

.entry-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.entry-name {
  font-size: 13px;
  font-weight: 600;
  color: #333;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.entry-role {
  font-size: 11px;
  color: #999;
}

.entry-arrow {
  color: #bbb;
  flex-shrink: 0;
}

.account-pop {
  width: 232px;
  padding: 6px;
  background: #fff;
  border-radius: 10px;
  border: 1px solid #eceef0;
  box-shadow: 0 8px 28px rgba(0, 0, 0, 0.12);
}

.pop-head {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 8px 10px;
}

.pop-user {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.pop-name {
  font-size: 14px;
  font-weight: 600;
  color: #222;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.pop-meta {
  font-size: 11px;
  color: #aaa;
  padding: 0 8px 8px;
}

.pop-divider {
  height: 1px;
  background: #f0f1f3;
  margin: 2px 4px 4px;
}

.pop-item {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: #444;
  font-size: 13px;
  cursor: pointer;
}

.pop-item:hover {
  background: #eefaf2;
  color: #07c05f;
}

.section-title {
  font-size: 13px;
  font-weight: 600;
  color: #333;
  margin: 4px 0 10px;
}

.section-title + .info-list {
  margin-bottom: 18px;
}

.info-row {
  display: flex;
  padding: 7px 0;
  border-bottom: 1px solid #f5f6f7;
  font-size: 13px;
}

.info-row:last-child {
  border-bottom: none;
}

.info-label {
  width: 72px;
  flex-shrink: 0;
  color: #999;
}

.info-value {
  color: #333;
}
</style>
