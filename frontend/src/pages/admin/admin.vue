<template>
  <InternalShell route="/pages/admin/admin">
    <!-- 稳定内部导航：按账户 / 用量 / 审计 / 安全 / 队列 / 权益 / 邀请分区
         （Phase 6）；窄屏为可横滑的锚点条。 -->
    <nav class="admin-anchor" data-testid="admin-section-nav" aria-label="内部分区导航">
      <button
        v-for="section in SECTIONS"
        :key="section.id"
        class="admin-anchor__item"
        :data-testid="`admin-anchor-${section.id}`"
        @click="jumpTo(section.id)"
      >
        {{ section.label }}
      </button>
    </nav>

    <view
      v-if="!isOperator"
      class="admin-notice"
      data-testid="admin-not-allowed"
      role="status"
    >
      <text>当前账号不是运营人员，无法查看工单。</text>
    </view>

    <template v-else>
      <template v-if="isAdmin">
      <view class="admin-form">
        <input
          v-model="username"
          class="admin-input"
          data-testid="account-username"
          placeholder="用户名"
          aria-label="用户名"
          :disabled="busy"
        />
        <input
          v-model="password"
          class="admin-input"
          data-testid="account-password"
          placeholder="密码"
          aria-label="密码"
          type="password"
          :disabled="busy"
        />
        <input
          v-model="displayName"
          class="admin-input"
          data-testid="account-display-name"
          placeholder="显示名"
          aria-label="显示名"
          :disabled="busy"
        />
        <select
          v-model="role"
          class="admin-select"
          data-testid="account-role"
          aria-label="角色"
          :disabled="busy"
        >
          <option value="USER">USER</option>
          <option value="ADMIN">ADMIN</option>
        </select>
        <button
          data-testid="create-account"
          class="admin-submit"
          :disabled="busy || !canSubmit"
          @click="onCreate"
        >
          {{ busy ? "开通中…" : "开通账户" }}
        </button>
      </view>

      <view id="admin-sec-accounts">
      <!-- ADMIN-ACCTS: the account registry with per-account disable. -->
      <view class="account-list">
        <view class="account-list-head">
          <text class="account-list-title">账户列表</text>
          <button
            data-testid="refresh-accounts"
            class="admin-nav-index"
            :disabled="busy"
            @click="onRefreshAccounts"
          >
            刷新
          </button>
        </view>
        <view v-if="loadFailed" class="admin-error" data-testid="account-load-failed" role="alert">
          <text>账户列表加载失败，请重试。</text>
        </view>
        <view
          v-for="account in accounts"
          :key="account.accountId"
          class="account-row"
          data-testid="account-row"
        >
          <text class="account-cell">{{ account.username }}</text>
          <text class="account-cell">{{ account.role }}</text>
          <text class="account-cell">{{ account.status }}</text>
          <text class="account-cell">{{ account.displayName }}</text>
          <button
            v-if="account.status === 'ACTIVE' && account.accountId !== auth.accountId"
            class="admin-row-btn"
            data-testid="disable-account"
            :disabled="busy"
            @click="onDisable(account)"
          >
            禁用
          </button>
          <button
            v-if="account.status === 'ACTIVE' && account.accountId !== auth.accountId"
            class="admin-row-btn"
            data-testid="reset-account-select"
            :disabled="busy"
            @click="resetAccountId = account.accountId"
          >
            安全重置
          </button>
        </view>
      </view>

      <view class="admin-form" data-testid="admin-reset-card">
        <text class="account-list-title">管理员安全重置</text>
        <text class="admin-hint">先用当前管理员密码 re-auth（15 分钟），再设置目标账号临时密码。系统不会发送邮件或短信，须走已批准的线下渠道。</text>
        <input
          v-model="reauthPassword"
          class="admin-input"
          data-testid="admin-reauth-password"
          type="password"
          autocomplete="current-password"
          placeholder="当前管理员密码"
          aria-label="当前管理员密码"
        />
        <button
          class="admin-nav-index"
          data-testid="admin-reauth"
          :disabled="busy || !reauthPassword"
          @click="onAdminReauth"
        >
          确认管理员身份
        </button>
        <input
          v-model="resetAccountId"
          class="admin-input"
          data-testid="reset-account-id"
          placeholder="目标账号编号"
          aria-label="目标账号编号"
        />
        <input
          v-model="resetPassword"
          class="admin-input"
          data-testid="reset-temporary-password"
          type="password"
          autocomplete="new-password"
          placeholder="临时密码"
          aria-label="临时密码"
        />
        <button
          class="admin-nav-index"
          data-testid="admin-reset-password"
          :disabled="busy || !reauthOk || !resetAccountId || resetPassword.length < 12"
          @click="onAdminResetPassword"
        >
          设置临时密码并撤销旧会话
        </button>
        <text v-if="resetMessage" class="admin-hint" data-testid="admin-reset-message">
          {{ resetMessage }}
        </text>
      </view>

      <view v-if="result" class="admin-result" data-testid="account-result" role="status">
        <text>已开通：{{ result.username }}（{{ result.role }}，状态 {{ result.status }}）</text>
      </view>
      <view v-if="failed" class="admin-error" data-testid="account-failed" role="alert">
        <text>开通失败，请检查输入或权限（不会披露用户名是否存在）。</text>
      </view>

      <!-- DOGFOOD-05 (ADR-0006 §3.3): provider plan status card. UNKNOWN
           renders no quota, allowance or cost figure at all — never a zero
           or fabricated remaining amount. -->
      <view class="ops-section">
        <view class="account-list-head">
          <text class="account-list-title">Provider 套餐状态</text>
          <button
            data-testid="refresh-provider-plan"
            class="admin-nav-index"
            :disabled="busy"
            @click="onRefreshProviderPlan"
          >
            刷新
          </button>
        </view>
        <view
          v-if="planFailed"
          class="admin-error"
          data-testid="provider-plan-failed"
          role="alert"
        >
          <text>套餐状态加载失败，请重试。</text>
        </view>
        <view
          v-else-if="providerPlan?.status === 'VALID'"
          class="audit-row"
          data-testid="provider-plan-row"
        >
          <text class="audit-cell">套餐：{{ providerPlan.planName || "（未命名）" }}</text>
          <text class="audit-cell">
            适用期：{{ providerPlan.validFrom || "?" }} ~ {{ providerPlan.validUntil || "?" }}
          </text>
          <text class="audit-cell">
            限额：{{ providerPlan.tokenCap == null ? "未配置" : providerPlan.tokenCap }} tokens /
            {{ providerPlan.requestCap == null ? "未配置" : providerPlan.requestCap }} 次请求
          </text>
          <text v-if="providerPlan.monthCostUsd != null" class="audit-cell">
            本月已结算成本：{{ providerPlan.monthCostUsd.toFixed(4) }} USD
          </text>
        </view>
        <view
          v-else-if="providerPlan?.status === 'UNKNOWN'"
          class="admin-error"
          data-testid="provider-plan-unknown"
          role="alert"
        >
          <text>UNKNOWN（配置缺失或过期）——额度与成本信息不可用，不显示任何估算值。</text>
        </view>
        <view
          v-else-if="providerPlan?.status === 'DISABLED'"
          class="admin-empty"
          data-testid="provider-plan-disabled"
        >
          <text>套餐监控未启用。</text>
        </view>
      </view>

      </view>
      <view id="admin-sec-usage">
      <!-- ADMIN-OPS: per-day usage/cost summary -->
      <view class="ops-section">
        <view class="account-list-head">
          <text class="account-list-title">用量与成本（近 14 天）</text>
          <button
            data-testid="refresh-usage"
            class="admin-nav-index"
            :disabled="busy"
            @click="onRefreshUsage"
          >
            刷新
          </button>
        </view>
        <view v-if="usageFailed" class="admin-error" data-testid="usage-failed" role="alert">
          <text>用量统计加载失败，请重试。</text>
        </view>
        <view v-if="usageRows.length > 0" class="usage-table" data-testid="usage-table">
          <view v-for="row in usageRows" :key="row.day" class="usage-row" data-testid="usage-row">
            <text class="usage-cell">{{ row.day }}</text>
            <text class="usage-cell">{{ row.generations }} 轮</text>
            <text class="usage-cell">{{ row.inputTokens }} / {{ row.outputTokens }} tokens</text>
            <text class="usage-cell">{{ row.cost.toFixed(6) }}</text>
          </view>
        </view>
        <view v-else-if="!usageFailed" class="admin-empty" data-testid="usage-empty">
          <text>暂无已结算的生成用量。</text>
        </view>
      </view>

      </view>
      <view id="admin-sec-audit">
      <!-- ADMIN-OPS: append-only audit trail -->
      <view class="ops-section">
        <view class="account-list-head">
          <text class="account-list-title">审计日志</text>
          <button
            data-testid="refresh-audit"
            class="admin-nav-index"
            :disabled="busy"
            @click="onRefreshAudit"
          >
            刷新
          </button>
        </view>
        <view v-if="auditFailed" class="admin-error" data-testid="audit-failed" role="alert">
          <text>审计日志加载失败，请重试。</text>
        </view>
        <view
          v-for="event in auditEvents"
          :key="event.id"
          class="audit-row"
          data-testid="audit-row"
        >
          <text class="audit-cell">{{ event.eventType }}</text>
          <text class="audit-cell">{{ event.username }}</text>
          <text class="audit-cell">{{ event.occurredAt }}</text>
        </view>
        <button
          v-if="auditHasMore"
          data-testid="audit-load-more"
          class="admin-nav-index"
          :disabled="busy"
          @click="onLoadMoreAudit"
        >
          加载更早
        </button>
      </view>

      </view>
      <view id="admin-sec-safety">
      <!-- SAFETY-QUEUE (V59): read-only deterministic safety queue; triage
           stays a human action outside this page. -->
      <view class="ops-section">
        <view class="account-list-head">
          <text class="account-list-title">安全事件队列（只读）</text>
          <button
            data-testid="refresh-safety"
            class="admin-nav-index"
            :disabled="busy"
            @click="onRefreshSafety"
          >
            刷新
          </button>
        </view>
        <view v-if="safetyFailed" class="admin-error" data-testid="safety-failed" role="alert">
          <text>安全事件加载失败，请重试。</text>
        </view>
        <view
          v-else-if="safetyEvents.length === 0"
          class="admin-empty"
          data-testid="safety-empty"
        >
          <text>暂无安全事件。</text>
        </view>
        <view
          v-for="event in safetyEvents"
          :key="event.id"
          class="audit-row"
          data-testid="safety-row"
        >
          <text class="audit-cell">{{ event.riskLevel }}</text>
          <text class="audit-cell">{{ event.stage }}</text>
          <text class="audit-cell">{{ event.ruleId }}</text>
          <text class="audit-cell">账号 {{ event.ownerId }}</text>
          <text class="audit-cell">{{ event.createdAt }}</text>
          <!-- METRICS-ALERT: 事实年龄 + 部署阈值判出的 SLA 超时标记，处置仍是人工。 -->
          <text class="audit-cell" data-testid="safety-sla">
            {{ event.ageHours }}h{{ event.slaBreached ? " · SLA 超时" : "" }}
          </text>
        </view>
      </view>

      </view>
      <view id="admin-sec-queues">
      <!-- ADMIN-BETA (V64): read-only intake queues — report, age appeal,
           export task and memory-anomaly sampling. Triage and disposition
           stay human actions outside this page. -->
      <view class="ops-section">
        <view class="account-list-head">
          <text class="account-list-title">举报队列（只读）</text>
          <button
            data-testid="refresh-beta-queues"
            class="admin-nav-index"
            :disabled="busy"
            @click="onRefreshBetaQueues"
          >
            刷新
          </button>
        </view>
        <view v-if="betaFailed" class="admin-error" data-testid="beta-queues-failed" role="alert">
          <text>Beta 队列加载失败，请重试。</text>
        </view>
        <view
          v-else-if="betaReports.length === 0"
          class="admin-empty"
          data-testid="reports-empty"
        >
          <text>暂无举报。</text>
        </view>
        <view
          v-for="report in betaReports"
          :key="report.id"
          class="audit-row"
          data-testid="beta-report-row"
        >
          <text class="audit-cell">{{ report.reason }}</text>
          <text class="audit-cell">{{ report.status }}</text>
          <text class="audit-cell">账号 {{ report.ownerId }}</text>
          <text class="audit-cell">{{ report.note }}</text>
          <text class="audit-cell">{{ report.createdAt }}</text>
        </view>
        <view
          v-if="!betaFailed && betaAppeals.length === 0"
          class="admin-empty"
        >
          <text>暂无年龄申诉。</text>
        </view>
        <view
          v-for="appeal in betaAppeals"
          :key="appeal.id"
          class="audit-row"
          data-testid="beta-appeal-row"
        >
          <text class="audit-cell">{{ appeal.status }}</text>
          <text class="audit-cell">账号 {{ appeal.ownerId }}</text>
          <text class="audit-cell">{{ appeal.reason }}</text>
          <text class="audit-cell">{{ appeal.createdAt }}</text>
        </view>
        <view v-if="!betaFailed && betaExports.length === 0" class="admin-empty">
          <text>暂无导出任务。</text>
        </view>
        <view
          v-for="task in betaExports"
          :key="task.id"
          class="audit-row"
          data-testid="beta-export-row"
        >
          <text class="audit-cell">{{ task.status }}</text>
          <text class="audit-cell">账号 {{ task.ownerId }}</text>
          <text class="audit-cell">{{ task.createdAt }}</text>
          <text class="audit-cell">{{ task.completedAt ?? "未完成" }}</text>
        </view>
      </view>

      <!-- ADMIN-BETA (V64): memory-anomaly sampling (non-ACCEPTED or
           soft-deleted memory rows), newest first. -->
      <view class="ops-section">
        <view class="account-list-head">
          <text class="account-list-title">记忆异常抽样（只读）</text>
        </view>
        <view v-if="betaFailed" class="admin-error" role="alert">
          <text>记忆抽样加载失败，请重试。</text>
        </view>
        <view
          v-else-if="betaSampling.length === 0"
          class="admin-empty"
          data-testid="sampling-empty"
        >
          <text>暂无异常记忆样本。</text>
        </view>
        <view
          v-for="sample in betaSampling"
          :key="sample.id"
          class="audit-row"
          data-testid="beta-sampling-row"
        >
          <text class="audit-cell">{{ sample.status }}</text>
          <text class="audit-cell">{{ sample.scope }}</text>
          <text class="audit-cell">账号 {{ sample.ownerId }}</text>
          <text class="audit-cell">{{ sample.summary }}</text>
          <text class="audit-cell">{{ sample.deletedAt ?? "未删除" }}</text>
        </view>
      </view>

      </view>
      <view id="admin-sec-entitlements">
      <!-- ENT-TRIAL (V61): simulated PREMIUM trial budgets. -->
      <view class="ops-section">
        <view class="account-list-head">
          <text class="account-list-title">试用授予（模拟 PREMIUM）</text>
        </view>
        <view class="sc-row">
          <input
            v-model="trialAccountId"
            class="rename-input"
            data-testid="trial-account-input"
            placeholder="账号编号"
            aria-label="目标账号编号"
          />
          <button
            data-testid="trial-grant"
            class="admin-nav-index"
            :disabled="busy || !trialAccountId.trim()"
            @click="onGrantTrial"
          >
            授予 20 轮 / 14 天
          </button>
        </view>
        <view v-if="trialResult" class="admin-empty" data-testid="trial-result" role="status">
          <text>{{ trialResult }}</text>
        </view>
        <view v-else-if="trialFailed" class="admin-error" data-testid="trial-failed" role="alert">
          <text>试用授予失败，请重试。</text>
        </view>
      </view>

      <!-- QUOTA-PERSIST (V61): ledger reconciliation + persisted registry. -->
      <view class="ops-section">
        <view class="account-list-head">
          <text class="account-list-title">配额对账与模型注册表</text>
          <button
            data-testid="recon-refresh"
            class="admin-nav-index"
            :disabled="busy"
            @click="onRefreshRecon"
          >
            刷新
          </button>
        </view>
        <view v-if="reconFailed" class="admin-error" data-testid="recon-failed" role="alert">
          <text>对账数据加载失败，请重试。</text>
        </view>
        <view v-else-if="recon" class="audit-row" data-testid="recon-row">
          <text class="audit-cell">结算 {{ recon.settledCount }} 笔 / {{ recon.settledAmount }}</text>
          <text class="audit-cell">冲正 {{ recon.releasedCount }} 笔 / {{ recon.releasedAmount }}</text>
          <text class="audit-cell">异常：结算未完成 {{ recon.settledNotCompleted }} · 完成未结算 {{ recon.completedNotSettled }} · 失败未冲正 {{ recon.failedWithoutRelease }}</text>
        </view>
        <view
          v-for="dep in registry"
          :key="dep.providerId"
          class="audit-row"
          data-testid="registry-row"
        >
          <text class="audit-cell">{{ dep.providerId }}</text>
          <text class="audit-cell">{{ dep.protocol }}</text>
          <text class="audit-cell">{{ dep.admissionState }}</text>
          <text class="audit-cell">{{ dep.updatedAt }}</text>
        </view>
      </view>

      </view>
      <view id="admin-sec-invites">
      <!-- INVITE (V60): single-use invite codes; registration itself is
           config-gated on the server (default off). -->
      <view class="ops-section">
        <view class="account-list-head">
          <text class="account-list-title">邀请码（凭码开通测试账号）</text>
          <button
            data-testid="invite-create"
            class="admin-nav-index"
            :disabled="busy"
            @click="onCreateInvite"
          >
            生成邀请码
          </button>
        </view>
        <view v-if="inviteCreated" class="admin-empty" data-testid="invite-created" role="status">
          <text>新邀请码：{{ inviteCreated.code }}（14 天内有效，一次性使用）</text>
        </view>
        <view v-if="inviteFailed" class="admin-error" data-testid="invite-failed" role="alert">
          <text>邀请码操作失败，请重试。</text>
        </view>
        <view
          v-for="invite in invites"
          :key="invite.id"
          class="audit-row"
          data-testid="invite-row"
        >
          <text class="audit-cell">{{ invite.code }}</text>
          <text class="audit-cell">{{ invite.status }}</text>
          <text class="audit-cell">{{ invite.expiresAt }}</text>
          <button
            v-if="invite.status === 'ACTIVE'"
            class="admin-nav-index"
            :data-testid="`invite-disable-${invite.code}`"
            :disabled="busy"
            @click="onDisableInvite(invite.code)"
          >
            停用
          </button>
        </view>
      </view>

      <!-- ENT-SNAP (V40): simulated service-class assignment -->
      <view class="ops-section">
        <view class="account-list-head">
          <text class="account-list-title">权益分配（模拟 ECONOMY / PREMIUM）</text>
          <button
            data-testid="refresh-service-classes"
            class="admin-nav-index"
            :disabled="busy"
            @click="onRefreshServiceClasses"
          >
            刷新
          </button>
        </view>
        <view v-if="scFailed" class="admin-error" data-testid="service-class-failed" role="alert">
          <text>权益分配加载失败，请重试。</text>
        </view>
        <view class="sc-form">
          <select
            v-model="scAccountId"
            class="admin-select"
            data-testid="sc-account"
            aria-label="目标账户"
            :disabled="busy"
          >
            <option value="">选择账户</option>
            <option v-for="acc in accounts" :key="acc.accountId" :value="acc.accountId">
              {{ acc.username }}
            </option>
          </select>
          <select
            v-model="scClass"
            class="admin-select"
            data-testid="sc-class"
            aria-label="权益等级"
            :disabled="busy"
          >
            <option value="ECONOMY">ECONOMY</option>
            <option value="PREMIUM">PREMIUM</option>
          </select>
          <button
            data-testid="sc-assign"
            class="admin-nav-index"
            :disabled="busy || !scAccountId"
            @click="onAssignServiceClass"
          >
            分配
          </button>
        </view>
        <view
          v-for="row in scAssignments"
          :key="row.accountId"
          class="audit-row"
          data-testid="sc-row"
        >
          <text class="audit-cell">{{ row.username }}</text>
          <text class="audit-cell">{{ row.serviceClass }}</text>
        </view>
        <view v-if="scResult" class="admin-result" data-testid="sc-result" role="status">
          <text>{{ `已分配：${scResult.username} → ${scResult.serviceClass}` }}</text>
        </view>
      </view>
      </view>
      </template>

      <!-- S0-14-D: redacted ops-case queue. Never renders body/providerRef/internal notes. -->
      <view class="ops-section">
        <view class="account-list-head">
          <text class="account-list-title">工单（脱敏）</text>
          <button
            data-testid="refresh-cases"
            class="admin-nav-index"
            :disabled="busy"
            @click="onRefreshCases"
          >
            刷新
          </button>
        </view>
        <view v-if="casesFailed" class="admin-error" data-testid="cases-failed" role="alert">
          <text>工单加载失败，请重试。</text>
        </view>
        <view
          v-else-if="cases.length === 0"
          class="admin-empty"
          data-testid="cases-empty"
        >
          <text>暂无工单。</text>
        </view>
        <view
          v-for="row in cases"
          :key="row.id"
          class="audit-row"
          data-testid="ops-case-row"
        >
          <text class="audit-cell">{{ row.kind }}</text>
          <text class="audit-cell">{{ row.status }}</text>
          <text class="audit-cell">{{ row.severity }}</text>
          <text class="audit-cell">账号 {{ row.sourceOwnerId }}</text>
          <text class="audit-cell">{{ row.publicNote || "无公开说明" }}</text>
          <text class="audit-cell">{{ row.openedAt }}</text>
          <input
            v-if="canMutateCases && row.status !== 'RESOLVED'"
            v-model="caseDisposition[row.id]"
            data-testid="ops-case-disposition"
            class="admin-input"
            maxlength="240"
            placeholder="结案说明（结案时必填）"
            aria-label="结案说明"
          />
          <input
            v-if="canMutateCases"
            v-model="casePublicNote[row.id]"
            data-testid="ops-case-public-note"
            class="admin-input"
            maxlength="240"
            :placeholder="row.publicNote || '用户可见说明'"
            aria-label="用户可见说明"
          />
          <button
            v-if="canMutateCases"
            data-testid="ops-case-save-public-note"
            class="admin-nav-index"
            :disabled="busy"
            @click="onCaseNote(row.id, 'PUBLIC')"
          >
            保存公开说明
          </button>
          <input
            v-if="canMutateCases"
            v-model="caseInternalDraft[row.id]"
            data-testid="ops-case-internal-note"
            class="admin-input"
            maxlength="500"
            placeholder="内部备注（不向用户展示）"
            aria-label="内部备注"
          />
          <button
            v-if="canMutateCases"
            data-testid="ops-case-save-internal-note"
            class="admin-nav-index"
            :disabled="busy"
            @click="onCaseNote(row.id, 'INTERNAL')"
          >
            保存内部备注
          </button>
          <button
            v-if="canMutateCases"
            data-testid="ops-case-read-internal-note"
            class="admin-nav-index"
            :disabled="busy"
            @click="onReadInternalNote(row.id)"
          >
            读取内部备注
          </button>
          <text
            v-if="caseInternalRead[row.id] !== undefined"
            class="audit-cell"
            data-testid="ops-case-internal-note-read"
          >
            {{ caseInternalRead[row.id] || "无内部备注" }}
          </text>
          <button
            v-if="canMutateCases && row.status !== 'RESOLVED'"
            data-testid="ops-case-ack"
            class="admin-nav-index"
            :disabled="busy"
            @click="onCaseAction(row.id, 'ACK')"
          >
            确认
          </button>
          <button
            v-if="canMutateCases && row.status !== 'RESOLVED'"
            data-testid="ops-case-resolve"
            class="admin-nav-index"
            :disabled="busy || !caseDisposition[row.id]?.trim()"
            @click="onCaseAction(row.id, 'RESOLVE')"
          >
            结案
          </button>
        </view>
      </view>
    </template>
  </InternalShell>
