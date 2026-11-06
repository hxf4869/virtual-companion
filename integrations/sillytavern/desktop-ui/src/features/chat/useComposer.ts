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
    quote?: ComposerQuote | null;
    onClearQuote?: () => void;
    onSent?: () => void;
}

export function useComposer({ quote = null, onClearQuote, onSent }: UseComposerOptions = {}) {
    const bridge = useSessionBridge();
    const activeKey = useChatSnapshot(s => s.key);
    const draft = useChatSnapshot(() => bridge.draft.read(activeKey));
    const canSend = useChatSnapshot(s => s.canSend);
    const busy = useChatSnapshot(s => s.busy);
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
    }, [draft, form]);

    const setDraft = useCallback((nextText: string) => {
        const normalized = String(nextText ?? '');
        bridge.draft.write(activeKey, normalized);
        form.setValue('text', normalized, { shouldDirty: true, shouldTouch: true });
    }, [activeKey, bridge, form]);

    const lastMsg = messages.at(-1);
    const canContinue = Boolean(lastMsg && !lastMsg.is_user && !lastMsg.is_system);
    const isNonBlank = composerMessageSchema.safeParse({ text: draft }).success;
    const canSubmit =
        canSend &&
        !busy &&
        Boolean(isNonBlank || (preferences?.continue_on_send && canContinue));

    const submitComposer = useCallback((): boolean => {
        if (!canSubmit || submittingRef.current) return false;

        const rawDraft = bridge.draft.read(activeKey);
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
    }, [activeKey, bridge, canContinue, canSubmit, form, onClearQuote, onSent, preferences?.continue_on_send, quote]);

    const handleFormSubmit = form.handleSubmit(() => {
        submitComposer();
    });

    const continueGeneration = useCallback(() => {
        void bridge.continue();
    }, [bridge]);

    const stopGeneration = useCallback(() => {
        void bridge.stop();
    }, [bridge]);

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
