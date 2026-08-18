// FR-CHAT-001: surface the last echoed X-Request-Id so a failed H5 call can
// be matched to server logs. The transport records the header; pages only
// display it. Invalid/blank values are ignored.

const HEADER = "X-Request-Id";

let last: string | null = null;

export function rememberRequestId(id: string | null): void {
  last = id && id.trim() ? id.trim() : null;
}

export function rememberRequestIdFromResponse(response: {
  headers?: { get?: (name: string) => string | null };
}): void {
  const raw = response.headers?.get?.(HEADER);
  if (typeof raw === "string" && raw.trim()) {
    last = raw.trim();
  }
}

export function lastRequestId(): string | null {
  return last;
}

export function requestIdLabel(id: string | null = last): string {
  return id ? `请求号 ${id}` : "";
}