</template>

<script lang="ts">
// ADMIN-UI: internal account provisioning page. Backed by POST
// /api/v1/auth/admin/accounts (ADMIN only). A non-OK response maps to null via
// the typed auth client and the page shows one generic failure message — it
// never discloses whether a username already exists (INV-TENANT-001). The
// backend rejects non-ADMIN callers; the page additionally gates the form on
// the local role for honest UX. Passwords are sent once over the authenticated
// transport and never persisted or logged.
import { computed, defineComponent, onMounted, ref } from "vue";

import {
  adminResetPassword,
  assignServiceClass,
  createAccount,
  createInvite,
  disableAccount,
  disableInvite,
  grantTrial,
  listAccounts,
  listBetaAgeAppeals,
  listBetaExportTasks,
  listBetaMemorySampling,
  listBetaReports,
  listInvites,
  providerRegistry,
  quotaReconciliation,
  listAuditEvents,
  reauthAuth,
  listOpsCases,
  readOpsCaseInternalNote,
  listSafetyEvents,
  transitionOpsCase,
  updateOpsCaseNote,
  listServiceClassAssignments,
  usageSummary,
  providerPlanStatus,
  type AccountListItem,
  type AuditEventListItem,
  type BetaAgeAppealItem,
  type BetaExportTaskItem,
  type BetaMemorySamplingItem,
  type BetaReportItem,
  type InviteCreated,
  type InviteListItem,
  type ProviderRegistryItem,
  type QuotaReconciliation,
  type SafetyEventItem,
  type ServiceClassAssignmentItem,
  type UsageSummaryItem,
  type ProviderPlanStatus,
} from "@/api/auth";
import { canEnterAdminPage } from "@/domain/nav-guard";
import type { PublicOpsCase } from "@/domain/ops-case-redact";
import { createAuthenticatedTransport } from "@/api/transport";
import InternalShell from "@/app/InternalShell.vue";
import { useAuthStore } from "@/stores/auth";

