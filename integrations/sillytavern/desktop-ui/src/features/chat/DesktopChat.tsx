import { useEffect, useRef } from 'react';
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
    error: string;
    conversation: string;
    onDraft(value: string): void;
    onSend(): void;
    onRetry(): void;
}

// 消息与输入由 React 独占。复用已确认皮肤的 class，未加载或搬运 ST 原生消息节点。
export function DesktopChat(p: DesktopChatProps) {
    const transcript = useRef<HTMLDivElement>(null);
    useEffect(() => { if (p.status === 'ready') transcript.current?.lastElementChild?.scrollIntoView({ block: 'end' }); }, [p.conversation, p.status]);
    return <div className="vc-desktop-conversation" data-status={p.status}>
        <div id="chat" ref={transcript} role="log" aria-label="聊天消息" aria-busy={p.status === 'loading'}>
            {p.status === 'loading' && <p className="vc-empty" role="status">正在打开聊天…</p>}
            {p.status === 'error' && <div className="vc-empty" role="alert"><p>{p.error}</p><Button className="vc-btn vc-btn-fill" onClick={p.onRetry}>重试</Button></div>}
            {p.status === 'ready' && p.messages.map((message, index) => <article key={index} className={`mes${!message.is_user && (index === 0 || p.messages[index - 1]?.is_user) ? ' vc-speaker' : ''}`}
                {...{ mesid: index, is_user: String(Boolean(message.is_user)), is_system: String(Boolean(message.is_system)) }}>
                {!message.is_user && <div className="mesAvatarWrapper"><div className="avatar">{p.avatar ? <img src={p.avatar} alt="" /> : <span>{[...(message.name || '')][0]}</span>}</div></div>}
                <div className="mes_block"><div className="ch_name"><span className="name_text">{message.name}</span></div><div className="mes_text">{message.mes}</div></div>
            </article>)}
        </div>
        {p.status === 'ready' && <div id="form_sheld"><form id="send_form" onSubmit={event => { event.preventDefault(); if (p.canSend && p.draft.trim()) p.onSend(); }}>
            <textarea id="send_textarea" aria-label="消息" placeholder="发送消息…" value={p.draft} rows={2} onChange={event => p.onDraft(event.target.value)} />
            <Button id="send_but" type="submit" aria-label="发送" disabled={!p.canSend || !p.draft.trim()}><Icon sprite={p.sprite} name="arrow-up" /></Button>
        </form></div>}
    </div>;
}
