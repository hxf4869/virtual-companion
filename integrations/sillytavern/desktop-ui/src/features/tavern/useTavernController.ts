import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useAppClient } from '../../app/providers';
import { queryKeys } from '../../data/queryKeys';
import {
  TAVERN_SECTIONS,
  createTavernController,
  createTavernReads,
  normalizeTavernSection,
  portablePreset,
  tavernQueryKeys,
  tavernSectionTitle,
  validateTavernName,
  type TavernAction,
  type TavernAskNameDialogState,
  type TavernAskNameRequest,
  type TavernCharDeleteDialogState,
  type TavernCharacterDeletionRequest,
  type TavernCodeEditorDialogState,
  type TavernCodeEditorHandle,
  type TavernCodeEditorRequest,
  type TavernConfirmDialogState,
  type TavernConfirmRequest,
  type TavernControllerState,
  type TavernField,
  type TavernGalleryItem,
  type TavernGroup,
  type TavernListItem,
  type TavernOption,
  type TavernOrderItem,
  type TavernResource,
  type TavernSectionProps,
  type UseTavernControllerOptions,
  type UseTavernControllerResult,
} from '../../data/queries/tavern';
import { useSessionBridge } from '../../runtime/session-bridge';

export {
  TAVERN_SECTIONS,
  createTavernController,
  normalizeTavernSection,
  portablePreset,
  tavernQueryKeys,
  tavernSectionTitle,
  validateTavernName,
  type TavernAction,
  type TavernAskNameDialogState,
  type TavernAskNameRequest,
  type TavernCharDeleteDialogState,
  type TavernCharacterDeletionRequest,
  type TavernCodeEditorDialogState,
  type TavernCodeEditorHandle,
  type TavernCodeEditorRequest,
  type TavernConfirmDialogState,
  type TavernConfirmRequest,
  type TavernControllerState,
  type TavernField,
  type TavernGalleryItem,
  type TavernGroup,
  type TavernListItem,
  type TavernOption,
  type TavernOrderItem,
  type TavernResource,
  type TavernSectionProps,
  type UseTavernControllerOptions,
  type UseTavernControllerResult,
};

interface AskNameInternalState {
  open: boolean;
  title: string;
  value: string;
  error: string;
  validate: (raw: string) => string;
  onConfirm: (name: string) => void;
}

interface ConfirmInternalState {
  open: boolean;
  title: string;
  message?: string;
  confirmLabel: string;
  cancelLabel: string;
  danger: boolean;
  resolve: ((ok: boolean) => void) | null;
}

interface CharDeleteInternalState {
  open: boolean;
  avatar: string;
  onSelect: ((deleteChats: boolean, label: string) => void) | null;
}

interface CodeEditorInternalState {
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
  const checkValidityRef = useRef<(() => boolean) | null>(null);

  const [state, setState] = useState<TavernControllerState>(() => ({
    ...INITIAL_STATE,
    key: sectionKey,
  }));

  const [askNameState, setAskNameState] = useState<AskNameInternalState>({
    open: false,
    title: '',
    value: '',
    error: '',
    validate: validateTavernName,
    onConfirm: () => {},
  });

  const [confirmState, setConfirmState] = useState<ConfirmInternalState>({
    open: false,
    title: '',
    message: undefined,
    confirmLabel: '确认',
    cancelLabel: '取消',
    danger: true,
    resolve: null,
  });

  const [charDeleteState, setCharDeleteState] = useState<CharDeleteInternalState>({
    open: false,
    avatar: '',
    onSelect: null,
  });

