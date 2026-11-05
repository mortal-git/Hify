<script setup lang="ts">
import { h, onMounted, ref } from 'vue'
import {
  NButton,
  NDataTable,
  NInput,
  NModal,
  NPopconfirm,
  NRadioButton,
  NRadioGroup,
  NSwitch,
  NTag,
  useMessage,
} from 'naive-ui'
import type { DataTableColumns } from 'naive-ui'

import { iamApi } from '@/api/iam'
import type { UserDto } from '@/api/iam'
import { useAuthStore } from '@/stores/auth'

const message = useMessage()
const auth = useAuthStore()

const users = ref<UserDto[]>([])
const loading = ref(false)

const showCreate = ref(false)
const creating = ref(false)
const createForm = ref({ user_name: '', password: '', role: 'MEMBER' as 'ADMIN' | 'MEMBER' })

const resetTarget = ref<UserDto | null>(null)
const resetPassword = ref('')
const resetting = ref(false)

async function load(): Promise<void> {
  loading.value = true
  try {
    users.value = await iamApi.listUsers()
  } catch (e) {
    message.error(e instanceof Error ? e.message : '用户列表加载失败')
  } finally {
    loading.value = false
  }
}

onMounted(load)

function isSelf(u: UserDto): boolean {
  return auth.user?.id === u.id
}

async function create(): Promise<void> {
  const f = createForm.value
  if (!f.user_name.trim()) {
    message.warning('请输入用户名')
    return
  }
  if (f.password.length < 6) {
    message.warning('密码至少 6 位')
    return
  }
  creating.value = true
  try {
    const u = await iamApi.createUser({ user_name: f.user_name.trim(), password: f.password, role: f.role })
    message.success(`用户「${u.user_name}」已创建`)
    showCreate.value = false
    load()
  } catch (e) {
    message.error(e instanceof Error ? e.message : '创建失败')
  } finally {
    creating.value = false
  }
}

async function toggleEnabled(u: UserDto, enabled: boolean): Promise<void> {
  try {
    const fresh = await iamApi.updateUser(u.id, { enabled })
    Object.assign(u, fresh)
    message.success(enabled ? `已启用「${u.user_name}」` : `已停用「${u.user_name}」，该用户无法再登录`)
  } catch (e) {
    message.error(e instanceof Error ? e.message : '操作失败')
    load()
  }
}

async function toggleRole(u: UserDto): Promise<void> {
  const role = u.role === 'ADMIN' ? 'MEMBER' : 'ADMIN'
  try {
    const fresh = await iamApi.updateUser(u.id, { role })
    Object.assign(u, fresh)
    message.success(`「${u.user_name}」已设为 ${role === 'ADMIN' ? '管理员' : '普通成员'}`)
  } catch (e) {
    message.error(e instanceof Error ? e.message : '操作失败')
    load()
  }
}

function openReset(u: UserDto): void {
  resetTarget.value = u
  resetPassword.value = ''
}

async function confirmReset(): Promise<void> {
  const target = resetTarget.value
  if (!target) return
  if (resetPassword.value.length < 6) {
    message.warning('密码至少 6 位')
    return
  }
  resetting.value = true
  try {
    await iamApi.resetPassword(target.id, resetPassword.value)
    message.success(`已重置「${target.user_name}」的密码`)
    resetTarget.value = null
  } catch (e) {
    message.error(e instanceof Error ? e.message : '重置失败')
  } finally {
    resetting.value = false
  }
}

async function remove(u: UserDto): Promise<void> {
  try {
    await iamApi.deleteUser(u.id)
    message.success(`用户「${u.user_name}」已删除`)
    load()
  } catch (e) {
    message.error(e instanceof Error ? e.message : '删除失败')
  }
}

function fmtTime(iso: string | null): string {
  return iso ? new Date(iso).toLocaleString('zh-CN', { hour12: false }) : '—'
}

