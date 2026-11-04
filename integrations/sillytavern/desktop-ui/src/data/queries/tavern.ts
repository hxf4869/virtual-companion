import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  queryOptions,
  useMutation,
  useQueryClient,
  type FetchQueryOptions,
  type QueryClient,
} from '@tanstack/react-query';
import {
  TAVERN_SECTIONS,
  createTavernController,
  normalizeTavernSection,
  portablePreset,
  tavernSectionTitle,
  validateTavernName,
} from '../../../../extension/vc-model-settings/desktop/tavern-controller.js';
import { useAppClient } from '../../app/providers';
import { AlertDialog } from '../../design/components/AlertDialog';
import { Button } from '../../design/components/Button';
import { Dialog } from '../../design/components/Dialog';
import { toast } from '../../design/components/Toast';
import { WorldCodeEditorDialog } from '../../features/tavern/CodeField';
import { useSessionBridge } from '../../runtime/session-bridge';
import type { AppClient } from '../client';
import { queryKeys } from '../queryKeys';

export {
  TAVERN_SECTIONS,
  createTavernController,
  normalizeTavernSection,
  portablePreset,
  tavernSectionTitle,
  validateTavernName,
};

export interface TavernOption {
  value: string;
  label: string;
}

export interface TavernResource {
  key: string;
  label: string;
  value: string;
  options: TavernOption[];
}

export interface TavernAction {
  id: string;
  label: string;
  accept?: string;
  disabled?: boolean;
}

export interface TavernField {
  key: string;
  name?: string;
  label: string;
  kind?: string;
  value: unknown;
  options?: TavernOption[];
  min?: number;
  max?: number;
  step?: number;
  disabled?: boolean;
  nullableBoolean?: boolean;
  error?: string;
}

export interface TavernGroup {
  id: string;
  title: string;
  fields: TavernField[];
  actions?: TavernAction[];
}

export interface TavernListItem {
  id: string;
  name: string;
  selected?: boolean;
}

export interface TavernOrderItem {
  id: string;
  name: string;
  enabled: boolean;
}

export interface TavernGalleryItem {
  id: string;
  name: string;
  src: string;
  selected?: boolean;
}

export interface TavernControllerState {
  key: string;
  sprite: string;
  loading: boolean;
  busy: boolean;
  dirty: boolean;
  error: string;
  conflict: boolean;
  resources: TavernResource[];
  actions: TavernAction[];
  groups: TavernGroup[];
  items?: TavernListItem[];
  order?: TavernOrderItem[];
  gallery?: TavernGalleryItem[];
  selectedTemplate: string;
  selectedPresets: Record<string, string>;
  selectedWorld: string;
  selectedPersona: string;
  selectedCharacter: string;
  selectedPrompt: string;
  selectedScope: string;
  worlds: string[];
  avatars: string[];
  backgrounds: Array<{ filename: string; isAnimated?: boolean }>;
  characters: Array<{ avatar: string; name?: string }>;
  projection: unknown;
  projectionError: string;
  canMetadata: boolean;
  onField: (id: string, value: unknown) => void;
  onAction: (action: string, value?: unknown) => void;
}

export interface UseTavernControllerOptions {
  initialCharacter?: string;
  onOpenModels?: () => void;
  onOpenAppearance?: () => void;
}

export interface UseTavernControllerResult {
  sectionKey: string;
  title: string;
  state: TavernControllerState;
  loading: boolean;
  busy: boolean;
  dirty: boolean;
  error: string;
  conflict: boolean;
  formRef: React.RefObject<HTMLFormElement | null>;
  save: () => Promise<boolean>;
  discard: () => Promise<boolean>;
  reload: () => Promise<void>;
  onField: (id: string, value: unknown) => void;
  onAction: (action: string, value?: unknown) => void;
  reorderPrompts: (orderedIds: string[]) => void;
  modals: React.ReactNode;
}

export interface TavernSectionProps {
  controller: UseTavernControllerResult;
}

