import { createPinia } from "pinia";
import { createSSRApp } from "vue";

import App from "./App.vue";
import { attachAppNavigationGuards, bootstrapAuthSession } from "./domain/nav-runtime";
import { installH5A11yShims } from "./platform/h5-a11y";
import { useAuthStore } from "./stores/auth";

export function createApp() {
  const pinia = createPinia();
  const app = createSSRApp(App);

  app.use(pinia);

  // DOGFOOD-09：uni-h5 框架层 a11y 缺口（uni-input 名称转发 / uni-button
  // 键盘可达 / uni-page-head landmark）在应用启动时一次性安装。
  installH5A11yShims();

  // Eagerly create the auth store so the cookie-backed session is restored and
  // the global 401 clear-and-redirect hook is live before any page mounts.
  void useAuthStore(pinia);
  attachAppNavigationGuards();
  bootstrapAuthSession();

  return {
    app,
  };
}
