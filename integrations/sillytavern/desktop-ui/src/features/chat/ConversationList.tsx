import { Avatar } from '../../design/components/Avatar';
import { IconButton } from '../../design/components/IconButton';
import { type ConversationRow } from '../../data/queries/chat';
import { useChatSnapshot, useSessionBridge } from '../../runtime/session-bridge';

export interface ConversationListProps {
    rows: readonly ConversationRow[];
    activeKey: string | null;
    onSelectConversation: (row: ConversationRow) => void;
    onOpenQuickSwitch?: () => void;
}

export function ConversationList({
    rows,
    activeKey,
    onSelectConversation,
    onOpenQuickSwitch,
}: ConversationListProps) {
    const bridge = useSessionBridge();
    // Subscribe to bridge so draft updates re-render draft previews
    useChatSnapshot(() => bridge.draft.read(activeKey ?? ''));

    return (
        <>
            <header className="vc-convo-head">
                <h2 className="vc-convo-title">会话</h2>
                <IconButton
                    icon="search"
                    size={36}
                    iconSize={18}
                    className="vc-icon-btn"
                    data-quick-switch-trigger=""
                    aria-label="搜索会话 (⌘K)"
                    title="搜索会话 (⌘K)"
                    onClick={onOpenQuickSwitch}
                />
            </header>
            <div className="vc-convo-items">
                {rows.map(item => {
                    const isActive = item.key === activeKey;
                    const draft = bridge.draft.read(item.key);
                    const previewText = draft ? `[草稿] ${draft}` : item.preview;

                    return (
                        <button
                            key={item.key}
                            type="button"
                            className={['vc-convo-row', isActive ? 'is-active' : '']
                                .filter(Boolean)
                                .join(' ')}
                            aria-current={isActive ? 'true' : undefined}
                            data-conversation-key={item.key}
                            data-relationship-id={item.relationshipId || undefined}
                            onClick={() => {
                                onSelectConversation(item);
                            }}
                        >
                            <Avatar
                                src={item.avatarUrl || item.avatar}
                                name={item.title || '伴'}
                                size={40}
                            />
                            <span className="vc-convo-meta">
                                <span className="vc-convo-name">
                                    {item.title}
                                    {item.instanceName ? (
                                        <small className="vc-convo-sub">
                                            {` · ${item.instanceName}`}
                                        </small>
                                    ) : null}
                                </span>
                                {previewText ? (
                                    <span
                                        className={[
                                            'vc-convo-preview',
                                            draft ? 'is-draft' : '',
                                        ]
                                            .filter(Boolean)
                                            .join(' ')}
                                    >
                                        {previewText}
                                    </span>
                                ) : null}
                            </span>
                            {item.timeText ? (
                                <span className="vc-convo-time">{item.timeText}</span>
                            ) : null}
                        </button>
                    );
                })}
            </div>
        </>
    );
}
