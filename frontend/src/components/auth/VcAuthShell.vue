<template>
  <wd-config-provider
    theme="light"
    :button="buttonDefaults"
    custom-class="vc-auth-provider"
  >
    <view class="vc-auth-shell" role="main">
      <view class="vc-auth-shell__frame">
        <button
          v-if="showBack"
          class="vc-auth-shell__back"
          type="button"
          aria-label="返回登录"
          @click="$emit('back')"
        >
          <view class="vc-auth-shell__back-mark" aria-hidden="true" />
        </button>

        <view v-if="showBrand" class="vc-auth-shell__brand" aria-label="虚拟陪伴">
          <view class="vc-auth-shell__brand-dot" aria-hidden="true" />
          <text class="vc-auth-shell__brand-name">虚拟陪伴</text>
        </view>

        <view class="vc-auth-shell__content">
          <slot />
        </view>

        <view v-if="$slots.footer" class="vc-auth-shell__footer">
          <slot name="footer" />
        </view>
      </view>
    </view>
  </wd-config-provider>
</template>

<script setup lang="ts">
withDefaults(defineProps<{
  showBack?: boolean;
  showBrand?: boolean;
}>(), {
  showBack: false,
  showBrand: false,
});

defineEmits<{
  (event: "back"): void;
}>();

const buttonDefaults = {
  size: "large" as const,
  round: false,
};
</script>

<style scoped>
.vc-auth-shell {
  box-sizing: border-box;
  min-height: 100vh;
  min-height: 100dvh;
  color: var(--vc-color-ink);
  background: var(--vc-color-canvas);
}

.vc-auth-shell__frame {
  display: flex;
  flex-direction: column;
  box-sizing: border-box;
  width: 100%;
  max-width: 430px;
  min-height: 100vh;
  min-height: 100dvh;
  margin: 0 auto;
  padding:
    calc(var(--vc-space-5) + env(safe-area-inset-top, 0px))
    var(--vc-space-5)
    calc(var(--vc-space-5) + env(safe-area-inset-bottom, 0px));
}

.vc-auth-shell__back {
  display: grid;
  place-items: center;
  flex: 0 0 44px;
  width: 44px;
  height: 44px;
  min-height: 44px;
  margin: calc(-1 * var(--vc-space-2)) 0 var(--vc-space-5) calc(-1 * var(--vc-space-3));
  padding: 0;
  border: 0;
  border-radius: var(--vc-radius-full);
  color: var(--vc-color-ink);
  background: transparent;
}

.vc-auth-shell__back::after {
  border: 0;
}

.vc-auth-shell__back:active {
  background: var(--vc-color-surface-soft);
}

.vc-auth-shell__back-mark {
  width: 10px;
  height: 10px;
  border-bottom: 1.5px solid currentColor;
  border-left: 1.5px solid currentColor;
  transform: rotate(45deg);
}

.vc-auth-shell__brand {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--vc-space-2);
  min-height: 44px;
  margin: 0 0 var(--vc-space-7);
}

.vc-auth-shell__brand-dot {
  width: 9px;
  height: 9px;
  border: 2px solid var(--vc-color-surface);
  border-radius: var(--vc-radius-full);
  background: var(--vc-color-primary);
  box-shadow: var(--vc-shadow-brand-mark);
}

.vc-auth-shell__brand-name {
  font-size: 16px;
  font-weight: 600;
  line-height: 24px;
}

.vc-auth-shell__content {
  width: 100%;
  min-width: 0;
}

.vc-auth-shell__footer {
  width: 100%;
  margin-top: auto;
  padding-top: var(--vc-space-8);
  color: var(--vc-color-ink-muted);
  font-size: 12px;
  line-height: 18px;
  text-align: center;
}

@media (max-width: 359px) {
  .vc-auth-shell__frame {
    padding-right: var(--vc-space-4);
    padding-left: var(--vc-space-4);
  }

  .vc-auth-shell__brand {
    margin-bottom: var(--vc-space-6);
  }
}
</style>
