import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useForm, type UseFormReturn } from 'react-hook-form';
import { z } from 'zod';
import { useSessionBridge } from '../../runtime/session-bridge';
import {
    useCharacters,
    useCreateInstance,
    useDeleteCharacter,
    useImportCharacter,
    useRenameInstance,
    useSavePersona,
    type CharacterCardItem,
    type CharacterInstanceItem,
    type CreatedInstanceResult,
    type ImportedCharacterResult,
    type PersonaFields,
} from '../../data/queries/characters';
import {
    GENDERS,
    RELATION_COPY,
    STYLE_OPTIONS,
    buildCharacterCard,
    sanitizeInstanceName,
} from '../../../../extension/vc-model-settings/instance-logic.js';

export { GENDERS, RELATION_COPY, STYLE_OPTIONS };

export const WIZARD_RELATIONS = [
    '好朋友',
    '恋人',
    '倾听者',
    '家人',
    '搭档',
    '前任',
] as const;

export const TOTAL_WIZARD_STEPS = 7;

export const DEFAULT_WIZARD_STYLES = [
    '口语短句，偶尔表情',
    '好奇你的生活',
] as const;

export const personaSchema = z.object({
    description: z.string(),
    personality: z.string(),
    scenario: z.string(),
    first_mes: z.string(),
    mes_example: z.string(),
});

export type PersonaFormValues = z.infer<typeof personaSchema>;

export const PERSONA_FIELD_ROWS: ReadonlyArray<{
    key: keyof PersonaFields;
    label: string;
    rows: number;
}> = [
    { key: 'description', label: '介绍', rows: 5 },
    { key: 'personality', label: '性格', rows: 4 },
    { key: 'scenario', label: '情景', rows: 3 },
    { key: 'first_mes', label: '开场', rows: 3 },
    { key: 'mes_example', label: '例句', rows: 5 },
];

export function characterInitial(name: string): string {
    const clean = String(name || '').replace(/[^\p{L}\p{N}]/gu, '');
    return [...clean][0] || '角';
}

export function characterCardTarget(
    card: Pick<CharacterCardItem, 'avatar' | 'characterRef'> | null | undefined,
): string {
    if (!card) return '';
    return String(card.avatar || card.characterRef || '');
}

export function isSameCharacterCard(
    a: Pick<CharacterCardItem, 'avatar' | 'characterRef'> | null | undefined,
    b: Pick<CharacterCardItem, 'avatar' | 'characterRef'> | null | undefined,
): boolean {
    if (!a || !b) return false;
    return Boolean(
        (a.avatar && a.avatar === b.avatar) ||
            (a.characterRef && a.characterRef === b.characterRef),
    );
}

export function matchesCharacterTarget(
    card: Pick<CharacterCardItem, 'avatar' | 'characterRef'> | null | undefined,
    target?: string,
): boolean {
    if (!card) return false;
    const rawTarget = target ? String(target) : '';
    if (!rawTarget) return false;
    let decoded = rawTarget;
    try {
        decoded = decodeURIComponent(rawTarget);
    } catch {
        decoded = rawTarget;
    }
    return Boolean(
        (card.avatar && (card.avatar === decoded || card.avatar === rawTarget)) ||
            (card.characterRef &&
                (card.characterRef === decoded || card.characterRef === rawTarget)),
    );
}

export function findCharacterCard(
    cards: readonly CharacterCardItem[],
    target?: string,
): CharacterCardItem | null {
    if (!target) return null;
    return cards.find((c) => matchesCharacterTarget(c, target)) ?? null;
}

export function filterCharacterCards(
    cards: readonly CharacterCardItem[],
    searchQuery: string,
): CharacterCardItem[] {
    const q = String(searchQuery || '').trim().toLowerCase();
    if (!q) return [...cards];
    return cards.filter((card) => {
        if (card.name.toLowerCase().includes(q)) return true;
        if (card.description.toLowerCase().includes(q)) return true;
        if (card.worldName.toLowerCase().includes(q)) return true;
        return card.instances.some((inst) =>
            inst.label.toLowerCase().includes(q),
        );
    });
}

