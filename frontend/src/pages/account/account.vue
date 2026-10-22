<template>
  <ConsumerShell route="/pages/account/account" :show-header="false">
    <view class="profile-page">
      <view class="profile-topbar">
        <text class="profile-topbar__title" role="heading" aria-level="1">我的</text>
        <view class="profile-mark" aria-hidden="true">@</view>
      </view>

      <!-- VC-R52：期望账号失配后的页面级反馈。放在认证分支之外：reconcile
           后无论落在哪个身份状态，反馈都保持可见（role=status 即 polite
           live region，与仓库既有可访问反馈模式一致）。 -->
      <view
        v-if="accountContextNotice"
        class="context-notice"
        data-testid="account-context-notice"
        role="status"
      >
        <text>{{ accountContextNotice }}</text>
      </view>

      <view
        v-if="auth.sessionStatus === 'unknown'"
        class="profile-state"
        :role="auth.error === 'refresh-failed' ? 'alert' : 'status'"
        data-testid="account-loading"
      >
        <template v-if="auth.error === 'refresh-failed'">
          <text class="profile-state__title">暂时没能打开账号信息</text>
          <text class="profile-state__copy">检查网络后再试一次。</text>
          <button class="secondary-action" data-testid="account-retry" @click="restoreAccount">
            重新加载
          </button>
        </template>
        <template v-else>
          <view class="profile-skeleton profile-skeleton--short" aria-hidden="true" />
          <view class="profile-skeleton" aria-hidden="true" />
          <text class="vc-sr-only">正在加载账号信息</text>
        </template>
      </view>

      <view
        v-else-if="!auth.isAuthenticated"
        class="profile-state"
        data-testid="account-signed-out"
      >
        <text class="profile-state__title">登录后查看账号与安全设置</text>
        <text class="profile-state__copy">你的设置会跟随账号保存。</text>
        <button class="primary-action" data-testid="nav-login" @click="goTo('/pages/login/login')">
          登录
        </button>
      </view>

      <template v-else>
        <view class="profile-identity" data-testid="account-identity">
          <view class="profile-avatar" aria-hidden="true">{{ accountMark }}</view>
          <view class="profile-identity__copy">
            <text class="profile-identity__label">当前账号</text>
            <text class="profile-identity__email" data-testid="account-email">
              {{ auth.email || "已登录账号" }}
            </text>
          </view>
        </view>

        <view
          v-if="auth.passwordMustChange"
          class="required-notice"
          data-testid="password-required"
          role="alert"
        >
          <AppIcon name="lock" :size="18" />
          <text>请先设置一个新密码，再继续使用其他功能。</text>
        </view>

        <section class="settings-section" aria-labelledby="companion-section-title">
          <text id="companion-section-title" class="settings-section__title">陪伴</text>
          <view class="settings-list">
            <button
              type="button"
              class="settings-row"
              data-testid="me-companion"
              @click="goTo('/pages/companion/companion')"
            >
              <span class="settings-row__copy">
                <text class="settings-row__label">陪伴设置</text>
                <text class="settings-row__note">称呼、回复长度和聊天偏好</text>
              </span>
              <AppIcon name="chevron-right" :size="18" />
            </button>

            <button
              type="button"
              class="settings-row"
              data-testid="me-memory"
              @click="goTo('/pages/memory/memory')"
            >
              <span class="settings-row__copy">
                <text class="settings-row__label">记忆管理</text>
                <text class="settings-row__note">查看、编辑或删除陪伴记住的内容</text>
              </span>
              <AppIcon name="chevron-right" :size="18" />
            </button>
          </view>
        </section>

        <section class="settings-section" aria-labelledby="account-section-title">
          <text id="account-section-title" class="settings-section__title">账号</text>
          <view class="settings-list">
            <button
              type="button"
              class="settings-row"
              data-testid="password-toggle"
              :aria-expanded="passwordOpen"
              @click="passwordOpen = !passwordOpen"
            >
              <span class="settings-row__copy">
                <text class="settings-row__label">修改密码</text>
                <text class="settings-row__note">修改后需要重新登录</text>
              </span>
              <AppIcon :name="passwordOpen ? 'arrow-up' : 'chevron-right'" :size="18" />
            </button>

            <view v-if="passwordOpen" class="inline-form" data-testid="password-form">
              <text class="form-label">当前密码</text>
              <input
                v-model="currentPassword"
                class="form-input"
                data-testid="current-password"
                type="password"
                autocomplete="current-password"
                aria-label="当前密码"
              />
              <text class="form-label">新密码</text>
              <input
                v-model="newPassword"
                class="form-input"
                data-testid="new-password"
                type="password"
                autocomplete="new-password"
                aria-label="新密码"
              />
              <text class="form-hint">至少 8 个字符</text>
              <text class="form-label">再次输入新密码</text>
              <input
                v-model="confirmPassword"
                class="form-input"
                data-testid="confirm-password"
                type="password"
                autocomplete="new-password"
                aria-label="再次输入新密码"
              />
              <text
                v-if="passwordMessage"
                class="form-message"
                data-testid="password-message"
                role="alert"
              >
                {{ passwordMessage }}
              </text>
              <button
                type="button"
                class="primary-action primary-action--compact"
                data-testid="change-password"
                :disabled="busy || !canChangePassword"
                @click="onChangePassword"
              >
                {{ busy === "password" ? "修改中…" : "确认修改" }}
              </button>
            </view>

            <!-- :key 绑定账号：切换账号（含失配恢复 clear() 经 null 的往返）
                 即重建面板，旧副本状态（含已填密码）随 unmount 清空、迟到回调
                 被存活守卫丢弃；必须改密的会话先改密再出现入口。 -->
            <DataExportPanel
              v-if="!auth.passwordMustChange"
              :key="auth.accountId ?? undefined"
              :transport="transport"
              :download-fetch="authedFetch"
            />
          </view>
        </section>

        <section class="settings-section" aria-labelledby="security-section-title">
          <text id="security-section-title" class="settings-section__title">安全</text>
          <view class="settings-list">
            <view class="security-fact" data-testid="authenticator-status">
              <view
                class="security-fact__icon"
                :class="{ 'security-fact__icon--warning': !auth.authenticatorEnabled }"
                aria-hidden="true"
              >
                <AppIcon name="shield" :size="20" />
              </view>
              <view class="settings-row__copy">
                <text class="settings-row__label">身份验证器</text>
                <text class="settings-row__note">
                  {{ auth.authenticatorEnabled ? "已开启" : "需要设置" }}
                </text>
              </view>
            </view>

            <view class="trusted-devices" data-testid="trusted-devices">
              <view class="trusted-devices__heading">
                <view class="settings-row__copy">
                  <text class="settings-row__label">信任的设备</text>
                  <text class="settings-row__note">登录仍需密码，可免验证身份验证器</text>
                </view>
                <button
                  v-if="deviceState === 'error'"
                  type="button"
                  class="text-action"
                  data-testid="trusted-devices-retry"
                  @click="loadTrustedDevices"
                >
                  重试
                </button>
              </view>

              <text v-if="deviceState === 'loading'" class="device-state" role="status">
                正在加载设备…
              </text>
              <text
                v-else-if="deviceState === 'error'"
                class="device-state device-state--error"
                data-testid="trusted-devices-error"
                role="alert"
              >
                设备没有加载出来。
              </text>
              <text v-else-if="trustedDevices.length === 0" class="device-state">
                暂无信任的设备。
              </text>

              <view
                v-for="device in trustedDevices"
                :key="device.id"
                class="device-row"
                data-testid="trusted-device-row"
              >
                <view class="device-row__copy">
                  <text class="device-row__name">{{ device.displayName }}</text>
                  <text class="device-row__meta">
                    最近使用 {{ formatLocalDateTime(device.lastUsedAt) }}
                  </text>
                  <text class="device-row__meta">
                    {{ formatLocalDateTime(device.expiresAt) }} 到期
                  </text>
                </view>
                <button
                  type="button"
                  class="device-row__revoke"
                  data-testid="trusted-device-revoke"
                  :disabled="busy !== null"
                  @click="onRevokeTrustedDevice(device.id)"
                >
                  {{ busy === `device:${device.id}` ? "撤销中…" : "撤销" }}
                </button>
              </view>

              <text
                v-if="deviceActionError"
                class="device-state device-state--error"
                data-testid="trusted-device-action-error"
                role="alert"
              >
                {{ deviceActionError }}
              </text>
            </view>
          </view>
        </section>

        <section class="settings-section" aria-labelledby="about-section-title">
          <text id="about-section-title" class="settings-section__title">关于</text>
          <view class="settings-list">
            <view class="security-fact" data-testid="ai-identity-note">
              <view class="security-fact__icon" aria-hidden="true">
                <AppIcon name="info" :size="20" />
              </view>
              <view class="settings-row__copy">
                <text class="settings-row__label">AI 陪伴者</text>
                <text class="settings-row__note">回复由 AI 生成，并非真人。</text>
              </view>
            </view>
          </view>
        </section>

        <button
          v-if="auth.role === 'ADMIN'"
          type="button"
          class="admin-entry"
          data-testid="me-admin"
          @click="goTo('/pages/admin/admin')"
        >
          <span>进入管理后台</span>
          <AppIcon name="chevron-right" :size="18" />
        </button>

        <button
          type="button"
          class="logout-action"
          data-testid="account-logout"
          :disabled="busy !== null"
          @click="onLogout"
        >
          <AppIcon name="logout" :size="18" />
          <text>{{ busy === "logout" ? "正在退出…" : "退出登录" }}</text>
        </button>

        <view class="danger-zone">
          <button
            type="button"
            class="danger-zone__toggle"
            data-testid="delete-account-open"
            :aria-expanded="deleteOpen"
            :disabled="busy !== null"
            @click="deleteOpen = !deleteOpen"
          >
            注销账号
          </button>
          <view v-if="deleteOpen" class="danger-zone__confirm" data-testid="delete-account-confirm">
            <text class="danger-zone__title">注销后无法恢复</text>
            <text class="danger-zone__copy">
              聊天等账号数据会被删除；依法需要保留的审计记录会按期限留存。
            </text>
            <text class="form-label">输入当前密码确认</text>
            <input
              v-model="deletePassword"
              class="form-input"
              data-testid="delete-account-password"
              type="password"
              autocomplete="current-password"
              aria-label="注销确认当前密码"
            />
            <text
              v-if="deleteError"
              class="form-message"
              data-testid="delete-account-error"
              role="alert"
            >
              {{ deleteError }}
            </text>
            <view class="danger-zone__actions">
              <!-- VC-R16: busy=delete 期间注销 intent 已提交服务器，「取消」不再
                   诚实（closeDelete 并不撤销请求），仅此状态禁用；提交前取消保留。 -->
              <button
                type="button"
                class="secondary-action"
                data-testid="delete-account-cancel"
                :disabled="busy === 'delete'"
                @click="closeDelete"
              >
                取消
              </button>
              <button
                type="button"
                class="danger-action"
                data-testid="delete-account-confirm-btn"
                :disabled="busy !== null"
                @click="onConfirmDelete"
              >
                {{ busy === "delete" ? "注销中…" : "确认注销" }}
              </button>
            </view>
          </view>
        </view>
      </template>
    </view>
  </ConsumerShell>
