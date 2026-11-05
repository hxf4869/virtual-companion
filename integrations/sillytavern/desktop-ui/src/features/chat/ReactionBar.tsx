import { Toolbar } from '@base-ui/react/toolbar';
import { REACTIONS } from '../../../../extension/vc-model-settings/chat-logic.js';
import { Icon } from '../../design/components/Icon';

export interface ReactionBarProps {
    selected: readonly string[];
    onSelectEmoji: (emoji: string) => void;
    onOpenMore: () => void;
}

export function ReactionBar({ selected, onSelectEmoji, onOpenMore }: ReactionBarProps) {
    return (
        <div id="vc-react-bar" className="vc-glass vc-react-bar">
            <Toolbar.Root aria-label="消息回应" style={{ display: 'contents' }}>
                {REACTIONS.map((item: { emoji: string; label: string }) => (
                    <Toolbar.Button
                        key={item.emoji}
                        type="button"
                        className="vc-react-btn"
                        data-emoji={item.emoji}
                        aria-label={item.label}
                        aria-pressed={selected.includes(item.emoji)}
                        onClick={() => onSelectEmoji(item.emoji)}
                    >
                        {item.emoji}
                    </Toolbar.Button>
                ))}
                <Toolbar.Button
                    type="button"
                    className="vc-react-btn vc-react-more"
                    data-more=""
                    aria-label="更多"
                    onClick={onOpenMore}
                >
                    <Icon name="plus" size={18} />
                </Toolbar.Button>
            </Toolbar.Root>
        </div>
    );
}