export interface UseCharactersStateOptions {
    avatar?: string;
    onOpenCharacter: (avatar: string) => void | Promise<void>;
    onCloseCharacter: () => void | Promise<void>;
}

export function useCharactersState({
    avatar,
    onOpenCharacter,
    onCloseCharacter,
}: UseCharactersStateOptions) {
    const { cards, loose, instances, isLoading, isError, error, refetch } =
        useCharacters();

    const [searchQuery, setSearchQuery] = useState('');
    const [createWizardOpen, setCreateWizardOpen] = useState(false);

    const mountedRef = useRef(true);
    const currentTargetRef = useRef(avatar);
    currentTargetRef.current = avatar;
    const onCloseCharacterRef = useRef(onCloseCharacter);
    onCloseCharacterRef.current = onCloseCharacter;

    useEffect(() => {
        mountedRef.current = true;
        return () => {
            mountedRef.current = false;
        };
    }, []);

    const activeCard = useMemo<CharacterCardItem | null>(
        () => findCharacterCard(cards, avatar),
        [cards, avatar],
    );

    const filteredCards = useMemo<CharacterCardItem[]>(
        () => filterCharacterCards(cards, searchQuery),
        [cards, searchQuery],
    );

    const selectCard = useCallback(
        (card: Pick<CharacterCardItem, 'avatar' | 'characterRef'>) => {
            const target = characterCardTarget(card);
            if (!target) return;
            if (isSameCharacterCard(card, activeCard)) {
                return;
            }
            void onOpenCharacter(target);
        },
        [activeCard, onOpenCharacter],
    );

    const openImportedCard = useCallback(
        (imported: Pick<ImportedCharacterResult, 'avatar' | 'characterRef'>) => {
            const target = characterCardTarget(imported);
            if (target) {
                void onOpenCharacter(target);
            }
        },
        [onOpenCharacter],
    );

    const closeDetail = useCallback(() => {
        void onCloseCharacter();
    }, [onCloseCharacter]);

    const handleDeletedCard = useCallback(
        (deletedCard?: Pick<CharacterCardItem, 'avatar' | 'characterRef'>) => {
            if (!mountedRef.current) return;
            const currentTarget = currentTargetRef.current;
            if (!currentTarget) return;
            if (
                deletedCard &&
                !matchesCharacterTarget(deletedCard, currentTarget)
            ) {
                return;
            }
            void onCloseCharacterRef.current();
        },
        [],
    );

    return {
        cards,
        loose,
        instances,
        activeCard,
        filteredCards,
        searchQuery,
        setSearchQuery,
        createWizardOpen,
        setCreateWizardOpen,
        isLoading,
        isError,
        error,
        refetch,
        selectCard,
        openImportedCard,
        closeDetail,
        handleDeletedCard,
    };
}

export interface InstanceDialogState {
    open: boolean;
    mode: 'create' | 'rename';
    initialName: string;
    relationship: Record<string, any> | null;
}

export interface UseCharacterDetailStateOptions {
    card: CharacterCardItem;
    onDeleted: (card: CharacterCardItem) => void;
    onOpenConversation: (conversationKey: string) => void | Promise<void>;
    onEditCharacterCard: (avatar: string) => void | Promise<void>;
    onOpenVoiceSettings: (relationshipId: string) => void | Promise<void>;
    onOpenInstanceError?: (message: string) => void;
}

