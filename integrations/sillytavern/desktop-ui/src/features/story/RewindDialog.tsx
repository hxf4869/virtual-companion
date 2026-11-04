import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  CHAT_IDENTITY,
  REWIND_BLOCKED,
  REWIND_DEVICES,
  REWIND_FAILED,
  REWIND_RECALC,
  SESSION_CHANGED,
  decimalOf,
  rewindCopy,
  storyTurn,
} from '../../../../extension/vc-model-settings/story-logic.js';
import { useAppClient } from '../../app/providers';
import { queryKeys } from '../../data/queryKeys';
import {
  buildStoryRunRecord,
  normalizeStoryView,
  rewindStoryWithClient,
  upsertStoryRunCache,
  type StoryActorView,
  type StoryRunRecord,
} from '../../data/queries/story';
import { Button } from '../../design/components/Button';
import { Dialog } from '../../design/components/Dialog';
import {
  PortalHostProvider,
  usePortalContainer,
  useToastPortalContainer,
} from '../../design/portal-host';
import { useSessionBridge } from '../../runtime/session-bridge';

export interface RewindResult {
  runId: string;
  branchId: string;
  worldVersion: number;
  stage?: 'investigation' | 'resolved' | '';
  view: StoryActorView;
}

export interface RewindDialogProps {
  open: boolean;
  runId: string;
  targetVersion: number | null;
  stageLabel?: string;
  chatIdentity?: string;
  conversationId?: string;
  busy?: boolean;
  onOpenChange: (open: boolean) => void;
  onBeforeConfirm?: () => void;
  onRewound?: (result: RewindResult) => void;
  onError?: (message: string) => void;
}

export function RewindDialog({
  open,
  runId,
  targetVersion,
  stageLabel = '调查中',
  chatIdentity,
  conversationId,
  busy = false,
  onOpenChange,
  onBeforeConfirm,
  onRewound,
  onError,
}: RewindDialogProps) {
  const client = useAppClient();
  const bridge = useSessionBridge();
  const queryClient = useQueryClient();
  const portalContainer = usePortalContainer();
  const toastContainer = useToastPortalContainer();
  const [hostEl, setHostEl] = useState<HTMLDivElement | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (!open || targetVersion === null) return null;

  const resolvedContainer = portalContainer ?? hostEl;

  const title = targetVersion === 0 ? '回到调查开始？' : `回到版本 ${targetVersion}？`;
  const lead = rewindCopy({ version: targetVersion, stage: stageLabel });
  const isPending = busy || submitting;

  const handleConfirm = async () => {
    if (isPending) return;
    const resolvedIdentity =
      chatIdentity || String(bridge.getContext()?.chatMetadata?.vc_f2?.id || '');
    if (!CHAT_IDENTITY.test(resolvedIdentity)) {
      onError?.(REWIND_BLOCKED);
      onOpenChange(false);
      return;
    }

    onBeforeConfirm?.();
    setSubmitting(true);
    try {
      const res: any = await rewindStoryWithClient(client, {
        runId: String(runId),
        toWorldVersion: targetVersion,
        chatIdentity: resolvedIdentity,
      });

      const branchId =
        decimalOf(res?.branchId || res?.newBranchId) ||
        decimalOf(queryClient.getQueryData<StoryRunRecord>(queryKeys.storyRun(runId))?.branchId) ||
        '1';
      const worldVersion =
        typeof res?.worldVersion === 'number' && Number.isSafeInteger(res.worldVersion)
          ? res.worldVersion
          : targetVersion;

      const rawView = await client.go.fetchStoryActorView({
        runId: String(runId),
        branchId,
        worldVersion,
      });
      const view = normalizeStoryView(rawView);

      const prevRun = queryClient.getQueryData<StoryRunRecord>(queryKeys.storyRun(runId));
      const resolvedConvId =
        conversationId ||
        prevRun?.conversationId ||
        String(bridge.getContext()?.chatMetadata?.vc_binding?.conversationId || '1');

      const updatedRun = buildStoryRunRecord(
        {
          runId,
          branchId,
          worldVersion,
          stage: res?.stage || 'investigation',
        },
        resolvedConvId,
        prevRun,
      );

      upsertStoryRunCache(queryClient, updatedRun);
      queryClient.setQueryData(
        queryKeys.storyView(String(runId), 'player', branchId, worldVersion),
        view,
      );

      const turn = storyTurn(
        { runId: String(runId), branchId, conversationId: resolvedConvId },
        { runId: String(runId), branchId, worldVersion },
        resolvedConvId,
      );
      bridge.story.advance(
        turn ?? {
          runId: String(runId),
          branchId,
          worldVersion,
          conversationId: resolvedConvId,
        },
      );

      onRewound?.({
        runId: String(runId),
        branchId,
        worldVersion,
        stage: updatedRun.stage,
        view,
      });
      onOpenChange(false);
    } catch (err: any) {
      const msg =
        err?.status === 409 && err?.code === 'ACCOUNT_CONTEXT_CHANGED'
          ? SESSION_CHANGED
          : REWIND_FAILED;
      onError?.(msg);
      onOpenChange(false);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div ref={setHostEl} className="vc-story-rewind-host">
      {resolvedContainer ? (
        <PortalHostProvider container={resolvedContainer} toastContainer={toastContainer}>
          <Dialog
            open={open}
            onOpenChange={onOpenChange}
            title={title}
            width={420}
            showCloseButton={false}
            className="vc-story-rewind-dialog"
            actions={
              <div className="vc-story-rewind-actions">
                <Button
                  variant="gray"
                  data-action="cancel-rewind"
                  disabled={isPending}
                  onClick={() => onOpenChange(false)}
                >
                  取消
                </Button>
                <Button
                  variant="filled"
                  data-action="confirm-rewind"
                  pending={submitting}
                  disabled={isPending}
                  onClick={() => void handleConfirm()}
                >
                  确认回档
                </Button>
              </div>
            }
          >
            <div className="vc-story-rewind-copy">
              <p>{lead}</p>
              <p>{REWIND_RECALC}</p>
              <p>{REWIND_DEVICES}</p>
            </div>
          </Dialog>
        </PortalHostProvider>
      ) : null}
    </div>
  );
}
