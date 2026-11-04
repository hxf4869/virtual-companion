import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from '@tanstack/react-router';
import {
  invalidateVoicePolicy,
  voicePlayer,
  waitForVoiceClip,
} from '../../../../extension/vc-model-settings/voice-logic.js';
import { useAppClient } from '../../app/providers';
import { ConflictError } from '../../data/client';
import {
  usePreviewVoiceMutation,
  useSaveVoiceSettingsMutation,
  useVoiceEnginesQuery,
  useVoiceSettingsQuery,
} from '../../data/queries/voice';
import { AlertDialog } from '../../design/components/AlertDialog';
import { Button } from '../../design/components/Button';
import { toast } from '../../design/components/Toast';
import { useLeaveGuard } from '../../shell/useLeaveGuard';
import { VoiceForm, voiceFormValues, type VoiceValues } from './VoiceForm';

function ActiveRouterLeaveGuard({ dirty, busy }: { dirty: boolean; busy?: boolean }) {
  return <>{useLeaveGuard(dirty, { busy })}</>;
}

const SCENES = ['morning', 'night', 'care', 'share', 'default'] as const;
const MOODS = ['开心', '黏人', '好奇', '得意', '懒洋洋', '有点累', '想独处', '有点烦', '困'] as const;

export function buildGlobalVoicePayload(
  values: VoiceValues,
  settings: Record<string, any>,
): Record<string, unknown> {
  const { revision, updatedAt: _u, ...rest } = settings;
  const next: Record<string, any> = {
    ...rest,
    expectedRevision: revision,
    cosyVoiceInstructions: { ...(settings.cosyVoiceInstructions || {}) },
    proactiveVoiceRates: { ...(settings.proactiveVoiceRates || {}) },
    kokoroMoodSpeeds: { ...(settings.kokoroMoodSpeeds || {}) },
  };
  const boolKeys = ['kokoroEnabled', 'cosyVoiceEnabled', 'asrEnabled'];
  const numKeys = [
    'kokoroTimeoutSeconds',
    'cosyVoiceTimeoutSeconds',
    'asrTimeoutSeconds',
    'dailyChatLimit',
    'dailyProactiveLimit',
    'maxRecordingSeconds',
  ];
  for (const k of boolKeys) {
    if (k in values) next[k] = Boolean(values[k]);
  }
  for (const k of numKeys) {
    if (k in values) next[k] = Number(values[k]);
  }
  if ('voiceFrequency' in values) {
    next.voiceFrequency = String(values.voiceFrequency ?? 'STANDARD');
  }
  for (const scene of SCENES) {
    if (`instruction:${scene}` in values) {
      next.cosyVoiceInstructions[scene] = String(values[`instruction:${scene}`] ?? '');
    }
    if (`rate:${scene}` in values) {
      next.proactiveVoiceRates[scene] = Number(values[`rate:${scene}`]) / 100;
    }
  }
  for (const mood of MOODS) {
    if (`mood:${mood}` in values) {
      next.kokoroMoodSpeeds[mood] = Number(values[`mood:${mood}`]);
    }
  }
  return next;
}

export interface VoiceSectionProps {
  relationshipId?: string;
}

