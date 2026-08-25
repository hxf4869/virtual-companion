<script lang="ts">
import { enforceAppRoute } from "./domain/nav-runtime";

export default {
  name: "VirtualCompanionApp",
  onShow() {
    enforceAppRoute();
  },
};
</script>

<style>
page {
  min-height: 100%;
  color: #17212b;
  background: #f4f6f8;
}

/* DOGFOOD-09: uni-h5 内建 uni-button[disabled] 文字色在浅底上对比度仅约
   2.1:1；加深到约 5:1，保住禁用观感的同时满足 4.5:1（axe color-contrast）。 */
uni-button[disabled] {
  color: #6e6e6e !important;
}

/* DOGFOOD-09: 页面没有可见标题时（如 memory 页）给读屏/axe 用的视觉隐藏
   一级标题；页面上仍是普通文档流，不影响布局。 */
.vc-sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  margin: -1px;
  padding: 0;
  border: 0;
  overflow: hidden;
  clip: rect(0 0 0 0);
  clip-path: inset(50%);
  white-space: nowrap;
}
</style>
