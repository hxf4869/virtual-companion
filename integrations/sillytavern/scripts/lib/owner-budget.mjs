// 只释放本轮 Owner 的预留，并从全局月预算里减去该 Owner 自己的金额。
// month_cost_budget 没有 owner 列，不能把整月 settled/reserved 清零。

export function ownerBudgetResetSql(ownerId) {
    if (!/^[1-9][0-9]{0,18}$/.test(String(ownerId))) throw new Error('owner id');
    const owner = BigInt(ownerId).toString();
    return `WITH mine AS (
  SELECT COALESCE(SUM(reserved_usd) FILTER (WHERE status = 'HELD'), 0) AS reserved,
         COALESCE(SUM(actual_usd) FILTER (WHERE status = 'SETTLED'), 0) AS settled
    FROM vc.model_cost_reservation
   WHERE owner_user_id = ${owner}
     AND month_start = date_trunc('month', clock_timestamp() AT TIME ZONE 'UTC')::date
), released AS (
  UPDATE vc.model_cost_reservation
     SET status = 'RELEASED', released_at = clock_timestamp()
   WHERE owner_user_id = ${owner}
     AND month_start = date_trunc('month', clock_timestamp() AT TIME ZONE 'UTC')::date
     AND status = 'HELD'
  RETURNING 1
)
UPDATE vc.month_cost_budget AS budget
   SET reserved_usd = GREATEST(0, budget.reserved_usd - mine.reserved),
       settled_usd = GREATEST(0, budget.settled_usd - mine.settled)
  FROM mine
 WHERE budget.month_start = date_trunc('month', clock_timestamp() AT TIME ZONE 'UTC')::date`;
}