</template>

<script setup lang="ts">
import { computed, onActivated, onMounted, ref, watch } from "vue";

import {
  changeAuthPassword,
  deleteAccount,
  listTrustedDevices,
  revokeTrustedDevice,
  type TrustedDevice,
} from "@/api/auth";
import { createAuthedFetch } from "@/api/authed-fetch";
import { createAuthenticatedTransport } from "@/api/transport";
import { goTo } from "@/app/navigate";
import ConsumerShell from "@/app/ConsumerShell.vue";
import DataExportPanel from "@/components/account/DataExportPanel.vue";
import AppIcon from "@/design-system/AppIcon.vue";
import { formatLocalDateTime } from "@/domain/timestamp";
import { useAuthStore } from "@/stores/auth";

type DeviceState = "idle" | "loading" | "ready" | "error";
type BusyAction = "password" | "logout" | "delete" | `device:${string}`;

const auth = useAuthStore();
const passwordOpen = ref(auth.passwordMustChange);
const currentPassword = ref("");
const newPassword = ref("");
const confirmPassword = ref("");
const passwordMessage = ref("");
const trustedDevices = ref<TrustedDevice[]>([]);
const deviceState = ref<DeviceState>("idle");
const deviceActionError = ref("");
const deleteOpen = ref(false);
const deletePassword = ref("");
const deleteError = ref("");
const busy = ref<BusyAction | null>(null);
// VC-R52：期望账号失配（服务端 409 + ACCOUNT_CONTEXT_CHANGED）后的页面级
// 反馈。放账号页层级而不是会被 :key 重建的面板内部，旧面板重建后仍可见。
const accountContextNotice = ref("");

