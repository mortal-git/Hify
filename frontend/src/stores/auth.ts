import { computed, ref } from 'vue'
import { defineStore } from 'pinia'

import { iamApi } from '@/api/iam'
import type { CurrentUser } from '@/api/iam'

export const useAuthStore = defineStore('auth', () => {
  const user = ref<CurrentUser | null>(null)
  const loaded = ref(false)

  const isAdmin = computed(() => user.value?.role === 'ADMIN')

  async function fetchMe(): Promise<void> {
    try {
      user.value = await iamApi.me()
    } catch {
      user.value = null
    } finally {
      loaded.value = true
    }
  }

  async function login(userName: string, password: string): Promise<void> {
    user.value = await iamApi.login({ user_name: userName, password })
  }

  async function logout(): Promise<void> {
    try {
      await iamApi.logout()
    } finally {
      user.value = null
    }
  }

  return { user, loaded, isAdmin, fetchMe, login, logout }
})