/** ADMIN-OPS: audit page size (the server clamps its own band). */
const AUDIT_PAGE_SIZE = 50;

export default defineComponent({
  name: "AdminPage",
  components: { InternalShell },
  setup() {
    // 内部分区导航（运行时锚点；不做第二套路由）。
    const SECTIONS = [
      { id: "accounts", label: "账户" },
      { id: "usage", label: "用量" },
      { id: "audit", label: "审计" },
      { id: "safety", label: "安全" },
      { id: "queues", label: "队列" },
      { id: "entitlements", label: "权益" },
      { id: "invites", label: "邀请" },
    ] as const;

    function jumpTo(id: string): void {
      try {
        document
          .getElementById(`admin-sec-${id}`)
          ?.scrollIntoView({ behavior: "smooth", block: "start" });
      } catch {
        // Presentation-only scroll.
      }
    }

    const auth = useAuthStore();
    const username = ref("");
    const password = ref("");
    const displayName = ref("");
    const role = ref("USER");
    const busy = ref(false);
    const result = ref<{
      accountId: string;
      username: string;
      role: string;
      status: string;
    } | null>(null);
    const failed = ref(false);
    const reauthPassword = ref("");
    const reauthOk = ref(false);
    const resetAccountId = ref("");
    const resetPassword = ref("");
    const resetMessage = ref("");
    // ADMIN-ACCTS: the account registry loaded on mount and after mutations.
    const accounts = ref<AccountListItem[]>([]);
    const loadFailed = ref(false);
    // ADMIN-OPS: usage summary + audit trail state.
    const usageRows = ref<UsageSummaryItem[]>([]);
    const usageFailed = ref(false);
    // DOGFOOD-05 (ADR-0006 §3.3): provider plan status card state.
    const providerPlan = ref<ProviderPlanStatus | null>(null);
    const planFailed = ref(false);
    const auditEvents = ref<AuditEventListItem[]>([]);
    const auditFailed = ref(false);
    const auditHasMore = ref(false);
    // SAFETY-QUEUE (V59): read-only deterministic safety queue.
    const safetyEvents = ref<SafetyEventItem[]>([]);
    const safetyFailed = ref(false);
    // ADMIN-BETA (V64): read-only intake queues + memory-anomaly sampling.
    const betaReports = ref<BetaReportItem[]>([]);
    const betaAppeals = ref<BetaAgeAppealItem[]>([]);
    const betaExports = ref<BetaExportTaskItem[]>([]);
    const betaSampling = ref<BetaMemorySamplingItem[]>([]);
    const betaFailed = ref(false);
    // INVITE (V60): single-use invite codes.
    const invites = ref<InviteListItem[]>([]);
    const inviteCreated = ref<InviteCreated | null>(null);
    const inviteFailed = ref(false);
    // ENT-TRIAL (V61) + QUOTA-PERSIST (V61).
    const trialAccountId = ref("");
    const trialResult = ref("");
    const trialFailed = ref(false);
    const recon = ref<QuotaReconciliation | null>(null);
    const reconFailed = ref(false);
    const registry = ref<ProviderRegistryItem[]>([]);
    // ENT-SNAP: simulated service-class assignments.
    const scAssignments = ref<ServiceClassAssignmentItem[]>([]);
    const scFailed = ref(false);
    const scAccountId = ref("");
    const scClass = ref<"ECONOMY" | "PREMIUM">("ECONOMY");
    const scResult = ref<{ username: string; serviceClass: string } | null>(null);
    const cases = ref<PublicOpsCase[]>([]);
    const caseDisposition = ref<Record<string, string>>({});
    const casePublicNote = ref<Record<string, string>>({});
    const caseInternalDraft = ref<Record<string, string>>({});
    const caseInternalRead = ref<Record<string, string>>({});
    const casesFailed = ref(false);
    const isAdmin = computed(() => auth.role === "ADMIN");
    const isOperator = computed(() => canEnterAdminPage(auth.role));
    const canMutateCases = computed(() =>
      auth.role === "ADMIN" || auth.role === "SAFETY_REVIEWER" || auth.role === "PRIVACY_OPERATOR");

    // SESS-REVIVE: a 401 first tries one silent refresh and replays the request.
    const transport = createAuthenticatedTransport({
      getAccessToken: () => auth.accessToken,
      renewAccessToken: () => auth.renewAccessToken(transport),
      onUnauthorized: () => auth.onUnauthorized(),
    });

    // SESS-REVIVE: restore the session from the HttpOnly refresh cookie on mount.
    onMounted(async () => {
      if (!auth.isAuthenticated) {
        await auth.tryRefresh(transport);
      }
      if (isOperator.value) {
        await refreshCases();
      }
      if (isAdmin.value) {
        await refreshAccounts();
        await refreshProviderPlan();
        await refreshUsage();
        await refreshAudit();
        await refreshSafety();
        await refreshBetaQueues();
        await refreshInvites();
        await refreshRecon();
        await refreshServiceClasses();
      }
    });

    async function refreshCases(): Promise<void> {
      casesFailed.value = false;
      try {
        cases.value = await listOpsCases(transport);
      } catch {
        casesFailed.value = true;
      }
    }

    async function onRefreshCases(): Promise<void> {
      busy.value = true;
      try {
        await refreshCases();
      } finally {
        busy.value = false;
      }
    }

    async function onCaseAction(caseId: string, action: "ACK" | "RESOLVE"): Promise<void> {
      const disposition = action === "RESOLVE" ? caseDisposition.value[caseId]?.trim() : undefined;
      if (action === "RESOLVE" && !disposition) return;
      busy.value = true;
      try {
        await transitionOpsCase(
          transport,
          caseId,
          action,
          disposition,
        );
        if (action === "RESOLVE") delete caseDisposition.value[caseId];
        await refreshCases();
      } catch {
        casesFailed.value = true;
      } finally {
        busy.value = false;
      }
    }

    async function onCaseNote(
      caseId: string,
      visibility: "INTERNAL" | "PUBLIC",
    ): Promise<void> {
      busy.value = true;
      const note = visibility === "PUBLIC"
        ? (casePublicNote.value[caseId] ?? "")
        : (caseInternalDraft.value[caseId] ?? "");
      try {
        await updateOpsCaseNote(transport, caseId, visibility, note);
        if (visibility === "PUBLIC") delete casePublicNote.value[caseId];
        await refreshCases();
      } catch {
        casesFailed.value = true;
      } finally {
        busy.value = false;
      }
    }

    async function onReadInternalNote(caseId: string): Promise<void> {
      busy.value = true;
      try {
        const note = await readOpsCaseInternalNote(transport, caseId);
        caseInternalRead.value[caseId] = note;
        caseInternalDraft.value[caseId] = note;
      } catch {
        casesFailed.value = true;
      } finally {
        busy.value = false;
      }
    }

    /** ADMIN-OPS: reload the usage summary (non-fatal failure keeps rows). */
    async function refreshUsage(): Promise<void> {
      usageFailed.value = false;
      try {
        usageRows.value = await usageSummary(transport, 14);
      } catch {
        usageFailed.value = true;
      }
    }

    async function onRefreshUsage(): Promise<void> {
      busy.value = true;
      try {
        await refreshUsage();
      } finally {
        busy.value = false;
      }
    }

    /**
     * DOGFOOD-05: reload the provider plan status. A null result (non-OK or
     * unparseable) shows one generic failure — no invented plan state.
     */
    async function refreshProviderPlan(): Promise<void> {
      planFailed.value = false;
      try {
        const parsed = await providerPlanStatus(transport);
        if (parsed) {
          providerPlan.value = parsed;
        } else {
          planFailed.value = true;
        }
      } catch {
        planFailed.value = true;
      }
    }

    async function onRefreshProviderPlan(): Promise<void> {
      busy.value = true;
      try {
        await refreshProviderPlan();
      } finally {
        busy.value = false;
      }
    }

    /** ADMIN-OPS: reload the first audit page (newest first). */
    async function refreshAudit(): Promise<void> {
      auditFailed.value = false;
      try {
        const page = await listAuditEvents(transport, undefined, AUDIT_PAGE_SIZE);
        auditEvents.value = page;
        auditHasMore.value = page.length >= AUDIT_PAGE_SIZE;
      } catch {
        auditFailed.value = true;
      }
    }

    async function onRefreshAudit(): Promise<void> {
      busy.value = true;
      try {
        await refreshAudit();
      } finally {
        busy.value = false;
      }
    }

    /** ADMIN-OPS: append an older audit page (exclusive after cursor). */
    async function onLoadMoreAudit(): Promise<void> {
      if (busy.value || !auditHasMore.value) return;
      const last = auditEvents.value[auditEvents.value.length - 1];
      if (!last) return;
      busy.value = true;
      try {
        const page = await listAuditEvents(transport, last.id, AUDIT_PAGE_SIZE);
        auditEvents.value = [...auditEvents.value, ...page];
        auditHasMore.value = page.length >= AUDIT_PAGE_SIZE;
      } catch {
        auditFailed.value = true;
      } finally {
        busy.value = false;
      }
    }

    /** SAFETY-QUEUE (V59): reload the newest safety queue page (read-only). */
    async function refreshSafety(): Promise<void> {
      safetyFailed.value = false;
      try {
        safetyEvents.value = await listSafetyEvents(transport, undefined, 50);
      } catch {
        safetyFailed.value = true;
      }
    }

    async function onRefreshSafety(): Promise<void> {
      busy.value = true;
      try {
        await refreshSafety();
      } finally {
        busy.value = false;
      }
    }

    /** ADMIN-BETA (V64): reload all read-only console queues (non-fatal). */
    async function refreshBetaQueues(): Promise<void> {
      betaFailed.value = false;
      try {
        betaReports.value = await listBetaReports(transport, undefined, 50);
        betaAppeals.value = await listBetaAgeAppeals(transport, undefined, 50);
        betaExports.value = await listBetaExportTasks(transport, undefined, 50);
        betaSampling.value = await listBetaMemorySampling(transport, undefined, 50);
      } catch {
        betaFailed.value = true;
      }
    }

    async function onRefreshBetaQueues(): Promise<void> {
      busy.value = true;
      try {
        await refreshBetaQueues();
      } finally {
        busy.value = false;
      }
    }

    /** ENT-TRIAL (V61): grant a default 20-turn / 14-day trial. */
    async function onGrantTrial(): Promise<void> {
      const target = trialAccountId.value.trim();
      if (!target) return;
      busy.value = true;
      trialFailed.value = false;
      trialResult.value = "";
      try {
        const grantId = await grantTrial(transport, target);
        trialResult.value = `已授予试用（编号 ${grantId}）。到期或用尽后自动回到原等级，不删除任何数据。`;
      } catch {
        trialFailed.value = true;
      } finally {
        busy.value = false;
      }
    }

    /** QUOTA-PERSIST (V61): reconciliation + persisted registry. */
    async function refreshRecon(): Promise<void> {
      reconFailed.value = false;
      try {
        recon.value = await quotaReconciliation(transport, 14);
        registry.value = await providerRegistry(transport);
      } catch {
        reconFailed.value = true;
      }
    }

    async function onRefreshRecon(): Promise<void> {
      busy.value = true;
      try {
        await refreshRecon();
      } finally {
        busy.value = false;
      }
    }

    /** INVITE (V60): mint one code and refresh the registry. */
    async function onCreateInvite(): Promise<void> {
      busy.value = true;
      inviteFailed.value = false;
      try {
        inviteCreated.value = await createInvite(transport);
        await refreshInvites();
      } catch {
        inviteFailed.value = true;
      } finally {
        busy.value = false;
      }
    }

    async function refreshInvites(): Promise<void> {
      inviteFailed.value = false;
      try {
        invites.value = await listInvites(transport);
      } catch {
        inviteFailed.value = true;
      }
    }

    async function onDisableInvite(code: string): Promise<void> {
      busy.value = true;
      inviteFailed.value = false;
      try {
        await disableInvite(transport, code);
        await refreshInvites();
      } catch {
        inviteFailed.value = true;
      } finally {
        busy.value = false;
      }
    }

    /** ENT-SNAP: reload the assignment registry (non-fatal). */
    async function refreshServiceClasses(): Promise<void> {
      scFailed.value = false;
      try {
        scAssignments.value = await listServiceClassAssignments(transport);
      } catch {
        scFailed.value = true;
      }
    }

    async function onRefreshServiceClasses(): Promise<void> {
      busy.value = true;
      try {
        await refreshServiceClasses();
      } finally {
        busy.value = false;
      }
    }

    /** ENT-SNAP: assign a simulated service class and refresh the registry. */
    async function onAssignServiceClass(): Promise<void> {
      if (busy.value || !scAccountId.value) return;
      busy.value = true;
      scResult.value = null;
      try {
        const applied = await assignServiceClass(
          transport,
          scAccountId.value,
          scClass.value,
        );
        if (applied) {
          const account = accounts.value.find((a) => a.accountId === scAccountId.value);
          scResult.value = {
            username: account?.username ?? scAccountId.value,
            serviceClass: applied,
          };
          await refreshServiceClasses();
        } else {
          scFailed.value = true;
        }
      } catch {
        scFailed.value = true;
      } finally {
        busy.value = false;
      }
    }

    /** ADMIN-ACCTS: reload the registry (non-fatal failure keeps the list). */
    async function refreshAccounts(): Promise<void> {
      loadFailed.value = false;
      try {
        accounts.value = await listAccounts(transport);
      } catch {
        loadFailed.value = true;
      }
    }

    async function onRefreshAccounts(): Promise<void> {
      busy.value = true;
      try {
        await refreshAccounts();
      } finally {
        busy.value = false;
      }
    }

    /** ADMIN-ACCTS: disable one account; the row flips on a confirmed result. */
    async function onDisable(account: AccountListItem): Promise<void> {
      busy.value = true;
      try {
        const disabled = await disableAccount(transport, account.accountId);
        if (disabled) {
          accounts.value = accounts.value.map((a) =>
            a.accountId === account.accountId ? { ...a, status: "DISABLED" } : a,
          );
        } else {
          loadFailed.value = true;
        }
      } catch {
        loadFailed.value = true;
      } finally {
        busy.value = false;
      }
    }

    async function onAdminReauth(): Promise<void> {
      if (busy.value || !reauthPassword.value) return;
      busy.value = true;
      resetMessage.value = "";
      try {
        reauthOk.value = await reauthAuth(transport, reauthPassword.value);
        resetMessage.value = reauthOk.value
          ? "管理员身份已确认，15 分钟内可执行一次性重置。"
          : "管理员身份确认失败。";
        reauthPassword.value = "";
      } catch {
        reauthOk.value = false;
        resetMessage.value = "管理员身份确认失败。";
      } finally {
        busy.value = false;
      }
    }

    async function onAdminResetPassword(): Promise<void> {
      if (busy.value || !reauthOk.value || !resetAccountId.value
          || resetPassword.value.length < 12) return;
      busy.value = true;
      resetMessage.value = "";
      try {
        const ok = await adminResetPassword(
          transport, resetAccountId.value.trim(), resetPassword.value,
        );
        resetMessage.value = ok
          ? "临时密码已设置，旧会话已撤销；系统未发送消息，请走批准的线下渠道。"
          : "安全重置失败，请重新确认管理员身份。";
        if (ok) {
          resetPassword.value = "";
          reauthOk.value = false;
        }
      } catch {
        resetMessage.value = "安全重置失败，请重新确认管理员身份。";
        reauthOk.value = false;
      } finally {
        busy.value = false;
      }
    }

    const canSubmit = computed(
      () =>
        username.value.trim().length > 0 &&
        password.value.length > 0 &&
        displayName.value.trim().length > 0,
    );

    async function onCreate(): Promise<void> {
      if (!canSubmit.value || busy.value) return;
      busy.value = true;
      failed.value = false;
      result.value = null;
      try {
        const created = await createAccount(
          transport,
          username.value.trim(),
          password.value,
          displayName.value.trim(),
          role.value,
        );
        if (created) {
          result.value = created;
          password.value = "";
        } else {
          failed.value = true;
        }
      } catch {
        failed.value = true;
      } finally {
        busy.value = false;
      }
    }

    function goTo(url: string): void {
      try {
        const uniApi = (globalThis as Record<string, unknown>).uni as
          | { navigateTo?: (options: { url: string }) => void }
          | undefined;
        if (uniApi?.navigateTo) {
          uniApi.navigateTo({ url });
        } else if (typeof location !== "undefined") {
          location.href = url;
        }
      } catch {
        // Presentation-only navigation.
      }
    }

    return {
      SECTIONS,
      jumpTo,
      auth,
      username,
      password,
      displayName,
      role,
      busy,
      result,
      failed,
      reauthPassword,
      reauthOk,
      resetAccountId,
      resetPassword,
      resetMessage,
      onAdminReauth,
      onAdminResetPassword,
      accounts,
      loadFailed,
      usageRows,
      usageFailed,
      providerPlan,
      planFailed,
      onRefreshProviderPlan,
      auditEvents,
      auditFailed,
      auditHasMore,
      safetyEvents,
      safetyFailed,
      onRefreshSafety,
      betaReports,
      betaAppeals,
      betaExports,
      betaSampling,
      betaFailed,
      onRefreshBetaQueues,
      invites,
      inviteCreated,
      inviteFailed,
      onCreateInvite,
      onDisableInvite,
      trialAccountId,
      trialResult,
      trialFailed,
      onGrantTrial,
      recon,
      reconFailed,
      registry,
      onRefreshRecon,
      scAssignments,
      scFailed,
      scAccountId,
      scClass,
      scResult,
      canSubmit,
      onCreate,
      onRefreshAccounts,
      onDisable,
      onRefreshUsage,
      onRefreshAudit,
      onLoadMoreAudit,
      onRefreshServiceClasses,
      onAssignServiceClass,
      cases,
      caseDisposition,
      casePublicNote,
      caseInternalDraft,
      caseInternalRead,
      casesFailed,
      isAdmin,
      isOperator,
      canMutateCases,
      onRefreshCases,
      onCaseAction,
      onCaseNote,
      onReadInternalNote,
      goTo,
    };
  },
});
</script>

