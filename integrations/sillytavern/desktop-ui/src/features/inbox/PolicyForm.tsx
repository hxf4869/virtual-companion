import { useEffect, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { ConflictError } from '../../data/client';
import {
  normalizeProactivePolicy,
  useProactivePolicy,
  useSavePolicy,
  type ProactivePolicy,
} from '../../data/queries/inbox';
import { useLeaveGuard } from '../../shell/useLeaveGuard';
import { Button } from '../../design/components/Button';
import { Field } from '../../design/components/Field';
import { Segment } from '../../design/components/Segment';
import { Switch } from '../../design/components/Switch';
import { TextInput } from '../../design/components/TextInput';
import { toast } from '../../design/components/Toast';
import {
  PROACTIVE_LABELS,
  readProactivePolicy,
  validatePolicy,
} from '../../../../extension/vc-model-settings/inbox-logic.js';
import { ReauthDialog } from './ReauthDialog';

const policyFormSchema = z
  .object({
    relationshipId: z.string(),
    enabled: z.boolean(),
    supportsMode: z.boolean(),
    supportsCheckIn: z.boolean(),
    mode: z.string(),
    checkInAfterMinutes: z.number().nullable(),
    quietHoursStart: z.string(),
    quietHoursEnd: z.string(),
    quietHoursTimezone: z.string(),
    dailyLimit: z.number(),
    recentInteractionMinutes: z.number(),
    allowedModes: z.array(z.string()),
    offlineCapable: z.boolean(),
  })
  .superRefine((val, ctx) => {
    const message = validatePolicy(val);
    if (message) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message,
      });
    }
  });

export type PolicyFormValues = z.infer<typeof policyFormSchema>;

function toFormValues(policy: ProactivePolicy): PolicyFormValues {
  return {
    relationshipId: policy.relationshipId,
    enabled: policy.enabled,
    supportsMode: policy.supportsMode,
    supportsCheckIn: policy.supportsCheckIn,
    mode: policy.mode,
    checkInAfterMinutes: policy.checkInAfterMinutes,
    quietHoursStart: policy.quietHoursStart,
    quietHoursEnd: policy.quietHoursEnd,
    quietHoursTimezone: policy.quietHoursTimezone,
    dailyLimit: policy.dailyLimit,
    recentInteractionMinutes: policy.recentInteractionMinutes,
    allowedModes: policy.allowedModes.length > 0 ? [...policy.allowedModes] : ['COMPANION'],
    offlineCapable: policy.offlineCapable,
  };
}

const MODE_OPTIONS = [
  { value: 'OFF', label: PROACTIVE_LABELS.OFF || '关闭' },
  { value: 'FOLLOW_UP', label: PROACTIVE_LABELS.FOLLOW_UP || '跟进' },
  { value: 'DAILY', label: PROACTIVE_LABELS.DAILY || '日常' },
  { value: 'CLOSE_FRIEND', label: PROACTIVE_LABELS.CLOSE_FRIEND || '亲近' },
] as const;

export interface PolicyFormProps {
  relId: string | null;
  onSaved?: (policy: ProactivePolicy) => void;
}

