import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Button } from '@base-ui/react/button';
import { MessageTools, type MessageToolsProps, QuoteBar, type QuoteProps } from './ComposeBits';
import { Icon } from '../../components/Icon';

export interface DesktopMessage { name?: string; mes: string; send_date?: string; gen_started?: number; gen_finished?: number; is_user?: boolean; is_system?: boolean; vc_message_id?: string; swipe_id?: number; swipes?: string[]; extra?: { vc_voice?: {clipId?: string; status?: string; durationMs?: number}; vc_voice_input?: {durationMs: number}; [key: string]: unknown } }
export interface DesktopChatProps {
    messages: DesktopMessage[];
    status: 'empty' | 'loading' | 'ready' | 'error';
    draft: string;
    sprite: string;
    avatar: string;
    canSend: boolean;
    busy: boolean;
    notice: string;
    noticeAction?: string;
    conflict: boolean;
    enterToSend: boolean;
    error: string;
    conversation: string;
    historyAll?: boolean;
    preferences?: { continue_on_send?: boolean; quick_continue?: boolean; timestamps_enabled?: boolean; timer_enabled?: boolean; timestamp_model_icon?: boolean; mesIDDisplay_enabled?: boolean; message_token_count_enabled?: boolean };
    quote?: QuoteProps | null;
    tools?(index: number, message: DesktopMessage): MessageToolsProps;
    onAction?(action: string, index: number, message: DesktopMessage, anchor: HTMLElement): void;
    onPat?(): void;
    onEmoji?(anchor: HTMLElement): void;
    renderMedia?(node: HTMLElement, index: number, message: DesktopMessage): (() => void) | void;
    mountVoiceInput?(node: HTMLElement): { destroy(): void } | undefined;
    onDraft(value: string): void;
    onFormatInput?(event:KeyboardEvent<HTMLTextAreaElement>,node:HTMLTextAreaElement):void;
    onSend(): void;
    onRetry(): void;
    onStop(): void;
    onNoticeRetry(): void;
    onCopyDraft(): void;
    renderMessage?(node: HTMLElement, index: number, message: DesktopMessage, streaming: boolean): (() => void) | void;
    mountCardActions?(node: HTMLElement): (() => void) | void;
    mountFollow?(node: HTMLElement, floating: HTMLElement): { beforeHistory?(): void; open(): void; sent(): void; update(state?: {busy: boolean; lastIndex: number}): void; destroy(): void };
}

function MessageContents({ p, message, index }: { p: DesktopChatProps; message: DesktopMessage; index: number }) {
    const leaf = useRef<HTMLDivElement>(null);
    const streaming = p.busy && index === p.messages.length - 1 && !message.is_user;
    useEffect(() => {
        const node = leaf.current;
        if (!node) return;
        if (p.renderMessage) return p.renderMessage(node, index, message, streaming);
        const text = node.ownerDocument.createElement('div'); text.className = 'mes_text'; text.textContent = message.mes; node.replaceChildren(text);
    }, [p.renderMessage, p.conversation, message, message.mes, streaming, index, message.swipe_id]);
    const voice = message.extra?.vc_voice;
    return <div ref={leaf} className="vc-desktop-message-content" aria-hidden={message.extra?.vc_voice_input || (voice && ['queued', 'running', 'ready'].includes(voice.status || '')) ? true : undefined} />;
}

function MediaContents({p, message, index}: {p: DesktopChatProps; message: DesktopMessage; index: number}) {
    const leaf = useRef<HTMLDivElement>(null), extra = message.extra, voice = extra?.vc_voice;
    const revision = JSON.stringify([voice?.clipId, voice?.status, voice?.durationMs, extra?.vc_voice_input, extra?.vc_sticker, extra?.media, extra?.image, extra?.title]);
    useEffect(() => { if (leaf.current) return p.renderMedia?.(leaf.current, index, message); }, [p.renderMedia, p.conversation, index, message, message.mes, revision]);
    return <div ref={leaf} className="vc-mes-media" />;
}

