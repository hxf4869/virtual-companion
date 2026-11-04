import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { useAppClient } from '../../app/providers';
import { ConflictError } from '../../data/client';
import { useCorrectMemory, type MemoryItem } from '../../data/queries/memory';
import { useLeaveGuard } from '../../shell/useLeaveGuard';
import { Button } from '../../design/components/Button';
import { Field } from '../../design/components/Field';
import { Textarea } from '../../design/components/Textarea';
import { idOf } from '../../../../extension/vc-model-settings/memory-logic.js';
import { ReauthDialog } from '../inbox/ReauthDialog';

const correctSchema = z.object({
  summary: z.string().trim().min(1, '纠正内容不能为空'),
});

type CorrectFormValues = z.infer<typeof correctSchema>;

export interface CorrectMemoryProps {
  item: MemoryItem;
  onSaved: (updated: MemoryItem) => void;
  onCancel: () => void;
}

export function CorrectMemory({ item, onSaved, onCancel }: CorrectMemoryProps) {
  const client = useAppClient();
  const correctMutation = useCorrectMemory();
  const itemId = idOf(item);

  const [expectedVersion, setExpectedVersion] = useState<number>(Number(item.version ?? 1));
  const [conflictItem, setConflictItem] = useState<MemoryItem | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [reauthOpen, setReauthOpen] = useState(false);

  const form = useForm<CorrectFormValues>({
    defaultValues: {
      summary: item.summary ?? '',
    },
  });

  const {
    watch,
    setValue,
    reset,
    getValues,
    formState: { isDirty },
  } = form;

  const summaryValue = watch('summary');
  const leaveGuardDialog = useLeaveGuard(isDirty);

  useEffect(() => {
    reset({ summary: item.summary ?? '' });
    setExpectedVersion(Number(item.version ?? 1));
    setConflictItem(null);
    setErrorMessage(null);
  }, [itemId, reset]);

  const executeSave = async () => {
    const raw = getValues();
    const parsed = correctSchema.safeParse(raw);
    if (!parsed.success) {
      setErrorMessage(parsed.error.issues[0]?.message ?? '纠正内容不能为空');
      return;
    }

    setErrorMessage(null);
    try {
      const updated = await correctMutation.mutateAsync({
        id: itemId,
        summary: parsed.data.summary,
        expectedVersion,
      });
      setConflictItem(null);
      reset({ summary: updated.summary });
      onSaved(updated);
    } catch (err) {
      const status = (err as { status?: number })?.status;
      const code = (err as { code?: string })?.code;
      const kind = (err as { kind?: string })?.kind;

      if (err instanceof ConflictError || status === 409) {
        const currentFromDetails = (err as { details?: { current?: MemoryItem } })?.details
          ?.current;
        if (currentFromDetails) {
          setConflictItem(currentFromDetails);
          if (currentFromDetails.version) {
            setExpectedVersion(Number(currentFromDetails.version));
          }
        } else {
          try {
            const fresh = (await client.go.fetchMemory(itemId)) as MemoryItem | null;
            if (fresh) {
              setConflictItem(fresh);
              if (fresh.version) {
                setExpectedVersion(Number(fresh.version));
              }
            }
          } catch {
            // Keep conflict message even if refresh fails
          }
        }
        setErrorMessage('版本冲突 (409)：该记忆已在别处更新，你的草稿已保留。');
        return;
      }

      if (status === 401 || status === 403 || code === 'step_up_required' || kind === 'forbidden') {
        setReauthOpen(true);
        return;
      }

      setErrorMessage(err instanceof Error ? err.message : '保存纠正失败，请重试。');
    }
  };

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
            onValueChange={(val) => {
              setValue('summary', val, { shouldDirty: true });
              if (errorMessage && !conflictItem) setErrorMessage(null);
            }}
            disabled={correctMutation.isPending}
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
              onClick={() => {
                reset({ summary: conflictItem.summary });
                setExpectedVersion(Number(conflictItem.version ?? expectedVersion));
                setConflictItem(null);
                setErrorMessage(null);
              }}
            >
              加载最新内容
            </Button>
          </div>
        ) : null}

        <div className="vc-correct-memory__actions">
          <Button
            variant="gray"
            size="sm"
            disabled={correctMutation.isPending}
            onClick={onCancel}
          >
            取消
          </Button>
          <Button
            type="submit"
            variant="filled"
            size="sm"
            pending={correctMutation.isPending}
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