<style scoped>
/* 内部壳高密度变体：暮色深底、抬升面板、紧凑行距。窄屏表格换为摘要行
   （audit-row 网格），不做不可读的 nowrap 横向堆叠。 */
.admin-anchor {
  position: sticky;
  top: 0;
  z-index: var(--vc-z-header);
  display: flex;
  gap: var(--vc-space-1);
  margin-bottom: var(--vc-space-3);
  padding: var(--vc-space-2) 0;
  overflow-x: auto;
  background: var(--vc-env);
}

.admin-anchor__item {
  min-height: 44px;
  flex: 0 0 auto;
  margin: 0;
  padding: 0 var(--vc-space-4);
  border: 1px solid var(--vc-border-env-strong);
  border-radius: var(--vc-radius-pill);
  background: var(--vc-env-raised);
  color: var(--vc-on-env-muted);
  font: inherit;
  font-size: var(--vc-text-xs);
  font-weight: 600;
}

.admin-anchor__item::after {
  border: 0;
}

.ops-section,
.account-list {
  margin-top: var(--vc-space-4);
  padding: var(--vc-space-4);
  border: 1px solid var(--vc-border-env);
  border-radius: var(--vc-radius-m);
  background: var(--vc-env-raised);
  color: var(--vc-on-env);
  font-size: var(--vc-text-sm);
  line-height: 1.6;
}

