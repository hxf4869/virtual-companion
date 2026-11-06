export interface MobileConversationPreviewInput {
  draft?: string | null;
  voiceDurationSec?: number | null;
  voiceDurationMs?: number | null;
  hasInteractiveCard?: boolean | null;
  preview?: string | null;
}

export type MobileConversationPreviewResult =
  | {
      kind: 'draft';
      text: string;
      prefix: '草稿：';
      body: string;
    }
  | {
      kind: 'voice';
      text: string;
      durationText: string;
    }
  | {
      kind: 'card';
      text: '[互动卡片]';
    }
  | {
      kind: 'text';
      text: string;
    };

export function formatVoiceDurationText(secondsTotal: number): string {
  const clamped = Math.max(0, Math.round(Number.isFinite(secondsTotal) ? secondsTotal : 0));
  const mins = Math.floor(clamped / 60);
  const secs = clamped % 60;
  return `${mins}:${String(secs).padStart(2, '0')}`;
}

const VOICE_PREVIEW_REGEX = /^\[语音\]\s*(?:(\d+):(\d{1,2})|(\d+)s?)?$/i;
const INTERACTIVE_CARD_TAG_REGEX =
  /<\s*(?:iframe|div|table|section|article|details|style|script|form|canvas|svg)\b/i;

export function formatMobileConversationPreview(
  input: MobileConversationPreviewInput,
): MobileConversationPreviewResult {
  // 1. Draft: "草稿：…"
  const trimmedDraft = typeof input.draft === 'string' ? input.draft.trim() : '';
  if (trimmedDraft) {
    const singleLineDraft = trimmedDraft.replace(/\s+/g, ' ');
    return {
      kind: 'draft',
      text: `草稿：${singleLineDraft}`,
      prefix: '草稿：',
      body: singleLineDraft,
    };
  }

  const rawPreview = typeof input.preview === 'string' ? input.preview.trim() : '';

  // 2. Voice: "[语音] 0:08"
  if (
    typeof input.voiceDurationSec === 'number' &&
    Number.isFinite(input.voiceDurationSec) &&
    input.voiceDurationSec >= 0
  ) {
    const durationText = formatVoiceDurationText(input.voiceDurationSec);
    return {
      kind: 'voice',
      text: `[语音] ${durationText}`,
      durationText,
    };
  }

  if (
    typeof input.voiceDurationMs === 'number' &&
    Number.isFinite(input.voiceDurationMs) &&
    input.voiceDurationMs >= 0
  ) {
    const durationText = formatVoiceDurationText(input.voiceDurationMs / 1000);
    return {
      kind: 'voice',
      text: `[语音] ${durationText}`,
      durationText,
    };
  }

  const voiceMatch = rawPreview.match(VOICE_PREVIEW_REGEX);
  if (voiceMatch) {
    let durationText = '0:00';
    if (voiceMatch[1] !== undefined && voiceMatch[2] !== undefined) {
      durationText = `${Number(voiceMatch[1])}:${String(Number(voiceMatch[2])).padStart(2, '0')}`;
    } else if (voiceMatch[3] !== undefined) {
      durationText = formatVoiceDurationText(Number(voiceMatch[3]));
    }
    return {
      kind: 'voice',
      text: `[语音] ${durationText}`,
      durationText,
    };
  }

  // 3. Interactive Card: "[互动卡片]"
  if (
    input.hasInteractiveCard ||
    rawPreview === '[互动卡片]' ||
    INTERACTIVE_CARD_TAG_REGEX.test(rawPreview)
  ) {
    return {
      kind: 'card',
      text: '[互动卡片]',
    };
  }

  // 4. Plain stripped text fallback
  const stripped = rawPreview
    .replace(/<[^<>]*>/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  return {
    kind: 'text',
    text: stripped || '暂无消息',
  };
}
