<script lang="ts">
import "./design-system/base.css";
import "./pages/admin-console/admin-console.css";

import { enforceAppRoute } from "./domain/nav-runtime";

export default {
  name: "VirtualCompanionApp",
  onShow() {
    enforceAppRoute();
  },
};
</script>

<style>
/* 设计系统全局 token 与基础排版在 design-system/base.css。 */

/* DOGFOOD-09: uni-h5 内建 uni-button[disabled] 文字色在浅底上对比度不足；
   用语义 token 加深，保住禁用观感的同时满足 4.5:1（axe color-contrast）。 */
uni-button[disabled] {
  background-color: var(--vc-disabled-surface) !important;
  color: var(--vc-disabled-ink) !important;
  opacity: 1;
}
</style>
