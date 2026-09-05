<template>
  <view class="vc-authenticator-setup">
    <view class="vc-authenticator-setup__intro">
      <text class="vc-authenticator-setup__title" role="heading" aria-level="1">
        设置身份验证器
      </text>
      <text class="vc-authenticator-setup__lead">
        用身份验证器 App 扫描二维码。以后登录时，它会为你生成 6 位验证码。
      </text>
    </view>

    <view class="vc-authenticator-setup__qr-wrap">
      <image
        class="vc-authenticator-setup__qr"
        :src="setup.qrCodeDataUrl"
        mode="aspectFit"
        aria-label="身份验证器设置二维码"
      />
    </view>

    <view class="vc-authenticator-setup__manual">
      <text class="vc-authenticator-setup__manual-label">无法扫码？手动输入这个密钥</text>
      <text class="vc-authenticator-setup__manual-key" user-select>{{ setup.manualKey }}</text>
      <button class="vc-authenticator-setup__copy" type="button" @click="$emit('copy-key')">
        {{ copyMessage || "复制密钥" }}
      </button>
    </view>

    <view class="vc-authenticator-setup__verify">
      <text class="vc-authenticator-setup__verify-label">输入 App 显示的 6 位验证码</text>
      <VcTotpCodeInput
        :model-value="code"
        :error="error"
        :disabled="submitting"
        test-id="setup-code"
        @update:model-value="$emit('update:code', $event)"
        @submit="$emit('confirm')"
      />
      <VcTrustDevice
        :model-value="trustDevice"
        :disabled="submitting"
        @update:model-value="$emit('update:trustDevice', $event)"
      />
      <wd-button
        block
        size="large"
        :loading="submitting"
        :disabled="code.length !== 6 || submitting"
        data-testid="setup-submit"
        @click="$emit('confirm')"
      >
        验证并开启
      </wd-button>
    </view>
  </view>
</template>

<script setup lang="ts">
import type { AuthenticatorSetup } from "@/api/auth";
import VcTotpCodeInput from "@/components/auth/VcTotpCodeInput.vue";
import VcTrustDevice from "@/components/auth/VcTrustDevice.vue";

defineProps<{
  setup: AuthenticatorSetup;
  code: string;
  trustDevice: boolean;
  submitting: boolean;
  error: string;
  copyMessage?: string;
}>();

defineEmits<{
  (event: "update:code", value: string): void;
  (event: "update:trustDevice", value: boolean): void;
  (event: "copy-key"): void;
  (event: "confirm"): void;
}>();
</script>

<style scoped>
.vc-authenticator-setup {
  display: grid;
  gap: var(--vc-space-6);
  min-width: 0;
}

.vc-authenticator-setup__intro {
  display: grid;
  gap: var(--vc-space-2);
}

.vc-authenticator-setup__title {
  font-size: 28px;
  font-weight: 600;
  line-height: 36px;
}

.vc-authenticator-setup__lead {
  color: var(--vc-color-ink-muted);
  font-size: 15px;
  line-height: 24px;
}

.vc-authenticator-setup__qr-wrap {
  display: grid;
  place-items: center;
}

.vc-authenticator-setup__qr {
  box-sizing: border-box;
  width: 208px;
  height: 208px;
  padding: var(--vc-space-3);
  border: 1px solid var(--vc-color-hairline);
  border-radius: var(--vc-radius-card);
  background: var(--vc-color-surface);
}

.vc-authenticator-setup__manual {
  display: grid;
  gap: var(--vc-space-2);
  min-width: 0;
  padding: var(--vc-space-4);
  border-radius: var(--vc-radius-card);
  background: var(--vc-color-surface-soft);
}

.vc-authenticator-setup__manual-label,
.vc-authenticator-setup__verify-label {
  color: var(--vc-color-ink);
  font-size: 14px;
  font-weight: 500;
  line-height: 22px;
}

.vc-authenticator-setup__manual-key {
  min-width: 0;
  color: var(--vc-color-ink);
  font-family: var(--vc-font-mono);
  font-size: 14px;
  line-height: 22px;
  overflow-wrap: anywhere;
}

.vc-authenticator-setup__copy {
  justify-self: start;
  min-height: 44px;
  margin: 0 0 0 calc(-1 * var(--vc-space-3));
  padding: 0 var(--vc-space-3);
  border: 0;
  color: var(--vc-color-primary);
  background: transparent;
  font-size: 14px;
  font-weight: 500;
}

.vc-authenticator-setup__copy::after {
  border: 0;
}

.vc-authenticator-setup__verify {
  display: grid;
  gap: var(--vc-space-3);
}
</style>
