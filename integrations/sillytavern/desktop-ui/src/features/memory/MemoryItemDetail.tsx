import { useEffect, useRef, useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useAppClient } from '../../app/providers';
import {
  normalizeConversationKey,
  parseConversationKey,
} from '../../data/queries/chat';
import {
  useForgetMemory,
  useMemoryDetail,
  useMemoryEvidence,
  usePinMemory,
  type MemoryItem,
  type MemorySourceRef,
} from '../../data/queries/memory';
import { useSessionBridge, type SessionBridge } from '../../runtime/session-bridge';
import { useChatUi } from '../chat/ChatRoute';
import { AlertDialog } from '../../design/components/AlertDialog';
import { Button } from '../../design/components/Button';
import { EmptyState } from '../../design/components/EmptyState';
import {
  canEdit,
  chatSnapshotsFromRecent,
  FORGET_NOTICE,
  idOf,
  openMessageSource,
  parseSourceRef,
  stamp,
} from '../../../../extension/vc-model-settings/memory-logic.js';
import { CorrectMemory } from './CorrectMemory';
import { ReauthDialog } from '../inbox/ReauthDialog';

export interface LocateMessagePayload {
  relationshipId: string;
  chatIdentity?: string;
  chatFile?: string;
  avatar?: string;
  conversationKey?: string;
  floor: number | null;
  messageId?: string;
  sourceRef?: string;
  excerpt?: string;
}

export function isCurrentConversation(
  bridge: SessionBridge,
  expectedKey: string,
): boolean {
  if (!expectedKey) return false;
  const snapKey = bridge.getSnapshot().key;
  if (snapKey && snapKey !== expectedKey) return false;
  const ctx = bridge.getContext();
  const file = String(ctx?.getCurrentChatId?.() || ctx?.chatId || '').replace(
    /\.jsonl$/i,
    '',
  );
  const avatar =
    ctx?.characters?.[ctx?.characterId]?.avatar ||
    parseConversationKey(snapKey)?.avatar ||
    '';
  const ctxKey = avatar && file ? normalizeConversationKey(avatar, file) : '';
  if (ctxKey && ctxKey !== expectedKey) return false;
  return Boolean(snapKey || ctxKey);
}

export interface MemoryItemDetailProps {
  item: MemoryItem | null;
  onItemUpdated?: (item: MemoryItem) => void;
  onItemForgotten?: (id: string) => void;
  onNavigateToMessage?: (payload: LocateMessagePayload) => void | Promise<void>;
}

