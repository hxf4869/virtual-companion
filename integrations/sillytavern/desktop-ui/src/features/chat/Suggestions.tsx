import type { CSSProperties } from 'react';
import { Button } from '@base-ui/react/button';
export function Suggestions(p: { items: string[]; pick(text: string): void }) {
    return (
        <>
            {p.items.map((text, index) => (
                <Button
                    key={index}
                    type="button"
                    className="vc-suggest-chip"
                    style={{ '--i': index } as CSSProperties}
                    onClick={() => p.pick(text)}
                >
                    {text}
                </Button>
            ))}
        </>
    );
}
