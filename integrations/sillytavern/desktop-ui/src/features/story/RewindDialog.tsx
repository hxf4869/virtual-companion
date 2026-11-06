import { useState } from 'react';
import {
  REWIND_DEVICES,
  REWIND_RECALC,
} from '../../../../extension/vc-model-settings/story-logic.js';
import { Button } from '../../design/components/Button';
import { Dialog } from '../../design/components/Dialog';
import {
  PortalHostProvider,
  usePortalContainer,
  useToastPortalContainer,
} from '../../design/portal-host';
import { useStoryRewind, type RewindResult } from './useStory';

export type { RewindResult };

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
  const portalContainer = usePortalContainer();
  const toastContainer = useToastPortalContainer();
  const [hostEl, setHostEl] = useState<HTMLDivElement | null>(null);

  const { title, lead, submitting, isPending, handleConfirm } = useStoryRewind({
    runId,
    targetVersion,
    stageLabel,
    chatIdentity,
    conversationId,
    busy,
    onOpenChange,
    onBeforeConfirm,
    onRewound,
    onError,
  });

  if (!open || targetVersion === null) return null;

  const resolvedContainer = portalContainer ?? hostEl;

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
