import { createPinia } from "pinia";
import { createSSRApp } from "vue";

import App from "./App.vue";
import { useAuthStore } from "./stores/auth";

export function createApp() {
  const pinia = createPinia();
  const app = createSSRApp(App);

  app.use(pinia);

  // TASK-0034: eagerly create the auth store so a persisted session is restored
  // at startup and the server-401 clear+redirect hook is live before any page
  // mounts. New pages obtain their authenticated transport from the auth store
  // via createAuthenticatedTransport({ getAccessToken, onUnauthorized });
  // existing chat/memory transports adopt it in a later task (their pages are
  // frozen). Tokens are never written into chat drafts, memory content or any
  // model-bound context.
  void useAuthStore(pinia);

  return {
    app,
  };
}
