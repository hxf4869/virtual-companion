import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from '@tanstack/react-router';
import * as logic from '../../../../extension/vc-model-settings/model-logic.js';
import { iconSpriteUrl } from '../../../../extension/vc-model-settings/ui/icons.js';
import { useAppClient } from '../../app/providers';
import { ConflictError } from '../../data/client';
import {
  useDiscoverProviderModelsMutation,
  useLocalModelsQuery,
  useProvidersQuery,
  usePurposesQuery,
  useSaveLocalRerankMutation,
  useSaveModelPurposeMutation,
  useSaveProviderMutation,
  useUsageQuery,
  useVerifyModelToolCallsMutation,
} from '../../data/queries/models';
import { AlertDialog } from '../../design/components/AlertDialog';
import { toast } from '../../design/components/Toast';
import { useSessionBridge } from '../../runtime/session-bridge';
import { useLeaveGuard } from '../../shell/useLeaveGuard';
import { Action, Input } from '../models/fields';
import { LocalModels } from './LocalModels';
import { ProviderForm, ProviderList } from './ProviderForm';
import { PurposeBindings } from './PurposeBindings';
import { UsagePanel } from './UsagePanel';

const NEW_KEY_PLACEHOLDER_RE = /^__new_\d+__$/;

function fmtTime(iso?: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function isBlank(v: unknown): boolean {
  return v === '' || v === null || v === undefined;
}

function isKind(err: unknown, kind: string): boolean {
  if (!err || typeof err !== 'object') return false;
  return (err as { kind?: string }).kind === kind;
}

function ActiveRouterLeaveGuard({ dirty }: { dirty: boolean }) {
  return <>{useLeaveGuard(dirty)}</>;
}

interface BindingDraftEntry {
  providerId: string;
  profileKey: string;
  state: string;
  revision: number;
  dirty: boolean;
  error: string | null;
}

export function ModelSection() {
  const client = useAppClient();
  const bridge = useSessionBridge();
  const router = useRouter({ warn: false });
  const sprite = iconSpriteUrl();

  const [usageMonth, setUsageMonth] = useState<string>(() => logic.currentUsageMonth());
  const providersQuery = useProvidersQuery();
  const purposesQuery = usePurposesQuery();
  const localModelsQuery = useLocalModelsQuery();
  const usageQuery = useUsageQuery(usageMonth);

  const saveProviderMutation = useSaveProviderMutation();
  const savePurposeMutation = useSaveModelPurposeMutation();
  const saveRerankMutation = useSaveLocalRerankMutation();
  const discoverMutation = useDiscoverProviderModelsMutation();
  const verifyToolCallsMutation = useVerifyModelToolCallsMutation();

  const providers: any[] = useMemo(
    () => (Array.isArray(providersQuery.data) ? providersQuery.data : []),
    [providersQuery.data],
  );
  const purposes: any[] = useMemo(
    () => (Array.isArray(purposesQuery.data) ? purposesQuery.data : []),
    [purposesQuery.data],
  );

  const [selectedProviderId, setSelectedProviderId] = useState<string | null>(null);
  const [creatingNew, setCreatingNew] = useState(false);
  const [draft, setDraft] = useState<any | null>(null);
  const [originalDraft, setOriginalDraft] = useState<any | null>(null);
  const [activeModelIndex, setActiveModelIndex] = useState<number>(0);
  const [tab, setTab] = useState<'provider' | 'bindings'>('provider');

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [conflict, setConflict] = useState<{ message: string; currentRevision: number | null } | null>(null);
  const [contextChanged, setContextChanged] = useState<string | null>(null);
  const [stash, setStash] = useState<{ draft: any; selectedProfileKey: string | null } | null>(null);
  const [stashBanner, setStashBanner] = useState(false);
  const [keyEditing, setKeyEditing] = useState(false);
  const [keyClearing, setKeyClearing] = useState(false);
  const [cloneFor, setCloneFor] = useState<{
    profileKey: string;
    newProfileKey: string;
    newDisplayName: string;
    error: string | null;
  } | null>(null);
  const [deleteFor, setDeleteFor] = useState<string | null>(null);
  const [advancedOpen, setAdvancedOpen] = useState(false);

  const [discoverBusy, setDiscoverBusy] = useState(false);
  const [discoverError, setDiscoverError] = useState<string | null>(null);
  const [checkState, setCheckState] = useState<{
    busy: boolean;
    error: string | null;
    result: { total: number; unrecorded: readonly { modelId: string; displayName: string }[] } | null;
  }>({ busy: false, error: null, result: null });
  const [toolVerify, setToolVerify] = useState<{
    busy: boolean;
    profileKey: string | null;
    error: string | null;
  }>({ busy: false, profileKey: null, error: null });

  const [bindingsDraft, setBindingsDraft] = useState<Record<string, BindingDraftEntry>>({});
  const [bindingsSaving, setBindingsSaving] = useState(false);
  const [bindingsConflict, setBindingsConflict] = useState<{
    purpose: string;
    currentRevision: number | null;
    latest: any | null;
  } | null>(null);

  const [reauth, setReauth] = useState<{
    open: boolean;
    busy: boolean;
    error: string | null;
    password: string;
    retry: 'provider' | 'bindings' | 'verify-tool-calls' | 'local-rerank' | null;
  }>({ open: false, busy: false, error: null, password: '', retry: null });
  const [pendingRerank, setPendingRerank] = useState<boolean>(false);

  const [sharedImpactConfirm, setSharedImpactConfirm] = useState<{
    usages: string[];
  } | null>(null);
  const [pendingInternalLeave, setPendingInternalLeave] = useState<(() => void) | null>(null);

  const providerRequestRef = useRef(0);
  const latestDraftRef = useRef<any | null>(draft);
  latestDraftRef.current = draft;
  const latestProfileKeyRef = useRef<string | null>(null);
  const bindingsDraftRef = useRef<Record<string, BindingDraftEntry>>(bindingsDraft);
  bindingsDraftRef.current = bindingsDraft;
  const modelIdentitiesRef = useRef(new WeakMap<object, number>());
  const nextModelIdentityRef = useRef(0);

  const getModelIdentity = useCallback((model: object) => {
    let id = modelIdentitiesRef.current.get(model);
    if (!id) {
      id = ++nextModelIdentityRef.current;
      modelIdentitiesRef.current.set(model, id);
    }
    return id;
  }, []);

  const invalidateProviderRequests = useCallback(() => {
    providerRequestRef.current += 1;
    setDiscoverBusy(false);
    setDiscoverError(null);
    setCheckState({ busy: false, error: null, result: null });
    setToolVerify({ busy: false, profileKey: null, error: null });
    setReauth({ open: false, busy: false, error: null, password: '', retry: null });
  }, []);

  const applyProviderSelection = useCallback(
    (providerId: string | null, providerList: any[], keepProfileKey?: string | null) => {
      invalidateProviderRequests();
      setSelectedProviderId(providerId);
      const found = providerList.find((p) => p.providerId === providerId) ?? null;
      if (!found && (providerId == null || providerId === '')) {
        setCreatingNew(false);
        setDraft(null);
        setOriginalDraft(null);
        setActiveModelIndex(0);
        setKeyEditing(false);
        setKeyClearing(false);
        setConflict(null);
        setStash(null);
        setStashBanner(false);
        setCloneFor(null);
        setDeleteFor(null);
        setSaveError(null);
        return;
      }
      const nextDraft = found ? logic.providerDraftFromApi(found) : logic.newProviderDraft();
      setCreatingNew(!found);
      setDraft(nextDraft);
      setOriginalDraft(structuredClone(nextDraft));
      const idx = keepProfileKey
        ? Math.max(
            0,
            nextDraft.models.findIndex((m: any) => m.profileKey === keepProfileKey),
          )
        : 0;
      setActiveModelIndex(idx >= 0 ? idx : 0);
      setKeyEditing(false);
      setKeyClearing(false);
      setConflict(null);
      setStash(null);
      setStashBanner(false);
      setCloneFor(null);
      setDeleteFor(null);
      setSaveError(null);
    },
    [invalidateProviderRequests],
  );

  // Sync initial providers when loaded
  const initializedRef = useRef(false);
  useEffect(() => {
    if (!providersQuery.isSuccess) return;
    if (!initializedRef.current) {
      initializedRef.current = true;
      void client.go.captureSessionContext?.().catch(() => {});
      const firstId = providers[0]?.providerId ?? null;
      applyProviderSelection(firstId, providers);
    }
  }, [providersQuery.isSuccess, providers, applyProviderSelection, client.go]);

  // Sync bindings draft from purposes query when not dirty
  useEffect(() => {
    if (!purposes.length) return;
    setBindingsDraft((prev) => {
      const next = { ...prev };
      for (const b of purposes) {
        const existing = next[b.purpose];
        if (!existing || !existing.dirty) {
          if (
            existing &&
            !existing.dirty &&
            typeof existing.revision === 'number' &&
            typeof b.revision === 'number' &&
            existing.revision > b.revision
          ) {
            continue;
          }
          next[b.purpose] = {
            providerId: b.providerId ?? '',
            profileKey: b.profileKey ?? '',
            state: b.state ?? 'ENABLED',
            revision: b.revision ?? existing?.revision ?? 0,
            dirty: false,
            error: existing?.error ?? null,
          };
        }
      }
      bindingsDraftRef.current = next;
      return next;
    });
  }, [purposes]);

  const isProviderDirty = useMemo(() => {
    if (stash) return true;
    if (draft && originalDraft && logic.draftDiffers(draft, originalDraft)) return true;
    return false;
  }, [stash, draft, originalDraft]);

  const isBindingsDirty = useMemo(
    () => Object.values(bindingsDraft).some((b) => b.dirty),
    [bindingsDraft],
  );

  const isDirty = isProviderDirty || isBindingsDirty;

  const currentModel = useMemo(() => {
    if (!draft || !Array.isArray(draft.models) || !draft.models.length) return null;
    return draft.models[activeModelIndex] ?? draft.models[0] ?? null;
  }, [draft, activeModelIndex]);
  latestProfileKeyRef.current = currentModel?.profileKey ?? null;

  const errors = useMemo(() => {
    if (!draft) {
      return {
        provider: {} as Record<string, string>,
        credential: {} as Record<string, string>,
        models: new Map<string, Record<string, string>>(),
        endpoint: null as any,
      };
    }
    const prov = logic.validateProviderForm(draft, { isNew: creatingNew });
    const cred = logic.validateCredentialPlan(draft, {
      isNew: creatingNew,
      credentialConfigured: draft.credentialConfigured,
    });
    const modelsMap = new Map<string, Record<string, string>>();
    for (const m of draft.models) {
      const errs = logic.validateModelForm(m) as unknown as Record<string, string>;
      if (Object.keys(errs).length) modelsMap.set(m.profileKey, errs);
    }
    return {
      provider: prov.errors as unknown as Record<string, string>,
      credential: cred as unknown as Record<string, string>,
      models: modelsMap,
      endpoint: prov.endpoint,
    };
  }, [draft, creatingNew]);

  const anyError = useMemo(
    () =>
      Boolean(
        Object.keys(errors.provider).length ||
          Object.keys(errors.credential).length ||
          errors.models.size > 0,
      ),
    [errors],
  );

  const discardDrafts = useCallback(() => {
    applyProviderSelection(selectedProviderId, providers);
    setBindingsDraft(() => {
      const next: Record<string, BindingDraftEntry> = {};
      for (const b of purposes) {
        next[b.purpose] = {
          providerId: b.providerId ?? '',
          profileKey: b.profileKey ?? '',
          state: b.state ?? 'ENABLED',
          revision: b.revision ?? 0,
          dirty: false,
          error: null,
        };
      }
      return next;
    });
    setBindingsConflict(null);
  }, [applyProviderSelection, selectedProviderId, providers, purposes]);

  const guardInternalAction = useCallback(
    (fn: () => void) => {
      if (saving || bindingsSaving || saveRerankMutation.isPending || reauth.busy) return;
      if (!isDirty) {
        fn();
        return;
      }
      setPendingInternalLeave(() => fn);
    },
    [saving, bindingsSaving, saveRerankMutation.isPending, reauth.busy, isDirty],
  );

  const sharedImpactModels = useCallback(() => {
    if (!draft) return [];
    const list: { profileKey: string; displayName: string; usages: any[] }[] = [];
    for (const model of draft.models) {
      if (!model.boundPurposes?.length) continue;
      const origModel = originalDraft?.models?.find((m: any) => m.profileKey === model.profileKey);
      let edited = model.isNew || model.isClone || model.editedSubs?.size > 0;
      if (!edited && origModel) {
        edited =
          model.displayName !== origModel.displayName ||
          model.modelId !== origModel.modelId ||
          String(model.contextWindowTokens) !== String(origModel.contextWindowTokens) ||
          String(model.maxOutputTokens) !== String(origModel.maxOutputTokens) ||
          model.state !== origModel.state;
      }
      if (!origModel) edited = true;
      if (edited) {
        list.push({
          profileKey: model.profileKey,
          displayName: model.displayName || model.modelId,
          usages: model.boundPurposes.map(logic.purposeMeta),
        });
      }
    }
    return list;
  }, [draft, originalDraft]);

  const executeSaveProvider = useCallback(
    async (bypassImpactConfirm = false) => {
      if (saving || !draft) return;
      const workingDraft = structuredClone(draft);
      for (const m of workingDraft.models) {
        if (NEW_KEY_PLACEHOLDER_RE.test(m.profileKey) || m.profileKey === '') {
          m.profileKey = String(m.modelId ?? '').trim();
        }
      }
      setDraft(workingDraft);

      const provErr = logic.validateProviderForm(workingDraft, { isNew: creatingNew });
      const credErr = logic.validateCredentialPlan(workingDraft, {
        isNew: creatingNew,
        credentialConfigured: workingDraft.credentialConfigured,
      });
      const hasModelErr = workingDraft.models.some(
        (m: any) => Object.keys(logic.validateModelForm(m)).length > 0,
      );
      if (
        Object.keys(provErr.errors).length ||
        Object.keys(credErr).length ||
        hasModelErr
      ) {
        toast.show({ title: '有字段未通过校验，请按提示修改。', kind: 'error' });
        return;
      }

      if (!bypassImpactConfirm) {
        const impacts = sharedImpactModels();
        const usages = [
          ...new Set(impacts.flatMap((item) => item.usages.map((u: any) => u.label))),
        ];
        if (usages.length > 1) {
          setSharedImpactConfirm({ usages });
          return;
        }
      }

      const isNew = creatingNew;
      const keepProfileKey = currentModel?.profileKey ?? null;
      const payload = logic.buildProviderPut(workingDraft, { isNew });
      const providerId = isNew ? workingDraft.providerId.trim() : workingDraft.providerId;

      setSaving(true);
      setSaveError(null);
      try {
        await saveProviderMutation.mutateAsync({ providerId, body: payload });
        setCreatingNew(false);
        setStash(null);
        setStashBanner(false);
        setConflict(null);
        toast.show({ title: '已保存', kind: 'success' });

        const [provRes] = await Promise.all([
          providersQuery.refetch(),
          purposesQuery.refetch(),
        ]);
        const freshList = Array.isArray(provRes.data) ? provRes.data : providers;
        applyProviderSelection(providerId, freshList, keepProfileKey);
        void bridge.refreshCatalog().catch(() => {});
      } catch (err: any) {
        if (err instanceof ConflictError || isKind(err, 'conflict-revision')) {
          const info = logic.conflictInfo(err);
          setConflict({
            message: '这段配置已在另一处更新。你的输入已保留，请加载最新内容后继续。',
            currentRevision: info?.currentRevision ?? null,
          });
        } else if (isKind(err, 'context-changed')) {
          setContextChanged(
            '登录会话已变更（可能在别处登录或退出），为避免写入错误的账号上下文，本次未保存。你的输入已保留；请重新加载页面数据后再继续。',
          );
        } else if (isKind(err, 'unauthenticated')) {
          setContextChanged(
            '登录已过期，本次未保存。你的输入已保留；请重新登录后，再重新加载页面数据。',
          );
        } else if (isKind(err, 'forbidden')) {
          setSaveError(
            '写入前需要重新验证身份。请在下方输入当前登录密码完成验证，验证后将继续保存。',
          );
          setReauth({ open: true, busy: false, error: null, password: '', retry: 'provider' });
        } else if (isKind(err, 'invalid')) {
          setSaveError('保存内容未通过校验，请检查表单后重试。');
        } else if (isKind(err, 'profile-in-use')) {
          setSaveError('该模型配置仍被用途绑定引用，请先解除绑定。');
        } else {
          setSaveError(err?.message ?? '保存失败，请重试。');
        }
      } finally {
        setSaving(false);
      }
    },
    [
      saving,
      draft,
      creatingNew,
      sharedImpactModels,
      currentModel,
      saveProviderMutation,
      providersQuery,
      purposesQuery,
      providers,
      applyProviderSelection,
      bridge,
    ],
  );

  const executeSaveBindings = useCallback(async () => {
    if (bindingsSaving) return;
    const dirtyEntries = Object.entries(bindingsDraftRef.current).filter(([, b]) => b.dirty);
    if (!dirtyEntries.length) return;
    setBindingsSaving(true);
    let failed = 0;
    let succeeded = 0;

    setBindingsDraft((prev) => {
      const next = { ...prev };
      for (const [purpose] of dirtyEntries) {
        if (next[purpose]) {
          next[purpose] = { ...next[purpose], error: null };
        }
      }
      return next;
    });

    for (const [purpose, b] of dirtyEntries) {
      try {
        const updated: any = await savePurposeMutation.mutateAsync({
          purpose,
          body: logic.buildBindingPut(b),
        });
        const nextRevision =
          typeof updated?.revision === 'number' && Number.isFinite(updated.revision)
            ? updated.revision
            : b.revision;
        const nextProviderId = updated?.providerId ?? b.providerId;
        const nextProfileKey = updated?.profileKey ?? b.profileKey;
        const nextState = updated?.state ?? b.state;

        setBindingsDraft((prev) => {
          const current = prev[purpose];
          const modifiedDuringSave =
            Boolean(current) &&
            (current.providerId !== b.providerId ||
              current.profileKey !== b.profileKey ||
              current.state !== b.state);
          return {
            ...prev,
            [purpose]: modifiedDuringSave
              ? {
                  ...current,
                  revision: nextRevision,
                  dirty: true,
                  error: null,
                }
              : {
                  providerId: nextProviderId,
                  profileKey: nextProfileKey,
                  state: nextState,
                  revision: nextRevision,
                  dirty: false,
                  error: null,
                },
          };
        });
        succeeded += 1;
      } catch (err: any) {
        failed += 1;
        let errorMessage = err?.message ?? '保存失败。';
        if (err instanceof ConflictError || isKind(err, 'conflict-revision')) {
          errorMessage = '该用途绑定已在另一处更新；你的选择已保留，请在上方对比后选择。';
          setBindingsConflict({
            purpose,
            currentRevision: err?.details?.currentRevision ?? null,
            latest: null,
          });
        } else if (isKind(err, 'context-changed')) {
          errorMessage = '登录会话已变更；你的选择已保留，请重新加载页面数据。';
          setContextChanged(
            '登录会话已变更（可能在别处登录或退出），为避免写入错误的账号上下文，本次未保存。你的选择已保留；请重新加载页面数据后再继续。',
          );
        } else if (isKind(err, 'forbidden')) {
          errorMessage = '写入前需要重新验证身份；请在顶部完成验证后重试。';
          setReauth({ open: true, busy: false, error: null, password: '', retry: 'bindings' });
        }
        setBindingsDraft((prev) => ({
          ...prev,
          [purpose]: {
            ...(prev[purpose] ?? b),
            error: errorMessage,
          },
        }));
      }
    }

    setBindingsSaving(false);
    await purposesQuery.refetch().catch(() => {});
    if (!failed) {
      toast.show({ title: '用途绑定已保存。', kind: 'success' });
    }
    if (succeeded) {
      void bridge.refreshCatalog().catch(() => {});
    }
  }, [bindingsSaving, savePurposeMutation, purposesQuery, bridge]);

  const handleSaveLocalRerank = useCallback(
    async (enabled: boolean) => {
      const localView = logic.localModelsFromPayload(localModelsQuery.data);
      if (saveRerankMutation.isPending || localView.rerank?.switchDisabled) return;
      const revision = Number.isFinite(localView.rerank?.revision)
        ? localView.rerank.revision
        : 0;
      try {
        await saveRerankMutation.mutateAsync({ enabled, expectedRevision: revision });
        await localModelsQuery.refetch();
      } catch (err: any) {
        if (err instanceof ConflictError || isKind(err, 'conflict-revision')) {
          toast.show({ title: '这段配置已在另一处更新。', kind: 'error' });
          await localModelsQuery.refetch();
          return;
        }
        if (isKind(err, 'forbidden')) {
          setPendingRerank(enabled);
          setReauth({
            open: true,
            busy: false,
            error: null,
            password: '',
            retry: 'local-rerank',
          });
          return;
        }
        toast.show({ title: err?.message || '本机模型不可用', kind: 'error' });
      }
    },
    [localModelsQuery, saveRerankMutation],
  );

  const handleDiscover = useCallback(async () => {
    if (discoverBusy || !draft) return;
    setCheckState({ busy: false, error: null, result: null });
    const check = logic.validateProviderForm(draft, { isNew: creatingNew });
    if (check.errors.baseUrl || check.errors.protocol) {
      setDiscoverError('请先填写正确的 Base URL 与协议，再拉取模型列表。');
      return;
    }
    if (creatingNew) {
      setDiscoverError('请先保存供应商，再拉取模型列表。');
      return;
    }
    if (!draft.credentialConfigured && !draft.credential) {
      setDiscoverError('拉取模型列表需要先配置 API 密钥（只在你点击时访问服务商接口）。');
      return;
    }
    setDiscoverBusy(true);
    setDiscoverError(null);
    const reqId = providerRequestRef.current;
    try {
      const models = await discoverMutation.mutateAsync({
        providerId: draft.providerId,
        body: {
          protocol: draft.protocol,
          baseUrl: draft.baseUrl.trim(),
          credential: draft.credential || undefined,
        },
      });
      if (reqId !== providerRequestRef.current) return;
      const found = Array.isArray(models) ? models : [];
      if (!found.length) {
        setDiscoverError('服务商未返回任何模型；仍可手填模型 ID 新增。');
      } else {
        let added = 0;
        const nextDraft = structuredClone(draft);
        for (const item of found) {
          const modelId = String(item.modelId ?? '').trim();
          if (!modelId) continue;
          if (nextDraft.models.some((x: any) => x.modelId === modelId)) continue;
          const m = logic.newModelDraft();
          m.modelId = modelId;
          m.displayName = String(item.displayName ?? modelId);
          m.profileKey = modelId;
          nextDraft.models.push(m);
          added += 1;
        }
        if (added) {
          setDraft(nextDraft);
          setActiveModelIndex(nextDraft.models.length - 1);
          toast.show({
            title: `拉取完成，新增 ${added} 个模型配置（未保存）。`,
            kind: 'success',
          });
        } else {
          setDiscoverError('拉取到的模型都已存在；仍可手填新增。');
        }
      }
    } catch (err: any) {
      if (reqId !== providerRequestRef.current) return;
      setDiscoverError(err?.message ?? '拉取失败，请检查地址与密钥后重试。');
    } finally {
      if (reqId === providerRequestRef.current) {
        setDiscoverBusy(false);
      }
    }
  }, [discoverBusy, draft, creatingNew, discoverMutation]);

  const handleCheckConnection = useCallback(async () => {
    if (checkState.busy || !draft) return;
    const check = logic.validateProviderForm(draft, { isNew: creatingNew });
    if (check.errors.baseUrl || check.errors.protocol) {
      setCheckState({
        busy: false,
        error: '请先填写正确的 Base URL 与协议，再检查连接。',
        result: null,
      });
      return;
    }
    if (creatingNew) {
      setCheckState({
        busy: false,
        error: '请先保存供应商，再检查连接（检查按已保存的供应商发起）。',
        result: null,
      });
      return;
    }
    if (!draft.credentialConfigured && !draft.credential) {
      setCheckState({
        busy: false,
        error: '检查连接需要先配置 API 密钥（只在你点击时访问服务商的模型列表接口）。',
        result: null,
      });
      return;
    }
    setCheckState({ busy: true, error: null, result: null });
    const reqId = providerRequestRef.current;
    try {
      const found = await discoverMutation.mutateAsync({
        providerId: draft.providerId,
        body: {
          protocol: draft.protocol,
          baseUrl: draft.baseUrl.trim(),
          credential: draft.credential || undefined,
        },
      });
      if (reqId !== providerRequestRef.current) return;
      const items = Array.isArray(found) ? found : [];
      setCheckState({
        busy: false,
        error: null,
        result: {
          total: items.length,
          unrecorded: logic.unrecordedModels(items, draft.models),
        },
      });
    } catch (err: any) {
      if (reqId !== providerRequestRef.current) return;
      setCheckState({
        busy: false,
        error: err?.message ?? '连接检查失败，请检查地址与密钥后重试。',
        result: null,
      });
    }
  }, [checkState.busy, draft, creatingNew, discoverMutation]);

  const handleVerifyToolCalls = useCallback(async () => {
    if (!currentModel || !draft || toolVerify.busy) return;
    if (creatingNew || currentModel.isNew) {
      setToolVerify({
        busy: false,
        profileKey: currentModel.profileKey,
        error: '请先保存该模型，再验证工具调用。',
      });
      return;
    }
    if (originalDraft && logic.draftDiffers(draft, originalDraft)) {
      setToolVerify({
        busy: false,
        profileKey: currentModel.profileKey,
        error: '请先保存当前配置，再验证工具调用。',
      });
      return;
    }
    const providerId = draft.providerId;
    const profileKey = currentModel.profileKey;
    const reqId = providerRequestRef.current;
    setToolVerify({ busy: true, profileKey, error: null });
    try {
      await verifyToolCallsMutation.mutateAsync({ providerId, profileKey });
      if (reqId !== providerRequestRef.current) return;
      const res = await providersQuery.refetch();
      if (reqId !== providerRequestRef.current) return;
      const freshList = Array.isArray(res.data) ? res.data : providers;
      applyProviderSelection(providerId, freshList, profileKey);
      setToolVerify({ busy: false, profileKey, error: null });
      toast.show({ title: '已验证', kind: 'success' });
    } catch (err: any) {
      if (reqId !== providerRequestRef.current) return;
      if (isKind(err, 'forbidden')) {
        setToolVerify({ busy: false, profileKey, error: null });
        setReauth({
          open: true,
          busy: false,
          error: null,
          password: '',
          retry: 'verify-tool-calls',
        });
      } else if (isKind(err, 'context-changed')) {
        setToolVerify({ busy: false, profileKey, error: null });
        setContextChanged(
          '登录会话已变更（可能在别处登录或退出），为避免写入错误的账号上下文，这次没有完成验证。你的输入已保留；请重新加载页面数据后再继续。',
        );
      } else if (isKind(err, 'unauthenticated')) {
        setToolVerify({ busy: false, profileKey, error: null });
        setContextChanged(
          '登录已过期，这次没有完成验证。你的输入已保留；请重新登录后，再重新加载页面数据。',
        );
      } else {
        setToolVerify({
          busy: false,
          profileKey,
          error: logic.toolCallVerificationFailure(err),
        });
      }
    }
  }, [
    currentModel,
    draft,
    toolVerify.busy,
    creatingNew,
    originalDraft,
    verifyToolCallsMutation,
    providersQuery,
    providers,
    applyProviderSelection,
  ]);

  const handleReauthSubmit = useCallback(async () => {
    if (reauth.busy) return;
    if (!reauth.password) {
      setReauth((prev) => ({ ...prev, error: '请输入当前登录密码。' }));
      return;
    }
    setReauth((prev) => ({ ...prev, busy: true, error: null }));
    const retryTarget = reauth.retry;
    try {
      await client.go.reauth(reauth.password);
      setReauth({ open: false, busy: false, error: null, password: '', retry: null });
      toast.show({
        title:
          retryTarget === 'verify-tool-calls'
            ? '身份验证已更新，继续验证工具调用。'
            : '身份验证已更新，继续保存。',
        kind: 'success',
      });
      if (retryTarget === 'provider') void executeSaveProvider();
      else if (retryTarget === 'bindings') void executeSaveBindings();
      else if (retryTarget === 'verify-tool-calls') void handleVerifyToolCalls();
      else if (retryTarget === 'local-rerank') void handleSaveLocalRerank(pendingRerank);
    } catch (err: any) {
      if (isKind(err, 'context-changed')) {
        setReauth({ open: false, busy: false, error: null, password: '', retry: null });
        setContextChanged(
          '登录会话已变更（可能在别处登录或退出）。你的输入已保留；请重新加载页面数据后再继续。',
        );
        return;
      }
      setReauth((prev) => ({
        ...prev,
        busy: false,
        error:
          err?.status === 404
            ? '密码不正确或会话已失效，请重试。'
            : (err?.message ?? '验证失败，请重试。'),
      }));
    }
  }, [
    reauth,
    client.go,
    executeSaveProvider,
    executeSaveBindings,
    handleVerifyToolCalls,
    handleSaveLocalRerank,
    pendingRerank,
  ]);

  const handleEdit = useCallback(
    (bind: string, value: string, checked?: boolean) => {
      if (['provider.baseUrl', 'provider.protocol', 'provider.credential'].includes(bind)) {
        invalidateProviderRequests();
      }
      if (bind === 'reauth.password') {
        setReauth((prev) => ({ ...prev, password: value }));
        return;
      }
      if (bind.startsWith('clone.')) {
        const field = bind.slice('clone.'.length);
        setCloneFor((prev) => (prev ? { ...prev, [field]: value } : null));
        return;
      }
      if (bind.startsWith('bindingState.')) {
        const purpose = bind.slice('bindingState.'.length);
        setBindingsDraft((prev) => {
          const cur = prev[purpose];
          if (!cur) return prev;
          return {
            ...prev,
            [purpose]: {
              ...cur,
              state: checked ? 'ENABLED' : 'DISABLED',
              dirty: true,
            },
          };
        });
        return;
      }
      if (bind.startsWith('binding.')) {
        const purpose = bind.slice('binding.'.length);
        setBindingsDraft((prev) => {
          const cur = prev[purpose];
          if (!cur) return prev;
          const [providerId = '', profileKey = ''] = value ? value.split('::') : ['', ''];
          const saved = purposes.find((item) => item.purpose === purpose);
          const dirty =
            providerId !== (saved?.providerId ?? '') ||
            profileKey !== (saved?.profileKey ?? '');
          return {
            ...prev,
            [purpose]: {
              ...cur,
              providerId,
              profileKey,
              dirty,
            },
          };
        });
        return;
      }
      if (bind.startsWith('provider.')) {
        const field = bind.slice('provider.'.length);
        setDraft((prev: any) => {
          const next = prev ? { ...prev, [field]: value } : prev;
          latestDraftRef.current = next;
          return next;
        });
        return;
      }
      if (bind.startsWith('model.')) {
        setDraft((prev: any) => {
          if (!prev || !prev.models[activeModelIndex]) return prev;
          const next = structuredClone(prev);
          const m = next.models[activeModelIndex];
          const path = bind.slice('model.'.length);
          if (path === 'modelId') {
            m.modelId = value;
            if (m.isNew && (m.autoProfileKey || NEW_KEY_PLACEHOLDER_RE.test(m.profileKey))) {
              m.autoProfileKey = true;
              m.profileKey = value.trim();
            }
            latestDraftRef.current = next;
            return next;
          }
          if (path === 'profileKey') {
            m.profileKey = value;
            m.autoProfileKey = false;
            latestDraftRef.current = next;
            return next;
          }
          if (path === 'reasoningLevels') {
            const extras = logic.extraReasoningLevels(m.reasoningLevels);
            const selected = new Set<string>(
              m.reasoningLevels.filter((lv: string) => logic.REASONING_LEVELS.includes(lv)),
            );
            if (checked) selected.add(value);
            else selected.delete(value);
            m.reasoningLevels = [
              ...logic.REASONING_LEVELS.filter((lv: string) => selected.has(lv)),
              ...extras,
            ];
            if (
              m.generationParams.reasoningEffort &&
              !m.reasoningLevels.includes(m.generationParams.reasoningEffort)
            ) {
              m.generationParams.reasoningEffort = '';
            }
            m.editedSubs.add('reasoningLevels');
            m.editedSubs.add('generationParams');
            latestDraftRef.current = next;
            return next;
          }
          const parts = path.split('.');
          let cur: any = m;
          for (let i = 0; i < parts.length - 1; i++) {
            cur = cur[parts[i]];
          }
          cur[parts[parts.length - 1]] = value;
          if (path.startsWith('capabilities.')) m.editedSubs.add('capabilities');
          else if (path.startsWith('generationParams.')) m.editedSubs.add('generationParams');
          else if (path.startsWith('pricing.')) m.editedSubs.add('pricing');
          latestDraftRef.current = next;
          return next;
        });
      }
    },
    [invalidateProviderRequests, purposes, activeModelIndex],
  );

  const handleAction = useCallback(
    (action: string, el: HTMLElement) => {
      switch (action) {
        case 'tab': {
          const nextTab = (el.getAttribute('data-tab') as 'provider' | 'bindings') || 'provider';
          guardInternalAction(() => setTab(nextTab));
          break;
        }
        case 'new-provider': {
          guardInternalAction(() => {
            invalidateProviderRequests();
            const nextDraft = logic.newProviderDraft();
            setDraft(nextDraft);
            setOriginalDraft(structuredClone(nextDraft));
            setCreatingNew(true);
            setActiveModelIndex(0);
            setTab('provider');
          });
          break;
        }
        case 'select-provider': {
          const id = el.getAttribute('data-id') || '';
          guardInternalAction(() => {
            if (!id) {
              invalidateProviderRequests();
              const nextDraft = logic.newProviderDraft();
              setDraft(nextDraft);
              setOriginalDraft(structuredClone(nextDraft));
              setCreatingNew(true);
              setActiveModelIndex(0);
              return;
            }
            applyProviderSelection(id, providers);
          });
          break;
        }
        case 'discard': {
          guardInternalAction(() => {
            discardDrafts();
            toast.show({ title: '已放弃未保存的修改。', kind: 'success' });
          });
          break;
        }
        case 'save':
        case 'save-anyway': {
          if (tab === 'bindings') void executeSaveBindings();
          else void executeSaveProvider();
          break;
        }
        case 'endpoint-convert': {
          const suggested = el.getAttribute('data-suggested');
          if (suggested) {
            invalidateProviderRequests();
            setDraft((prev: any) => (prev ? { ...prev, baseUrl: suggested } : prev));
            toast.show({ title: '已转换为 Base URL；请检查后保存。', kind: 'success' });
          }
          break;
        }
        case 'conflict-view-latest': {
          const reqId = providerRequestRef.current;
          const targetProviderId = draft?.providerId;
          if (!targetProviderId) break;
          void providersQuery.refetch().then((res) => {
            const currentDraftNow = latestDraftRef.current;
            if (
              reqId !== providerRequestRef.current ||
              !currentDraftNow ||
              currentDraftNow.providerId !== targetProviderId
            ) {
              return;
            }
            const list = Array.isArray(res.data) ? res.data : [];
            const latest = list.find((p) => p.providerId === targetProviderId);
            if (!latest) {
              setConflict({
                message:
                  '最新列表中已不存在该供应商（可能已被删除）。你的输入已保留，可复制为新建供应商。',
                currentRevision: null,
              });
              return;
            }
            setStash({
              draft: structuredClone(currentDraftNow),
              selectedProfileKey: latestProfileKeyRef.current,
            });
            invalidateProviderRequests();
            const latestDraft = logic.providerDraftFromApi(latest);
            setDraft(latestDraft);
            setOriginalDraft(structuredClone(latestDraft));
            setConflict(null);
            setStashBanner(true);
            setActiveModelIndex(0);
          });
          break;
        }
        case 'conflict-keep':
          setConflict(null);
          break;
        case 'restore-stash': {
          if (!stash || !draft) break;
          const restored = structuredClone(stash.draft);
          restored.revision = draft.revision;
          invalidateProviderRequests();
          setDraft(restored);
          const idx = stash.selectedProfileKey
            ? Math.max(
                0,
                restored.models.findIndex(
                  (m: any) => m.profileKey === stash.selectedProfileKey,
                ),
              )
            : 0;
          setActiveModelIndex(idx >= 0 ? idx : 0);
          setStash(null);
          setStashBanner(false);
          break;
        }
        case 'dismiss-stash-banner':
          setStash(null);
          setStashBanner(false);
          break;
        case 'context-reload': {
          setContextChanged(null);
          void client.go.captureSessionContext?.().catch(() => {});
          void Promise.all([providersQuery.refetch(), purposesQuery.refetch()]).then(
            ([provRes]) => {
              const list = Array.isArray(provRes.data) ? provRes.data : [];
              applyProviderSelection(selectedProviderId ?? list[0]?.providerId ?? null, list);
            },
          );
          break;
        }
        case 'context-keep':
          setContextChanged(null);
          break;
        case 'key-replace':
          setKeyEditing(true);
          break;
        case 'key-clear':
          setKeyClearing(true);
          break;
        case 'key-clear-confirm':
          invalidateProviderRequests();
          setDraft((prev: any) =>
            prev
              ? {
                  ...prev,
                  clearCredential: true,
                  credential: '',
                  state: prev.state === 'ENABLED' ? 'DISABLED' : prev.state,
                }
              : prev,
          );
          setKeyClearing(false);
          break;
        case 'key-clear-cancel':
          setKeyClearing(false);
          break;
        case 'key-undo':
          invalidateProviderRequests();
          setDraft((prev: any) =>
            prev ? { ...prev, credential: '', clearCredential: false } : prev,
          );
          setKeyEditing(false);
          break;
        case 'add-model': {
          if (!draft) break;
          const nextDraft = structuredClone(draft);
          const model: any = logic.newModelDraft();
          model.profileKey = `__new_${nextDraft.models.length + 1}__`;
          model.autoProfileKey = true;
          nextDraft.models.push(model);
          setDraft(nextDraft);
          setActiveModelIndex(nextDraft.models.length - 1);
          break;
        }
        case 'select-model': {
          const idx = Number(el.getAttribute('data-model-index'));
          if (Number.isFinite(idx)) {
            setActiveModelIndex(idx);
            setCloneFor(null);
            setDeleteFor(null);
          }
          break;
        }
        case 'delete-model':
          setDeleteFor(currentModel?.profileKey ?? null);
          break;
        case 'delete-model-confirm': {
          if (!draft || !currentModel) break;
          const nextDraft = structuredClone(draft);
          nextDraft.models.splice(activeModelIndex, 1);
          setDraft(nextDraft);
          setActiveModelIndex(0);
          setDeleteFor(null);
          break;
        }
        case 'delete-model-cancel':
          setDeleteFor(null);
          break;
        case 'clone-model': {
          if (!currentModel || !draft) break;
          const base = `${currentModel.modelId || 'model'}-copy`;
          let key = base;
          let i = 2;
          while (draft.models.some((x: any) => x.profileKey === key)) {
            key = `${base}${i}`;
            i += 1;
          }
          setCloneFor({
            profileKey: currentModel.profileKey,
            newProfileKey: key,
            newDisplayName: `${currentModel.displayName || currentModel.modelId}（副本）`,
            error: null,
          });
          break;
        }
        case 'clone-confirm': {
          if (!currentModel || !cloneFor || !draft) break;
          const key = cloneFor.newProfileKey.trim() || currentModel.modelId;
          if (draft.models.some((x: any) => x.profileKey === key)) {
            setCloneFor({ ...cloneFor, error: '该配置标识已存在，请换一个。' });
            break;
          }
          const nextDraft = structuredClone(draft);
          const cloned = logic.cloneModelDraft(currentModel, {
            profileKey: key,
            displayName:
              cloneFor.newDisplayName.trim() ||
              `${currentModel.displayName || currentModel.modelId}（副本）`,
          });
          nextDraft.models.push(cloned);
          setDraft(nextDraft);
          setActiveModelIndex(nextDraft.models.length - 1);
          setCloneFor(null);
          toast.show({
            title: '已创建副本（未保存）；原配置与现有绑定不受影响。',
            kind: 'success',
          });
          break;
        }
        case 'clone-cancel':
          setCloneFor(null);
          break;
        case 'cap': {
          if (!currentModel || !draft) break;
          const capKey = el.getAttribute('data-cap-key');
          const capState = el.getAttribute('data-cap-state');
          if (!capKey || !capState || capState === 'VERIFIED') break;
          const nextDraft = structuredClone(draft);
          const m = nextDraft.models[activeModelIndex];
          if (m) {
            m.capabilities[capKey] = capState;
            m.touchedCaps.add(capKey);
            m.editedSubs.add('capabilities');
            setDraft(nextDraft);
          }
          break;
        }
        case 'discover':
          void handleDiscover();
          break;
        case 'verify-tool-calls':
          void handleVerifyToolCalls();
          break;
        case 'check-connection':
          void handleCheckConnection();
          break;
        case 'check-add-models': {
          const unrecorded = checkState.result?.unrecorded;
          if (!Array.isArray(unrecorded) || !unrecorded.length || !draft) break;
          const nextDraft = structuredClone(draft);
          let added = 0;
          for (const item of unrecorded) {
            if (nextDraft.models.some((x: any) => x.modelId === item.modelId)) continue;
            const m = logic.newModelDraft();
            m.modelId = item.modelId;
            m.displayName = item.displayName;
            m.profileKey = item.modelId;
            nextDraft.models.push(m);
            added += 1;
          }
          if (added) {
            setDraft(nextDraft);
            setActiveModelIndex(nextDraft.models.length - 1);
            setCheckState((prev) =>
              prev.result ? { ...prev, result: { ...prev.result, unrecorded: [] } } : prev,
            );
            toast.show({
              title: `已加入 ${added} 个模型配置（未保存）；请补齐参数后保存。`,
              kind: 'success',
            });
          }
          break;
        }
        case 'reauth-submit':
          void handleReauthSubmit();
          break;
        case 'reauth-cancel':
          setReauth({ open: false, busy: false, error: null, password: '', retry: null });
          break;
        case 'save-bindings':
          void executeSaveBindings();
          break;
        case 'discard-bindings': {
          setBindingsDraft(() => {
            const next: Record<string, BindingDraftEntry> = {};
            for (const b of purposes) {
              next[b.purpose] = {
                providerId: b.providerId ?? '',
                profileKey: b.profileKey ?? '',
                state: b.state ?? 'ENABLED',
                revision: b.revision ?? 0,
                dirty: false,
                error: null,
              };
            }
            return next;
          });
          setBindingsConflict(null);
          break;
        }
        case 'bindings-view-latest': {
          void purposesQuery.refetch().then((res) => {
            const list = Array.isArray(res.data) ? res.data : [];
            setBindingsConflict((prev) =>
              prev
                ? {
                    ...prev,
                    latest: list.find((b: any) => b.purpose === prev.purpose) ?? null,
                  }
                : null,
            );
          });
          break;
        }
        case 'bindings-adopt-latest': {
          const purpose = el.getAttribute('data-purpose');
          const latest = bindingsConflict?.latest;
          if (purpose && latest) {
            setBindingsDraft((prev) => ({
              ...prev,
              [purpose]: {
                providerId: latest.providerId ?? '',
                profileKey: latest.profileKey ?? '',
                state: latest.state ?? 'ENABLED',
                revision: latest.revision ?? 0,
                dirty: false,
                error: null,
              },
            }));
          }
          setBindingsConflict(null);
          break;
        }
        case 'bindings-retry-latest': {
          const purpose = el.getAttribute('data-purpose');
          const latest = bindingsConflict?.latest;
          if (purpose && latest) {
            setBindingsDraft((prev) => {
              const cur = prev[purpose];
              if (!cur) return prev;
              return {
                ...prev,
                [purpose]: {
                  ...cur,
                  revision: latest.revision ?? 0,
                  dirty: true,
                  error: null,
                },
              };
            });
          }
          setBindingsConflict(null);
          break;
        }
        case 'bindings-keep':
          setBindingsConflict(null);
          break;
        case 'usage-month': {
          const delta = Number(el.getAttribute('data-delta'));
          if (delta === 1 || delta === -1) {
            setUsageMonth((prev) => logic.shiftUsageMonth(prev, delta));
          }
          break;
        }
        case 'retry-load':
          void providersQuery.refetch();
          void purposesQuery.refetch();
          void localModelsQuery.refetch();
          void usageQuery.refetch();
          break;
        default:
          break;
      }
    },
    [
      guardInternalAction,
      invalidateProviderRequests,
      applyProviderSelection,
      providers,
      discardDrafts,
      tab,
      executeSaveBindings,
      executeSaveProvider,
      providersQuery,
      draft,
      currentModel,
      stash,
      client.go,
      purposesQuery,
      selectedProviderId,
      activeModelIndex,
      cloneFor,
      handleDiscover,
      handleVerifyToolCalls,
      handleCheckConnection,
      checkState.result,
      handleReauthSubmit,
      purposes,
      bindingsConflict,
      localModelsQuery,
      usageQuery,
    ],
  );

  const events = useMemo(
    () => ({
      disabled: saving || bindingsSaving || reauth.busy,
      onAction: handleAction,
      onEdit: handleEdit,
    }),
    [saving, bindingsSaving, reauth.busy, handleAction, handleEdit],
  );

  const providersProps = useMemo(
    () => ({
      vc: false,
      heading: false,
      sprite,
      creatingNew,
      rows: providers.map((provider) => {
        const keyMissing = !provider.credentialConfigured;
        return {
          id: provider.providerId,
          name: provider.displayName || provider.providerId,
          selected: !creatingNew && provider.providerId === selectedProviderId,
          enabled: provider.state === 'ENABLED',
          disabled: provider.state === 'DISABLED',
          credentialConfigured: Boolean(provider.credentialConfigured),
          stateLabel:
            (logic.PROVIDER_STATE_LABELS as Record<string, string>)[provider.state] ??
            provider.state,
          tone: keyMissing ? 'danger' : provider.state === 'ENABLED' ? 'ok' : 'warn',
          status: keyMissing
            ? '缺密钥'
            : ((logic.PROVIDER_STATE_LABELS as Record<string, string>)[provider.state] ??
              provider.state),
          protocol: logic.protocolMeta(provider.protocol)?.label ?? provider.protocol,
          modelCount: provider.models?.length ?? 0,
        };
      }),
      onAction: handleAction,
    }),
    [sprite, creatingNew, providers, selectedProviderId, handleAction],
  );

  const providerFormProps = useMemo(() => {
    const ledger = logic.normalizeLedgerPrice(currentModel?.ledgerPrice);
    return {
      desktop: true,
      vc: true,
      sprite,
      screen: 'provider',
      creatingNew,
      draft,
      updated: fmtTime(draft?.updatedAt),
      stateLabel: draft
        ? ((logic.PROVIDER_STATE_LABELS as Record<string, string>)[draft.state] ?? draft.state)
        : '',
      errors: { ...errors.provider, ...errors.credential },
      protocols: logic.PROTOCOLS,
      endpoint: { ...(errors.endpoint || {}), blank: isBlank(draft?.baseUrl) },
      keyPlan: draft
        ? logic.keyPlan(draft, draft.credentialConfigured)
        : { action: 'none', finalKey: 'none' },
      keyEditing,
      keyClearing,
      keyLabels: logic.KEY_STATE_LABELS,
      conflict: conflict || undefined,
      stashBanner,
      contextChanged: contextChanged || undefined,
      discoverBusy,
      discoverError: discoverError || undefined,
      budgetInsufficient: false,
      budgetCopy: logic.BUDGET_COPY,
      models: (draft?.models ?? []).map((model: any, index: number) => ({
        key: getModelIdentity(model),
        index,
        profileKey: model.profileKey,
        selected: model === currentModel,
        name: model.displayName || model.modelId || '未命名模型',
        id: model.modelId || '（未填 ID）',
        incomplete: isBlank(model.contextWindowTokens),
        bound: model.boundPurposes?.length ?? 0,
        error: Object.values(errors.models.get(model.profileKey) ?? {})[0],
      })),
      model: currentModel
        ? {
            identity: getModelIdentity(currentModel),
            desktop: true,
            sprite,
            model: currentModel,
            errors: errors.models.get(currentModel.profileKey) ?? {},
            ledger: { status: ledger, copy: logic.ledgerPriceCopy(ledger) },
            shared: (currentModel.boundPurposes ?? [])
              .map((p: string) => logic.purposeMeta(p).label)
              .join('、'),
            contextMissing: logic.contextWindowMissing(currentModel),
            advancedOpen,
            onAdvancedChange: setAdvancedOpen,
            reasoning: logic.REASONING_LEVELS.map((id: string) => ({
              id,
              label: logic.reasoningLevelLabel(id),
            })),
            extraReasoning: logic.extraReasoningLevels(currentModel.reasoningLevels),
            capabilities: logic.CAPABILITY_FIELDS.map((field) => ({
              id: field.key,
              label: field.label,
              value: currentModel.capabilities?.[field.key] ?? 'UNKNOWN',
            })),
            capabilityStates: logic.CAPABILITY_STATES.map((id: string) => ({
              id,
              label: (logic.CAPABILITY_STATE_LABELS as Record<string, string>)[id],
            })),
            currencies: logic.CURRENCIES.map((id: string) => ({
              id,
              label: (logic.CURRENCY_LABELS as Record<string, string>)[id],
            })),
            pricingLabel: logic.formatPricing(currentModel.pricing),
            verification: {
              busy:
                toolVerify.profileKey === currentModel.profileKey && toolVerify.busy,
              error:
                toolVerify.profileKey === currentModel.profileKey
                  ? toolVerify.error || ''
                  : '',
              verifiedNote: logic.TOOL_CALLS_VERIFIED_NOTE,
              note: logic.TOOL_CALLS_UNVERIFIED_NOTE,
              hint: logic.TOOL_CALLS_VERIFY_HINT,
              action: logic.TOOL_CALLS_VERIFY_ACTION,
            },
            deleting: deleteFor === currentModel.profileKey,
            deleteDisabled: Boolean(currentModel.boundPurposes?.length),
            clone:
              cloneFor && cloneFor.profileKey === currentModel.profileKey ? cloneFor : undefined,
            events,
          }
        : undefined,
      check: checkState,
      testTarget:
        currentModel && draft
          ? `${draft.displayName || draft.providerId} · ${currentModel.displayName || currentModel.modelId}`
          : '未选择模型',
      testUrl:
        draft?.endpointUrl ?? (errors.endpoint?.ok ? errors.endpoint.finalUrl : '—'),
      saveError: saveError || undefined,
      events,
    };
  }, [
    currentModel,
    sprite,
    creatingNew,
    draft,
    errors,
    keyEditing,
    keyClearing,
    conflict,
    stashBanner,
    contextChanged,
    discoverBusy,
    discoverError,
    getModelIdentity,
    advancedOpen,
    toolVerify,
    deleteFor,
    cloneFor,
    events,
    checkState,
    saveError,
  ]);

  const bindingTargetLabel = useCallback(
    (providerId: string, profileKey: string) => {
      if (!providerId || !profileKey) return '未绑定（待配置）';
      const prov = providers.find((p) => p.providerId === providerId);
      const model = prov?.models?.find((m: any) => m.profileKey === profileKey);
      return `${prov?.displayName ?? providerId} · ${model?.displayName ?? model?.modelId ?? profileKey}`;
    },
    [providers],
  );

  const bindingsProps = useMemo(() => {
    const mine = bindingsConflict ? bindingsDraft[bindingsConflict.purpose] : null;
    return {
      desktop: true,
      options: logic.buildBindingOptions(providers),
      rows: logic.PURPOSES.map((purpose) => {
        const original = purposes.find((row) => row.purpose === purpose.id);
        const d = bindingsDraft[purpose.id];
        const status = original?.status ?? 'PENDING_CONFIGURATION';
        return {
          id: purpose.id,
          label: purpose.id === 'EMBEDDING' ? '向量检索' : purpose.label,
          description: purpose.desc,
          bindable: logic.canBindPurpose(purpose.id),
          current: d ? `${d.providerId}::${d.profileKey}` : '',
          enabled: d?.state !== 'DISABLED',
          dirty: d?.dirty === true,
          status,
          statusLabel:
            (logic.BINDING_STATUS_LABELS as Record<string, string>)[status] ?? status,
          statusClass:
            status === 'READY'
              ? 'vcms-badge-ok'
              : status === 'PENDING_CONFIGURATION'
                ? 'vcms-badge-warn'
                : 'vcms-badge-muted',
          revision: original?.revision,
          updated: fmtTime(original?.updatedAt),
          error: d?.error ?? undefined,
        };
      }),
      dirtyCount: Object.values(bindingsDraft).filter((r) => r.dirty).length,
      saving: bindingsSaving,
      disabled: reauth.busy,
      contextChanged: contextChanged || undefined,
      conflict: bindingsConflict
        ? {
            purpose: bindingsConflict.purpose,
            label: logic.purposeMeta(bindingsConflict.purpose).label,
            latest: Boolean(bindingsConflict.latest),
            revision: bindingsConflict.latest?.revision,
            mine: mine
              ? bindingTargetLabel(mine.providerId, mine.profileKey)
              : '未绑定（待配置）',
            target: bindingsConflict.latest
              ? bindingTargetLabel(
                  bindingsConflict.latest.providerId,
                  bindingsConflict.latest.profileKey,
                )
              : '',
          }
        : undefined,
      onAction: handleAction,
      onEdit: handleEdit,
    };
  }, [
    bindingsConflict,
    bindingsDraft,
    providers,
    purposes,
    bindingsSaving,
    reauth.busy,
    contextChanged,
    bindingTargetLabel,
    handleAction,
    handleEdit,
  ]);

  const localProps = useMemo(() => {
    const view = localModelsQuery.isLoading
      ? {
          embedding: {
            name: logic.LOCAL_EMBEDDING_MODEL,
            label: logic.LOCAL_RUNTIME_LABELS.LOADING,
            tone: 'neutral',
          },
          rerank: {
            name: logic.LOCAL_RERANK_MODEL,
            label: logic.LOCAL_RUNTIME_LABELS.LOADING,
            tone: 'neutral',
            enabled: false,
            switchDisabled: true,
          },
        }
      : logic.localModelsFromPayload(localModelsQuery.data);
    return {
      desktop: true,
      embedding: {
        name: view.embedding?.name || logic.LOCAL_EMBEDDING_MODEL,
        label: view.embedding?.label || logic.LOCAL_RUNTIME_LABELS.UNAVAILABLE,
        tone: view.embedding?.tone || 'danger',
      },
      rerank: {
        name: view.rerank?.name || logic.LOCAL_RERANK_MODEL,
        label: view.rerank?.label || logic.LOCAL_RUNTIME_LABELS.UNAVAILABLE,
        tone: view.rerank?.tone || 'danger',
        enabled: view.rerank?.enabled === true,
        disabled:
          saveRerankMutation.isPending ||
          reauth.busy ||
          Boolean(view.rerank?.switchDisabled),
      },
      onToggle: (enabled: boolean) => {
        void handleSaveLocalRerank(enabled);
      },
    };
  }, [
    localModelsQuery.isLoading,
    localModelsQuery.data,
    saveRerankMutation.isPending,
    reauth.busy,
    handleSaveLocalRerank,
  ]);

  const usageProps = useMemo(() => {
    const rawRows = Array.isArray((usageQuery.data as any)?.purposes)
      ? (usageQuery.data as any).purposes
      : [];
    return {
      vc: true,
      sprite,
      month: (usageQuery.data as any)?.month || usageMonth,
      loading: usageQuery.isLoading,
      error: usageQuery.error
        ? (usageQuery.error as Error)?.message || '用量暂时无法读取'
        : undefined,
      rows: rawRows.map((row: any) => ({
        purpose: row.purpose,
        label: logic.usagePurposeLabel(row.purpose),
        calls: row.calls ?? 0,
        unpriced: row.unpricedCalls ?? 0,
        input: logic.formatTokenCount(row.inputTokens),
        output: logic.formatTokenCount(row.outputTokens),
        cached: logic.formatTokenCount(row.cachedInputTokens),
        rate: logic.formatCacheHitRate(row.cacheHitRate),
        fee: logic.formatUsageFee(row),
        meta: `调用 ${row.calls ?? 0} · 输入 ${logic.formatTokenCount(row.inputTokens)} · 输出 ${logic.formatTokenCount(row.outputTokens)} · 缓存命中率 ${logic.formatCacheHitRate(row.cacheHitRate)} · 费用 ${logic.formatUsageFee(row)}`,
      })),
      onAction: handleAction,
    };
  }, [
    usageQuery.data,
    usageQuery.isLoading,
    usageQuery.error,
    sprite,
    usageMonth,
    handleAction,
  ]);

  const ready = providersQuery.isSuccess;
  const saveDisabled = ready
    ? !isDirty || anyError || saving || bindingsSaving
    : true;
  const clean = ready && !isDirty && !anyError && !saving && !bindingsSaving;
  const modelCount = providers.reduce(
    (sum, p) => sum + (p.models?.length ?? 0),
    0,
  );

  return (
    <div className="vcms-panel" role="region" aria-label="模型设置" data-vc-model-section="">
      {router ? <ActiveRouterLeaveGuard dirty={isDirty} /> : null}
      <header className="vcms-header">
        <div className="vcms-header-titles">
          <h2 className="vcms-title" tabIndex={-1}>
            模型设置
          </h2>
          <p className="vcms-subtitle">
            供应商 {providers.length} · 模型配置 {modelCount} · 用途绑定 {purposes.length}
          </p>
        </div>
        <div className="vcms-header-actions">
          <Action
            action="discard"
            events={events}
            className="vc-btn vc-btn-text"
            id="vcms-discard"
            hidden={!isDirty}
          >
            放弃修改
          </Action>
          <Action
            action="save"
            events={events}
            className="vc-btn vc-btn-fill"
            id="vcms-save"
            disabled={saveDisabled}
            data-vc-clean={clean ? '' : undefined}
            title={anyError ? '存在校验错误，请先按提示修改' : undefined}
          >
            {saving ? '保存中…' : '保存更改'}
          </Action>
        </div>
      </header>

      <div className="vcms-body">
        {reauth.open && (
          <div className="vcms-reauth-bar" role="alertdialog" aria-label="重新验证身份">
            <div className="vcms-reauth-main">
              <i className="fa-solid fa-user-shield" />
              <p>
                写入前需要重新验证身份。输入当前登录密码完成验证，
                {reauth.retry === 'verify-tool-calls'
                  ? '验证成功后将继续验证工具调用。'
                  : '验证成功后将继续未完成的保存。'}
              </p>
            </div>
            <div className="vcms-reauth-form">
              <Input
                events={events}
                id="vcms-reauth-password"
                type="password"
                bind="reauth.password"
                value={reauth.password}
                placeholder="当前登录密码"
                autoComplete="current-password"
                spellCheck={false}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    events.onAction('reauth-submit', event.currentTarget);
                  }
                }}
              />
              {reauth.error && <p className="vcms-field-err is-visible">{reauth.error}</p>}
              <div className="vcms-callout-actions">
                <Action
                  action="reauth-submit"
                  events={events}
                  className="vcms-btn vcms-btn-primary vcms-btn-sm"
                  disabled={reauth.busy}
                >
                  {reauth.busy
                    ? '验证中…'
                    : reauth.retry === 'verify-tool-calls'
                      ? '验证并继续'
                      : '验证并继续保存'}
                </Action>
                <Action
                  action="reauth-cancel"
                  events={events}
                  className="vcms-btn vcms-btn-ghost vcms-btn-sm"
                  disabled={reauth.busy}
                >
                  取消
                </Action>
              </div>
            </div>
          </div>
        )}

        {providersQuery.isLoading && (
          <div className="vcms-skeleton">
            <div className="vcms-sk-col">
              {Array.from({ length: 3 }, (_, i) => (
                <div className="vcms-sk-card" key={i} />
              ))}
            </div>
            <div className="vcms-sk-main">
              {Array.from({ length: 8 }, (_, i) => (
                <div className="vcms-sk-line" key={i} />
              ))}
            </div>
          </div>
        )}

        {providersQuery.isError && (
          <div className="vcms-stateblock">
            <i className="fa-solid fa-plug-circle-xmark vcms-stateblock-icon" />
            <h3>无法加载模型配置</h3>
            <p>{(providersQuery.error as Error)?.message ?? '请稍后重试。'}</p>
            <Action action="retry-load" events={events} className="vcms-btn vcms-btn-primary">
              <i className="fa-solid fa-rotate-right" /> 重试
            </Action>
          </div>
        )}

        {ready && (
          <>
            <div className="vcms-layout">
              <aside className="vcms-providers" aria-label="供应商列表">
                <div className="vcms-providers-head">
                  <span className="vcms-section-label">接入的供应商</span>
                  <Action
                    action="new-provider"
                    events={events}
                    className="vcms-btn vcms-btn-ghost vcms-btn-sm"
                  >
                    <i className="fa-solid fa-plus" /> 新建
                  </Action>
                </div>
                <div className="vcms-provider-list" id="vcms-provider-list">
                  <ProviderList {...providersProps} />
                </div>
              </aside>
              <main className="vcms-main">
                <div className="vcms-tabs" role="tablist">
                  {(['provider', 'bindings'] as const).map((t) => (
                    <Action
                      key={t}
                      action="tab"
                      events={events}
                      role="tab"
                      className={`vcms-tab ${tab === t ? 'is-active' : ''}`}
                      aria-selected={tab === t}
                      data-tab={t}
                    >
                      {t === 'provider' ? '供应商与模型' : '用途绑定'}
                    </Action>
                  ))}
                </div>
                <div className="vcms-tabpanes">
                  {tab === 'provider' ? (
                    <ProviderForm {...providerFormProps} />
                  ) : (
                    <PurposeBindings {...bindingsProps} />
                  )}
                </div>
              </main>
            </div>
            <LocalModels {...localProps} />
            <UsagePanel {...usageProps} />
          </>
        )}
      </div>

      <AlertDialog
        open={Boolean(sharedImpactConfirm)}
        onOpenChange={(open) => {
          if (!open) setSharedImpactConfirm(null);
        }}
        title={
          sharedImpactConfirm
            ? `同时影响 ${sharedImpactConfirm.usages.length} 个用途`
            : '确认保存'
        }
        description={
          sharedImpactConfirm
            ? `${sharedImpactConfirm.usages.join('、')} 会使用修改后的配置。`
            : ''
        }
        cancelLabel="检查一下"
        confirmLabel="仍要保存"
        onConfirm={() => {
          setSharedImpactConfirm(null);
          void executeSaveProvider(true);
        }}
      />

      <AlertDialog
        open={Boolean(pendingInternalLeave)}
        onOpenChange={(open) => {
          if (!open) setPendingInternalLeave(null);
        }}
        title="放弃更改？"
        description="关闭后本次输入将丢失。"
        cancelLabel="继续编辑"
        confirmLabel="放弃"
        danger
        onConfirm={() => {
          const fn = pendingInternalLeave;
          setPendingInternalLeave(null);
          discardDrafts();
          fn?.();
        }}
      />
    </div>
  );
}
