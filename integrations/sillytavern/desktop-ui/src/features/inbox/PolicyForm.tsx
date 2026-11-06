import { type ReactNode } from 'react';
import { type ProactivePolicy } from '../../data/queries/inbox';
import { Button } from '../../design/components/Button';
import { Field } from '../../design/components/Field';
import { Segment } from '../../design/components/Segment';
import { Switch } from '../../design/components/Switch';
import { TextInput } from '../../design/components/TextInput';
import { toast } from '../../design/components/Toast';
import { ReauthDialog } from './ReauthDialog';
import {
  POLICY_MODE_OPTIONS,
  policyFormSchema,
  toPolicyFormValues,
  usePolicyForm,
  type PolicyFormValues,
  type UsePolicyFormOptions,
} from './useInbox';

export {
  POLICY_MODE_OPTIONS,
  policyFormSchema,
  toPolicyFormValues,
  usePolicyForm,
  type PolicyFormValues,
  type UsePolicyFormOptions,
};

export type LeaveGuardProp = ReactNode | ((dirty: boolean) => ReactNode);

export interface PolicyFormProps {
  relId: string | null;
  onSaved?: (policy: ProactivePolicy) => void;
  onDirtyChange?: (isDirty: boolean) => void;
  guard?: LeaveGuardProp;
}

export function PolicyForm({
  relId,
  onSaved,
  onDirtyChange,
  guard,
}: PolicyFormProps) {
  const {
    values,
    isDirty,
    isPolicyReady,
    isSaving,
    conflictLatest,
    formError,
    reauthOpen,
    setReauthOpen,
    executeSave,
    handleLoadLatest,
    handleKeepDraft,
    setEnabled,
    setMode,
    setCheckInAfterMinutes,
    setDailyLimit,
    setRecentInteractionMinutes,
    toggleAllowedMode,
    setQuietHoursStart,
    setQuietHoursEnd,
    setQuietHoursTimezone,
    setOfflineCapable,
  } = usePolicyForm({
    relId,
    onDirtyChange,
    onSaved: (saved) => {
      toast.show({ title: '已保存主动陪伴策略', kind: 'success' });
      onSaved?.(saved);
    },
  });

  const leaveGuardDialog =
    typeof guard === 'function' ? guard(isDirty) : (guard ?? null);

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
          onCheckedChange={setEnabled}
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
              options={POLICY_MODE_OPTIONS}
              onValueChange={setMode}
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
              onValueChange={setCheckInAfterMinutes}
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
            onValueChange={setDailyLimit}
          />
        </Field>

        <Field label="间隔（分钟）">
          <TextInput
            aria-label="间隔（分钟）"
            type="number"
            min={0}
            max={10080}
            value={String(values.recentInteractionMinutes)}
            onValueChange={setRecentInteractionMinutes}
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
              onValueChange={setQuietHoursStart}
            />
          </Field>
          <Field label="静默结束">
            <TextInput
              aria-label="静默结束"
              placeholder="07:00"
              value={values.quietHoursEnd}
              onValueChange={setQuietHoursEnd}
            />
          </Field>
          <Field label="静默时区">
            <TextInput
              aria-label="静默时区"
              placeholder="Asia/Shanghai"
              value={values.quietHoursTimezone}
              onValueChange={setQuietHoursTimezone}
            />
          </Field>
        </div>

        <Field label="离线跟进">
          <Switch
            aria-label="离线跟进"
            checked={values.offlineCapable}
            onCheckedChange={setOfflineCapable}
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
            disabled={!isPolicyReady}
            pending={isSaving}
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