export function MemoryItemDetail({
  item,
  onItemUpdated,
  onItemForgotten,
  onNavigateToMessage,
}: MemoryItemDetailProps) {
  const client = useAppClient();
  const navigate = useNavigate();
  const itemId = item ? idOf(item) : null;
  const detailQuery = useMemoryDetail(itemId);
  const evidenceQuery = useMemoryEvidence(itemId);
  const pinMutation = usePinMemory();
  const forgetMutation = useForgetMemory();
  const bridge = useSessionBridge();
  const chatUi = useChatUi();

  const mountedRef = useRef(true);
  const jumpTicketRef = useRef(0);
  const navigatingSelfRef = useRef(false);
  const scopeRef = useRef<{ itemId: string | null }>({ itemId });
  if (scopeRef.current.itemId !== itemId) {
    scopeRef.current = { itemId };
  }

  const [editing, setEditing] = useState(false);
  const [confirmForgetOpen, setConfirmForgetOpen] = useState(false);
  const [reauthOpen, setReauthOpen] = useState(false);
  const [pendingAction, setPendingAction] = useState<{
    kind: 'pin' | 'forget';
    scope: { itemId: string | null };
  } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [jumpingSourceIdx, setJumpingSourceIdx] = useState<number | null>(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (!navigatingSelfRef.current) {
        jumpTicketRef.current += 1;
      }
    };
  }, []);

  useEffect(() => {
    jumpTicketRef.current += 1;
    setEditing(false);
    setConfirmForgetOpen(false);
    setReauthOpen(false);
    setPendingAction(null);
    setNotice(null);
    setErrorMessage(null);
    setJumpingSourceIdx(null);
  }, [itemId, item?.relationshipId]);

  if (!item) {
    return (
      <aside className="vc-memory-detail-pane vc-memory-detail-pane--empty" aria-label="记忆详情">
        <EmptyState icon="sparkles" title="选择一条记忆查看详情与来源" />
      </aside>
    );
  }

  const currentItem: MemoryItem = detailQuery.data ?? item;
  const evidenceList: MemorySourceRef[] = evidenceQuery.data ?? [];
  const editable = canEdit(currentItem);
  const isPinned = Boolean(currentItem.pinned || currentItem.pinnedAt);

  const handlePinToggle = async () => {
    if (!itemId) return;
    const requestScope = scopeRef.current;
    const targetItemId = itemId;
    setErrorMessage(null);
    try {
      const updated = await pinMutation.mutateAsync({ id: targetItemId, pinned: !isPinned });
      if (!mountedRef.current || scopeRef.current !== requestScope) return;
      onItemUpdated?.(updated);
    } catch (err) {
      if (!mountedRef.current || scopeRef.current !== requestScope) return;
      const status = (err as { status?: number })?.status;
      if (status === 401 || status === 403) {
        setPendingAction({ kind: 'pin', scope: requestScope });
        setReauthOpen(true);
        return;
      }
      setErrorMessage(err instanceof Error ? err.message : '操作未完成，请重试。');
    }
  };

  const handleForget = async () => {
    if (!itemId) return;
    const requestScope = scopeRef.current;
    const targetItemId = itemId;
    setErrorMessage(null);
    try {
      await forgetMutation.mutateAsync({ id: targetItemId });
      if (!mountedRef.current || scopeRef.current !== requestScope) return;
      setNotice(FORGET_NOTICE);
      onItemForgotten?.(targetItemId);
    } catch (err) {
      if (!mountedRef.current || scopeRef.current !== requestScope) return;
      const status = (err as { status?: number })?.status;
      if (status === 401 || status === 403) {
        setPendingAction({ kind: 'forget', scope: requestScope });
        setReauthOpen(true);
        return;
      }
      setErrorMessage(err instanceof Error ? err.message : '遗忘操作未完成，请重试。');
    }
  };

  const handleJumpToSource = async (ref: MemorySourceRef, idx: number) => {
    const ticket = ++jumpTicketRef.current;
    setJumpingSourceIdx(idx);
    setErrorMessage(null);
    try {
      const parsed = parseSourceRef(ref.sourceRef);
      const messageId = String(ref.messageId || parsed?.messageId || '');
      const mesId =
        parsed?.mesId ?? (/^\d+$/.test(messageId) ? Number(messageId) : null);
      const detail = {
        relationshipId: String(currentItem.relationshipId ?? ''),
        chatIdentity: parsed?.chatIdentity || '',
        messageId,
        mesId,
      };
      let openedTarget = null as {
        relationshipId?: string;
        chatIdentity?: string;
        file?: string;
        avatar?: string;
      } | null;

      const floor = await openMessageSource(detail, {
        getContext: () => bridge.getContext(),
        loadChats: async () => chatSnapshotsFromRecent(await client.recent()),
        openConversation: async (target: {
          relationshipId?: string;
          chatIdentity?: string;
          file?: string;
          avatar?: string;
        }) => {
          if (!mountedRef.current || jumpTicketRef.current !== ticket) {
            return false;
          }
          const avatar = target.avatar || bridge.getSnapshot().avatar;
          openedTarget = { ...target, avatar };
          const status = await bridge.open(openedTarget);
          return (
            status === 'opened' &&
            mountedRef.current &&
            jumpTicketRef.current === ticket
          );
        },
        ensureVisible: () => {},
      });

      if (!mountedRef.current || jumpTicketRef.current !== ticket) {
        return;
      }

      const ctx = bridge.getContext();
      const currentChatFile = String(
        ctx?.getCurrentChatId?.() || ctx?.chatId || '',
      ).replace(/\.jsonl$/i, '');
      const currentAvatar =
        ctx?.characters?.[ctx?.characterId]?.avatar || bridge.getSnapshot().avatar;
      const resolvedFile = openedTarget?.file || currentChatFile;
      const resolvedAvatar = openedTarget?.avatar || currentAvatar;
      const conversationKey =
        resolvedAvatar && resolvedFile
          ? normalizeConversationKey(resolvedAvatar, resolvedFile)
           : bridge.getSnapshot().key;

      if (!conversationKey || !isCurrentConversation(bridge, conversationKey)) {
        return;
      }

      navigatingSelfRef.current = true;
      try {
        if (onNavigateToMessage) {
          await onNavigateToMessage({
            relationshipId: detail.relationshipId,
            chatIdentity: detail.chatIdentity,
            chatFile: resolvedFile,
            avatar: resolvedAvatar,
            conversationKey,
            floor,
            messageId,
            sourceRef: ref.sourceRef,
            excerpt: ref.excerpt,
          });
        } else {
          await navigate({
            to: '/chat/$conversationKey',
            params: { conversationKey },
          });
        }
      } finally {
        navigatingSelfRef.current = false;
      }

      if (
        jumpTicketRef.current !== ticket ||
        !isCurrentConversation(bridge, conversationKey)
      ) {
        return;
      }

      chatUi?.requestMessageJump(conversationKey, floor);
    } catch {
      if (mountedRef.current && jumpTicketRef.current === ticket) {
        setErrorMessage('原消息无法定位或所在会话不可用。');
      }
    } finally {
      if (mountedRef.current && jumpTicketRef.current === ticket) {
        setJumpingSourceIdx(null);
      }
    }
  };

  return (
    <aside className="vc-memory-detail-pane" aria-label="记忆详情">
      <div className="vc-memory-detail-pane__header">
        <h3 className="vc-memory-detail-pane__title">记忆详情</h3>
        <div className="vc-memory-detail-pane__actions">
          {editable ? (
            <>
              <Button
                variant="gray"
                size="sm"
                disabled={pinMutation.isPending}
                onClick={() => void handlePinToggle()}
              >
                {isPinned ? '取消置顶' : '置顶'}
              </Button>
              {!editing ? (
                <Button variant="gray" size="sm" onClick={() => setEditing(true)}>
                  纠正
                </Button>
              ) : null}
            </>
          ) : null}
          {currentItem.lifecycle !== 'forgotten' && currentItem.lifecycle !== 'FORGOTTEN' ? (
            <Button
              variant="danger-soft"
              size="sm"
              onClick={() => setConfirmForgetOpen(true)}
            >
              遗忘
            </Button>
          ) : null}
        </div>
      </div>

      {notice ? (
        <div className="vc-memory-detail-pane__notice" role="status">
          {notice}
        </div>
      ) : null}

      {errorMessage ? (
        <div className="vc-memory-detail-pane__error" role="alert">
          {errorMessage}
        </div>
      ) : null}

      {editing ? (
        <CorrectMemory
          item={currentItem}
          onSaved={(updated) => {
            setEditing(false);
            setNotice('纠正已保存');
            onItemUpdated?.(updated);
          }}
          onCancel={() => setEditing(false)}
        />
      ) : (
        <div className="vc-memory-detail-pane__body">
          <p className="vc-memory-detail-pane__summary">{currentItem.summary}</p>
          <div className="vc-memory-detail-pane__timestamps">
            <span>更新时间：{stamp(currentItem.updatedAt || currentItem.createdAt)}</span>
          </div>
        </div>
      )}

      <div className="vc-memory-detail-pane__sources">
        <h4 className="vc-memory-detail-pane__subtitle">来源证据</h4>
        {evidenceList.length === 0 ? (
          <p className="vc-memory-detail-pane__empty-source">暂无关联对话片段</p>
        ) : (
          <ul className="vc-memory-detail-pane__source-list">
            {evidenceList.map((ev, idx) => (
              <li key={ev.evidenceId || ev.sourceRef || idx} className="vc-memory-source-item">
                <blockquote className="vc-memory-source-item__quote">
                  {ev.excerpt || '对话片段'}
                </blockquote>
                <Button
                  variant="gray"
                  size="sm"
                  pending={jumpingSourceIdx === idx}
                  onClick={() => void handleJumpToSource(ev, idx)}
                >
                  跳转原消息
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <AlertDialog
        open={confirmForgetOpen}
        onOpenChange={setConfirmForgetOpen}
        title="确认遗忘这条记忆？"
        description={FORGET_NOTICE}
        confirmLabel="确认遗忘"
        cancelLabel="取消"
        danger
        pending={forgetMutation.isPending}
        onConfirm={() => {
          void handleForget();
        }}
      />

      <ReauthDialog
        open={reauthOpen}
        onOpenChange={(open) => {
          setReauthOpen(open);
          if (!open) {
            setPendingAction(null);
          }
        }}
        onSuccess={() => {
          if (
            !mountedRef.current ||
            !pendingAction ||
            pendingAction.scope !== scopeRef.current ||
            pendingAction.scope.itemId !== itemId
          ) {
            return;
          }
          setPendingAction(null);
          if (pendingAction.kind === 'pin') return handlePinToggle();
          if (pendingAction.kind === 'forget') return handleForget();
        }}
      />
    </aside>
  );
}

export { MemoryItemDetail as MemoryDetail };
