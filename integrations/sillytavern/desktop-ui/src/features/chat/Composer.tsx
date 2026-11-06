import { useRef, useState } from 'react';
import {
    COPY,
    quoteSummary,
} from '../../../../extension/vc-model-settings/chat-logic.js';
import { applyInputMarkdown } from '../../../../extension/vc-model-settings/desktop/standalone/input-markdown.js';
import { Icon } from '../../design/components/Icon';
import { EmojiPicker } from './EmojiPicker';
import { VoiceRecorder } from './VoiceRecorder';
import {
    composerMessageSchema,
    useComposer,
    type ComposerFormValues,
    type ComposerQuote,
    type UseComposerOptions,
} from './useComposer';

export {
    composerMessageSchema,
    useComposer,
    type ComposerFormValues,
    type ComposerQuote,
    type UseComposerOptions,
};

export interface ComposerProps {
    quote?: ComposerQuote | null;
    onClearQuote?: () => void;
    onSent?: () => void;
}

export function Composer({ quote = null, onClearQuote, onSent }: ComposerProps) {
    const {
        draft,
        canSend,
        busy,
        enterToSend,
        preferences,
        canContinue,
        canSubmit,
        form,
        setDraft,
        submitComposer,
        handleFormSubmit,
        continueGeneration,
        stopGeneration,
    } = useComposer({ quote, onClearQuote, onSent });

    const [voiceAvailable, setVoiceAvailable] = useState(false);
    const textareaRef = useRef<HTMLTextAreaElement | null>(null);

    const { ref: registerRef, ...registerField } = form.register('text', {
        onChange: e => {
            setDraft(String(e.target.value ?? ''));
        },
    });

    return (
        <div id="form_sheld">
            {preferences?.quick_continue && canContinue ? (
                <button
                    type="button"
                    className="vc-link vc-quick-continue"
                    disabled={!canSend || busy}
                    onClick={continueGeneration}
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
                                stopGeneration();
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