export const tavernQueryKeys = {
  settingsDoc: queryKeys.settingsDoc,
  characters: queryKeys.characters,
  characterDetail: (avatar: string) => [...queryKeys.characters, avatar] as const,
  worldbookList: ['settingsDoc', 'worldbookList'] as const,
  worldbook: (name: string) => queryKeys.worldbook(name),
  avatars: ['settingsDoc', 'avatars'] as const,
  backgrounds: ['settingsDoc', 'backgrounds'] as const,
  purposes: queryKeys.purposes,
  providers: queryKeys.providers,
} as const;

export function settingsDocQueryOptions(client: AppClient) {
  return queryOptions({
    queryKey: queryKeys.settingsDoc,
    queryFn: ({ signal }) => client.request('/api/settings/get', {}, { signal }),
  });
}

export function tavernCharactersQueryOptions(client: AppClient) {
  return queryOptions({
    queryKey: queryKeys.characters,
    queryFn: ({ signal }) => client.request('/api/characters/all', {}, { signal }),
  });
}

export function tavernCharacterDetailQueryOptions(client: AppClient, avatar: string) {
  return queryOptions({
    queryKey: tavernQueryKeys.characterDetail(avatar),
    queryFn: ({ signal }) =>
      client.request('/api/characters/get', { avatar_url: avatar }, { signal }),
  });
}

export function tavernWorldbookListQueryOptions(client: AppClient) {
  return queryOptions({
    queryKey: tavernQueryKeys.worldbookList,
    queryFn: ({ signal }) => client.request('/api/worldinfo/list', {}, { signal }),
  });
}

export function tavernWorldbookQueryOptions(client: AppClient, name: string) {
  return queryOptions({
    queryKey: queryKeys.worldbook(name),
    queryFn: ({ signal }) => client.request('/api/worldinfo/get', { name }, { signal }),
  });
}

export function tavernAvatarsQueryOptions(client: AppClient) {
  return queryOptions({
    queryKey: tavernQueryKeys.avatars,
    queryFn: ({ signal }) => client.request('/api/avatars/get', {}, { signal }),
  });
}

export function tavernBackgroundsQueryOptions(client: AppClient) {
  return queryOptions({
    queryKey: tavernQueryKeys.backgrounds,
    queryFn: ({ signal }) => client.request('/api/backgrounds/all', {}, { signal }),
  });
}

export function tavernPurposesQueryOptions(client: AppClient) {
  return queryOptions({
    queryKey: queryKeys.purposes,
    queryFn: () => client.go.fetchModelPurposes(),
  });
}

export function tavernProvidersQueryOptions(client: AppClient) {
  return queryOptions({
    queryKey: queryKeys.providers,
    queryFn: () => client.go.fetchProviders(),
  });
}

async function fetchWithQuery<TData, TQueryKey extends readonly unknown[]>(
  queryClient: QueryClient,
  options: FetchQueryOptions<TData, Error, TData, TQueryKey>,
  fresh = false,
): Promise<TData> {
  if (fresh) {
    await queryClient.invalidateQueries({
      queryKey: options.queryKey,
      exact: true,
      refetchType: 'none',
    });
    return queryClient.fetchQuery({ ...options, staleTime: 0 });
  }
  return queryClient.fetchQuery(options);
}

interface AskNameState {
  open: boolean;
  title: string;
  value: string;
  error: string;
  validate: (raw: string) => string;
  onConfirm: (name: string) => void;
}

interface ConfirmDialogState {
  open: boolean;
  title: string;
  message?: string;
  confirmLabel: string;
  cancelLabel: string;
  danger: boolean;
  resolve: ((ok: boolean) => void) | null;
}

interface CharDeleteDialogState {
  open: boolean;
  avatar: string;
  onSelect: ((deleteChats: boolean, label: string) => void) | null;
}

interface CodeEditorDialogState {
  open: boolean;
  initialValue: string;
  dirty: boolean;
  onApply: ((value: string) => void) | null;
  onDone: (() => void) | null;
}