.account-list-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--vc-space-3);
  margin-bottom: var(--vc-space-2);
}

.account-list-title {
  font-size: var(--vc-text-md);
  font-weight: 650;
}

.admin-form {
  display: flex;
  flex-wrap: wrap;
  gap: var(--vc-space-2);
  margin-top: var(--vc-space-3);
  padding: var(--vc-space-4);
  border: 1px solid var(--vc-border-env);
  border-radius: var(--vc-radius-m);
  background: var(--vc-env-raised);
}

.admin-input,
.admin-select,
.rename-input {
  box-sizing: border-box;
  flex: 1 1 10em;
  min-height: 44px;
  padding: 0 var(--vc-space-3);
  /* 暗面上的真实控件边界 ≥3:1，不用装饰级 border-env。 */
  border: 1px solid var(--vc-border-env-strong);
  border-radius: var(--vc-radius-s);
  background: var(--vc-env);
  color: var(--vc-on-env);
  font-size: 16px;
}

.admin-submit {
  min-height: 44px;
  flex: 0 0 auto;
  margin: 0;
  padding: 0 var(--vc-space-5);
  border: 0;
  border-radius: var(--vc-radius-s);
  background: var(--vc-primary);
  color: var(--vc-on-primary);
  font: inherit;
  font-size: var(--vc-text-sm);
  font-weight: 650;
}

