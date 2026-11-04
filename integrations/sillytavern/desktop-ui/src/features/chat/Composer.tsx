import { useEffect, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import {
    COPY,
    quoteSummary,
    withQuote,
} from '../../../../extension/vc-model-settings/chat-logic.js';
import { applyInputMarkdown } from '../../../../extension/vc-model-settings/desktop/standalone/input-markdown.js';
import { Icon } from '../../design/components/Icon';
import { useChatSnapshot, useSessionBridge } from '../../runtime/session-bridge';
import { EmojiPicker } from './EmojiPicker';
import { VoiceRecorder } from './VoiceRecorder';

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

export interface ComposerProps {
    quote?: ComposerQuote | null;
    onClearQuote?: () => void;
    onSent?: () => void;
}

export function Composer({ quote = null, onClearQuote, onSent }: ComposerProps) {
    const bridge = useSessionBridge();
    const activeKey = useChatSnapshot(s => s.key);
    const draft = useChatSnapshot(() => bridge.draft.read(activeKey));
    const canSend = useChatSnapshot(s => s.canSend);
    const busy = useChatSnapshot(s => s.busy);
    const enterToSend = useChatSnapshot(s => s.enterToSend);
    const preferences = useChatSnapshot(s => s.preferences);
    const messages = useChatSnapshot(s => s.messages);

    const [voiceAvailable, setVoiceAvailable] = useState(false);
    const textareaRef = useRef<HTMLTextAreaElement | null>(null);
    const submittingRef = useRef(false);

    const form = useForm<ComposerFormValues>({
        defaultValues: { text: draft },
    });

    useEffect(() => {
        if (form.getValues('text') !== draft) {
            form.setValue('text', draft, { shouldDirty: false, shouldTouch: false });
        }
    }, [draft, form]);

    const { ref: registerRef, ...registerField } = form.register('text', {
        onChange: e => {
            bridge.draft.write(activeKey, String(e.target.value ?? ''));
        },
    });

    const lastMsg = messages.at(-1);
    const canContinue = Boolean(lastMsg && !lastMsg.is_user && !lastMsg.is_system);
    const isNonBlank = composerMessageSchema.safeParse({ text: draft }).success;
    const canSubmit =
        canSend &&
        !busy &&
        Boolean(isNonBlank || (preferences?.continue_on_send && canContinue));

    const submitComposer = () => {
        if (!canSubmit || submittingRef.current) return;

        const rawDraft = bridge.draft.read(activeKey);
        const parsed = composerMessageSchema.safeParse({ text: rawDraft });

        if (!parsed.success) {
            if (preferences?.continue_on_send && canContinue) {
                submittingRef.current = true;
                onSent?.();
                void bridge.send('', { type: 'continue' }).finally(() => {
                    submittingRef.current = false;
                });
                return;
            }
            form.setError('text', {
                type: 'zod',
                message: parsed.error.issues[0]?.message || '请输入消息内容',
            });
            return;
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
    };

    const handleFormSubmit = form.handleSubmit(() => {
        submitComposer();
    });

    return (
        <div id="form_sheld">
            {preferences?.quick_continue && canContinue ? (
                <button
                    type="button"
                    className="vc-link vc-quick-continue"
                    disabled={!canSend || busy}
                    onClick={() => {
                        void bridge.continue();
                    }}
                >
                    继续
                </button>
            ) : null}

            {quote ? (
                <div id="vc-quote-bar">
                    <span className="vc-quote-label">{COPY.quote}</span>
                    <span className="vc-quote-text">
                        {`${quote.name ? `${quote.name}：` : ''}${quoteSummary(quote.text)}`}
                    </span>
                    <button
                        type="button"
                        className="vc-quote-close"
                        aria-label="关闭引用"
                        onClick={() => {
                            onClearQuote?.();
                            textareaRef.current?.focus();
                        }}
                    >
                        <Icon name="close" size={16} />
                    </button>
                </div>
            ) : null}

            <form
                id="send_form"
                className={voiceAvailable ? 'vc-voice-input-available' : undefined}
                onSubmit={e => {
                    void handleFormSubmit(e);
                }}
            >
                <textarea
                    {...registerField}
                    ref={node => {
                        registerRef(node);
                        textareaRef.current = node;
                    }}
                    id="send_textarea"
                    aria-label="消息"
                    placeholder="发送消息…"
                    value={draft}
                    rows={2}
                    onKeyDown={e => {
                        if (preferences?.enable_md_hotkeys) {
                            applyInputMarkdown(e, e.currentTarget);
                        }
                        const isComposing =
                            e.nativeEvent.isComposing || (e as any).isComposing || e.keyCode === 229;
                        if (enterToSend && e.key === 'Enter' && !e.shiftKey && !isComposing) {
                            e.preventDefault();
                            submitComposer();
                        }
                    }}
                />
                <VoiceRecorder onAvailableChange={setVoiceAvailable} />
                <EmojiPicker mode="compose" />
                {busy ? (
                    <button
                        key="stop"
                        id="mes_stop"
                        type="button"
                        aria-label="停止"
                        onClick={e => {
                            if (e.detail < 2) {
                                void bridge.stop();
                            }
                        }}
                    >
                        <Icon name="stop" size={18} />
                    </button>
                ) : (
                    <button
                        key="send"
                        id="send_but"
                        type="submit"
                        aria-label="发送"
                        disabled={!canSubmit}
                    >
                        <Icon name="send" size={18} />
                    </button>
                )}
            </form>
        </div>
    );
}