  const [codeEditorState, setCodeEditorState] = useState<CodeEditorInternalState>({
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

  const setCheckValidity = useCallback((fn: (() => boolean) | null) => {
    checkValidityRef.current = fn;
  }, []);

  const mutation = useMutation({
    mutationFn: async (operation: () => Promise<void>) => {
      await operation();
    },
  });
  const mutateAsyncRef = useRef(mutation.mutateAsync);
  mutateAsyncRef.current = mutation.mutateAsync;

  const openConfirmModal = useCallback(
    (req: TavernConfirmRequest): Promise<boolean> =>
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
      checkValidity: () => {
        if (optionsRef.current.checkValidity) {
          return optionsRef.current.checkValidity();
        }
        if (checkValidityRef.current) {
          return checkValidityRef.current();
        }
        return true;
      },
      reads: createTavernReads(queryClient, client),
      runMutation: (operation: () => Promise<void>) => mutateAsyncRef.current(operation),
      onUpdate: (nextState: TavernControllerState) => {
        setState({ ...nextState });
      },
      onNotify: (message: string) => {
        optionsRef.current.onNotify?.(message);
      },
      onDownload: (value: unknown, name: string) => {
        optionsRef.current.onDownload?.(value, name);
      },
      onConfirm: (req: TavernConfirmRequest) => {
        if (optionsRef.current.onConfirm) {
          return optionsRef.current.onConfirm(req);
        }
        return openConfirmModal({
          title: req.title,
          message: req.message,
          confirmLabel: req.confirmLabel || '删除',
          cancelLabel: req.cancelLabel || '取消',
          danger: req.danger !== false,
        });
      },
      onConfirmDiscard: () => {
        if (optionsRef.current.onConfirmDiscard) {
          return optionsRef.current.onConfirmDiscard();
        }
        return openConfirmModal({
          title: '放弃更改？',
          message: '未保存的更改会丢失。',
          confirmLabel: '放弃',
          cancelLabel: '继续编辑',
          danger: true,
        });
      },
      onAskName: (req: TavernAskNameRequest) => {
        if (optionsRef.current.onAskName) {
          optionsRef.current.onAskName(req);
          return;
        }
        setAskNameState({
          open: true,
          title: req.title,
          value: req.initial || '',
          error: '',
          validate: req.validate || validateTavernName,
          onConfirm: req.onConfirm,
        });
      },
      onChooseCharacterDeletion: (req: TavernCharacterDeletionRequest) => {
        if (optionsRef.current.onChooseCharacterDeletion) {
          optionsRef.current.onChooseCharacterDeletion(req);
          return;
        }
        setCharDeleteState({
          open: true,
          avatar: req.avatar,
          onSelect: req.onSelect,
        });
      },
      onOpenCodeEditor: (req: TavernCodeEditorRequest): TavernCodeEditorHandle => {
        if (optionsRef.current.onOpenCodeEditor) {
          return optionsRef.current.onOpenCodeEditor(req);
        }
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
            if (optionsRef.current.onConfirmDiscard) {
              return optionsRef.current.onConfirmDiscard();
            }
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

  const handleRequestLeave = useCallback(async () => {
    return (await controllerRef.current?.requestLeave()) ?? true;
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

  const setAskNameValue = useCallback((value: string) => {
    setAskNameState((prev) => ({ ...prev, value, error: '' }));
  }, []);

  const closeAskName = useCallback(() => {
    setAskNameState((prev) => ({ ...prev, open: false, error: '' }));
  }, []);

  const askNameDialog = useMemo<TavernAskNameDialogState>(
    () => ({
      open: askNameState.open,
      title: askNameState.title,
      value: askNameState.value,
      error: askNameState.error,
      setValue: setAskNameValue,
      submit: submitAskName,
      close: closeAskName,
    }),
    [
      askNameState.open,
      askNameState.title,
      askNameState.value,
      askNameState.error,
      setAskNameValue,
      submitAskName,
      closeAskName,
    ],
  );

  const confirmModalConfirm = useCallback(() => {
    setConfirmState((prev) => {
      prev.resolve?.(true);
      return { ...prev, open: false, resolve: null };
    });
  }, []);

  const confirmModalCancel = useCallback(() => {
    setConfirmState((prev) => {
      prev.resolve?.(false);
      return { ...prev, open: false, resolve: null };
    });
  }, []);

  const confirmDialog = useMemo<TavernConfirmDialogState>(
    () => ({
      open: confirmState.open,
      title: confirmState.title,
      message: confirmState.message,
      confirmLabel: confirmState.confirmLabel,
      cancelLabel: confirmState.cancelLabel,
      danger: confirmState.danger,
      confirm: confirmModalConfirm,
      cancel: confirmModalCancel,
    }),
    [
      confirmState.open,
      confirmState.title,
      confirmState.message,
      confirmState.confirmLabel,
      confirmState.cancelLabel,
      confirmState.danger,
      confirmModalConfirm,
      confirmModalCancel,
    ],
  );

  const selectCharDelete = useCallback(
    (deleteChats: boolean, label: string) => {
      const cb = charDeleteState.onSelect;
      setCharDeleteState({ open: false, avatar: '', onSelect: null });
      cb?.(deleteChats, label);
    },
    [charDeleteState.onSelect],
  );

  const closeCharDelete = useCallback(() => {
    setCharDeleteState((prev) => ({ ...prev, open: false }));
  }, []);

  const charDeleteDialog = useMemo<TavernCharDeleteDialogState>(
    () => ({
      open: charDeleteState.open,
      avatar: charDeleteState.avatar,
      select: selectCharDelete,
      close: closeCharDelete,
    }),
    [charDeleteState.open, charDeleteState.avatar, selectCharDelete, closeCharDelete],
  );

  const setCodeEditorDirty = useCallback((isDirty: boolean) => {
    codeEditorDirtyRef.current = isDirty;
  }, []);

  const applyCodeEditor = useCallback(
    (nextVal: string) => {
      codeEditorState.onApply?.(nextVal);
    },
    [codeEditorState],
  );

  const closeCodeEditor = useCallback(() => {
    codeEditorDirtyRef.current = false;
    const doneCb = codeEditorState.onDone;
    setCodeEditorState((prev) => ({ ...prev, open: false, onApply: null, onDone: null }));
    doneCb?.();
  }, [codeEditorState]);

  const codeEditorDialog = useMemo<TavernCodeEditorDialogState>(
    () => ({
      open: codeEditorState.open,
      initialValue: codeEditorState.initialValue,
      setDirty: setCodeEditorDirty,
      apply: applyCodeEditor,
      close: closeCodeEditor,
    }),
    [
      codeEditorState.open,
      codeEditorState.initialValue,
      setCodeEditorDirty,
      applyCodeEditor,
      closeCodeEditor,
    ],
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
    setCheckValidity,
    save: handleSave,
    discard: handleDiscard,
    reload: handleReload,
    requestLeave: handleRequestLeave,
    onField: handleField,
    onAction: handleAction,
    reorderPrompts: handleReorderPrompts,
    askNameDialog,
    confirmDialog,
    charDeleteDialog,
    codeEditorDialog,
  };
}