.admin-submit::after {
  border: 0;
}

.admin-nav-index {
  min-height: 44px;
  flex: 0 0 auto;
  margin: 0;
  padding: 0 var(--vc-space-4);
  border: 1px solid var(--vc-border-env-strong);
  border-radius: var(--vc-radius-s);
  background: transparent;
  color: var(--vc-on-env);
  font: inherit;
  font-size: var(--vc-text-xs);
  font-weight: 600;
}

.admin-nav-index::after {
  border: 0;
}

.admin-notice {
  padding: var(--vc-space-4);
  border: 1px solid var(--vc-border-env);
  border-radius: var(--vc-radius-m);
  background: var(--vc-env-raised);
  color: var(--vc-on-env-muted);
  font-size: var(--vc-text-sm);
}

.admin-error {
  margin: var(--vc-space-2) 0;
  padding: var(--vc-space-2) var(--vc-space-3);
  border: 1px solid var(--vc-danger-on-env);
  border-radius: var(--vc-radius-s);
  color: var(--vc-danger-on-env);
  font-size: var(--vc-text-xs);
}

.admin-empty {
  color: var(--vc-on-env-muted);
  font-size: var(--vc-text-xs);
}

.admin-result {
  margin-top: var(--vc-space-2);
  color: var(--vc-glow);
  font-size: var(--vc-text-xs);
}

