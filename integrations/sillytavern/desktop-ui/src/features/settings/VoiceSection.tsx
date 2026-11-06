import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  buildRelationshipVoicePayload,
  invalidateVoicePolicy,
  resolvePreviewVoice,
  voicePlayer,
  waitForVoiceClip,
} from '../../../../extension/vc-model-settings/voice-logic.js';
import { useAppClient } from '../../app/providers';
import { ConflictError } from '../../data/client';
import { queryKeys } from '../../data/queryKeys';
import {
  usePreviewVoiceMutation,
  useSaveVoiceSettingsMutation,
  useVoiceEnginesQuery,
  useVoiceSettingsQuery,
} from '../../data/queries/voice';
import { AlertDialog } from '../../design/components/AlertDialog';
import { Button } from '../../design/components/Button';
import { toast } from '../../design/components/Toast';
import { DesktopVoiceForm } from './DesktopVoiceForm';
import { voiceFormValues, type VoiceValues } from './VoiceForm';

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
  renderLeaveGuard?: (state: { dirty: boolean; busy?: boolean }) => ReactNode;
}

function voiceRelationship(rows: unknown, id?: string) {
  return Array.isArray(rows)
    ? rows.find((row) => String(row?.relationshipId) === id)
    : undefined;
}

export function VoiceSection({ relationshipId, renderLeaveGuard }: VoiceSectionProps = {}) {
  const client = useAppClient();
  const queryClient = useQueryClient();
  const settingsQuery = useVoiceSettingsQuery();
  const enginesQuery = useVoiceEnginesQuery();
  const saveMutation = useSaveVoiceSettingsMutation();
  const previewMutation = usePreviewVoiceMutation();
  const relationshipsQuery = useQuery({
    queryKey: queryKeys.relationships,
    queryFn: () => client.go.fetchRelationships(),
    enabled: Boolean(relationshipId),
  });
  const saveRelationship = useMutation({
    mutationFn: async (draft: { values: VoiceValues; baseline: Record<string, any> }) => {
      const fresh = voiceRelationship(await client.go.fetchRelationships(), relationshipId);
      if (!fresh) throw new Error('没有完成，请重试。');
      const payload: Record<string, unknown> = buildRelationshipVoicePayload(draft.values, fresh);
      const original: Record<string, unknown> = buildRelationshipVoicePayload(
        voiceFormValues(draft.baseline, draft.baseline),
        fresh,
      );
      for (const key of ['kokoroVoice', 'cosyVoice', 'speed', 'voiceFrequency', 'proactiveEngine', 'proactiveVoice']) {
        if (Object.is(payload[key], original[key])) delete payload[key];
      }
      return client.go.storyRequest('PATCH', `/api/v1/relationships/${encodeURIComponent(relationshipId!)}`, payload);
    },
    onSuccess: (saved) => {
      queryClient.setQueryData(queryKeys.relationships, (rows) =>
        Array.isArray(rows)
          ? rows.map((row) => String(row?.relationshipId) === relationshipId ? saved : row)
          : [saved],
      );
    },
  });
  const latestSource = relationshipId
    ? voiceRelationship(relationshipsQuery.data, relationshipId)
    : settingsQuery.data;

  const [values, setValues] = useState<VoiceValues>({});
  const [baseline, setBaseline] = useState<Record<string, any> | null>(null);
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

  const loaded = baseline !== null;
  const working = saveMutation.isPending || saveRelationship.isPending;
  const loading = enginesQuery.isLoading || settingsQuery.isLoading ||
    Boolean(relationshipId && relationshipsQuery.isLoading);
  const loadError = settingsQuery.isError || enginesQuery.isError ||
    Boolean(relationshipId && (relationshipsQuery.isError || (!loading && !latestSource)));
  const buildPayload = relationshipId ? buildRelationshipVoicePayload : buildGlobalVoicePayload;
  const isDirty = Boolean(baseline && JSON.stringify(buildPayload(values, baseline)) !==
    JSON.stringify(buildPayload(voiceFormValues(baseline, relationshipId ? baseline : undefined), baseline)));

  const adoptSource = useCallback((source: Record<string, any>) => {
    setBaseline(source);
    setValues(voiceFormValues(source, relationshipId ? source : undefined));
    setStatusMessage('');
    setShowLoadLatest(false);
  }, [relationshipId]);

  useEffect(() => {
    if (!latestSource || !enginesQuery.data || working || isDirty || showLoadLatest) return;
    adoptSource(latestSource);
  }, [latestSource, enginesQuery.data, working, isDirty, showLoadLatest, adoptSource]);

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
    const [sRes, enginesRes] = await Promise.all([
      relationshipId ? relationshipsQuery.refetch() : settingsQuery.refetch(),
      enginesQuery.refetch(),
    ]);
    const source = relationshipId ? voiceRelationship(sRes.data, relationshipId) : sRes.data;
    if (sRes.isError || enginesRes.isError || !source) {
      setStatusMessage('没有完成，请重试。');
      return;
    }
    adoptSource(source);
  }, [settingsQuery, enginesQuery, relationshipsQuery, relationshipId, adoptSource]);

  const handlePreview = useCallback(
    async (engine: string) => {
      if (!relationshipId || !settingsQuery.data || !baseline) return;
      const ticket = ++previewEpochRef.current;
      const voice = resolvePreviewVoice(engine, values, baseline, enginesQuery.data);
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
    [relationshipId, settingsQuery.data, baseline, enginesQuery.data, values, previewMutation, client.go],
  );

  const handleSave = useCallback(async () => {
    if (
      working ||
      loading ||
      !baseline ||
      !isDirty ||
      !latestSource
    ) {
      return;
    }
    if (formRef.current && !formRef.current.reportValidity()) return;
    setStatusMessage('');
    try {
      const saved = relationshipId
        ? await saveRelationship.mutateAsync({ values, baseline })
        : await saveMutation.mutateAsync(buildGlobalVoicePayload(values, baseline));
      if (!saved) throw new Error('没有完成，请重试。');
      invalidateVoicePolicy();
      globalThis.dispatchEvent?.(new Event('vc-voice-settings-changed'));
      if (!relationshipId) queryClient.setQueryData(queryKeys.voiceSettings, saved);
      adoptSource(saved);
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
  }, [working, loading, baseline, isDirty, latestSource, relationshipId, saveRelationship, values, saveMutation, queryClient, adoptSource]);
  const enginesData = (enginesQuery.data as any) ?? { tts: [], asr: {} };

  return (
    <section className="vc-settings-section" data-vc-voice-section="">
      {renderLeaveGuard ? renderLeaveGuard({ dirty: isDirty, busy: working }) : null}
      <header className="vc-settings-header">
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
            className="vc-btn-fill"
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
            <DesktopVoiceForm
              mode="relationship"
              values={values}
              engines={enginesData}
              disabled={working || loading}
              preview={previewState}
              onFieldChange={handleFieldChange}
              onPreview={(eng) => void handlePreview(eng)}
            />
          ) : (
            <DesktopVoiceForm
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
            : loadError
              ? '没有完成，请重试。'
              : statusMessage}
        </p>
        {(showLoadLatest || loadError) && (
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
          const source = latestSource ?? baseline;
          if (source) adoptSource(source);
        }}
      />
    </section>
  );
}
