import { useState } from 'react';
import { useCancelFollowUp, useFollowUps, type FollowUpItem } from '../../data/queries/inbox';
import { AlertDialog } from '../../design/components/AlertDialog';
import { Button } from '../../design/components/Button';
import { EmptyState } from '../../design/components/EmptyState';
import { FOLLOW, triggerText } from '../../../../extension/vc-model-settings/inbox-logic.js';
import { ReauthDialog } from './ReauthDialog';

export interface FollowUpsProps {
  relId: string | null;
}

export function FollowUps({ relId }: FollowUpsProps) {
  const followUpsQuery = useFollowUps(relId);
  const cancelMutation = useCancelFollowUp(relId);
  const [confirmTargetId, setConfirmTargetId] = useState<string | null>(null);
  const [reauthOpen, setReauthOpen] = useState(false);
  const [pendingCancelId, setPendingCancelId] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const items: FollowUpItem[] = followUpsQuery.data ?? [];

  const runCancel = async (followUpId: string) => {
    setErrorMessage(null);
    try {
      await cancelMutation.mutateAsync(followUpId);
      setPendingCancelId(null);
    } catch (err) {
      const status = (err as { status?: number })?.status;
      const kind = (err as { kind?: string })?.kind;
      if (status === 401 || status === 403 || kind === 'forbidden') {
        setPendingCancelId(followUpId);
        setReauthOpen(true);
        return;
      }
      setErrorMessage(err instanceof Error ? err.message : '没有取消，请重试。');
    }
  };

  return (
    <section className="vc-inbox-card vc-follow-ups" aria-label="待跟进事项">
      <div className="vc-inbox-card__header">
        <h3 className="vc-inbox-card__title">待跟进事项</h3>
      </div>

      {errorMessage ? (
        <div className="vc-inbox-card__error" role="alert">
          {errorMessage}
        </div>
      ) : null}

      {items.length === 0 ? (
        <EmptyState icon="clock" title="暂无待跟进事项" />
      ) : (
        <ul className="vc-follow-ups__list">
          {items.map((item) => {
            const statusText = (FOLLOW as Record<string, string>)[item.status] || item.status;
            const timeText = triggerText(item);
            const canCancel = item.status !== 'CANCELLED';

            return (
              <li key={item.followUpId} className="vc-follow-ups__item">
                <div className="vc-follow-ups__main">
                  <div className="vc-follow-ups__meta">
                    <span className="vc-inbox-badge">{statusText}</span>
                    {timeText ? <span className="vc-follow-ups__time">{timeText}</span> : null}
                  </div>
                  <p className="vc-follow-ups__body">{item.body || '计划跟进'}</p>
                </div>
                {canCancel ? (
                  <Button
                    variant="danger-soft"
                    size="sm"
                    disabled={cancelMutation.isPending}
                    onClick={() => setConfirmTargetId(item.followUpId)}
                  >
                    取消跟进
                  </Button>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      <AlertDialog
        open={Boolean(confirmTargetId)}
        onOpenChange={(open) => {
          if (!open) setConfirmTargetId(null);
        }}
        title="取消这条跟进？"
        description="取消后不会再对外发送。"
        confirmLabel="取消跟进"
        cancelLabel="保留"
        danger
        pending={cancelMutation.isPending}
        onConfirm={() => {
          if (confirmTargetId) {
            void runCancel(confirmTargetId);
          }
        }}
      />

      <ReauthDialog
        open={reauthOpen}
        onOpenChange={setReauthOpen}
        onSuccess={() => {
          if (pendingCancelId) {
            return runCancel(pendingCancelId);
          }
        }}
      />
    </section>
  );
}