export function VoiceSection({ relationshipId }: VoiceSectionProps = {}) {
  const client = useAppClient();
  const router = useRouter({ warn: false });
  const settingsQuery = useVoiceSettingsQuery();
  const enginesQuery = useVoiceEnginesQuery();
  const saveMutation = useSaveVoiceSettingsMutation();
  const previewMutation = usePreviewVoiceMutation();

  const [values, setValues] = useState<VoiceValues>({});
  const [baseline, setBaseline] = useState<string>('');
  const [loaded, setLoaded] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string>('');
  const [showLoadLatest, setShowLoadLatest] = useState(false);
  const [confirmDiscardOpen, setConfirmDiscardOpen] = useState(false);
  const [previewState, setPreviewState] = useState<
    Record<string, { busy?: boolean; playing?: boolean }>
  >({});

  const formRef = useRef<HTMLFormElement | null>(null);
  const previewEpochRef = useRef(0);

  useEffect(() => {
    return () => {
      previewEpochRef.current += 1;
      voicePlayer.stop();
    };
  }, []);

  const currentSnapshot = useMemo(() => {
    if (!loaded || !settingsQuery.data) return '';
    return JSON.stringify(
      buildGlobalVoicePayload(values, settingsQuery.data as Record<string, any>),
    );
  }, [loaded, settingsQuery.data, values]);

  const isDirty = Boolean(loaded && baseline && currentSnapshot !== baseline);

  // Initialize or update values from query when not dirty
  useEffect(() => {
    if (!settingsQuery.data || !enginesQuery.data) return;
    if (!loaded || (!isDirty && !showLoadLatest)) {
      const nextValues = voiceFormValues(settingsQuery.data as Record<string, unknown>);
      setValues(nextValues);
      setBaseline(
        JSON.stringify(
          buildGlobalVoicePayload(
            nextValues,
            settingsQuery.data as Record<string, any>,
          ),
        ),
      );
      setLoaded(true);
      setStatusMessage('');
      setShowLoadLatest(false);
    }
  }, [settingsQuery.data, enginesQuery.data, loaded, isDirty, showLoadLatest]);

  const handleFieldChange = useCallback((key: string, value: string | boolean) => {
    setValues((prev) => ({ ...prev, [key]: value }));
    if (['kokoroVoice', 'cosyVoice', 'speed'].includes(key)) {
      previewEpochRef.current += 1;
      setPreviewState({});
      voicePlayer.stop();
    }
  }, []);

  const handleLoadLatest = useCallback(async () => {
    setStatusMessage('');
    const [sRes] = await Promise.all([
      settingsQuery.refetch(),
      enginesQuery.refetch(),
    ]);
    if (sRes.data) {
      const nextValues = voiceFormValues(sRes.data as Record<string, unknown>);
      setValues(nextValues);
      setBaseline(
        JSON.stringify(
          buildGlobalVoicePayload(nextValues, sRes.data as Record<string, any>),
        ),
      );
      setLoaded(true);
      setShowLoadLatest(false);
    }
  }, [settingsQuery, enginesQuery]);

  const handlePreview = useCallback(
    async (engine: string) => {
      if (!relationshipId || !settingsQuery.data) return;
      const ticket = ++previewEpochRef.current;
      const key = engine === 'kokoro' ? 'kokoroVoice' : 'cosyVoice';
      const voice = String(values[key] || '') || (engine === 'kokoro' ? 'zf_001' : 'default');
      const speed = Number(values.speed) || 1;
      setPreviewState({ [engine]: { busy: true } });
      try {
        const queued: any = await previewMutation.mutateAsync({
          relationshipId: String(relationshipId),
          engine,
          voice,
          speed,
        });
        if (ticket !== previewEpochRef.current) return;
        const timeoutMs =
          (engine === 'kokoro'
            ? Number((settingsQuery.data as any).kokoroTimeoutSeconds || 30)
            : Number((settingsQuery.data as any).cosyVoiceTimeoutSeconds || 30)) *
            1000 +
          5000;
        const clip: any = await waitForVoiceClip(queued.clipId, {
          timeoutMs,
          fetchClip: (id: string) => client.go.fetchVoiceClip(id),
        });
        if (ticket !== previewEpochRef.current || !clip) throw new Error('preview');
        await voicePlayer.toggle(clip.clipId, {
          onState(playing: boolean) {
            if (ticket === previewEpochRef.current) {
              setPreviewState({ [engine]: { playing } });
            }
          },
          onError() {
            if (ticket === previewEpochRef.current) {
              setPreviewState({});
              setStatusMessage('没有完成，请重试。');
            }
          },
        });
      } catch {
        if (ticket === previewEpochRef.current) {
          setPreviewState({});
          setStatusMessage('没有完成，请重试。');
        }
      }
    },
    [relationshipId, settingsQuery.data, values, previewMutation, client.go],
  );

  const handleSave = useCallback(async () => {
    if (
      saveMutation.isPending ||
      settingsQuery.isLoading ||
      !loaded ||
      !isDirty ||
      !settingsQuery.data
    ) {
      return;
    }
    if (formRef.current && !formRef.current.reportValidity()) return;
    setStatusMessage('');
    const payload = buildGlobalVoicePayload(
      values,
      settingsQuery.data as Record<string, any>,
    );
    try {
      const saved: any = await saveMutation.mutateAsync(payload);
      invalidateVoicePolicy();
      globalThis.dispatchEvent?.(new Event('vc-voice-settings-changed'));
      const refetched = saved || (await settingsQuery.refetch()).data || settingsQuery.data;
      setBaseline(
        JSON.stringify(
          buildGlobalVoicePayload(values, refetched as Record<string, any>),
        ),
      );
      setShowLoadLatest(false);
      toast.show({ title: '已保存', kind: 'success' });
    } catch (err: any) {
      const isConflict =
        err instanceof ConflictError ||
        err?.kind === 'conflict-revision' ||
        err?.status === 409;
      setStatusMessage(
        isConflict
          ? '设置已在另一处更新。你的输入已保留。'
          : '没有完成，请重试。',
      );
      setShowLoadLatest(isConflict);
    }
  }, [saveMutation, settingsQuery, loaded, isDirty, values]);

  const working = saveMutation.isPending;
  const loading = settingsQuery.isLoading || enginesQuery.isLoading;
  const enginesData = (enginesQuery.data as any) ?? { tts: [], asr: {} };

  return (
    <section className="vc-settings-section" data-vc-voice-section="">
      {router ? <ActiveRouterLeaveGuard dirty={isDirty} busy={working} /> : null}
      <header className="vc-settings-header">
        <h1 className="vc-settings-title">语音</h1>
        <div className="vc-settings-actions">
          {isDirty && (
            <Button
              type="button"
              variant="text"
              disabled={working || loading}
              onClick={() => setConfirmDiscardOpen(true)}
            >
              放弃修改
            </Button>
          )}
          <Button
            type="button"
            variant="filled"
            data-voice-save=""
            disabled={working || loading || !loaded || !isDirty}
            onClick={() => void handleSave()}
          >
            {working ? '保存中…' : '保存'}
          </Button>
        </div>
      </header>

      <form
        ref={formRef}
        className="vc-column vc-voice-settings"
        data-voice-settings={relationshipId ? 'relationship' : 'global'}
        onSubmit={(e) => {
          e.preventDefault();
          void handleSave();
        }}
      >
        {loaded &&
          (relationshipId ? (
            <VoiceForm
              mode="relationship"
              values={values}
              engines={enginesData}
              disabled={working || loading}
              preview={previewState}
              onFieldChange={handleFieldChange}
              onPreview={(eng) => void handlePreview(eng)}
            />
          ) : (
            <VoiceForm
              mode="global"
              values={values}
              engines={enginesData}
              disabled={working || loading}
              onFieldChange={handleFieldChange}
            />
          ))}
        <p role="status">
          {loading && !loaded
            ? '正在加载…'
            : settingsQuery.isError || enginesQuery.isError
              ? '没有完成，请重试。'
              : statusMessage}
        </p>
        {(showLoadLatest || settingsQuery.isError || enginesQuery.isError) && (
          <Button
            type="button"
            variant="text"
            disabled={working || loading}
            onClick={() => void handleLoadLatest()}
          >
            加载最新
          </Button>
        )}
      </form>

      <AlertDialog
        open={confirmDiscardOpen}
        onOpenChange={setConfirmDiscardOpen}
        title="放弃更改？"
        description="关闭后本次输入将丢失。"
        cancelLabel="继续编辑"
        confirmLabel="放弃"
        danger
        onConfirm={() => {
          setConfirmDiscardOpen(false);
          if (settingsQuery.data) {
            const nextValues = voiceFormValues(
              settingsQuery.data as Record<string, unknown>,
            );
            setValues(nextValues);
            setStatusMessage('');
            setShowLoadLatest(false);
          }
        }}
      />
    </section>
  );
}
