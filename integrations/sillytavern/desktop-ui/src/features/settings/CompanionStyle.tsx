import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from '@tanstack/react-router';
import {
  DEFAULT_GLOBAL_RULES,
  RULES_KEY,
  readGlobalRules,
} from '../../../../extension/vc-model-settings/instance-logic.js';
import { PLANNER_KEY } from '../../../../extension/vc-model-settings/reply-planner.js';
import {
  applyDocumentValues,
  documentChanges,
} from '../../../../extension/vc-model-settings/settings-documents.js';
import { useAppClient } from '../../app/providers';
import { settingsDocQueryOptions } from '../../data/queries/tavern';
import { Switch } from '../../design/components/Switch';
import { toast } from '../../design/components/Toast';
import { useSessionBridge } from '../../runtime/session-bridge';
import { useLeaveGuard } from '../../shell/useLeaveGuard';

function ActiveRouterLeaveGuard({ dirty, busy }: { dirty: boolean; busy: boolean }) {
  return <>{useLeaveGuard(dirty, { busy })}</>;
}

type StyleDocument = Record<string, unknown> & {
  extension_settings?: Record<string, unknown>;
};

function readStyleDocument(raw: unknown): StyleDocument | null {
  if (typeof raw !== 'string') return null;
  try {
    const value = JSON.parse(raw);
    return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}

export function CompanionStyle() {
  const client = useAppClient();
  const queryClient = useQueryClient();
  const queryOptions = settingsDocQueryOptions(client);
  const settingsQuery = useQuery(queryOptions);
  const bridge = useSessionBridge();
  const router = useRouter({ warn: false });
  const [baseline, setBaseline] = useState<StyleDocument | null>(null);
  const [rules, setRules] = useState<string>(DEFAULT_GLOBAL_RULES);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const savedRules = readGlobalRules(baseline?.extension_settings ?? {});
  const plannerEnabled = baseline?.extension_settings?.[PLANNER_KEY] === true;
  const isDirty = Boolean(baseline && rules !== savedRules);

  useEffect(() => {
    if (saving || isDirty) return;
    const fresh = readStyleDocument(settingsQuery.data?.settings);
    if (!fresh) return;
    setBaseline(fresh);
    setRules(readGlobalRules(fresh.extension_settings ?? {}));
  }, [settingsQuery.data, saving, isDirty]);

  const saveStyle = async (patch: Record<string, unknown>) => {
    if (!baseline || savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    try {
      const next = {
        ...baseline,
        extension_settings: { ...baseline.extension_settings, ...patch },
      };
      const changes = documentChanges(baseline, baseline, next);
      if (changes.length) {
        await client.post('/api/settings/save', { vc_changes: changes });
      }
      setBaseline(next);
      if (typeof patch[RULES_KEY] === 'string') setRules(readGlobalRules(next.extension_settings));
      queryClient.setQueryData(queryOptions.queryKey, (packet) => ({
        ...packet,
        settings: JSON.stringify(
          applyDocumentValues(readStyleDocument(packet?.settings) ?? structuredClone(baseline), changes),
        ),
      }));
      if (changes.length) await bridge.applySettings(changes);
      toast.show({ title: '已保存', kind: 'success' });
    } catch {
      toast.show({ title: '没有完成，请重试。', kind: 'error' });
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  return (
    <section className="vc-column vc-style-page vc-settings-section" data-vc-companion-style="">
      {router ? <ActiveRouterLeaveGuard dirty={isDirty} busy={saving} /> : null}
      <div data-planner-row="">
        <div className="vc-group">
          <div className="vc-cell">
            <span className="vc-grow">先想再说</span>
            <Switch
              aria-label="先想再说"
              checked={plannerEnabled}
              disabled={!baseline || saving}
              onCheckedChange={(checked) => void saveStyle({ [PLANNER_KEY]: checked })}
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
          disabled={!baseline || saving}
          onChange={(e) => setRules(e.currentTarget.value)}
          onBlur={(event) => {
            if (isDirty && !event.relatedTarget?.closest('[data-action="restore-rules"]')) {
              void saveStyle({ [RULES_KEY]: rules });
            }
          }}
        />
      </label>

      <div className="vc-settings-actions">
        <button
          type="button"
          className="vc-btn vc-btn-text"
          data-action="restore-rules"
          disabled={!baseline || saving}
          onClick={() => void saveStyle({ [RULES_KEY]: DEFAULT_GLOBAL_RULES, [PLANNER_KEY]: false })}
        >
          恢复默认
        </button>
        {isDirty && (
          <button
            type="button"
            className="vc-btn vc-btn-fill"
            disabled={saving}
            onClick={() => void saveStyle({ [RULES_KEY]: rules })}
          >
            {saving ? '保存中…' : '保存'}
          </button>
        )}
      </div>
    </section>
  );
}
export default CompanionStyle;