const INITIAL_STATE: TavernControllerState = {
  key: 'left-nav-panel',
  sprite: '',
  loading: true,
  busy: false,
  dirty: false,
  error: '',
  conflict: false,
  resources: [],
  actions: [],
  groups: [],
  selectedTemplate: 'context',
  selectedPresets: { openai: '', context: '', instruct: '', sysprompt: '', reasoning: '' },
  selectedWorld: '',
  selectedPersona: '',
  selectedCharacter: '',
  selectedPrompt: '',
  selectedScope: '',
  worlds: [],
  avatars: [],
  backgrounds: [],
  characters: [],
  projection: null,
  projectionError: '',
  canMetadata: false,
  onField: () => {},
  onAction: () => {},
};

export function useTavernController(
  section: string,
  options: UseTavernControllerOptions = {},
): UseTavernControllerResult {
  const sectionKey = normalizeTavernSection(section);
  const title = tavernSectionTitle(sectionKey);
  const client = useAppClient();
  const queryClient = useQueryClient();
  const bridge = useSessionBridge();
  const formRef = useRef<HTMLFormElement | null>(null);

  const [state, setState] = useState<TavernControllerState>(() => ({
    ...INITIAL_STATE,
    key: sectionKey,
  }));

  const [askNameState, setAskNameState] = useState<AskNameState>({
    open: false,
    title: '',
    value: '',
    error: '',
    validate: validateTavernName,
    onConfirm: () => {},
  });

  const [confirmState, setConfirmState] = useState<ConfirmDialogState>({
    open: false,
    title: '',
    message: undefined,
    confirmLabel: '确认',
    cancelLabel: '取消',
    danger: true,
    resolve: null,
  });

  const [charDeleteState, setCharDeleteState] = useState<CharDeleteDialogState>({
    open: false,
    avatar: '',
    onSelect: null,
  });

  const [codeEditorState, setCodeEditorState] = useState<CodeEditorDialogState>({
    open: false,
    initialValue: '',
    dirty: false,
    onApply: null,
    onDone: null,
  });
  const codeEditorDirtyRef = useRef(false);

  const optionsRef = useRef(options);
  optionsRef.current = options;
  const bridgeRef = useRef(bridge);
  bridgeRef.current = bridge;

  const mutation = useMutation({
    mutationFn: async (operation: () => Promise<void>) => {
      await operation();
    },
  });
  const mutateAsyncRef = useRef(mutation.mutateAsync);
  mutateAsyncRef.current = mutation.mutateAsync;

  const openConfirmModal = useCallback(
    (req: {
      title: string;
      message?: string;
      confirmLabel?: string;
      cancelLabel?: string;
      danger?: boolean;
    }): Promise<boolean> =>
      new Promise<boolean>((resolve) => {
        setConfirmState({
          open: true,
          title: req.title,
          message: req.message,
          confirmLabel: req.confirmLabel || '删除',
          cancelLabel: req.cancelLabel || '取消',
          danger: req.danger !== false,
          resolve,
        });
      }),
    [],
  );

  const controllerRef = useRef<ReturnType<typeof createTavernController> | null>(null);

  useEffect(() => {
    const getSettingsContext = () => {
      const activeBridge = bridgeRef.current;
      const rawCtx = activeBridge?.getContext?.() || {};
      const snap = activeBridge?.getSnapshot?.();
      const canEdit =
        rawCtx.canEditChatMetadata !== undefined
          ? Boolean(rawCtx.canEditChatMetadata)
          : Boolean(snap && snap.status === 'ready' && snap.key && !snap.conflict);
      return {
        ...rawCtx,
        canEditChatMetadata: canEdit,
      };
    };

    const getConversationKey = () => {
      const activeBridge = bridgeRef.current;
      const snap = activeBridge?.getSnapshot?.();
      if (snap?.key) return String(snap.key);
      const rawCtx = activeBridge?.getContext?.() || {};
      if (rawCtx.conversationKey) return String(rawCtx.conversationKey);
      const avatar =
        rawCtx.character?.avatar ?? rawCtx.characters?.[rawCtx.characterId]?.avatar ?? '';
      const file = String(rawCtx.chatId ?? '').replace(/\.jsonl$/i, '');
      return avatar && file ? JSON.stringify([avatar, file]) : '';
    };

    const ctrl = createTavernController({
      key: sectionKey,
      client,
      initialCharacter: optionsRef.current.initialCharacter,
      getContext: getSettingsContext,
      getConversationKey,
      checkValidity: () => !formRef.current?.querySelector('[aria-invalid="true"]'),
      reads: {
        settingsDoc: ({ fresh = false }: { fresh?: boolean } = {}) =>
          fetchWithQuery(queryClient, settingsDocQueryOptions(client), fresh),
        characters: ({ fresh = false }: { fresh?: boolean } = {}) =>
          fetchWithQuery(queryClient, tavernCharactersQueryOptions(client), fresh),
        characterDetail: (avatar: string, { fresh = false }: { fresh?: boolean } = {}) =>
          fetchWithQuery(queryClient, tavernCharacterDetailQueryOptions(client, avatar), fresh),
        worldbookList: ({ fresh = false }: { fresh?: boolean } = {}) =>
          fetchWithQuery(queryClient, tavernWorldbookListQueryOptions(client), fresh),
        worldbook: (name: string, { fresh = false }: { fresh?: boolean } = {}) =>
          fetchWithQuery(queryClient, tavernWorldbookQueryOptions(client, name), fresh),
        avatars: ({ fresh = false }: { fresh?: boolean } = {}) =>
          fetchWithQuery(queryClient, tavernAvatarsQueryOptions(client), fresh),
        backgrounds: ({ fresh = false }: { fresh?: boolean } = {}) =>
          fetchWithQuery(queryClient, tavernBackgroundsQueryOptions(client), fresh),
        purposes: ({ fresh = false }: { fresh?: boolean } = {}) =>
          fetchWithQuery(queryClient, tavernPurposesQueryOptions(client), fresh),
        providers: ({ fresh = false }: { fresh?: boolean } = {}) =>
          fetchWithQuery(queryClient, tavernProvidersQueryOptions(client), fresh),
      },
      runMutation: (operation: () => Promise<void>) => mutateAsyncRef.current(operation),
      onUpdate: (nextState: TavernControllerState) => {
        setState({ ...nextState });
      },
      onNotify: (message: string) => {
        toast.show({ title: message, kind: 'success' });
      },
      onConfirm: (req: { title: string; message?: string; confirmLabel?: string; danger?: boolean }) =>
        openConfirmModal({
          title: req.title,
          message: req.message,
          confirmLabel: req.confirmLabel || '删除',
          cancelLabel: '取消',
          danger: req.danger !== false,
        }),
      onConfirmDiscard: () =>
        openConfirmModal({
          title: '放弃更改？',
          message: '未保存的更改会丢失。',
          confirmLabel: '放弃',
          cancelLabel: '继续编辑',
          danger: true,
        }),
      onAskName: (req: {
        title: string;
        initial: string;
        validate: (raw: string) => string;
        onConfirm: (name: string) => void;
      }) => {
        setAskNameState({
          open: true,
          title: req.title,
          value: req.initial || '',
          error: '',
          validate: req.validate || validateTavernName,
          onConfirm: req.onConfirm,
        });
      },
      onChooseCharacterDeletion: (req: {
        avatar: string;
        onSelect: (deleteChats: boolean, label: string) => void;
      }) => {
        setCharDeleteState({
          open: true,
          avatar: req.avatar,
          onSelect: req.onSelect,
        });
      },
      onOpenCodeEditor: (req: {
        value: string;
        onApply: (val: string) => void;
        onDone: () => void;
      }) => {
        codeEditorDirtyRef.current = false;
        setCodeEditorState({
          open: true,
          initialValue: req.value,
          dirty: false,
          onApply: req.onApply,
          onDone: req.onDone,
        });
        return {
          isDirty: () => codeEditorDirtyRef.current,
          requestLeave: async () => {
            if (!codeEditorDirtyRef.current) return true;
            return openConfirmModal({
              title: '放弃更改？',
              message: '未保存的更改会丢失。',
              confirmLabel: '放弃',
              cancelLabel: '继续编辑',
              danger: true,
            });
          },
          destroy: () => {
            codeEditorDirtyRef.current = false;
            setCodeEditorState((prev) => ({ ...prev, open: false }));
          },
        };
      },
      onOpenModels: () => {
        optionsRef.current.onOpenModels?.();
      },
      onOpenAppearance: () => {
        optionsRef.current.onOpenAppearance?.();
      },
      onSettingsCommit: async (changes: any) => {
        await bridgeRef.current.applySettings(changes);
        await queryClient.invalidateQueries({ queryKey: queryKeys.settingsDoc });
      },
      onPresetCommit: async (apiId: string, name: string, changes: any, canonical: any) => {
        await bridgeRef.current.applyPreset(apiId, name, changes, canonical);
        await queryClient.invalidateQueries({ queryKey: queryKeys.preset(apiId, name) });
        await queryClient.invalidateQueries({ queryKey: queryKeys.settingsDoc });
      },
      onWorldbookCommit: async (name: string, canonical: any, action?: string) => {
        await bridgeRef.current.applyWorldbook(name, canonical, action as any);
        await queryClient.invalidateQueries({ queryKey: queryKeys.worldbook(name) });
        await queryClient.invalidateQueries({ queryKey: tavernQueryKeys.worldbookList });
      },
      onCharacterSaved: async (avatar: string) => {
        await bridgeRef.current.reloadCharacter(avatar);
        await queryClient.invalidateQueries({ queryKey: queryKeys.characters });
        await queryClient.invalidateQueries({ queryKey: queryKeys.relationships });
        await queryClient.invalidateQueries({ queryKey: queryKeys.recentChats });
      },
      onDeleteCharacter: async (avatar: string, deleteChats: boolean) => {
        await bridgeRef.current.deleteCharacter(avatar, deleteChats);
        queryClient.removeQueries({
          queryKey: tavernQueryKeys.characterDetail(avatar),
          exact: true,
        });
        await queryClient.invalidateQueries({ queryKey: queryKeys.characters });
        await queryClient.invalidateQueries({ queryKey: queryKeys.relationships });
        await queryClient.invalidateQueries({ queryKey: queryKeys.recentChats });
      },
      onAvatarsChanged: async () => {
        await queryClient.invalidateQueries({ queryKey: tavernQueryKeys.avatars });
      },
      onBackgroundsChanged: async () => {
        await queryClient.invalidateQueries({ queryKey: tavernQueryKeys.backgrounds });
      },
      onMetadataCommit: async (changes: any, expectedKey: string) => {
        await bridgeRef.current.commitMetadata(changes, expectedKey);
      },
    });

    controllerRef.current = ctrl;

    const unsubscribe = bridgeRef.current.subscribe(() => {
      ctrl.refreshContext();
    });

    return () => {
      unsubscribe?.();
      ctrl.destroy();
      controllerRef.current = null;
    };
  }, [sectionKey, client, queryClient, openConfirmModal]);

  const handleSave = useCallback(async () => {
    return (await controllerRef.current?.save()) ?? false;
  }, []);

  const handleDiscard = useCallback(async () => {
    return (await controllerRef.current?.discard()) ?? false;
  }, []);

  const handleReload = useCallback(async () => {
    await controllerRef.current?.act('reload');
  }, []);

  const handleField = useCallback((id: string, value: unknown) => {
    controllerRef.current?.edit(id, value);
  }, []);

  const handleAction = useCallback((action: string, value?: unknown) => {
    void controllerRef.current?.act(action, value);
  }, []);

  const handleReorderPrompts = useCallback((orderedIds: string[]) => {
    controllerRef.current?.reorderPrompts(orderedIds);
  }, []);

  const submitAskName = useCallback(() => {
    const trimmed = askNameState.value.trim();
    const validationError = askNameState.validate(trimmed);
    if (validationError) {
      setAskNameState((prev) => ({ ...prev, error: validationError }));
      return;
    }
    const callback = askNameState.onConfirm;
    setAskNameState((prev) => ({ ...prev, open: false, error: '' }));
    callback(trimmed);
  }, [askNameState]);

  const modals = React.createElement(
    React.Fragment,
    null,
    React.createElement(Dialog, {
      open: askNameState.open,
      onOpenChange: (nextOpen: boolean) => {
        if (!nextOpen) setAskNameState((prev) => ({ ...prev, open: false, error: '' }));
      },
      title: askNameState.title,
      className: 'vc-sheet',
      actions: React.createElement(
        React.Fragment,
        null,
        React.createElement(
          Button,
          {
            type: 'button',
            variant: 'gray',
            onClick: () => setAskNameState((prev) => ({ ...prev, open: false, error: '' })),
          },
          '取消',
        ),
        React.createElement(
          Button,
          {
            type: 'button',
            variant: 'filled',
            onClick: submitAskName,
          },
          '完成',
        ),
      ),
      children: React.createElement(
        'form',
        {
          className: 'vc-tavern-name',
          onSubmit: (e: React.FormEvent) => {
            e.preventDefault();
            submitAskName();
          },
        },
        React.createElement(
          'label',
          null,
          '名称',
          React.createElement('input', {
            required: true,
            maxLength: 120,
            value: askNameState.value,
            'aria-invalid': askNameState.error ? 'true' : undefined,
            onChange: (e: React.ChangeEvent<HTMLInputElement>) =>
              setAskNameState((prev) => ({ ...prev, value: e.target.value, error: '' })),
          }),
        ),
        askNameState.error
          ? React.createElement(
              'span',
              { className: 'vc-desk-error', role: 'alert' },
              askNameState.error,
            )
          : null,
      ),
    }),
    React.createElement(Dialog, {
      open: charDeleteState.open,
      onOpenChange: (nextOpen: boolean) => {
        if (!nextOpen) setCharDeleteState((prev) => ({ ...prev, open: false }));
      },
      title: '删除角色卡',
      className: 'vc-sheet',
      children: React.createElement(
        'div',
        { className: 'vc-column' },
        (
          [
            [false, '仅删除角色卡'],
            [true, '同时删除聊天'],
          ] as const
        ).map(([deleteChats, label]) =>
          React.createElement(
            'button',
            {
              key: label,
              type: 'button',
              className: 'vc-btn vc-btn-danger',
              onClick: () => {
                const cb = charDeleteState.onSelect;
                setCharDeleteState({ open: false, avatar: '', onSelect: null });
                cb?.(deleteChats, label);
              },
            },
            label,
          ),
        ),
      ),
    }),
    React.createElement(AlertDialog, {
      open: confirmState.open,
      onOpenChange: (nextOpen: boolean) => {
        if (!nextOpen) {
          setConfirmState((prev) => {
            prev.resolve?.(false);
            return { ...prev, open: false, resolve: null };
          });
        }
      },
      title: confirmState.title,
      description: confirmState.message,
      confirmLabel: confirmState.confirmLabel,
      cancelLabel: confirmState.cancelLabel,
      danger: confirmState.danger,
      className: 'vc-alert',
      onConfirm: () => {
        setConfirmState((prev) => {
          prev.resolve?.(true);
          return { ...prev, open: false, resolve: null };
        });
      },
    }),
    React.createElement(WorldCodeEditorDialog, {
      open: codeEditorState.open,
      initialValue: codeEditorState.initialValue,
      onDirtyChange: (isDirty: boolean) => {
        codeEditorDirtyRef.current = isDirty;
      },
      onApply: (nextVal: string) => {
        codeEditorState.onApply?.(nextVal);
      },
      onClose: () => {
        codeEditorDirtyRef.current = false;
        const doneCb = codeEditorState.onDone;
        setCodeEditorState((prev) => ({ ...prev, open: false, onApply: null, onDone: null }));
        doneCb?.();
      },
    }),
  );

  return {
    sectionKey,
    title,
    state,
    loading: state.loading,
    busy: state.busy,
    dirty: state.dirty,
    error: state.error,
    conflict: state.conflict,
    formRef,
    save: handleSave,
    discard: handleDiscard,
    reload: handleReload,
    onField: handleField,
    onAction: handleAction,
    reorderPrompts: handleReorderPrompts,
    modals,
  };
}
