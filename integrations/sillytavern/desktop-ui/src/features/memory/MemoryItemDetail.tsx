import type { ReactNode } from 'react';
import type { MemoryItem } from '../../data/queries/memory';
import { AlertDialog } from '../../design/components/AlertDialog';
import { Button } from '../../design/components/Button';
import { EmptyState } from '../../design/components/EmptyState';
import {
  FORGET_NOTICE,
  stamp,
} from '../../../../extension/vc-model-settings/memory-logic.js';
import { CorrectMemory } from './CorrectMemory';
import { ReauthDialog } from '../inbox/ReauthDialog';
import {
  isCurrentConversation,
  useMemoryItemDetailState,
  type LocateMessagePayload,
} from './useMemoryState';

export { isCurrentConversation, type LocateMessagePayload };

export interface MemoryItemDetailProps {
  item: MemoryItem | null;
  onItemUpdated?: (item: MemoryItem) => void;
  onItemForgotten?: (id: string) => void;
  onNavigateToMessage: (payload: LocateMessagePayload) => void | Promise<void>;
  renderLeaveGuard: (dirty: boolean) => ReactNode;
}

export function MemoryItemDetail({
  item,
  onItemUpdated,
  onItemForgotten,
  onNavigateToMessage,
  renderLeaveGuard,
}: MemoryItemDetailProps) {
  const {
    currentItem,
    evidenceList,
    editable,
    isPinned,
    editing,
    setEditing,
    confirmForgetOpen,
    setConfirmForgetOpen,
    reauthOpen,
    handleReauthOpenChange,
    handleReauthSuccess,
    notice,
    errorMessage,
    jumpingSourceIdx,
    pinPending,
    forgetPending,
    handlePinToggle,
    handleForget,
    handleJumpToSource,
    handleSavedCorrection,
  } = useMemoryItemDetailState({
    item,
    onItemUpdated,
    onItemForgotten,
    onNavigateToMessage,
  });

  if (!currentItem) {
    return (
      <aside className="vc-memory-detail-pane vc-memory-detail-pane--empty" aria-label="记忆详情">
        <EmptyState icon="sparkles" title="选择一条记忆查看详情与来源" />
      </aside>
    );
  }

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
                disabled={pinPending}
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
          onSaved={handleSavedCorrection}
          onCancel={() => setEditing(false)}
          renderLeaveGuard={renderLeaveGuard}
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
        pending={forgetPending}
        onConfirm={() => {
          void handleForget();
        }}
      />

      <ReauthDialog
        open={reauthOpen}
        onOpenChange={handleReauthOpenChange}
        onSuccess={handleReauthSuccess}
      />
    </aside>
  );
}

export { MemoryItemDetail as MemoryDetail };
