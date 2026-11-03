import { useEffect, useRef, useState } from 'react';
import { Button } from '@base-ui/react/button';
import { Icon } from '../../components/Icon';

export interface DesktopMessage { name?: string; mes: string; is_user?: boolean; is_system?: boolean }
export interface DesktopChatProps {
    messages: DesktopMessage[];
    status: 'empty' | 'loading' | 'ready' | 'error';
    draft: string;
    sprite: string;
    avatar: string;
    canSend: boolean;
    busy: boolean;
    notice: string;
    conflict: boolean;
    enterToSend: boolean;
    error: string;
    conversation: string;
    onDraft(value: string): void;
    onSend(): void;
    onRetry(): void;
    onStop(): void;
    onNoticeRetry(): void;
    onCopyDraft(): void;
    renderMessage?(node: HTMLElement, index: number, message: DesktopMessage, streaming: boolean): (() => void) | void;
    mountCardActions?(node: HTMLElement): (() => void) | void;
    mountFollow?(node: HTMLElement): { open(): void; sent(): void; update(): void; destroy(): void };
}

function MessageContents({ p, message, index }: { p: DesktopChatProps; message: DesktopMessage; index: number }) {
    const leaf = useRef<HTMLDivElement>(null);
    const streaming = p.busy && index === p.messages.length - 1 && !message.is_user;
    useEffect(() => {
        const node = leaf.current;
        if (!node) return;
        if (p.renderMessage) return p.renderMessage(node, index, message, streaming);
        node.textContent = message.mes;
    }, [p.renderMessage, p.conversation, message, message.mes, streaming, index]);
    return <div ref={leaf} className="mes_text" />;
}

// 消息与输入由 React 独占。复用已确认皮肤的 class，未加载或搬运 ST 原生消息节点。
export function DesktopChat(p: DesktopChatProps) {
    const transcript = useRef<HTMLDivElement>(null);
    const cardActions = useRef<HTMLDivElement>(null);
    const follow = useRef<ReturnType<NonNullable<DesktopChatProps['mountFollow']>>>(null);
    const [typing, setTyping] = useState(false);
    const last = p.messages.at(-1);
    const waiting = p.busy && (!last?.mes || last.is_user || last.is_system);
    useEffect(() => { if (cardActions.current) return p.mountCardActions?.(cardActions.current); }, [p.mountCardActions]);
    useEffect(() => {
        if (!transcript.current) return;
        const controller = p.mountFollow?.(transcript.current); follow.current = controller ?? null;
        return () => { controller?.destroy(); follow.current = null; };
    }, [p.mountFollow]);
    useEffect(() => { if (!waiting) { setTyping(false); return; } const timer = setTimeout(() => setTyping(true), 450); return () => clearTimeout(timer); }, [waiting]);
    useEffect(() => { if (p.status === 'ready') follow.current?.open(); }, [p.conversation, p.status]);
    useEffect(() => { follow.current?.update(); }, [p.messages.length, last?.mes, p.busy]);
    return <div className="vc-desktop-conversation" data-status={p.status}>
        <div id="chat" ref={transcript} role="log" aria-label="聊天消息" aria-busy={p.status === 'loading' || p.busy}>
            {p.status === 'loading' && <p className="vc-empty" role="status">正在打开聊天…</p>}
            {p.status === 'error' && <div className="vc-empty" role="alert"><p>{p.error}</p><Button className="vc-btn vc-btn-fill" onClick={p.onRetry}>重试</Button></div>}
            {p.status === 'ready' && p.messages.map((message, index) => !message.mes && p.busy ? null : <article key={index} className={`mes${!message.is_user && (index === 0 || p.messages[index - 1]?.is_user) ? ' vc-speaker' : ''}`}
                {...{ mesid: index, is_user: String(Boolean(message.is_user)), is_system: String(Boolean(message.is_system)) }}>
                {!message.is_user && <div className="mesAvatarWrapper"><div className="avatar">{p.avatar ? <img src={p.avatar} alt="" /> : <span>{[...(message.name || '')][0]}</span>}</div></div>}
                <div className="mes_block"><div className="ch_name"><span className="name_text">{message.name}</span></div><MessageContents p={p} message={message} index={index} /></div>
            </article>)}
        </div>
        {(p.notice || typing) && <div id="vc-chat-gen" className="vc-glass" role={p.notice && p.notice !== '已停止' ? 'alert' : 'status'} data-vc-typing={typing && !p.notice ? '' : undefined}>
            {p.notice ? <><span>{p.notice}</span>{!p.busy && p.notice !== '已停止' && <Button type="button" className="vc-link" onClick={p.onNoticeRetry}>{p.conflict ? '查看最新' : '重试'}</Button>}
                {p.conflict && <Button type="button" className="vc-link" onClick={p.onCopyDraft}>复制</Button>}</>
                : <>{p.avatar && <img className="vc-gen-avatar" src={p.avatar} alt="" />}<span className="vc-gen-bubble"><span className="vc-gen-dots" aria-hidden="true" /><span>正在输入</span></span></>}
        </div>}
        <div ref={cardActions} className="vc-desktop-card-actions" />
        {p.status === 'ready' && <div id="form_sheld"><form id="send_form" onSubmit={event => { event.preventDefault(); if (p.canSend && p.draft.trim()) { follow.current?.sent(); p.onSend(); } }}>
            <textarea id="send_textarea" aria-label="消息" placeholder="发送消息…" value={p.draft} rows={2} onChange={event => p.onDraft(event.target.value)} onKeyDown={event => {
                if (p.enterToSend && event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing && p.canSend && p.draft.trim()) {
                    event.preventDefault(); follow.current?.sent(); p.onSend();
                }
            }} />
            {p.busy ? <Button key="stop" id="mes_stop" type="button" aria-label="停止" onClick={event => { if (event.detail < 2) p.onStop(); }}><Icon sprite={p.sprite} name="square" /></Button>
                : <Button key="send" id="send_but" type="submit" aria-label="发送" disabled={!p.canSend || !p.draft.trim()}><Icon sprite={p.sprite} name="arrow-up" /></Button>}
        </form></div>}
    </div>;
}
