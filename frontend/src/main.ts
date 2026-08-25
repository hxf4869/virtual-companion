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

  // TASK-0034: eagerly create the auth store so a persisted session is restored
  // at startup and the server-401 clear+redirect hook is live before any page
  // mounts. New pages obtain their authenticated transport from the auth store
  // via createAuthenticatedTransport({ getAccessToken, onUnauthorized });
  // existing chat/memory transports adopt it in a later task (their pages are
  // frozen). Tokens are never written into chat drafts, memory content or any
  // model-bound context.
  void useAuthStore(pinia);
  attachAppNavigationGuards();
  bootstrapAuthSession();

  return {
    app,
  };
}