function messageInfo(p:DesktopChatProps,message:DesktopMessage,index:number) {
    const prefs=p.preferences,values:string[]=[];
    if(prefs?.timestamps_enabled&&message.send_date)values.push(Number.isFinite(Date.parse(message.send_date))?new Date(message.send_date).toLocaleString():message.send_date);
    if(prefs?.mesIDDisplay_enabled)values.push('#'+index);
    if(prefs?.timer_enabled&&typeof message.gen_started==='number'&&typeof message.gen_finished==='number')values.push(((message.gen_finished-message.gen_started)/1000).toFixed(1)+'s');
    if(prefs?.message_token_count_enabled&&typeof message.extra?.token_count==='number')values.push(message.extra.token_count+' tokens');
    if(prefs?.timestamp_model_icon&&typeof message.extra?.model==='string')values.push(message.extra.model);
    return values.join(' · ');
}

// 消息与输入由 React 独占。复用已确认皮肤的 class，未加载或搬运 ST 原生消息节点。
export function DesktopChat(p: DesktopChatProps) {
    const transcript = useRef<HTMLDivElement>(null);
    const floating = useRef<HTMLDivElement>(null), voiceInput = useRef<HTMLDivElement>(null);
    const [history, setHistory] = useState({ key: '', start: 0 });
    const start = p.historyAll ? 0 : history.key === p.conversation ? history.start : Math.max(0, p.messages.length - 80);
    const cardActions = useRef<HTMLDivElement>(null);
    const follow = useRef<ReturnType<NonNullable<DesktopChatProps['mountFollow']>>>(null);
    const [typing, setTyping] = useState(false);
    const last = p.messages.at(-1);
    const canContinue=Boolean(last&&!last.is_user&&!last.is_system),canSubmit=p.canSend&&Boolean(p.draft.trim()||p.preferences?.continue_on_send&&canContinue);
    const waiting = p.busy && (!last?.mes || last.is_user || last.is_system);
    useEffect(() => { if (voiceInput.current) { const controller = p.mountVoiceInput?.(voiceInput.current); return () => controller?.destroy(); } }, [p.mountVoiceInput, p.status]);
    useEffect(() => { if (cardActions.current) return p.mountCardActions?.(cardActions.current); }, [p.mountCardActions]);
    useEffect(() => {
        if (!transcript.current || !floating.current) return;
        const controller = p.mountFollow?.(transcript.current, floating.current); follow.current = controller ?? null;
        return () => { controller?.destroy(); follow.current = null; };
    }, [p.mountFollow]);
    useEffect(() => { if (!waiting) { setTyping(false); return; } const timer = setTimeout(() => setTyping(true), 450); return () => clearTimeout(timer); }, [waiting]);
    useEffect(() => { if (p.status === 'ready') follow.current?.open(); }, [p.conversation, p.status]);
    useEffect(() => { follow.current?.update({busy: p.busy, lastIndex: p.messages.length - 1}); }, [p.messages.length, last?.mes, p.busy]);
    return <div className="vc-desktop-conversation" data-status={p.status}>
        <div id="chat" ref={transcript} tabIndex={0} role="log" aria-label="聊天消息" aria-busy={p.status === 'loading' || p.busy}>
            {p.status === 'loading' && <p className="vc-empty" role="status">正在打开聊天…</p>}
            {p.status === 'error' && <div className="vc-empty" role="alert"><p>{p.error}</p><Button className="vc-btn vc-btn-fill" onClick={p.onRetry}>重试</Button></div>}
            {p.status === 'ready' && start > 0 && <Button className="vc-btn vc-link" onClick={() => { follow.current?.beforeHistory?.(); setHistory({key: p.conversation, start: Math.max(0, start - 80)}); }}>显示更早的消息</Button>}
            {p.status === 'ready' && p.messages.slice(start).map((message, offset) => { const index = start + offset; return !message.mes && p.busy ? null : <article key={message.vc_message_id || index} tabIndex={0} onContextMenu={event => {event.preventDefault(); p.onAction?.('more', index, message, event.currentTarget);}} onKeyDown={event => {if(event.key === 'F10' && event.shiftKey) {event.preventDefault();p.onAction?.('more', index, message, event.currentTarget);}}} title={messageInfo(p,message,index)||undefined} className={`mes${!message.is_user && (index === 0 || p.messages[index - 1]?.is_user) ? ' vc-speaker' : ''}`}
                {...{ mesid: index, is_user: String(Boolean(message.is_user)), is_system: String(Boolean(message.is_system)) }}>
                {!message.is_user && <div className="mesAvatarWrapper"><div className="avatar" onDoubleClick={() => { if (!p.busy) p.onPat?.(); }}>{p.avatar ? <img src={p.avatar} alt="" /> : <span>{[...(message.name || '')][0]}</span>}</div>{p.preferences?.timestamp_model_icon&&typeof message.extra?.model==='string'&&<span className="vc-message-model-icon" title={message.extra.model}><Icon sprite={p.sprite} name="cpu" size={12}/></span>}</div>}
                <div className="mes_block"><div className="ch_name"><span className="name_text">{message.name}</span></div><MessageContents p={p} message={message} index={index} /><MediaContents p={p} message={message} index={index} />{Array.isArray(message.extra?.vc_reactions) && <span className="vc-react-badge">{message.extra.vc_reactions.join('')}</span>}
                    <small className="vc-message-metadata">{messageInfo(p,message,index)}</small>
                </div>{p.tools && <div className="vc-mes-tools" onClick={event => { const button = (event.target as HTMLElement).closest<HTMLElement>('[data-vc-act]'); if(button)p.onAction?.(button.dataset.vcAct!, index, message, button); }}><MessageTools {...p.tools(index, message)} /><Button type="button" data-vc-act="more" aria-label="消息操作"><Icon sprite={p.sprite} name="ellipsis" size={18} /></Button></div>}
            </article>; })}
        </div>
        <div ref={floating} className="vc-chat-floating" />
        {(p.notice || typing) && <div id="vc-chat-gen" className="vc-glass" role={p.notice && p.notice !== '已停止' ? 'alert' : 'status'} data-vc-typing={typing && !p.notice ? '' : undefined}>
            {p.notice ? <><span>{p.notice}</span>{!p.busy && p.notice !== '已停止' && <Button type="button" className="vc-link" onClick={p.onNoticeRetry}>{p.conflict ? '查看最新' : p.noticeAction || '重试'}</Button>}
                {p.conflict && <Button type="button" className="vc-link" onClick={p.onCopyDraft}>复制</Button>}</>
                : <>{p.avatar && <img className="vc-gen-avatar" src={p.avatar} alt="" />}<span className="vc-gen-bubble"><span className="vc-gen-dots" aria-hidden="true" /><span>正在输入</span></span></>}
        </div>}
        <div ref={cardActions} className="vc-desktop-card-actions" />
        {p.status === 'ready' && <div id="form_sheld">{p.preferences?.quick_continue&&canContinue&&<Button type="button" className="vc-link vc-quick-continue" disabled={!p.canSend} onClick={event=>p.onAction?.('continue',p.messages.length-1,last!,event.currentTarget)}>继续</Button>}{p.quote && <div id="vc-quote-bar"><QuoteBar {...p.quote} /></div>}<form id="send_form" onSubmit={event => { event.preventDefault(); if (canSubmit) { follow.current?.sent(); p.onSend(); } }}>
            <textarea id="send_textarea" aria-label="消息" placeholder="发送消息…" value={p.draft} rows={2} onChange={event => p.onDraft(event.target.value)} onKeyDown={event => {
                p.onFormatInput?.(event,event.currentTarget);
                if (p.enterToSend && event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing && canSubmit) {
                    event.preventDefault(); follow.current?.sent(); p.onSend();
                }
            }} />
            <div ref={voiceInput} className="vc-voice-input-slot" />
            {p.onEmoji && <Button type="button" id="vc-emoji-btn" aria-label="表情" aria-haspopup="dialog" onClick={event => p.onEmoji?.(event.currentTarget)}><Icon sprite={p.sprite} name="smile" size={20} /></Button>}
            {p.busy ? <Button key="stop" id="mes_stop" type="button" aria-label="停止" onClick={event => { if (event.detail < 2) p.onStop(); }}><Icon sprite={p.sprite} name="square" /></Button>
                : <Button key="send" id="send_but" type="submit" aria-label="发送" disabled={!canSubmit}><Icon sprite={p.sprite} name="arrow-up" /></Button>}
        </form></div>}
    </div>;
}
