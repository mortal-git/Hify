import { createPinia } from 'pinia'
import { createApp } from 'vue'

import App from './App.vue'
import router from './router'
import './style.css'

async function bootstrap(): Promise<void> {
  if (import.meta.env.VITE_ENABLE_MSW === 'true') {
    const { worker } = await import('./mocks/browser')
    await worker.start({ onUnhandledFrame: 'bypass' })

    // SW 空闲约 30s 会被浏览器终止；重启后 activeClientIds 清空，/api 请求穿透到
    // vite 代理返回 502。MSW 自带的 5s keepalive 在后台标签页被节流到 1 次/分钟，
    // 护不住空闲期——回到前台立即重发激活消息重新注册，另加低频心跳兜底。
    const reactivate = (): void => {
      navigator.serviceWorker.controller?.postMessage('MOCK_ACTIVATE')
    }
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') reactivate()
    })
    window.addEventListener('online', reactivate)
    window.setInterval(reactivate, 20_000)
  }
  const app = createApp(App)
  app.use(createPinia())
  app.use(router)
  app.mount('#app')
}

bootstrap()