// VC-R11: 当前设备内容归属的账号。普通局部变量，只用于重新激活时的重载
// 判定，不参与渲染。
let devicesForAccountId: string | null = null;

// VC-R11-C: 页面私有两个代次，替代对 auth.getSessionRevision() 的捕获比较。
// store 的代次在「同账号重新认证」（login/tryRefresh 的 persist 不改
// accountId）时同样推进，会把正常在途结果误判过期：设备读取被丢后无人再
// 写 ready/error，设备区会永久停在 loading。页面只关心两种归属：
// deviceLoadSeq 跟设备列表读取，actionSeq 跟所有置 busy 的动作收尾；身份
// 交接清理时两者同步 bump 作废在途请求。撤销只占 actionSeq，不作废在途
// 设备读取。
let deviceLoadSeq = 0;
let actionSeq = 0;

const transport = createAuthenticatedTransport({
  getAccessToken: () => auth.accessToken,
  getAccountId: () => auth.accountId,
  getSessionRevision: () => auth.getSessionRevision(),
  onUnauthorized: () => auth.onUnauthorized(),
  onAccountContextChanged: handleAccountContextChanged,
});

// 副本下载与 transport 同源同一 auth store：cookie 会话 + CSRF + 401 登出。
const authedFetch = createAuthedFetch(() => auth.accessToken, {
  getAccountId: () => auth.accountId,
  getSessionRevision: () => auth.getSessionRevision(),
  onUnauthorized: () => auth.onUnauthorized(),
  onAccountContextChanged: handleAccountContextChanged,
});

