import { useLayoutEffect, useRef } from 'react';
import type { InboxProps } from './types';
import { Action } from './Parts';
export function InboxConflict({ p }: { p: InboxProps }) {
    return (
        <>
            <p data-tone="warn">这些设置已在另一处更新。你的输入已保留。</p>
            <div className="vc-inbox-actions">
                <Action
                    action="view-latest-policy"
                    run={p.events.action}
                    className="vc-btn vc-btn-text"
                    disabled={p.state.busy}
                >
                    查看最新
                </Action>
                <Action
                    action="keep-policy-draft"
                    run={p.events.action}
                    className="vc-btn vc-btn-fill"
                    disabled={p.state.busy}
                >
                    保留草稿
                </Action>
            </div>
        </>
    );
}
export function InboxReauth({ p }: { p: InboxProps }) {
    const input = useRef<HTMLInputElement>(null),
        error = p.state.policyError || p.state.channelError || '';
    useLayoutEffect(() => {
        if (error && !p.state.busy) input.current?.focus({ preventScroll: true });
    }, [error, p.state.busy]);
    useLayoutEffect(() => {
        const field = input.current;
        return () => {
            if (field) field.value = '';
        };
    }, []);
    return (
        <form
            onSubmit={(event) => {
                event.preventDefault();
                if (p.state.busy) return;
                const password = input.current!.value;
                input.current!.value = '';
                p.events.authenticate(password);
            }}
        >
            <header>
                <h2 id="vc-inbox-reauth-title">重新验证身份</h2>
                <p id="vc-inbox-reauth-description">保存前，请验证当前账号的密码。</p>
            </header>
            <label>
                当前密码
                <input
                    ref={input}
                    type="password"
                    data-field="reauth-password"
                    autoComplete="current-password"
                    spellCheck={false}
                    required
                    autoFocus
                    disabled={p.state.busy}
                />
            </label>
            <p data-reauth-error="" role="alert" hidden={!error}>
                {error}
            </p>
            <div className="vc-reauth-actions">
                <Action
                    action="reauth-cancel"
                    run={p.events.action}
                    className="vc-btn vc-btn-text"
                    disabled={p.state.busy}
                >
                    取消
                </Action>
                <button
                    type="submit"
                    className="vc-btn vc-btn-fill"
                    data-action="reauth-submit"
                    disabled={p.state.busy}
                >
                    {p.state.busy ? '正在验证…' : '验证并继续'}
                </button>
            </div>
        </form>
    );
}
