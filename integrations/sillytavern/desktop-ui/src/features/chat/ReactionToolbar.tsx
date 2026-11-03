import { Toolbar } from '@base-ui/react/toolbar';

export interface ReactionToolbarProps {
    reactions: readonly { emoji: string; label: string }[];
    selected: string[];
}
export function ReactionToolbar(p: ReactionToolbarProps) {
    return (
        <Toolbar.Root aria-label="消息回应" style={{ display: 'contents' }}>
            {p.reactions.map((item) => (
                <Toolbar.Button
                    key={item.emoji}
                    type="button"
                    data-emoji={item.emoji}
                    aria-label={item.label}
                    aria-pressed={p.selected.includes(item.emoji)}
                >
                    {item.emoji}
                </Toolbar.Button>
            ))}
            <Toolbar.Button type="button" className="vc-react-more" data-more="" aria-label="更多">
                <svg
                    className="vc-icon"
                    width="18"
                    height="18"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    aria-hidden="true"
                >
                    <path d="M12 5v14M5 12h14" />
                </svg>
            </Toolbar.Button>
        </Toolbar.Root>
    );
}
