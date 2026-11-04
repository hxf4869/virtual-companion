import React, { useMemo, useState, type CSSProperties } from 'react';
import { Popover as BasePopover } from '@base-ui/react/popover';
import { statusViewModel } from '../../../../extension/vc-model-settings/status-logic.js';
import { PortalNestedScope, usePortalContainer } from '../../design/portal-host';
import { Avatar } from '../../design/components/Avatar';
import { Button } from '../../design/components/Button';
import { useCompanionStateQuery, useRelationshipsQuery } from '../../data/queries/chat';
import { useChatSnapshot, useSessionBridge } from '../../runtime/session-bridge';

export interface ChatStatusCardProps {
    trigger: React.ReactElement;
    onOpenMemory?: () => void;
}

export function ChatStatusCard({ trigger, onOpenMemory }: ChatStatusCardProps) {
    const bridge = useSessionBridge();
    const relationshipId = useChatSnapshot(s => s.relationshipId);
    const characterName = useChatSnapshot(s => s.characterName);
    const avatarUrl = useChatSnapshot(s => s.avatarUrl);
    const portalContainer = usePortalContainer();

    const [open, setOpen] = useState(false);

    const relationshipsQuery = useRelationshipsQuery();
    const companionStateQuery = useCompanionStateQuery(relationshipId);

    const relationship = useMemo(() => {
        if (!relationshipId || !Array.isArray(relationshipsQuery.data)) return null;
        return (
            relationshipsQuery.data.find(
                (r: any) => String(r.relationshipId) === String(relationshipId),
            ) ?? null
        );
    }, [relationshipId, relationshipsQuery.data]);

    const model = useMemo(
        () =>
            statusViewModel({
                name: characterName || '角色',
                avatar: avatarUrl,
                relationship,
                state: companionStateQuery.data,
            }),
        [avatarUrl, characterName, companionStateQuery.data, relationship],
    );

    if (!relationshipId) {
        return trigger;
    }

    return (
        <BasePopover.Root open={open} onOpenChange={setOpen}>
            <BasePopover.Trigger
                render={trigger as React.ReactElement<Record<string, unknown>>}
            />
            <BasePopover.Portal container={portalContainer}>
                <PortalNestedScope>
                    <BasePopover.Positioner side="bottom" align="start" sideOffset={8} className="vc-popover__positioner">
                        <BasePopover.Popup
                            id="vc-status-card"
                            className="vc-popover vc-glass vc-status-card"
                            aria-label={`${model.name}状态卡`}
                        >
                            <div className="vc-sc-head">
                                <Avatar src={model.avatar} name={model.name} size={44} />
                                <div>
                                    <b>{model.name}</b>
                                    {model.instance ? <small>{model.instance}</small> : null}
                                </div>
                            </div>

                            {model.mood ? (
                                <div className="vc-sc-mood">
                                    <p className="vc-sc-title">{model.mood}</p>
                                    {model.line ? <p className="vc-sc-sub">{model.line}</p> : null}
                                </div>
                            ) : null}

                            {model.activity ? (
                                <div className="vc-sc-doing">
                                    <p className="vc-sc-label">在做什么</p>
                                    <p className="vc-sc-text">{model.activity}</p>
                                </div>
                            ) : null}

                            {model.bars.length > 0 ? (
                                <div className="vc-sc-bars">
                                    {model.bars.map((bar: { label: string; value: number }) => (
                                        <div key={bar.label} className="vc-sc-bar">
                                            <span>{bar.label}</span>
                                            <i
                                                role="progressbar"
                                                aria-label={bar.label}
                                                aria-valuemin={0}
                                                aria-valuemax={100}
                                                aria-valuenow={bar.value}
                                            >
                                                <b style={{ '--v': bar.value } as CSSProperties} />
                                            </i>
                                        </div>
                                    ))}
                                </div>
                            ) : null}

                            {model.day ? (
                                <div className="vc-sc-days">
                                    <p className="vc-sc-title">{model.day}</p>
                                    {model.next ? <p className="vc-sc-next">{model.next}</p> : null}
                                </div>
                            ) : null}

                            <div className="vc-sc-actions">
                                <Button
                                    type="button"
                                    variant="gray"
                                    className="vc-sc-action"
                                    onClick={() => {
                                        setOpen(false);
                                        void bridge.pat();
                                    }}
                                >
                                    拍一拍
                                </Button>
                                <Button
                                    type="button"
                                    variant="gray"
                                    className="vc-sc-action"
                                    onClick={() => {
                                        setOpen(false);
                                        onOpenMemory?.();
                                    }}
                                >
                                    查看记忆
                                </Button>
                            </div>
                        </BasePopover.Popup>
                    </BasePopover.Positioner>
                </PortalNestedScope>
            </BasePopover.Portal>
        </BasePopover.Root>
    );
}
