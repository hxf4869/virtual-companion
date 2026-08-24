// S0-22: user-facing memory labels. Catalog/database codes remain available to
// typed clients but are never echoed raw on ordinary H5 pages.

const SCOPE_LABELS: Readonly<Record<string, string>> = {
  RELATIONSHIP: "当前角色专属",
  SESSION: "当前会话",
};

const STATUS_LABELS: Readonly<Record<string, string>> = {
  PENDING_CONFIRMATION: "待确认",
  ACCEPTED: "已保存",
  REJECTED: "已拒绝",
  EXPIRED: "已过期",
};

export function publicMemoryScopeLabel(scope: string | null | undefined): string {
  return scope ? (SCOPE_LABELS[scope] ?? "其他范围") : "范围未知";
}

export function publicMemoryStatusLabel(status: string | null | undefined): string {
  return status ? (STATUS_LABELS[status] ?? "其他状态") : "状态未知";
}
