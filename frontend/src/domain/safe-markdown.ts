// MD-SAFE (§18.6): whitelist-only markdown for assistant text. Never emit
// HTML nodes or javascript: targets. Long paragraphs and fenced code are
// clipped so a single reply cannot blow the DOM.

export const MAX_DISPLAY_CHARS = 2000;
export const MAX_CODE_CHARS = 1200;

export type InlineStyle = "strong" | "em" | "code";

export interface InlinePart {
  text: string;
  style?: InlineStyle;
}

export type MdBlock =
  | { kind: "p"; parts: InlinePart[]; truncated?: boolean }
  | { kind: "code"; text: string; truncated: boolean }
  | { kind: "ul"; items: InlinePart[][] };

const INLINE_RE = /(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/g;

function parseInline(src: string): InlinePart[] {
  const parts: InlinePart[] = [];
  let last = 0;
  const re = new RegExp(INLINE_RE.source, "g");
  let match: RegExpExecArray | null;
  while ((match = re.exec(src)) !== null) {
    if (match.index > last) {
      parts.push({ text: src.slice(last, match.index) });
    }
    const token = match[0];
    if (token.startsWith("**") && token.endsWith("**") && token.length >= 4) {
      parts.push({ text: token.slice(2, -2), style: "strong" });
    } else if (token.startsWith("`") && token.endsWith("`") && token.length >= 2) {
      parts.push({ text: token.slice(1, -1), style: "code" });
    } else if (token.startsWith("*") && token.endsWith("*") && token.length >= 2) {
      parts.push({ text: token.slice(1, -1), style: "em" });
    } else {
      parts.push({ text: token });
    }
    last = match.index + token.length;
  }
  if (last < src.length) {
    parts.push({ text: src.slice(last) });
  }
  return parts.length > 0 ? parts : [{ text: src }];
}

function clipParts(parts: InlinePart[], max: number): { parts: InlinePart[]; truncated: boolean } {
  let used = 0;
  const out: InlinePart[] = [];
  for (const part of parts) {
    if (used >= max) {
      return { parts: out, truncated: true };
    }
    const room = max - used;
    if (part.text.length <= room) {
      out.push(part);
      used += part.text.length;
    } else {
      out.push({ ...part, text: part.text.slice(0, room) });
      return { parts: out, truncated: true };
    }
  }
  return { parts: out, truncated: false };
}

export function parseSafeMarkdown(src: string): MdBlock[] {
  const text = src.replace(/\r\n/g, "\n");
  const blocks: MdBlock[] = [];
  const lines = text.split("\n");
  let i = 0;
  while (i < lines.length) {
    const line = lines[i] ?? "";
    if (line.trim() === "") {
      i += 1;
      continue;
    }
    if (line.trim().startsWith("```")) {
      i += 1;
      const body: string[] = [];
      while (i < lines.length && !(lines[i] ?? "").trim().startsWith("```")) {
        body.push(lines[i] ?? "");
        i += 1;
      }
      if (i < lines.length) {
        i += 1;
      }
      const raw = body.join("\n");
      const truncated = raw.length > MAX_CODE_CHARS;
      blocks.push({
        kind: "code",
        text: truncated ? raw.slice(0, MAX_CODE_CHARS) : raw,
        truncated,
      });
      continue;
    }
    if (line.startsWith("- ")) {
      const items: InlinePart[][] = [];
      while (i < lines.length && (lines[i] ?? "").startsWith("- ")) {
        items.push(parseInline((lines[i] ?? "").slice(2)));
        i += 1;
      }
      blocks.push({ kind: "ul", items });
      continue;
    }
    const para: string[] = [];
    while (
      i < lines.length &&
      (lines[i] ?? "").trim() !== "" &&
      !(lines[i] ?? "").trim().startsWith("```") &&
      !(lines[i] ?? "").startsWith("- ")
    ) {
      para.push(lines[i] ?? "");
      i += 1;
    }
    const clipped = clipParts(parseInline(para.join("\n")), MAX_DISPLAY_CHARS);
    blocks.push(
      clipped.truncated
        ? { kind: "p", parts: clipped.parts, truncated: true }
        : { kind: "p", parts: clipped.parts },
    );
  }
  return blocks;
}
