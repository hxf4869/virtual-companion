import { useCallback, useEffect, useRef } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { withQuote } from '../../../../extension/vc-model-settings/chat-logic.js';
import { useChatSnapshot, useSessionBridge } from '../../runtime/session-bridge';

export const composerMessageSchema = z.object({
    text: z.string().refine(val => val.trim().length > 0, {
        message: '请输入消息内容',
    }),
});

export type ComposerFormValues = z.infer<typeof composerMessageSchema>;

export interface ComposerQuote {
    name?: string;
    text: string;
}

export interface UseComposerOptions {
    conversationKey?: string;
    quote?: ComposerQuote | null;
    onClearQuote?: () => void;
    onSent?: () => void;
}

export function useComposer({
    conversationKey,
    quote = null,
    onClearQuote,
    onSent,
}: UseComposerOptions = {}) {
    const bridge = useSessionBridge();
    const activeKey = useChatSnapshot(s => s.key);
    const status = useChatSnapshot(s => s.status);
    const targetKey = conversationKey !== undefined ? conversationKey : activeKey;
    const isTargetLive =
        conversationKey === undefined ||
        (activeKey === conversationKey && status === 'ready');
    const draft = useChatSnapshot(() => bridge.draft.read(targetKey));
    const snapshotCanSend = useChatSnapshot(s => s.canSend);
    const snapshotBusy = useChatSnapshot(s => s.busy);
    const canSend = isTargetLive && snapshotCanSend;
    const busy =
        (conversationKey === undefined || activeKey === conversationKey) && snapshotBusy;
    const enterToSend = useChatSnapshot(s => s.enterToSend);
    const preferences = useChatSnapshot(s => s.preferences);
    const messages = useChatSnapshot(s => s.messages);

    const submittingRef = useRef(false);

    const form = useForm<ComposerFormValues>({
        defaultValues: { text: draft },
    });

    useEffect(() => {
        if (form.getValues('text') !== draft) {
            form.setValue('text', draft, { shouldDirty: false, shouldTouch: false });
        }
    }, [targetKey, draft, form]);

    const setDraft = useCallback((nextText: string) => {
        const normalized = String(nextText ?? '');
        bridge.draft.write(targetKey, normalized);
        form.setValue('text', normalized, { shouldDirty: true, shouldTouch: true });
    }, [targetKey, bridge, form]);

    const lastMsg = messages.at(-1);
    const canContinue =
        isTargetLive && Boolean(lastMsg && !lastMsg.is_user && !lastMsg.is_system);
    const isNonBlank = composerMessageSchema.safeParse({ text: draft }).success;
    const canSubmit =
        canSend &&
        !busy &&
        Boolean(isNonBlank || (preferences?.continue_on_send && canContinue));

    const submitComposer = useCallback((): boolean => {
        if (!canSubmit || submittingRef.current) return false;

        const rawDraft = bridge.draft.read(targetKey);
        const parsed = composerMessageSchema.safeParse({ text: rawDraft });

        if (!parsed.success) {
            if (preferences?.continue_on_send && canContinue) {
                submittingRef.current = true;
                onSent?.();
                void bridge.send('', { type: 'continue' }).finally(() => {
                    submittingRef.current = false;
                });
                return true;
            }
            form.setError('text', {
                type: 'zod',
                message: parsed.error.issues[0]?.message || '请输入消息内容',
            });
            return false;
        }

        submittingRef.current = true;
        form.clearErrors('text');
        onSent?.();

        const rawUserText = parsed.data.text;
        const payload = quote ? withQuote(quote, rawUserText) : rawUserText;
        if (quote) {
            onClearQuote?.();
        }
        void bridge.send(payload, { draftInput: rawUserText }).finally(() => {
            submittingRef.current = false;
        });
        return true;
    }, [targetKey, bridge, canContinue, canSubmit, form, onClearQuote, onSent, preferences?.continue_on_send, quote]);

    const handleFormSubmit = form.handleSubmit(() => {
        submitComposer();
    });

    const continueGeneration = useCallback(() => {
        if (!isTargetLive) return;
        void bridge.continue();
    }, [bridge, isTargetLive]);

    const stopGeneration = useCallback(() => {
        if (conversationKey !== undefined && activeKey !== conversationKey) return;
        void bridge.stop();
    }, [activeKey, bridge, conversationKey]);

    return {
        bridge,
        activeKey,
        draft,
        canSend,
        busy,
        enterToSend,
        preferences,
        messages,
        canContinue,
        isNonBlank,
        canSubmit,
        form,
        setDraft,
        submitComposer,
        handleFormSubmit,
        continueGeneration,
        stopGeneration,
    };
}
