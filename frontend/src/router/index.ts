import { createRouter, createWebHistory } from 'vue-router'

import AppLayout from '@/components/AppLayout.vue'
import AgentAdminView from '@/views/AgentAdminView.vue'
import ChatView from '@/views/ChatView.vue'
import KbDetailView from '@/views/KbDetailView.vue'
import KnowledgeAdminView from '@/views/KnowledgeAdminView.vue'
import ProviderAdminView from '@/views/ProviderAdminView.vue'
import UsageAdminView from '@/views/UsageAdminView.vue'
import UserAdminView from '@/views/UserAdminView.vue'
import { useAuthStore } from '@/stores/auth'

declare module 'vue-router' {
  interface RouteMeta {
    admin?: boolean
  }
}

const router = createRouter({
  // BASE_URL 跟随构建时的 base（本地 dev 为 /，GitHub Pages 构建为 /Hify/）
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    {
      path: '/',
      component: AppLayout,
      children: [
        { path: '', redirect: '/chat' },
        { path: 'chat', component: ChatView },
        { path: 'agents', component: AgentAdminView, meta: { admin: true } },
        { path: 'knowledge', component: KnowledgeAdminView, meta: { admin: true } },
        { path: 'knowledge/:id', component: KbDetailView, meta: { admin: true } },
        { path: 'providers', component: ProviderAdminView, meta: { admin: true } },
        { path: 'users', component: UserAdminView, meta: { admin: true } },
        { path: 'usage', component: UsageAdminView, meta: { admin: true } },
      ],
    },
    { path: '/:pathMatch(.*)*', redirect: '/chat' },
  ],
})

router.beforeEach(async (to) => {
  const auth = useAuthStore()
  if (!auth.loaded) {
    await auth.fetchMe()
  }
  if (!auth.user) {
    // 无登录页：默认以 admin 自动登录（mock 阶段行为；接真后端时恢复 /login 页与守卫跳转）
    try {
      await auth.login('admin', 'admin')
    } catch {
      return false
    }
  }
  if (to.meta.admin && !auth.isAdmin) {
    return { path: '/chat' }
  }
  return true
})

export default router