const columns: DataTableColumns<UserDto> = [
  {
    title: '用户名',
    key: 'user_name',
    width: 160,
    render: (u) =>
      h('span', { class: isSelf(u) ? 'self-name' : '' }, `${u.user_name}${isSelf(u) ? '（当前登录）' : ''}`),
  },
  {
    title: '角色',
    key: 'role',
    width: 110,
    render: (u) =>
      h(
        NTag,
        { size: 'small', bordered: false, type: u.role === 'ADMIN' ? 'error' : 'default' },
        { default: () => (u.role === 'ADMIN' ? 'admin' : 'member') },
      ),
  },
  {
    title: '切换角色',
    key: 'role-toggle',
    width: 100,
    render: (u) =>
      isSelf(u)
        ? h('span', { class: 'dim' }, '—')
        : h(
            NButton,
            { size: 'tiny', quaternary: true, onClick: () => toggleRole(u) },
            { default: () => (u.role === 'ADMIN' ? '降为 member' : '升为 admin') },
          ),
  },
  {
    title: '状态',
    key: 'enabled',
    width: 90,
    render: (u) =>
      h(NSwitch, {
        size: 'small',
        value: u.enabled,
        disabled: isSelf(u),
        onUpdateValue: (v: boolean) => toggleEnabled(u, v),
      }),
  },
  { title: '创建时间', key: 'created_at', width: 170, render: (u) => fmtTime(u.created_at) },
  { title: '最近登录', key: 'last_login_at', width: 170, render: (u) => fmtTime(u.last_login_at) },
  {
    title: '操作',
    key: 'actions',
    width: 160,
    render: (u) =>
      h('div', { class: 'row-actions' }, [
        h(NButton, { size: 'tiny', quaternary: true, onClick: () => openReset(u) }, { default: () => '重置密码' }),
        isSelf(u)
          ? h('span', { class: 'dim' }, '—')
          : h(
              NPopconfirm,
              { onPositiveClick: () => remove(u) },
              {
                trigger: () =>
                  h(NButton, { size: 'tiny', quaternary: true, type: 'error' }, { default: () => '删除' }),
                default: () => `删除用户「${u.user_name}」？该用户的会话与日志保留。`,
              },
            ),
      ]),
  },
]
</script>

<template>
  <div class="user-admin">
    <div class="page-head">
      <div>
        <div class="page-title">用户管理</div>
        <div class="page-desc">集中创建、停用账号与设置管理员，角色仅 admin / member</div>
      </div>
      <n-button type="primary" @click="showCreate = true">新建用户</n-button>
    </div>

    <div class="page-card">
      <n-data-table
        size="small"
        :columns="columns"
        :data="users"
        :loading="loading"
        :row-key="(u: UserDto) => u.id"
        :bordered="false"
      />
    </div>

    <n-modal
      v-model:show="showCreate"
      preset="card"
      title="新建用户"
      style="width: 440px"
    >
      <n-input v-model:value="createForm.user_name" maxlength="30" placeholder="用户名（登录用）" />
      <n-input
        v-model:value="createForm.password"
        type="password"
        show-password-on="click"
        placeholder="初始密码（至少 6 位）"
        style="margin-top: 10px"
      />
      <n-radio-group
        :value="createForm.role"
        size="small"
        style="margin-top: 12px"
        @update:value="(v: string | number) => (createForm.role = v === 'ADMIN' ? 'ADMIN' : 'MEMBER')"
      >
        <n-radio-button value="MEMBER">member（仅使用）</n-radio-button>
        <n-radio-button value="ADMIN">admin（可构建）</n-radio-button>
      </n-radio-group>
      <template #footer>
        <n-button type="primary" :loading="creating" @click="create">创建</n-button>
      </template>
    </n-modal>

    <n-modal
      :show="resetTarget != null"
      preset="card"
      :title="`重置密码 — ${resetTarget?.user_name ?? ''}`"
      style="width: 420px"
      @update:show="(v: boolean) => (resetTarget = v ? resetTarget : null)"
    >
      <n-input
        v-model:value="resetPassword"
        type="password"
        show-password-on="click"
        placeholder="新密码（至少 6 位）"
        @keydown.enter="confirmReset"
      />
      <template #footer>
        <n-button type="primary" :loading="resetting" @click="confirmReset">确认重置</n-button>
      </template>
    </n-modal>
  </div>
</template>

<style scoped>
.user-admin {
  max-width: 1100px;
  margin: 0 auto;
}

.self-name {
  font-weight: 600;
}

.dim {
  color: #ccc;
  font-size: 12px;
}

.row-actions {
  display: flex;
  gap: 2px;
}
</style>