export function PolicyForm({ relId, onSaved }: PolicyFormProps) {
  const policyQuery = useProactivePolicy(relId);
  const saveMutation = useSavePolicy(relId);
  const activeRelRef = useRef<string | null>(relId);
  activeRelRef.current = relId;

  const [conflictLatest, setConflictLatest] = useState<ProactivePolicy | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [reauthOpen, setReauthOpen] = useState(false);

  const form = useForm<PolicyFormValues>({
    defaultValues: toFormValues(readProactivePolicy({}, relId ?? '') as ProactivePolicy),
  });

  const {
    watch,
    setValue,
    reset,
    getValues,
    formState: { isDirty },
  } = form;

  const values = watch();
  const leaveGuardDialog = useLeaveGuard(isDirty);

  // Reset form when relationship changes
  useEffect(() => {
    setConflictLatest(null);
    setFormError(null);
  }, [relId]);

  // Populate form when initial server policy arrives (and don't overwrite user's dirty draft on conflict)
  useEffect(() => {
    if (!policyQuery.data) return;
    if (isDirty || conflictLatest) return;
    reset(toFormValues(policyQuery.data));
  }, [policyQuery.data, isDirty, conflictLatest, reset]);

  const executeSave = async () => {
    if (!relId) return;
    const capturedRelId = relId;
    const rawValues = getValues();
    const parsed = policyFormSchema.safeParse({
      ...rawValues,
      relationshipId: capturedRelId,
      dailyLimit: Number(rawValues.dailyLimit),
      recentInteractionMinutes: Number(rawValues.recentInteractionMinutes),
      checkInAfterMinutes:
        rawValues.supportsCheckIn && rawValues.checkInAfterMinutes !== null
          ? Number(rawValues.checkInAfterMinutes)
          : null,
    });

    if (!parsed.success) {
      const msg = parsed.error.issues[0]?.message ?? '请检查表单输入';
      setFormError(msg);
      return;
    }

    setFormError(null);
    try {
      const saved = await saveMutation.mutateAsync(parsed.data);
      if (activeRelRef.current !== capturedRelId) return;
      reset(toFormValues(saved));
      setConflictLatest(null);
      toast.show({ title: '已保存主动陪伴策略', kind: 'success' });
      onSaved?.(saved);
    } catch (err) {
      if (activeRelRef.current !== capturedRelId) return;
      const status = (err as { status?: number })?.status;
      const kind = (err as { kind?: string })?.kind;
      if (err instanceof ConflictError || status === 409 || kind === 'conflict-revision') {
        const detailsCurrent = (err as { details?: { current?: Record<string, unknown> } })?.details?.current;
        if (detailsCurrent) {
          setConflictLatest(normalizeProactivePolicy(detailsCurrent, capturedRelId));
        } else {
          const refetched = await policyQuery.refetch();
          if (activeRelRef.current === capturedRelId && refetched.data) {
            setConflictLatest(refetched.data);
          }
        }
        setFormError('版本冲突 (409)：该策略已在别处更新，你的草稿已保留。');
        return;
      }
      if (status === 401 || status === 403 || kind === 'forbidden') {
        setReauthOpen(true);
        return;
      }
      setFormError(err instanceof Error ? err.message : '没有保存，请重试。');
    }
  };

  const handleLoadLatest = () => {
    if (!conflictLatest) return;
    reset(toFormValues(conflictLatest));
    setConflictLatest(null);
    setFormError(null);
  };

  const handleKeepDraft = () => {
    setConflictLatest(null);
    setFormError(null);
  };

  const toggleAllowedMode = (modeKey: 'COMPANION' | 'STORY') => {
    const set = new Set(values.allowedModes);
    if (set.has(modeKey)) {
      if (set.size <= 1) return;
      set.delete(modeKey);
    } else {
      set.add(modeKey);
    }
    setValue('allowedModes', [...set], { shouldDirty: true });
  };

  if (!relId) {
    return null;
  }

  return (
    <section className="vc-inbox-card vc-policy-form" aria-label="主动关怀策略">
      <div className="vc-inbox-card__header">
        <h3 className="vc-inbox-card__title">主动关怀策略</h3>
        <Switch
          aria-label="允许主动关怀"
          checked={values.enabled}
          onCheckedChange={(checked) => {
            setValue('enabled', checked, { shouldDirty: true });
            if (values.supportsMode) {
              if (!checked && values.mode !== 'OFF') {
                setValue('mode', 'OFF', { shouldDirty: true });
              } else if (checked && values.mode === 'OFF') {
                setValue('mode', 'DAILY', { shouldDirty: true });
              }
            }
          }}
        />
      </div>

      {conflictLatest ? (
        <div className="vc-policy-conflict" role="alert">
          <div className="vc-policy-conflict__title">检测到版本冲突，请选择保留草稿或加载最新版本</div>
          <div className="vc-policy-conflict__compare">
            <div className="vc-policy-conflict__pane">
              <strong>我的草稿</strong>
              <div>每日上限：{values.dailyLimit}</div>
              <div>
                静默时段：{values.quietHoursStart || '--'} - {values.quietHoursEnd || '--'}
              </div>
            </div>
            <div className="vc-policy-conflict__pane">
              <strong>最新版本</strong>
              <div>每日上限：{conflictLatest.dailyLimit}</div>
              <div>
                静默时段：{conflictLatest.quietHoursStart || '--'} - {conflictLatest.quietHoursEnd || '--'}
              </div>
            </div>
          </div>
          <div className="vc-policy-conflict__actions">
            <Button variant="gray" size="sm" onClick={handleKeepDraft}>
              保留我的草稿
            </Button>
            <Button variant="filled" size="sm" onClick={handleLoadLatest}>
              加载最新
            </Button>
          </div>
        </div>
      ) : null}

      <form
        className="vc-policy-form__fields"
        onSubmit={(e) => {
          e.preventDefault();
          void executeSave();
        }}
      >
        {values.supportsMode ? (
          <Field label="关怀频率">
            <Segment
              aria-label="关怀频率"
              value={values.mode || 'OFF'}
              options={MODE_OPTIONS}
              onValueChange={(nextMode) => {
                setValue('mode', nextMode, { shouldDirty: true });
                setValue('enabled', nextMode !== 'OFF', { shouldDirty: true });
              }}
            />
          </Field>
        ) : null}

        {values.supportsCheckIn ? (
          <Field label="多久没聊（分钟）">
            <TextInput
              aria-label="多久没聊（分钟）"
              type="number"
              min={120}
              max={4320}
              value={values.checkInAfterMinutes != null ? String(values.checkInAfterMinutes) : ''}
              onValueChange={(val) => {
                const num = val.trim() === '' ? null : Number(val);
                setValue('checkInAfterMinutes', num !== null && !Number.isNaN(num) ? num : null, {
                  shouldDirty: true,
                });
              }}
            />
          </Field>
        ) : null}

        <Field label="每日上限">
          <TextInput
            aria-label="每日上限"
            type="number"
            min={0}
            max={48}
            value={String(values.dailyLimit)}
            onValueChange={(val) => {
              const num = val.trim() === '' ? 0 : Number(val);
              setValue('dailyLimit', Number.isNaN(num) ? 0 : num, { shouldDirty: true });
            }}
          />
        </Field>

        <Field label="间隔（分钟）">
          <TextInput
            aria-label="间隔（分钟）"
            type="number"
            min={0}
            max={10080}
            value={String(values.recentInteractionMinutes)}
            onValueChange={(val) => {
              const num = val.trim() === '' ? 0 : Number(val);
              setValue('recentInteractionMinutes', Number.isNaN(num) ? 0 : num, { shouldDirty: true });
            }}
          />
        </Field>

        <Field label="允许主动发消息的模式">
          <div className="vc-policy-form__modes">
            <Button
              type="button"
              size="sm"
              variant={values.allowedModes.includes('COMPANION') ? 'filled' : 'gray'}
              onClick={() => toggleAllowedMode('COMPANION')}
            >
              日常
            </Button>
            <Button
              type="button"
              size="sm"
              variant={values.allowedModes.includes('STORY') ? 'filled' : 'gray'}
              onClick={() => toggleAllowedMode('STORY')}
            >
              剧情
            </Button>
          </div>
        </Field>

        <div className="vc-policy-form__quiet-grid">
          <Field label="静默开始">
            <TextInput
              aria-label="静默开始"
              placeholder="23:00"
              value={values.quietHoursStart}
              onValueChange={(val) => setValue('quietHoursStart', val, { shouldDirty: true })}
            />
          </Field>
          <Field label="静默结束">
            <TextInput
              aria-label="静默结束"
              placeholder="07:00"
              value={values.quietHoursEnd}
              onValueChange={(val) => setValue('quietHoursEnd', val, { shouldDirty: true })}
            />
          </Field>
          <Field label="静默时区">
            <TextInput
              aria-label="静默时区"
              placeholder="Asia/Shanghai"
              value={values.quietHoursTimezone}
              onValueChange={(val) => setValue('quietHoursTimezone', val, { shouldDirty: true })}
            />
          </Field>
        </div>

        <Field label="离线跟进">
          <Switch
            aria-label="离线跟进"
            checked={values.offlineCapable}
            onCheckedChange={(checked) => setValue('offlineCapable', checked, { shouldDirty: true })}
          />
        </Field>

        {formError ? (
          <div className="vc-policy-form__error" role="alert">
            {formError}
          </div>
        ) : null}

        <div className="vc-policy-form__actions">
          <Button
            type="submit"
            variant="filled"
            pending={saveMutation.isPending}
          >
            保存策略
          </Button>
        </div>
      </form>

      <ReauthDialog
        open={reauthOpen}
        onOpenChange={setReauthOpen}
        onSuccess={() => executeSave()}
      />
      {leaveGuardDialog}
    </section>
  );
}