const accountMark = computed(() => {
  const value = auth.email?.trim();
  return value ? value.slice(0, 1).toUpperCase() : "我";
});

const canChangePassword = computed(() => (
  currentPassword.value.length > 0
  && newPassword.value.length >= 8
  && newPassword.value === confirmPassword.value
));

onMounted(restoreAccount);
onActivated(reloadStaleAccountSecurity);

// VC-R11: 身份交接清理（A→B 换号或 A→退出）。KeepAlive 缓存的隐藏页跟随
// store 感知换号，同步清空旧账号私有内容；null→X 是初次恢复，不算交接，
// 不得清掉刚恢复出来的状态。清理只动本地副本，绝不发起请求——隐藏页不
// 抢跑，重载交给重新激活时的 onActivated。
watch(() => auth.accountId, (next, prev) => {
  if (prev === null || next === prev) return;
  clearPrivateAccountState();
});

/** 清掉旧账号的私有表单/列表状态，并作废在途请求的收尾：清理只清「此刻」
 * 的字段，迟到的错误文案、列表写入与 busy 复位靠代次比对整段静默丢弃。 */
function clearPrivateAccountState(): void {
  currentPassword.value = "";
  newPassword.value = "";
  confirmPassword.value = "";
  passwordMessage.value = "";
  passwordOpen.value = auth.passwordMustChange;
  deleteOpen.value = false;
  deletePassword.value = "";
  deleteError.value = "";
  trustedDevices.value = [];
  deviceState.value = "idle";
  deviceActionError.value = "";
  busy.value = null;
  devicesForAccountId = null;
  deviceLoadSeq++;
  actionSeq++;
}

/**
 * VC-R52 期望账号失配恢复（transport/authedFetch 归属成立的精确 409 +
 * ACCOUNT_CONTEXT_CHANGED，典型场景是共享 cookie jar 下另一 Tab 换号后本
 * Tab 的陈旧提交）。同步顺序：先置页面级反馈并清掉旧意图/私有表单状态
 * （作废页面动作代次，迟到收尾静默丢弃），再走 store 的
 * reconcileAccountContext——它先同步 clear()（仅本地：作废在途旧探测与旧
 * 动作归属、清共享私有缓存，accountId→null 使既有 v-else/:key 机制卸载旧
 * 面板），随后以 omit 头的 GET /auth/session 发现当前 Cookie 身份。绝不
 * logout、不触碰新账号的服务端会话，也绝不自动重放被拒操作：用户重新
 * 确认（重填密码）后才再次提交。去重由 clear() 推进的代次承担：旧代次的
 * 其余在途 409 被 transport 的归属判定挡下，无需本地标志。
 * 恢复完成后复用 reloadStaleAccountSecurity 按当前真实已认证账号重载安全
 * 区（只读设备列表，不重放写动作）：恢复路径不经 onActivated，null→B 的
 * watch 又按约定直接返回，安全区会停在「暂无信任的设备」。该入口自带的
 * account/seq 归属守卫也拦掉迟到的旧恢复对较新已确立身份的清扰。
 */
