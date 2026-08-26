// P2（round3）：消费者页面不显示 USER/ADMIN 等原始角色码，统一映射为中文
// 标签；ops/admin 内部诊断视图保留原值不受影响。

const ROLE_LABELS: Record<string, string> = {
  USER: "用户",
  ADMIN: "管理员",
  SAFETY_REVIEWER: "安全审查员",
  PRIVACY_OPERATOR: "隐私运营员",
};

export function accountRoleLabel(role: string | null | undefined): string {
  return (role != null && ROLE_LABELS[role]) || "未知";
}
