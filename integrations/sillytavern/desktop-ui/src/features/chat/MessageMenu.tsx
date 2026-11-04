import React from 'react';
import { Menu as BaseMenu } from '@base-ui/react/menu';
import { COPY, messageMenuPlan } from '../../../../extension/vc-model-settings/chat-logic.js';
import { chatVoiceAvailable } from '../../../../extension/vc-model-settings/voice-logic.js';
import { PortalNestedScope, usePortalContainer } from '../../design/portal-host';
import { Icon } from '../../design/components/Icon';
import '../../design/components/Menu.css';
import { useChatSnapshot, useSessionBridge, type ChatMessage } from '../../runtime/session-bridge';
import { ReactionBar } from './ReactionBar';

export interface MessageMenuProps {
    message: ChatMessage;
    index: number;
    isLast: boolean;
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onAction: (action: string, anchor: HTMLElement | null) => void;
    onOpenReactionPicker: (anchor: HTMLElement | null) => void;
    triggerRef?: React.RefObject<HTMLButtonElement | null>;
}

export function MessageMenu({
    message,
    index,
    isLast,
    open,
    onOpenChange,
    onAction,
    onOpenReactionPicker,
    triggerRef,
}: MessageMenuProps) {
    const bridge = useSessionBridge();
    const busy = useChatSnapshot(s => s.busy);
    const canSend = useChatSnapshot(s => s.canSend);
    const relationshipId = useChatSnapshot(s => s.relationshipId);
    const portalContainer = usePortalContainer();

    const isCharacter = !message.is_user && !message.is_system;
    const voiceEnabled =
        isCharacter &&
        (!busy || !isLast) &&
        chatVoiceAvailable(bridge.getContext());

    const plan = messageMenuPlan({
        system: message.is_system,
        character: isCharacter,
        last: isLast,
        voice: voiceEnabled,
        busy,
        bound: Boolean(relationshipId),
    });

    if (isCharacter && isLast && !busy) {
        const regenIdx = plan.indexOf('regenerate');
        if (regenIdx >= 0) {
            plan.splice(regenIdx + 1, 0, 'continue');
        } else {
            plan.push('continue');
        }
    }

    const selectedReactions: readonly string[] = Array.isArray(message.extra?.vc_reactions)
        ? message.extra.vc_reactions
        : [];

    return (
        <BaseMenu.Root open={open} onOpenChange={onOpenChange}>
            <BaseMenu.Trigger
                ref={triggerRef}
                type="button"
                data-vc-act="more"
                aria-label="消息操作"
            >
                <Icon name="ellipsis" size={18} />
            </BaseMenu.Trigger>
            <BaseMenu.Portal container={portalContainer}>
                <PortalNestedScope>
                    <BaseMenu.Positioner align="end" sideOffset={6} className="vc-menu__positioner">
                        <BaseMenu.Popup className="vc-menu vc-compose-menu">
                            {!message.is_system && canSend ? (
                                <ReactionBar
                                    selected={selectedReactions}
                                    onSelectEmoji={emoji => {
                                        onOpenChange(false);
                                        void bridge.react(index, emoji);
                                    }}
                                    onOpenMore={() => {
                                        onOpenChange(false);
                                        onOpenReactionPicker(triggerRef?.current ?? null);
                                    }}
                                />
                            ) : null}
                            {plan.map((itemId: string, idx: number) =>
                                itemId === '-' ? (
                                    <BaseMenu.Separator
                                        key={`sep-${idx}`}
                                        className="vc-menu__separator"
                                    />
                                ) : (
                                    <BaseMenu.Item
                                        key={itemId}
                                        className={[
                                            'vc-menu__item',
                                            itemId === 'remove' ? 'vc-menu__item--danger' : '',
                                        ]
                                            .filter(Boolean)
                                            .join(' ')}
                                        onClick={() => {
                                            onOpenChange(false);
                                            onAction(itemId, triggerRef?.current ?? null);
                                        }}
                                    >
                                        <span className="vc-menu__item-label">
                                            {(COPY as Record<string, string>)[itemId] ?? itemId}
                                        </span>
                                    </BaseMenu.Item>
                                ),
                            )}
                        </BaseMenu.Popup>
                    </BaseMenu.Positioner>
                </PortalNestedScope>
            </BaseMenu.Portal>
        </BaseMenu.Root>
    );
}