export function useCharacterDetailState({
    card,
    onDeleted,
    onOpenConversation,
    onEditCharacterCard,
    onOpenVoiceSettings,
    onOpenInstanceError,
}: UseCharacterDetailStateOptions) {
    const bridge = useSessionBridge();
    const deleteMutation = useDeleteCharacter();

    const [editingPersona, setEditingPersona] = useState(false);
    const [descExpanded, setDescExpanded] = useState(false);
    const [failedAvatarSrc, setFailedAvatarSrc] = useState('');
    const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
    const [deleteError, setDeleteError] = useState('');
    const [instanceDialogState, setInstanceDialogState] =
        useState<InstanceDialogState>({
            open: false,
            mode: 'create',
            initialName: '',
            relationship: null,
        });

    const mountedRef = useRef(true);
    const openingRef = useRef(false);
    const openRequestRef = useRef(0);

    useEffect(() => {
        mountedRef.current = true;
        return () => {
            mountedRef.current = false;
            openRequestRef.current += 1;
            openingRef.current = false;
        };
    }, []);

    useEffect(() => {
        setEditingPersona(false);
        setDescExpanded(false);
        setDeleteDialogOpen(false);
        setDeleteError('');
        openRequestRef.current += 1;
        openingRef.current = false;
    }, [card.characterRef, card.avatar]);

    const showAvatarImg = Boolean(
        card.avatarUrl && failedAvatarSrc !== card.avatarUrl,
    );

    const markAvatarFailed = useCallback(() => {
        setFailedAvatarSrc(card.avatarUrl);
    }, [card.avatarUrl]);

    const openInstance = useCallback(
        async (inst: CharacterInstanceItem) => {
            if (openingRef.current) return;
            openingRef.current = true;
            const requestId = ++openRequestRef.current;
            try {
                const status =
                    card.avatar && inst.file
                        ? await bridge.open({ avatar: card.avatar, file: inst.file })
                        : await bridge.open({
                              avatar: card.avatar,
                              relationshipId: inst.relationshipId,
                              chatIdentity: inst.chatIdentity || undefined,
                          });
                if (!mountedRef.current || requestId !== openRequestRef.current) {
                    return;
                }
                const conversationKey =
                    bridge.getSnapshot().key || inst.conversationKey;
                if (status === 'opened' && conversationKey) {
                    await onOpenConversation(conversationKey);
                } else if (status === 'failed') {
                    onOpenInstanceError?.('聊天没有加载出来，请重试。');
                }
            } catch {
                if (mountedRef.current && requestId === openRequestRef.current) {
                    onOpenInstanceError?.('聊天没有加载出来，请重试。');
                }
            } finally {
                if (requestId === openRequestRef.current) {
                    openingRef.current = false;
                }
            }
        },
        [bridge, card.avatar, onOpenConversation, onOpenInstanceError],
    );

    const confirmDelete = useCallback(async () => {
        if (deleteMutation.isPending) return;
        setDeleteError('');
        try {
            await deleteMutation.mutateAsync({
                avatar: card.avatar,
                deleteChats: true,
            });
            if (mountedRef.current) {
                setDeleteDialogOpen(false);
            }
            onDeleted(card);
        } catch (err: any) {
            if (mountedRef.current) {
                setDeleteError(err?.message || '删除角色失败，请重试。');
            }
        }
    }, [card, deleteMutation, onDeleted]);

    const handleDeleteDialogOpenChange = useCallback(
        (nextOpen: boolean) => {
            if (!deleteMutation.isPending) {
                setDeleteDialogOpen(nextOpen);
            }
        },
        [deleteMutation.isPending],
    );

    const openCreateInstanceDialog = useCallback(() => {
        setInstanceDialogState({
            open: true,
            mode: 'create',
            initialName: card.name,
            relationship: null,
        });
    }, [card.name]);

    const openRenameInstanceDialog = useCallback(
        (inst: CharacterInstanceItem) => {
            setInstanceDialogState({
                open: true,
                mode: 'rename',
                initialName: inst.name,
                relationship: inst.rawRelationship ?? {
                    relationshipId: inst.relationshipId,
                    characterRef: card.characterRef,
                    companionName: inst.name,
                },
            });
        },
        [card.characterRef],
    );

    const setInstanceDialogOpen = useCallback((open: boolean) => {
        setInstanceDialogState((prev) => ({ ...prev, open }));
    }, []);

    const editCharacterCard = useCallback(() => {
        void onEditCharacterCard(card.avatar);
    }, [card.avatar, onEditCharacterCard]);

    const openVoiceSettings = useCallback(
        (inst: Pick<CharacterInstanceItem, 'relationshipId'>) => {
            void onOpenVoiceSettings(inst.relationshipId);
        },
        [onOpenVoiceSettings],
    );

    return {
        editingPersona,
        setEditingPersona,
        descExpanded,
        setDescExpanded,
        showAvatarImg,
        markAvatarFailed,
        deleteDialogOpen,
        setDeleteDialogOpen,
        handleDeleteDialogOpenChange,
        deleteError,
        deletePending: deleteMutation.isPending,
        confirmDelete,
        instanceDialogState,
        openCreateInstanceDialog,
        openRenameInstanceDialog,
        setInstanceDialogOpen,
        openInstance,
        editCharacterCard,
        openVoiceSettings,
    };
}