function handleAccountContextChanged(): void {
  accountContextNotice.value = "登录状态已更新，请重新确认操作";
  clearPrivateAccountState();
  void auth.reconcileAccountContext(transport).then(() => {
    reloadStaleAccountSecurity();
  });
}

async function restoreAccount(): Promise<void> {
  if (!auth.isAuthenticated) {
    await auth.tryRefresh(transport);
  }
  await loadAccountSecurity();
}

/** 认证确立后的安全区加载：初次恢复与 KeepAlive 重新激活共用。 */
async function loadAccountSecurity(): Promise<void> {
  if (!auth.isAuthenticated) return;
  if (auth.passwordMustChange) passwordOpen.value = true;
  await loadTrustedDevices();
}

/** VC-R11: 重新激活（浏览器后退落回缓存页）。设备内容不属于当前账号且
 * 不在加载中才重载；首次 mount 与 activate 同触时要么已在加载、要么尚未
 * 认证，都被拦下，不会重复请求。 */
function reloadStaleAccountSecurity(): void {
  if (!auth.isAuthenticated) return;
  if (devicesForAccountId === auth.accountId || deviceState.value === "loading") return;
  void loadAccountSecurity();
}

async function loadTrustedDevices(): Promise<void> {
  deviceState.value = "loading";
  deviceActionError.value = "";
  devicesForAccountId = auth.accountId;
  // VC-R11-C: 只判页面私有代次。换号（清理 watch bump）后迟到的成功或失败
  // 静默丢弃；同账号重新认证不 bump，在途结果正常落地，设备区不会挂死。
  const mySeq = ++deviceLoadSeq;
  try {
    const devices = await listTrustedDevices(transport);
    if (mySeq !== deviceLoadSeq) return;
    trustedDevices.value = devices;
    deviceState.value = "ready";
  } catch {
    if (mySeq !== deviceLoadSeq) return;
    deviceState.value = "error";
  }
}

async function onRevokeTrustedDevice(deviceId: string): Promise<void> {
  if (busy.value) return;
  busy.value = `device:${deviceId}`;
  deviceActionError.value = "";
  // VC-R11-C: 撤销只占 actionSeq，不影响在途设备读取。换号后迟到的错误
  // 文案、列表写入与 busy 复位整段丢弃，不得碰新账号正进行的动作。
  const mySeq = ++actionSeq;
  try {
    if (!await revokeTrustedDevice(transport, deviceId)) {
      if (mySeq === actionSeq) {
        deviceActionError.value = "没有撤销成功，请再试一次。";
      }
      return;
    }
    if (mySeq === actionSeq) {
      trustedDevices.value = trustedDevices.value.filter((device) => device.id !== deviceId);
    }
  } catch {
    if (mySeq === actionSeq) {
      deviceActionError.value = "没有撤销成功，请再试一次。";
    }
  } finally {
    if (mySeq === actionSeq) {
      busy.value = null;
    }
  }
}

