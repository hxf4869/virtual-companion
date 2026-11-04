import { useCallback, useEffect, useState } from 'react';
import { useRouter } from '@tanstack/react-router';
import {
  DEFAULT_GLOBAL_RULES,
  RULES_KEY,
  readGlobalRules,
} from '../../../../extension/vc-model-settings/instance-logic.js';
import { PLANNER_KEY } from '../../../../extension/vc-model-settings/reply-planner.js';
import { Switch } from '../../design/components/Switch';
import { toast } from '../../design/components/Toast';
import { useSessionBridge } from '../../runtime/session-bridge';
import { useLeaveGuard } from '../../shell/useLeaveGuard';

function ActiveRouterLeaveGuard({ dirty }: { dirty: boolean }) {
  return <>{useLeaveGuard(dirty)}</>;
}

export function CompanionStyle() {
  const bridge = useSessionBridge();
  const router = useRouter({ warn: false });

  const readContextSettings = useCallback(() => {
    const ctx = bridge.getContext?.() || {};
    const ext =
      ctx.extensionSettings && typeof ctx.extensionSettings === 'object'
        ? ctx.extensionSettings
        : {};
    return {
      rules: readGlobalRules(ext),
      plannerEnabled: ext[PLANNER_KEY] === true,
    };
  }, [bridge]);

  const initial = readContextSettings();
  const [rules, setRules] = useState<string>(initial.rules);
  const [savedRules, setSavedRules] = useState<string>(initial.rules);
  const [plannerEnabled, setPlannerEnabled] = useState<boolean>(initial.plannerEnabled);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const current = readContextSettings();
    setRules(current.rules);
    setSavedRules(current.rules);
    setPlannerEnabled(current.plannerEnabled);
  }, [readContextSettings]);

  const isDirty = rules !== savedRules;

  const commitExtensionSetting = useCallback(
    async (key: string, nextValue: unknown) => {
      const ctx = bridge.getContext?.();
      if (ctx) {
        if (!ctx.extensionSettings || typeof ctx.extensionSettings !== 'object') {
          ctx.extensionSettings = {};
        }
        const beforeVal = ctx.extensionSettings[key];
        const hadBefore = Object.prototype.hasOwnProperty.call(ctx.extensionSettings, key);
        ctx.extensionSettings[key] = nextValue;
        ctx.saveSettingsDebounced?.();
        try {
          await bridge.applySettings?.([
            {
              path: ['extension_settings', key],
              before: { exists: hadBefore, value: beforeVal },
              after: { exists: true, value: nextValue },
            },
          ]);
        } catch {
          // runtime apply fallback already handled by context
        }
      }
    },
    [bridge],
  );

  const handleTogglePlanner = useCallback(
    (checked: boolean) => {
      setPlannerEnabled(checked);
      void commitExtensionSetting(PLANNER_KEY, checked);
    },
    [commitExtensionSetting],
  );

  const handleSaveRules = useCallback(async () => {
    if (saving || !isDirty) return;
    setSaving(true);
    try {
      await commitExtensionSetting(RULES_KEY, rules);
      setSavedRules(rules);
      toast.show({ title: '已保存', kind: 'success' });
    } finally {
      setSaving(false);
    }
  }, [saving, isDirty, commitExtensionSetting, rules]);

  const handleRestoreDefaults = useCallback(async () => {
    setRules(DEFAULT_GLOBAL_RULES);
    setSavedRules(DEFAULT_GLOBAL_RULES);
    setPlannerEnabled(false);
    await commitExtensionSetting(RULES_KEY, DEFAULT_GLOBAL_RULES);
    await commitExtensionSetting(PLANNER_KEY, false);
  }, [commitExtensionSetting]);

  return (
    <section className="vc-column vc-style-page vc-settings-section" data-vc-companion-style="">
      {router ? <ActiveRouterLeaveGuard dirty={isDirty} /> : null}
      <div data-planner-row="">
        <div className="vc-group">
          <div className="vc-cell">
            <span className="vc-grow">先想再说</span>
            <Switch
              aria-label="先想再说"
              checked={plannerEnabled}
              onCheckedChange={handleTogglePlanner}
            />
          </div>
        </div>
        <p className="vc-footnote" id="vc-planner-cost">
          可能增加一次模型用量。
        </p>
      </div>

      <label className="vc-style-rule">
        <textarea
          data-field="rules"
          aria-label="陪伴风格"
          rows={10}
          value={rules}
          onChange={(e) => setRules(e.currentTarget.value)}
          onBlur={() => {
            if (rules !== savedRules) {
              void handleSaveRules();
            }
          }}
        />
      </label>

      <div className="vc-settings-actions">
        <button
          type="button"
          className="vc-btn vc-btn-text"
          data-action="restore-rules"
          onClick={() => void handleRestoreDefaults()}
        >
          恢复默认
        </button>
        {isDirty && (
          <button
            type="button"
            className="vc-btn vc-btn-fill"
            disabled={saving}
            onClick={() => void handleSaveRules()}
          >
            {saving ? '保存中…' : '保存'}
          </button>
        )}
      </div>
    </section>
  );
}
export default CompanionStyle;
