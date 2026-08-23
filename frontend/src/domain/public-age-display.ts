// S0-22: ordinary users see a friendly verification method, never the raw
// providerRef or other internal vendor identifiers.

export function publicAgeMethodLabel(providerRef: string | null | undefined): string | null {
  if (!providerRef || !providerRef.trim()) return null;
  if (providerRef.trim() === "alpha-simulated") return "模拟核验";
  return "已通过成年核验渠道";
}