async function onChangePassword(): Promise<void> {
  if (busy.value || !canChangePassword.value) return;
  busy.value = "password";
  passwordMessage.value = "";
  // VC-R11-C: 迟到的失败文案与 busy 复位按动作代次丢弃。成功路径自身
  // clear() 即身份交接：清理 watch 会 bump actionSeq 并把 busy 置 null，
  // finally 因此跳过复位也不会卡死，成功完成不受影响。
  // VC-R15: 提交前捕获身份归属代次。迟到的旧改密成功只让位给已确立的
  // 较新凭据（新登录/挑战完成的 persist、不同已知账号交接的读回推进
  // credentialEpoch）：不清新身份、不导航登录页、不触碰新账号在途动作的
  // busy（actionSeq 门控不变）。login() 入口的代次推进只是登录「意图」，
  // 同会话 GET /auth/session 读回只是读取，都不让位——没有较新凭据时成功
  // 仍 clear()+去登录页（服务端已撤销全部会话）。判据落在全局 store 上，
  // 页面被卸载或 KeepAlive 隐藏同样成立，与 logout 的让位判据同源。
  const credentialAtSubmit = auth.getCredentialEpoch();
  const mySeq = ++actionSeq;
  try {
    const changed = await changeAuthPassword(
      transport,
      currentPassword.value,
      newPassword.value,
    );
    if (!changed) {
      if (mySeq === actionSeq) {
        passwordMessage.value = "没有修改成功，请检查当前密码。";
      }
      return;
    }
    if (auth.getCredentialEpoch() !== credentialAtSubmit) return;
    auth.clear();
    goTo("/pages/login/login");
  } catch {
    if (mySeq === actionSeq) {
      passwordMessage.value = "没有修改成功，请稍后再试。";
    }
  } finally {
    if (mySeq === actionSeq) {
      busy.value = null;
    }
  }
}

async function onLogout(): Promise<void> {
  if (busy.value) return;
  busy.value = "logout";
  const mySeq = ++actionSeq;
  try {
    // VC-R12: 只有本地清理归属本次调用、且此刻没有较新已认证身份才导航；
    // 让位给较新登录的迟到登出不得清掉新身份，也不得把页面拽回登录页。
    const owned = await auth.logout(transport);
    if (owned && !auth.isAuthenticated) goTo("/pages/login/login");
  } finally {
    if (mySeq === actionSeq) {
      busy.value = null;
    }
  }
}

function closeDelete(): void {
  deleteOpen.value = false;
  deletePassword.value = "";
  deleteError.value = "";
}

async function onConfirmDelete(): Promise<void> {
  if (busy.value) return;
  if (!deletePassword.value) {
    deleteError.value = "请输入当前密码。";
    return;
  }
  busy.value = "delete";
  deleteError.value = "";
  // VC-R11-C: 与改密同款动作代次门控；成功路径自身 clear() 的复位豁免同上。
  // VC-R16: 提交前捕获账号归属。注销是「账号级」后置条件，判据与 R15 改密的
  // credentialEpoch（凭据级）不同：迟到成功只有在当前身份仍等于提交时的
  // accountId 时才本地退出——同账号 A 在 DELETE 完成前重登（accountId 不变）
  // 也必须退出（账号已在服务端删除）；换号 B 或已变匿名（null）则静默让位，
  // 不清新身份、不重置新的登录流程、不导航。
  const accountAtSubmit = auth.accountId;
  const mySeq = ++actionSeq;
  try {
    if (!await deleteAccount(transport, deletePassword.value)) {
      if (mySeq === actionSeq) {
        // 非 ok 覆盖 404/503（intent 可能已持久化后失败、404 还隐藏存在性；
        // 401 由 transport 的 onUnauthorized 先清会话，不走该文案）：
        // 结果无法确认，不得绝对断言密码不正确或未注销。
        deleteError.value = "注销结果无法确认，请核对当前密码后重试。";
      }
      return;
    }
    if (auth.accountId === accountAtSubmit) {
      auth.clear();
      goTo("/pages/login/login");
    }
  } catch {
    if (mySeq === actionSeq) {
      // 网络断连：服务端可能已受理注销，同样不得谎称未注销。
      deleteError.value = "暂时无法确认注销结果，请检查网络后重试。";
    }
  } finally {
    if (mySeq === actionSeq) {
      busy.value = null;
    }
  }
}
</script>

<style scoped>
.profile-page {
  width: 100%;
  padding-bottom: var(--vc-space-4);
}

.profile-topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: 44px;
  margin-bottom: var(--vc-space-5);
}

.profile-topbar__title {
  font-size: 24px;
  font-weight: 650;
  line-height: 32px;
}

.profile-mark {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border: 1px solid var(--vc-color-hairline);
  border-radius: var(--vc-radius-full);
  background: var(--vc-color-surface);
  color: var(--vc-color-primary);
  font-size: 15px;
  font-weight: 700;
}