export interface UseCreateWizardStateOptions {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onOpenConversation: (conversationKey: string) => void | Promise<void>;
    onCreated?: (created: CreatedInstanceResult) => void;
}

export function useCreateWizardState({
    open,
    onOpenChange,
    onOpenConversation,
    onCreated,
}: UseCreateWizardStateOptions) {
    const bridge = useSessionBridge();
    const importMutation = useImportCharacter();
    const createInstanceMutation = useCreateInstance();

    const [step, setStep] = useState(1);
    const [name, setNameState] = useState('');
    const [gender, setGenderState] = useState<string>('女生');
    const [relation, setRelationState] = useState<string>('好朋友');
    const [styles, setStyles] = useState<string[]>([...DEFAULT_WIZARD_STYLES]);
    const [customPersonality, setCustomPersonalityState] = useState('');
    const [userAddressAs, setUserAddressAsState] = useState('');
    const [scenario, setScenarioState] = useState('');
    const [avoidTopicsText, setAvoidTopicsTextState] = useState('');
    const [firstMes, setFirstMesState] = useState<string>(
        RELATION_COPY['好朋友']?.first || '',
    );
    const [firstMesCustomized, setFirstMesCustomized] = useState(false);
    const [stepError, setStepError] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const [hasImported, setHasImported] = useState(false);

    const mountedRef = useRef(true);
    const openRef = useRef(open);
    openRef.current = open;
    const submitEpochRef = useRef(0);
    const submitIntentRef = useRef<{
        chatIdentity: string;
        imported: ImportedCharacterResult | null;
        created: CreatedInstanceResult | null;
    }>({
        chatIdentity: '',
        imported: null,
        created: null,
    });

    const resetWizard = useCallback(() => {
        submitEpochRef.current += 1;
        submitIntentRef.current = {
            chatIdentity: '',
            imported: null,
            created: null,
        };
        setHasImported(false);
        setStep(1);
        setNameState('');
        setGenderState('女生');
        setRelationState('好朋友');
        setStyles([...DEFAULT_WIZARD_STYLES]);
        setCustomPersonalityState('');
        setUserAddressAsState('');
        setScenarioState('');
        setAvoidTopicsTextState('');
        setFirstMesState(RELATION_COPY['好朋友']?.first || '');
        setFirstMesCustomized(false);
        setStepError('');
    }, []);

    useEffect(() => {
        mountedRef.current = true;
        return () => {
            mountedRef.current = false;
            submitEpochRef.current += 1;
            submitIntentRef.current = {
                chatIdentity: '',
                imported: null,
                created: null,
            };
        };
    }, []);

    useEffect(() => {
        if (!open) {
            resetWizard();
        }
    }, [open, resetWizard]);

    const busy =
        submitting ||
        importMutation.isPending ||
        createInstanceMutation.isPending;

    const handleOpenChange = useCallback(
        (nextOpen: boolean) => {
            if (busy) return;
            if (!nextOpen) {
                resetWizard();
            }
            onOpenChange(nextOpen);
        },
        [busy, onOpenChange, resetWizard],
    );

    const setName = useCallback(
        (nextName: string) => {
            if (busy || hasImported) return;
            setNameState(nextName);
            setStepError((prev) => (prev ? '' : prev));
        },
        [busy, hasImported],
    );

    const setGender = useCallback(
        (nextGender: string) => {
            if (busy || hasImported) return;
            setGenderState(nextGender);
        },
        [busy, hasImported],
    );

    const selectRelation = useCallback(
        (nextRel: string) => {
            if (busy || hasImported) return;
            setRelationState(nextRel);
            if (!firstMesCustomized) {
                const copy = (RELATION_COPY as Record<string, { first: string }>)[
                    nextRel
                ];
                if (copy?.first) {
                    setFirstMesState(copy.first);
                }
            }
        },
        [busy, firstMesCustomized, hasImported],
    );

    const toggleStyle = useCallback(
        (option: string) => {
            if (busy || hasImported) return;
            setStyles((prev) =>
                prev.includes(option)
                    ? prev.filter((item) => item !== option)
                    : [...prev, option],
            );
        },
        [busy, hasImported],
    );

    const setCustomPersonality = useCallback(
        (value: string) => {
            if (busy || hasImported) return;
            setCustomPersonalityState(value);
        },
        [busy, hasImported],
    );

    const setUserAddressAs = useCallback(
        (value: string) => {
            if (busy || hasImported) return;
            setUserAddressAsState(value);
        },
        [busy, hasImported],
    );

    const setScenario = useCallback(
        (value: string) => {
            if (busy || hasImported) return;
            setScenarioState(value);
        },
        [busy, hasImported],
    );

    const setAvoidTopicsText = useCallback(
        (value: string) => {
            if (busy || hasImported) return;
            setAvoidTopicsTextState(value);
        },
        [busy, hasImported],
    );

    const setFirstMes = useCallback(
        (value: string) => {
            if (busy || hasImported) return;
            setFirstMesState(value);
            setFirstMesCustomized(true);
        },
        [busy, hasImported],
    );

    const nextStep = useCallback(() => {
        if (busy) return;
        if (step === 1) {
            const clean = sanitizeInstanceName(name);
            if (!clean.ok) {
                setStepError(String(clean.reason || ''));
                return;
            }
        }
        setStepError('');
        setStep((prev) => Math.min(TOTAL_WIZARD_STEPS, prev + 1));
    }, [busy, name, step]);

    const prevStep = useCallback(() => {
        if (busy || hasImported || step <= 1) return;
        setStepError('');
        setStep((prev) => Math.max(1, prev - 1));
    }, [busy, hasImported, step]);

    const finish = useCallback(async () => {
        if (busy) return;
        const clean = sanitizeInstanceName(name);
        if (!clean.ok) {
            setStepError(String(clean.reason || ''));
            setStep(1);
            return;
        }
        const cleanName = String(clean.value || '');
        const ticket = ++submitEpochRef.current;
        const isAlive = () =>
            mountedRef.current &&
            openRef.current &&
            submitEpochRef.current === ticket;
        if (!submitIntentRef.current.chatIdentity) {
            submitIntentRef.current.chatIdentity = crypto.randomUUID();
        }
        const chatIdentity = submitIntentRef.current.chatIdentity;
        setSubmitting(true);
        setStepError('');
        try {
            let imported = submitIntentRef.current.imported;
            if (!imported) {
                const cardPayload = buildCharacterCard({
                    name: cleanName,
                    relation,
                    gender,
                    styles,
                    customPersonality,
                    scenario,
                    first_mes: firstMes,
                    userAddressAs,
                    avoidTopicsText,
                });
                const bytes = new TextEncoder().encode(JSON.stringify(cardPayload));
                const nextImported = await importMutation.mutateAsync({
                    name: `${cleanName}.json`,
                    bytes,
                });
                if (!isAlive()) return;
                imported = nextImported;
                submitIntentRef.current.imported = nextImported;
                setHasImported(true);
            }
            let created = submitIntentRef.current.created;
            if (!created) {
                const nextCreated = await createInstanceMutation.mutateAsync({
                    characterRef: imported.characterRef,
                    avatar: imported.avatar,
                    displayName: cleanName,
                    chatIdentity,
                    mode: 'COMPANION',
                });
                if (!isAlive()) return;
                if (!nextCreated.avatar || !nextCreated.file) {
                    setStepError('聊天没有加载出来，请重试。');
                    return;
                }
                created = nextCreated;
                submitIntentRef.current.created = nextCreated;
                submitIntentRef.current.chatIdentity =
                    nextCreated.chatIdentity || chatIdentity;
            }
            const openStatus = await bridge.open({
                avatar: created.avatar,
                file: created.file,
            });
            if (!isAlive()) return;
            if (openStatus === 'failed') {
                setStepError('聊天没有加载出来，请重试。');
                return;
            }
            if (openStatus !== 'opened') {
                return;
            }
            onCreated?.(created);
            resetWizard();
            onOpenChange(false);
            if (created.conversationKey) {
                await onOpenConversation(created.conversationKey);
            }
        } catch (err: any) {
            if (isAlive()) {
                setStepError(err?.message || '没有完成，请重试。');
            }
        } finally {
            if (mountedRef.current) {
                setSubmitting(false);
            }
        }
    }, [
        avoidTopicsText,
        bridge,
        busy,
        createInstanceMutation,
        customPersonality,
        firstMes,
        gender,
        importMutation,
        name,
        onCreated,
        onOpenChange,
        onOpenConversation,
        relation,
        resetWizard,
        scenario,
        styles,
        userAddressAs,
    ]);

    return {
        step,
        totalSteps: TOTAL_WIZARD_STEPS,
        name,
        setName,
        gender,
        setGender,
        relation,
        selectRelation,
        styles,
        toggleStyle,
        customPersonality,
        setCustomPersonality,
        userAddressAs,
        setUserAddressAs,
        scenario,
        setScenario,
        avoidTopicsText,
        setAvoidTopicsText,
        firstMes,
        setFirstMes,
        firstMesCustomized,
        stepError,
        setStepError,
        busy,
        hasImported,
        resetWizard,
        handleOpenChange,
        nextStep,
        prevStep,
        finish,
    };
}

