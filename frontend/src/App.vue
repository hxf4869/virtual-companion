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
</style>