.profile-identity {
  display: flex;
  align-items: center;
  gap: var(--vc-space-3);
  min-width: 0;
  margin-bottom: var(--vc-space-6);
  padding: var(--vc-space-4);
  border: 1px solid var(--vc-color-hairline);
  border-radius: var(--vc-radius-hero);
  background: var(--vc-color-surface);
}

.profile-avatar {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  justify-content: center;
  width: 46px;
  height: 46px;
  border-radius: var(--vc-radius-full);
  background: var(--vc-color-surface-soft);
  color: var(--vc-color-primary);
  font-size: 18px;
  font-weight: 650;
}

.profile-identity__copy,
.settings-row__copy,
.device-row__copy {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
  text-align: left;
}

.profile-identity__label,
.settings-row__note,
.device-row__meta,
.form-hint,
.profile-state__copy,
.danger-zone__copy {
  color: var(--vc-color-ink-muted);
  font-size: 12px;
  line-height: 18px;
}

.profile-identity__email {
  overflow-wrap: anywhere;
  color: var(--vc-color-ink);
  font-size: 16px;
  font-weight: 600;
  line-height: 24px;
}

.required-notice {
  display: flex;
  align-items: flex-start;
  gap: var(--vc-space-2);
  margin-bottom: var(--vc-space-5);
  padding: var(--vc-space-3);
  border: 1px solid var(--vc-color-hairline);
  border-radius: var(--vc-radius-control);
  background: var(--vc-color-surface-soft);
  color: var(--vc-color-primary);
  font-size: 13px;
  line-height: 20px;
}

.context-notice {
  margin-bottom: var(--vc-space-5);
  padding: var(--vc-space-3);
  border: 1px solid var(--vc-color-hairline);
  border-radius: var(--vc-radius-control);
  background: var(--vc-color-surface-soft);
  color: var(--vc-color-ink);
  font-size: 13px;
  line-height: 20px;
}

.settings-section {
  display: block;
  margin-bottom: var(--vc-space-5);
}

.settings-section__title {
  display: block;
  margin: 0 0 var(--vc-space-2) var(--vc-space-1);
  color: var(--vc-color-ink-muted);
  font-size: 13px;
  font-weight: 600;
  line-height: 20px;
}

.settings-list {
  overflow: hidden;
  border: 1px solid var(--vc-color-hairline);
  border-radius: var(--vc-radius-card);
  background: var(--vc-color-surface);
}

.settings-row,
.security-fact,
.trusted-devices {
  width: 100%;
  margin: 0;
  padding: var(--vc-space-3) var(--vc-space-4);
  border: 0;
  border-radius: 0;
  background: transparent;
  color: var(--vc-color-ink);
  font: inherit;
}

.settings-row,
.security-fact {
  display: flex;
  align-items: center;
  gap: var(--vc-space-3);
  min-height: 64px;
}

.settings-row + .settings-row,
.settings-row + .inline-form,
.security-fact + .trusted-devices {
  border-top: 1px solid var(--vc-color-hairline);
}

.settings-row::after,
.primary-action::after,
.secondary-action::after,
.text-action::after,
.device-row__revoke::after,
.admin-entry::after,
.logout-action::after,
.danger-zone__toggle::after,
.danger-action::after {
  border: 0;
}

.settings-row:active,
.admin-entry:active {
  background: var(--vc-color-surface-soft);
}

.settings-row__label,
.device-row__name {
  color: var(--vc-color-ink);
  font-size: 15px;
  font-weight: 550;
  line-height: 22px;
}

.security-fact__icon {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  justify-content: center;
  width: 34px;
  height: 34px;
  border-radius: var(--vc-radius-full);
  background: var(--vc-color-surface-soft);
  color: var(--vc-color-success);
}

.security-fact__icon--warning {
  color: var(--vc-color-warning);
}

.trusted-devices {
  display: block;
}

.trusted-devices__heading {
  display: flex;
  align-items: flex-start;
  gap: var(--vc-space-2);
}

.device-state {
  display: block;
  padding: var(--vc-space-3) 0 var(--vc-space-1);
  color: var(--vc-color-ink-muted);
  font-size: 13px;
  line-height: 20px;
}

.device-state--error,
.form-message {
  color: var(--vc-color-error);
}