export interface UsePersonaEditorStateOptions {
    avatar: string;
    characterRef: string;
    fields: PersonaFields;
    onBack: () => void;
    onSaved?: (fields: PersonaFields) => void;
}

export interface UsePersonaEditorStateReturn {
    form: UseFormReturn<PersonaFormValues>;
    baseline: PersonaFields;
    isDirty: boolean;
    isSaving: boolean;
    saveError: string;
    discardDialogOpen: boolean;
    setDiscardDialogOpen: (open: boolean) => void;
    requestBack: () => void;
    confirmDiscard: () => void;
    submit: (e?: React.BaseSyntheticEvent) => Promise<void>;
}

export function usePersonaEditorState({
    avatar,
    characterRef,
    fields,
    onBack,
    onSaved,
}: UsePersonaEditorStateOptions): UsePersonaEditorStateReturn {
    const saveMutation = useSavePersona();
    const [baseline, setBaseline] = useState<PersonaFields>(() => ({
        ...fields,
    }));
    const [discardDialogOpen, setDiscardDialogOpen] = useState(false);
    const [saveError, setSaveError] = useState('');

    const mountedRef = useRef(true);
    const activeTargetRef = useRef(`${characterRef}::${avatar}`);

    useEffect(() => {
        mountedRef.current = true;
        return () => {
            mountedRef.current = false;
        };
    }, []);

    const form = useForm<PersonaFormValues>({
        defaultValues: { ...fields },
    });

    useEffect(() => {
        activeTargetRef.current = `${characterRef}::${avatar}`;
        setBaseline({ ...fields });
        setSaveError('');
        setDiscardDialogOpen(false);
        form.reset({ ...fields });
    }, [
        avatar,
        characterRef,
        fields.description,
        fields.personality,
        fields.scenario,
        fields.first_mes,
        fields.mes_example,
        form,
    ]);

    const values = form.watch();
    const isDirty =
        values.description !== baseline.description ||
        values.personality !== baseline.personality ||
        values.scenario !== baseline.scenario ||
        values.first_mes !== baseline.first_mes ||
        values.mes_example !== baseline.mes_example;

    const requestBack = useCallback(() => {
        if (saveMutation.isPending) return;
        if (isDirty) {
            setDiscardDialogOpen(true);
            return;
        }
        onBack();
    }, [isDirty, onBack, saveMutation.isPending]);

    const confirmDiscard = useCallback(() => {
        setDiscardDialogOpen(false);
        form.reset({ ...baseline });
        onBack();
    }, [baseline, form, onBack]);

    const submit = useMemo(
        () =>
            form.handleSubmit(async (rawValues) => {
                if (saveMutation.isPending) return;
                const parsed = personaSchema.safeParse(rawValues);
                if (!parsed.success) {
                    setSaveError('请检查输入内容。');
                    return;
                }
                const targetKey = activeTargetRef.current;
                setSaveError('');
                try {
                    const saved = await saveMutation.mutateAsync({
                        avatar,
                        fields: parsed.data,
                    });
                    if (
                        !mountedRef.current ||
                        activeTargetRef.current !== targetKey
                    ) {
                        return;
                    }
                    setBaseline({ ...saved });
                    form.reset({ ...saved });
                    onSaved?.(saved);
                } catch (err: any) {
                    if (
                        mountedRef.current &&
                        activeTargetRef.current === targetKey
                    ) {
                        setSaveError(err?.message || '没有完成，请重试。');
                    }
                }
            }),
        [avatar, form, onSaved, saveMutation],
    );

    return {
        form,
        baseline,
        isDirty,
        isSaving: saveMutation.isPending,
        saveError,
        discardDialogOpen,
        setDiscardDialogOpen,
        requestBack,
        confirmDiscard,
        submit,
    };
}

