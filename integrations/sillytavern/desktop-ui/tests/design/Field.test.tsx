import React, { createRef, useState } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Field } from '../../src/design/components/Field';
import { Textarea } from '../../src/design/components/Textarea';

afterEach(() => {
  cleanup();
});

describe('Field + Textarea composition & accessibility contract (DR2-3)', () => {
  it('associates Field label, description, and error with Textarea and focuses Textarea when clicking label', async () => {
    const user = userEvent.setup();

    render(
      <Field label="简介" description="用于角色卡片摘要" error="简介不能为空">
        <Textarea defaultValue="合成说明" />
      </Field>,
    );

    const textarea = screen.getByRole('textbox', { name: '简介' }) as HTMLTextAreaElement;
    expect(textarea).toBeInstanceOf(HTMLTextAreaElement);
    expect(textarea.value).toBe('合成说明');
    expect(textarea.id).toBeTruthy();

    const labelEl = screen.getByText('简介').closest('label');
    expect(labelEl).not.toBeNull();
    expect(labelEl?.getAttribute('for')).toBe(textarea.id);

    const descEl = screen.getByText('用于角色卡片摘要');
    const errEl = screen.getByText('简介不能为空');
    const describedBy = textarea.getAttribute('aria-describedby') ?? '';
    expect(describedBy).toContain(descEl.id);
    expect(describedBy).toContain(errEl.id);
    expect(textarea.getAttribute('aria-invalid')).toBe('true');

    await user.click(screen.getByText('简介'));
    expect(document.activeElement).toBe(textarea);
  });

  it('preserves HTMLTextAreaElement ref, standalone usage, controlled/uncontrolled values, and onChange/onValueChange/onBlur', () => {
    const ref = createRef<HTMLTextAreaElement>();
    const onChange = vi.fn();
    const onValueChange = vi.fn();
    const onBlur = vi.fn();

    function ControlledHarness() {
      const [val, setVal] = useState('初始内容');
      return (
        <Textarea
          ref={ref}
          rows={5}
          placeholder="请输入内容"
          value={val}
          onChange={(e) => {
            onChange(e.currentTarget.tagName, e.target.value);
          }}
          onValueChange={(next) => {
            onValueChange(next);
            setVal(next);
          }}
          onBlur={onBlur}
        />
      );
    }

    render(<ControlledHarness />);

    expect(ref.current).toBeInstanceOf(HTMLTextAreaElement);
    expect(ref.current?.getAttribute('rows')).toBe('5');
    expect(ref.current?.value).toBe('初始内容');

    const el = ref.current!;
    fireEvent.change(el, { target: { value: '更新后的内容' } });
    expect(onChange).toHaveBeenCalledWith('TEXTAREA', '更新后的内容');
    expect(onValueChange).toHaveBeenCalledWith('更新后的内容');
    expect(el.value).toBe('更新后的内容');

    fireEvent.blur(el);
    expect(onBlur).toHaveBeenCalledTimes(1);
  });
});