.device-row {
  display: flex;
  align-items: center;
  gap: var(--vc-space-3);
  margin-top: var(--vc-space-3);
  padding-top: var(--vc-space-3);
  border-top: 1px solid var(--vc-color-hairline);
}

.device-row__revoke,
.text-action,
.danger-zone__toggle {
  min-width: 44px;
  min-height: 44px;
  margin: 0;
  padding: 0 var(--vc-space-2);
  border: 0;
  background: transparent;
  color: var(--vc-color-error);
  font: inherit;
  font-size: 13px;
}

.text-action {
  color: var(--vc-color-primary);
}

.inline-form {
  padding: var(--vc-space-4);
  background: var(--vc-color-surface-soft);
}

.form-label {
  display: block;
  margin: var(--vc-space-3) 0 var(--vc-space-1);
  color: var(--vc-color-ink);
  font-size: 13px;
  font-weight: 550;
  line-height: 20px;
}

.form-label:first-child {
  margin-top: 0;
}

.form-input {
  width: 100%;
  min-height: 46px;
  padding: 10px var(--vc-space-3);
  border: 1px solid var(--vc-color-hairline);
  border-radius: var(--vc-radius-control);
  background: var(--vc-color-surface);
  color: var(--vc-color-ink);
  font-size: 16px;
}

.form-message {
  display: block;
  margin-top: var(--vc-space-2);
  font-size: 13px;
  line-height: 20px;
}

.primary-action,
.secondary-action,
.danger-action {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 48px;
  margin: var(--vc-space-4) 0 0;
  padding: 0 var(--vc-space-4);
  border: 1px solid transparent;
  border-radius: var(--vc-radius-control);
  font: inherit;
  font-size: 15px;
  font-weight: 600;
}

.primary-action {
  width: 100%;
  background: var(--vc-color-primary);
  color: var(--vc-color-surface);
}

.primary-action--compact {
  margin-top: var(--vc-space-4);
}

.secondary-action {
  background: var(--vc-color-surface);
  border-color: var(--vc-color-hairline);
  color: var(--vc-color-ink);
}

.danger-action {
  background: var(--vc-color-error);
  color: var(--vc-color-surface);
}

.admin-entry,
.logout-action {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--vc-space-2);
  width: 100%;
  min-height: 48px;
  margin: 0 0 var(--vc-space-4);
  padding: 0 var(--vc-space-4);
  border: 1px solid var(--vc-color-hairline);
  border-radius: var(--vc-radius-control);
  background: var(--vc-color-surface);
  color: var(--vc-color-ink);
  font: inherit;
  font-size: 14px;
}

.logout-action {
  justify-content: center;
  color: var(--vc-color-primary);
  font-weight: 600;
}

.danger-zone {
  padding-top: var(--vc-space-2);
  border-top: 1px solid var(--vc-color-hairline);
  text-align: center;
}

.danger-zone__toggle {
  color: var(--vc-color-ink-muted);
}

.danger-zone__confirm {
  margin-top: var(--vc-space-2);
  padding: var(--vc-space-4);
  border: 1px solid var(--vc-color-hairline);
  border-radius: var(--vc-radius-card);
  background: var(--vc-color-surface);
  text-align: left;
}

.danger-zone__title,
.danger-zone__copy {
  display: block;
}

.danger-zone__title {
  color: var(--vc-color-error);
  font-size: 15px;
  font-weight: 650;
}

.danger-zone__actions {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--vc-space-2);
}

.profile-state {
  display: flex;
  flex-direction: column;
  justify-content: center;
  min-height: 320px;
  padding: var(--vc-space-5);
  text-align: center;
}

.profile-state__title {
  color: var(--vc-color-ink);
  font-size: 20px;
  font-weight: 650;
  line-height: 28px;
}

.profile-state__copy {
  margin-top: var(--vc-space-2);
}

.profile-skeleton {
  width: 100%;
  height: 18px;
  margin: var(--vc-space-2) 0;
  border-radius: var(--vc-radius-full);
  background: var(--vc-color-surface-soft);
}

.profile-skeleton--short {
  width: 42%;
}

@media (max-width: 340px) {
  .profile-identity,
  .settings-row,
  .security-fact,
  .trusted-devices,
  .inline-form,
  .danger-zone__confirm {
    padding-right: var(--vc-space-3);
    padding-left: var(--vc-space-3);
  }
}
</style>
