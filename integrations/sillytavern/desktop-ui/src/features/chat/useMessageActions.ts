import { useCallback, useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { createReminder } from '../../../../extension/vc-model-settings/api.js';
import {
    REMIND_PRESETS,
    computeRemindDueAt,
    remindSeed,
    rfc3339,
} from '../../../../extension/vc-model-settings/chat-logic.js';
import {
    useChatSnapshot,
    useSessionBridge,
    type ChatSnapshot,
} from '../../runtime/session-bridge';

export const editMessageSchema = z.object({
    text: z.string().refine(val => val.trim().length > 0, {
        message: '请输入消息内容',
    }),
});

export type EditMessageFormValues = z.infer<typeof editMessageSchema>;

export const remindMessageSchema = z.object({
    topic: z.string().refine(val => val.trim().length > 0, {
        message: '请输入提醒内容',
    }),
    presetId: z.string().min(1),
    customDueAt: z.string(),
});

export type RemindMessageFormValues = z.infer<typeof remindMessageSchema>;

export interface MessageActionTarget {
    key: string;
    messageKey: string;
}

export interface MessageTextTarget extends MessageActionTarget {
    text: string;
}

export function resolveMessageActionTarget(
    snapshot: ChatSnapshot,
    target: MessageActionTarget | null,
): { snapshot: ChatSnapshot; index: number } | null {
    if (!target || !target.key || !target.messageKey) return null;
    if (snapshot.status !== 'ready' || snapshot.key !== target.key) {
        return null;
    }
    const index = snapshot.messages.findIndex(msg => msg.key === target.messageKey);
    if (index < 0) return null;
    return { snapshot, index };
}

export interface UseMessageActionsOptions {
    onRemindSuccess?: () => void;
    onRemindError?: (error: unknown) => void;
}

export function useMessageActions({
    onRemindSuccess,
    onRemindError,
}: UseMessageActionsOptions = {}) {
    const bridge = useSessionBridge();
    const activeKey = useChatSnapshot(s => s.key);
    const status = useChatSnapshot(s => s.status);
    const messages = useChatSnapshot(s => s.messages);
    const busy = useChatSnapshot(s => s.busy);
    const notice = useChatSnapshot(s => s.notice);
    const error = useChatSnapshot(s => s.error);
    const conflict = useChatSnapshot(s => s.conflict);
    const catalogBlocked = useChatSnapshot(s => s.catalogBlocked);
    const settingsRequired = useChatSnapshot(s => s.settingsRequired);
    const popupRequest = useChatSnapshot(s => s.popupRequest);
    const personaChoice = useChatSnapshot(s => s.personaChoice);

    const [editing, setEditing] = useState<MessageTextTarget | null>(null);
    const [removing, setRemoving] = useState<MessageActionTarget | null>(null);
    const [reminding, setReminding] = useState<MessageTextTarget | null>(null);
    const [reactionTarget, setReactionTarget] = useState<MessageActionTarget | null>(null);
    const [popupInput, setPopupInput] = useState('');

    const editForm = useForm<EditMessageFormValues>({
        defaultValues: { text: '' },
    });

    const remindForm = useForm<RemindMessageFormValues>({
        defaultValues: {
            topic: '',
            presetId: REMIND_PRESETS[0]?.id || 'tonight',
            customDueAt: '',
        },
    });
    const remindPresetId = remindForm.watch('presetId');
    const remindCustomDueAt = remindForm.watch('customDueAt');

    useEffect(() => {
        if (popupRequest) {
            setPopupInput(popupRequest.initial || '');
        }
    }, [popupRequest]);

    const resolveActionTarget = useCallback(
        (target: MessageActionTarget | null) =>
            resolveMessageActionTarget(bridge.getSnapshot(), target),
        [bridge],
    );

    const openEditDialog = useCallback(
        (index: number, currentText: string) => {
            const messageKey = messages[index]?.key;
            if (!activeKey || !messageKey) return;
            editForm.reset({ text: currentText });
            setEditing({ key: activeKey, messageKey, text: currentText });
        },
        [activeKey, editForm, messages],
    );

    const submitEdit = editForm.handleSubmit(async values => {
        if (!editing) return;
        const parsed = editMessageSchema.safeParse(values);
        if (!parsed.success) {
            editForm.setError('text', {
                type: 'zod',
                message: parsed.error.issues[0]?.message || '请输入消息内容',
            });
            return;
        }
        const resolved = resolveActionTarget(editing);
        const nextText = parsed.data.text;
        setEditing(null);
        if (!resolved) return;
        await bridge.edit(resolved.index, nextText);
    });

    const openRemoveDialog = useCallback(
        (index: number) => {
            const messageKey = messages[index]?.key;
            if (!activeKey || !messageKey) return;
            setRemoving({ key: activeKey, messageKey });
        },
        [activeKey, messages],
    );

    const confirmRemove = useCallback(async () => {
        if (!removing) return;
        const resolved = resolveActionTarget(removing);
        setRemoving(null);
        if (!resolved) return;
        await bridge.remove(resolved.index);
    }, [bridge, removing, resolveActionTarget]);

    const openRemindDialog = useCallback(
        (index: number, text: string) => {
            const messageKey = messages[index]?.key;
            if (!activeKey || !messageKey) return;
            remindForm.reset({
                topic: remindSeed(text),
                presetId: REMIND_PRESETS[0]?.id || 'tonight',
                customDueAt: '',
            });
            setReminding({ key: activeKey, messageKey, text });
        },
        [activeKey, messages, remindForm],
    );

    const submitRemind = remindForm.handleSubmit(async values => {
        if (!reminding) return;
        const resolved = resolveActionTarget(reminding);
        const targetRelationshipId = resolved?.snapshot.relationshipId;
        if (!resolved || !targetRelationshipId) {
            setReminding(null);
            return;
        }
        const parsed = remindMessageSchema.safeParse(values);
        if (!parsed.success) {
            setReminding(null);
            return;
        }
        const preset = REMIND_PRESETS.find((p: any) => p.id === parsed.data.presetId);
        const customDate = parsed.data.customDueAt ? new Date(parsed.data.customDueAt) : null;
        const remindAt = preset
            ? computeRemindDueAt(preset)
            : customDate && !Number.isNaN(customDate.getTime())
              ? rfc3339(customDate)
              : null;
        if (!remindAt) {
            setReminding(null);
            return;
        }
        try {
            await createReminder(targetRelationshipId, {
                text: parsed.data.topic.trim(),
                remindAt,
            });
            setReminding(null);
            onRemindSuccess?.();
        } catch (err) {
            onRemindError?.(err);
        }
    });

    const openReactionTarget = useCallback(
        (index: number) => {
            const messageKey = messages[index]?.key;
            if (!activeKey || !messageKey) return;
            setReactionTarget({ key: activeKey, messageKey });
        },
        [activeKey, messages],
    );

    const selectReaction = useCallback(
        (emoji: string) => {
            const resolved = resolveActionTarget(reactionTarget);
            setReactionTarget(null);
            if (resolved) {
                void bridge.react(resolved.index, emoji);
            }
        },
        [bridge, reactionTarget, resolveActionTarget],
    );

    const confirmPopup = useCallback(() => {
        bridge.resolvePopup(popupRequest?.type === 3 ? popupInput : 1);
    }, [bridge, popupInput, popupRequest]);

    const cancelPopup = useCallback(() => {
        if (!popupRequest) return;
        bridge.resolvePopup(popupRequest.type === 3 ? null : 0);
    }, [bridge, popupRequest]);

    const selectPersonaChoice = useCallback(
        (avatar: string) => {
            bridge.resolvePersonaChoice(avatar);
        },
        [bridge],
    );

    const cancelPersonaChoice = useCallback(() => {
        if (!personaChoice) return;
        bridge.resolvePersonaChoice('');
    }, [bridge, personaChoice]);

    const canRetryNotice =
        Boolean(notice) &&
        !busy &&
        !conflict &&
        !catalogBlocked &&
        !settingsRequired &&
        notice !== '已停止';

    return {
        bridge,
        activeKey,
        status,
        messages,
        busy,
        notice,
        error,
        conflict,
        catalogBlocked,
        settingsRequired,
        popupRequest,
        personaChoice,
        editing,
        setEditing,
        editForm,
        openEditDialog,
        submitEdit,
        removing,
        setRemoving,
        openRemoveDialog,
        confirmRemove,
        reminding,
        setReminding,
        remindForm,
        remindPresetId,
        remindCustomDueAt,
        openRemindDialog,
        submitRemind,
        reactionTarget,
        setReactionTarget,
        openReactionTarget,
        selectReaction,
        popupInput,
        setPopupInput,
        confirmPopup,
        cancelPopup,
        selectPersonaChoice,
        cancelPersonaChoice,
        canRetryNotice,
    };
}