.admin-hint {
  display: block;
  margin: var(--vc-space-1) 0 var(--vc-space-2);
  color: var(--vc-on-env-muted);
  font-size: var(--vc-text-xs);
  line-height: 1.6;
}

/* 行式摘要：窄屏可读，宽屏成网格；不做 nowrap 溢出。 */
.audit-row,
.account-row,
.sc-row,
.usage-row {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(9em, 1fr));
  gap: var(--vc-space-1) var(--vc-space-3);
  padding: var(--vc-space-2) 0;
  border-bottom: 1px solid var(--vc-border-env);
  font-size: var(--vc-text-xs);
}

.audit-row:last-child,
.account-row:last-child,
.sc-row:last-child,
.usage-row:last-child {
  border-bottom: 0;
}

.audit-cell,
.account-cell,
.usage-cell {
  overflow-wrap: anywhere;
  color: var(--vc-on-env);
}

.usage-table {
  margin-top: var(--vc-space-2);
}

/* P2（round3）：账户行内操作补齐 ≥44px 触控尺寸；暗面（env-raised 面板上）
   用 border-env-strong 保住真实控件边界，不再是 uni-app mini 默认样式。 */
.admin-row-btn {
  min-height: 44px;
  flex: 0 0 auto;
  margin: 0;
  padding: 0 var(--vc-space-4);
  border: 1px solid var(--vc-border-env-strong);
  border-radius: var(--vc-radius-s);
  background: transparent;
  color: var(--vc-on-env);
  font: inherit;
  font-size: var(--vc-text-xs);
  font-weight: 600;
}

.admin-row-btn::after {
  border: 0;
}

.sc-form {
  display: flex;
  flex-wrap: wrap;
  gap: var(--vc-space-2);
  margin-top: var(--vc-space-2);
}
</style>
