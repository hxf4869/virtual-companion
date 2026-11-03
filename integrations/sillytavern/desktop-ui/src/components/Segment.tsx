import { RadioGroup } from '@base-ui/react/radio-group';
import { Radio } from '@base-ui/react/radio';

interface SegmentProps<T extends string> extends Omit<RadioGroup.Props, 'value' | 'defaultValue' | 'onValueChange' | 'children' | 'className'> {
    className?: string;
    label: string;
    preference: string;
    value: T;
    options: readonly { value: T; label: string }[];
    onValueChange: (value: T) => void;
}

export function Segment<T extends string>({ label, preference, value, options, onValueChange, className, ...props }: SegmentProps<T>) {
    const index = Math.max(0, options.findIndex(option => option.value === value));
    return <RadioGroup {...props} className={['vc-segment', className].filter(Boolean).join(' ')} aria-label={label} data-preference={preference}
        value={value}
        onValueChange={next => { const option = options.find(option => option.value === next); if (option) onValueChange(option.value); }}>
        <i className="vc-segment-thumb" aria-hidden="true" style={{ width: `calc((100% - 4px) / ${options.length})`, transform: `translateX(${index * 100}%)` }} />
        {options.map(option => <Radio.Root key={option.value} nativeButton render={<button type="button" />} value={option.value}
            aria-pressed={option.value === value}>{option.label}</Radio.Root>)}
    </RadioGroup>;
}
