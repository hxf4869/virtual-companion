// INC-PREF (FR-CHAT-005): default incognito flag for the next new conversation.

export interface IncognitoPref {
  defaultIncognito: boolean;
}

export interface IncognitoTransport {
  request(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<{ ok: boolean; status: number; json: unknown }>;
}

export class IncognitoHttpError extends Error {
  readonly status: number;

  constructor(status: number) {
    super(`incognito-pref request failed with status ${status}`);
    this.name = "IncognitoHttpError";
    this.status = status;
  }
}

const PATH = "/api/v1/incognito-pref";

function asPref(json: unknown): IncognitoPref | null {
  if (!json || typeof json !== "object") return null;
  const o = json as Record<string, unknown>;
  if (typeof o.defaultIncognito !== "boolean") return null;
  return { defaultIncognito: o.defaultIncognito };
}

export async function getIncognitoPref(t: IncognitoTransport): Promise<IncognitoPref> {
  const r = await t.request("GET", PATH);
  if (!r.ok) throw new IncognitoHttpError(r.status);
  return asPref(r.json) ?? { defaultIncognito: false };
}

export async function updateIncognitoPref(
  t: IncognitoTransport,
  defaultIncognito: boolean,
): Promise<IncognitoPref> {
  const r = await t.request("PUT", PATH, { defaultIncognito });
  if (!r.ok) throw new IncognitoHttpError(r.status);
  const parsed = asPref(r.json);
  if (!parsed) throw new IncognitoHttpError(r.status);
  return parsed;
}
