import type { ReactNode } from 'react';
import type { MemoryItem } from '../../data/queries/memory';
import { Button } from '../../design/components/Button';
import { Field } from '../../design/components/Field';
import { Textarea } from '../../design/components/Textarea';
import { ReauthDialog } from '../inbox/ReauthDialog';
import { useCorrectMemoryState } from './useMemoryState';

export interface CorrectMemoryProps {
  item: MemoryItem;
  onSaved: (updated: MemoryItem) => void;
  onCancel: () => void;
  renderLeaveGuard: (dirty: boolean) => ReactNode;
}

export function CorrectMemory({
  item,
  onSaved,
  onCancel,
  renderLeaveGuard,
}: CorrectMemoryProps) {
  const {
    summaryValue,
    isDirty,
    conflictItem,
    errorMessage,
    reauthOpen,
    setReauthOpen,
    isPending,
    handleSummaryChange,
    handleAcceptConflictVersion,
    executeSave,
  } = useCorrectMemoryState({ item, onSaved });

  const leaveGuardDialog = renderLeaveGuard(isDirty);

  return (
    <div className="vc-correct-memory">
      <form
        className="vc-correct-memory__form"
        onSubmit={(e) => {
          e.preventDefault();
          void executeSave();
        }}
      >
        <Field label="记忆内容" error={errorMessage ?? undefined}>
          <Textarea
            aria-label="记忆内容"
            rows={4}
            value={summaryValue}
            onValueChange={handleSummaryChange}
            disabled={isPending}
          />
        </Field>

        {conflictItem ? (
          <div className="vc-correct-memory__conflict" role="alert">
            <div className="vc-correct-memory__conflict-text">
              最新版本：{conflictItem.summary}
            </div>
            <Button
              variant="gray"
              size="sm"
              onClick={handleAcceptConflictVersion}
            >
              加载最新内容
            </Button>
          </div>
        ) : null}

        <div className="vc-correct-memory__actions">
          <Button
            variant="gray"
            size="sm"
            disabled={isPending}
            onClick={onCancel}
          >
            取消
          </Button>
          <Button
            type="submit"
            variant="filled"
            size="sm"
            pending={isPending}
          >
            保存纠正
          </Button>
        </div>
      </form>

      <ReauthDialog
        open={reauthOpen}
        onOpenChange={setReauthOpen}
        onSuccess={() => executeSave()}
      />
      {leaveGuardDialog}
    </div>
  );
}
