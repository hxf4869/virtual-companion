import { gapLabel, parseSendDate } from '../../../../../extension/vc-model-settings/chat-logic.js';
import type { ChatMessage } from '../../../runtime/session-bridge';

export const MESSAGE_DATE_GAP_MS = 20 * 60 * 1000;

export type MobileBubbleGroupPosition = 'solo' | 'start' | 'mid' | 'end';

export interface MobileConversationRowItem {
  key: string;
  index: number;
  message: ChatMessage;
  role: 'user' | 'assistant' | 'system';
  groupPosition: MobileBubbleGroupPosition;
  hasTail: boolean;
  showAvatar: boolean;
  spacingBeforePx: 0 | 4 | 12;
  adjacentTopCornerPx: 6 | 18;
  adjacentBottomCornerPx: 6 | 18;
  dateLabel: string | null;
  isLastUserMessage: boolean;
  isStreaming: boolean;
  isFailed: boolean;
}

export interface BuildMobileConversationRowsOptions {
  now?: number | Date;
  busy?: boolean;
}

function isSameLocalDay(aMs: number, bMs: number): boolean {
  const a = new Date(aMs);
  const b = new Date(bMs);
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

export function buildMobileConversationRows(
  messages: readonly ChatMessage[],
  options: BuildMobileConversationRowsOptions = {},
): MobileConversationRowItem[] {
  if (!Array.isArray(messages) || messages.length === 0) return [];

  const nowMs =
    options.now instanceof Date ? options.now.getTime() : (options.now ?? Date.now());
  const busy = Boolean(options.busy);

  interface IntermediateRow {
    key: string;
    index: number;
    message: ChatMessage;
    role: 'user' | 'assistant' | 'system';
    ts: number | null;
    dateLabel: string | null;
    isFailed: boolean;
  }

  const intermediate: IntermediateRow[] = [];
  let lastValidTs: number | null = null;

  for (let i = 0; i < messages.length; i += 1) {
    const msg = messages[i];
    if (!msg) continue;
    const role: 'user' | 'assistant' | 'system' = msg.is_system
      ? 'system'
      : msg.is_user
        ? 'user'
        : 'assistant';
    const index = typeof msg.index === 'number' && Number.isFinite(msg.index) ? msg.index : i;
    const key = typeof msg.key === 'string' && msg.key.trim() ? msg.key : `msg-${index}`;
    const ts = parseSendDate(msg.send_date);

    let dateLabel: string | null = null;
    if (ts !== null && lastValidTs !== null) {
      const gapMs = Math.abs(ts - lastValidTs);
      if (gapMs >= MESSAGE_DATE_GAP_MS || !isSameLocalDay(lastValidTs, ts)) {
        dateLabel = gapLabel(ts, nowMs) || null;
      }
    }
    if (ts !== null) {
      lastValidTs = ts;
    }

    const isFailed = msg.extra?.finish_reason === 'error';

    intermediate.push({
      key,
      index,
      message: msg,
      role,
      ts,
      dateLabel,
      isFailed,
    });
  }

  const canGroupPair = (prev: IntermediateRow, curr: IntermediateRow): boolean => {
    if (curr.dateLabel !== null) return false;
    if (prev.role === 'system' || curr.role === 'system') return false;
    if (prev.role !== curr.role) return false;
    if (curr.role === 'assistant') {
      const prevName = (prev.message.name || '').trim();
      const currName = (curr.message.name || '').trim();
      if (prevName !== currName) return false;
    }
    return true;
  };

  let lastUserRowIdx = -1;
  for (let i = intermediate.length - 1; i >= 0; i -= 1) {
    if (intermediate[i].role === 'user') {
      lastUserRowIdx = i;
      break;
    }
  }

  const lastRowIdx = intermediate.length - 1;

  return intermediate.map((row, idx) => {
    const prev = idx > 0 ? intermediate[idx - 1] : null;
    const next = idx + 1 < intermediate.length ? intermediate[idx + 1] : null;

    const groupedWithPrev = prev !== null && canGroupPair(prev, row);
    const groupedWithNext = next !== null && canGroupPair(row, next);

    let groupPosition: MobileBubbleGroupPosition;
    if (groupedWithPrev && groupedWithNext) {
      groupPosition = 'mid';
    } else if (groupedWithPrev && !groupedWithNext) {
      groupPosition = 'end';
    } else if (!groupedWithPrev && groupedWithNext) {
      groupPosition = 'start';
    } else {
      groupPosition = 'solo';
    }

    const hasTail = groupPosition === 'solo' || groupPosition === 'end';
    const showAvatar = row.role === 'assistant' && hasTail;
    const spacingBeforePx: 0 | 4 | 12 =
      idx === 0
        ? 0
        : row.dateLabel !== null || groupPosition === 'solo' || groupPosition === 'start'
          ? 12
          : 4;
    const adjacentTopCornerPx: 6 | 18 =
      groupPosition === 'mid' || groupPosition === 'end' ? 6 : 18;
    const adjacentBottomCornerPx: 6 | 18 =
      groupPosition === 'start' || groupPosition === 'mid' ? 6 : 18;
    const isLastUserMessage = idx === lastUserRowIdx && !row.isFailed;
    const isStreaming = busy && idx === lastRowIdx && row.role === 'assistant';

    return {
      key: row.key,
      index: row.index,
      message: row.message,
      role: row.role,
      groupPosition,
      hasTail,
      showAvatar,
      spacingBeforePx,
      adjacentTopCornerPx,
      adjacentBottomCornerPx,
      dateLabel: row.dateLabel,
      isLastUserMessage,
      isStreaming,
      isFailed: row.isFailed,
    };
  });
}