export interface UseInstanceDialogStateOptions {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    mode: 'create' | 'rename';
    characterRef: string;
    avatar?: string;
    initialName?: string;
    relationship?: Record<string, any> | null;
    onCreated?: (result: CreatedInstanceResult) => void;
    onRenamed?: (newName: string) => void;
}

export function useInstanceDialogState({
    open,
    onOpenChange,
    mode,
    characterRef,
    avatar = '',
    initialName = '',
    relationship = null,
    onCreated,
    onRenamed,
}: UseInstanceDialogStateOptions) {
    const createMutation = useCreateInstance();
    const renameMutation = useRenameInstance();

    const [draftName, setDraftNameState] = useState(initialName);
    const [nameError, setNameError] = useState('');

    useEffect(() => {
        if (open) {
            setDraftNameState(initialName);
            setNameError('');
        }
    }, [open, initialName, mode, characterRef]);

    const busy = createMutation.isPending || renameMutation.isPending;

    const setDraftName = useCallback((value: string) => {
        setDraftNameState(value);
        setNameError((prev) => (prev ? '' : prev));
    }, []);

    const handleOpenChange = useCallback(
        (nextOpen: boolean) => {
            if (!busy) {
                onOpenChange(nextOpen);
            }
        },
        [busy, onOpenChange],
    );

    const save = useCallback(
        async (e?: { preventDefault?: () => void }) => {
            e?.preventDefault?.();
            if (busy) return;
            const clean = sanitizeInstanceName(draftName);
            if (!clean.ok) {
                setNameError(String(clean.reason || ''));
                return;
            }
            const cleanName = String(clean.value || '');
            setNameError('');
            try {
                if (mode === 'create') {
                    const created = await createMutation.mutateAsync({
                        characterRef,
                        avatar,
                        displayName: cleanName,
                        mode: 'COMPANION',
                    });
                    onCreated?.(created);
                    onOpenChange(false);
                } else {
                    if (!relationship) {
                        setNameError('名称尚未保存');
                        return;
                    }
                    await renameMutation.mutateAsync({
                        relationship,
                        name: cleanName,
                    });
                    onRenamed?.(cleanName);
                    onOpenChange(false);
                }
            } catch (err: any) {
                setNameError(err?.message || '名称尚未保存');
            }
        },
        [
            avatar,
            busy,
            characterRef,
            createMutation,
            draftName,
            mode,
            onCreated,
            onOpenChange,
            onRenamed,
            relationship,
            renameMutation,
        ],
    );

    return {
        draftName,
        setDraftName,
        nameError,
        busy,
        handleOpenChange,
        save,
    };
}
