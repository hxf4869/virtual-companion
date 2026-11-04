import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import React, { useState } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Checkbox } from '../../src/design/components/Checkbox';
import { Field } from '../../src/design/components/Field';
import { Menu } from '../../src/design/components/Menu';
import { Popover } from '../../src/design/components/Popover';
import { ScrollArea } from '../../src/design/components/ScrollArea';
import { Segment } from '../../src/design/components/Segment';
import { Select } from '../../src/design/components/Select';
import { Slider } from '../../src/design/components/Slider';
import { Switch } from '../../src/design/components/Switch';
import { Tabs } from '../../src/design/components/Tabs';
import { TextInput } from '../../src/design/components/TextInput';
import { Textarea } from '../../src/design/components/Textarea';
import { ToastRegion, toast } from '../../src/design/components/Toast';
import { Tooltip } from '../../src/design/components/Tooltip';

const DESIGN_DIR = resolve(__dirname, '../../src/design');

function stripCssLayersForHappyDom(css: string): string {
  return css
    .replace(/^@layer\s+[^;{]+;\s*$/gm, '')
    .replace(/^@import\s+[^;]+;\s*$/gm, '')
    .replace(/@layer\s+[a-zA-Z0-9_-]+\s*\{([\s\S]*?)\n\}/g, '$1');
}

let styleEl: HTMLStyleElement | null = null;

beforeEach(() => {
  const files = [
    resolve(DESIGN_DIR, 'tokens.css'),
    resolve(DESIGN_DIR, 'base.css'),
    resolve(DESIGN_DIR, 'components/Menu.css'),
    resolve(DESIGN_DIR, 'components/Toast.css'),
    resolve(DESIGN_DIR, 'components/TextInput.css'),
    resolve(DESIGN_DIR, 'components/Textarea.css'),
    resolve(DESIGN_DIR, 'components/Select.css'),
    resolve(DESIGN_DIR, 'components/Segment.css'),
  ];
  styleEl = document.createElement('style');
  styleEl.textContent = files
    .map((p) => stripCssLayersForHappyDom(readFileSync(p, 'utf8')))
    .join('\n');
  document.head.appendChild(styleEl);
});

afterEach(() => {
  cleanup();
  styleEl?.remove();
  styleEl = null;
  vi.useRealTimers();
});

describe('Menu, Toast & form/navigation primitives (DR2-3)', () => {
  it('arrow keys move, Esc closes, focus returns, and Menu matches §16.4 geometry', async () => {
    const onSelectRename = vi.fn();
    const onSelectDelete = vi.fn();

    render(
      <Menu
        trigger={<button type="button">更多操作</button>}
        items={[
          { id: 'rename', label: '重命名', icon: 'edit', onSelect: onSelectRename },
          { id: 'delete', label: '删除角色', icon: 'trash', danger: true, separator: true, onSelect: onSelectDelete },
        ]}
      />,
    );

    const trigger = screen.getByRole('button', { name: '更多操作' });
    trigger.focus();
    fireEvent.click(trigger);

    const menu = await screen.findByRole('menu');
    expect(menu).not.toBeNull();
    expect(window.getComputedStyle(menu).minWidth).toBe('220px');

    const items = screen.getAllByRole('menuitem');
    expect(items).toHaveLength(2);
    expect(window.getComputedStyle(items[0]!).height).toBe('36px');

    await waitFor(() => {
      expect(items[0]?.getAttribute('data-highlighted')).not.toBeNull();
    });

    fireEvent.keyDown(menu, { key: 'ArrowDown', code: 'ArrowDown' });
    await waitFor(() => {
      expect(items[1]?.getAttribute('data-highlighted')).not.toBeNull();
    });

    fireEvent.keyDown(menu, { key: 'ArrowUp', code: 'ArrowUp' });
    await waitFor(() => {
      expect(items[0]?.getAttribute('data-highlighted')).not.toBeNull();
    });

    fireEvent.keyDown(menu, { key: 'Escape', code: 'Escape' });
    await waitFor(() => {
      expect(screen.queryByRole('menu')).toBeNull();
    });
    await waitFor(() => {
      expect(document.activeElement).toBe(trigger);
    });
  });

  it('Toast enforces single active instance, 1.8s auto-close on success, persistent closeable error, and bounded width', () => {
    vi.useFakeTimers();
    render(<ToastRegion />);

    act(() => {
      toast.show({ title: '已保存第一项', kind: 'success' });
      toast.show({ title: '已保存第二项', kind: 'success' });
    });

    expect(screen.queryByText('已保存第一项')).toBeNull();
    const secondTitle = screen.getByText('已保存第二项');
    expect(secondTitle).not.toBeNull();
    const toastRoot = secondTitle.closest('.vc-toast') as HTMLElement;
    expect(toastRoot).not.toBeNull();
    expect(window.getComputedStyle(toastRoot).maxWidth).toContain('min(360px,');

    act(() => {
      vi.advanceTimersByTime(1850);
    });
    expect(screen.queryByText('已保存第二项')).toBeNull();

    act(() => {
      toast.show({ title: '连接模型失败', kind: 'error' });
    });
    expect(screen.getByText('连接模型失败')).not.toBeNull();

    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(screen.getByText('连接模型失败')).not.toBeNull();

    const closeBtn = screen.getByRole('button', { name: '关闭提示' });
    act(() => {
      fireEvent.click(closeBtn);
    });
    expect(screen.queryByText('连接模型失败')).toBeNull();
  });

  it('renders Field, TextInput, Textarea, Switch, Checkbox, Segment, Slider, Select, Tabs, Popover, Tooltip, ScrollArea with visible 2px focus outline and §16.4 dimensions', async () => {
    function FormHarness() {
      const [seg, setSeg] = useState('chat');
      const [checked, setChecked] = useState(false);
      const [enabled, setEnabled] = useState(true);
      const [tab, setTab] = useState('general');
      const [model, setModel] = useState('claude-sonnet');
      const [temp, setTemp] = useState(0.7);

      return (
        <div>
          <Field label="模型名称" description="用于主对话生成" error="名称不能为空" className="custom-field">
            <TextInput placeholder="输入名称" defaultValue="Claude" className="custom-input" />
          </Field>
          <Textarea placeholder="系统提示词" defaultValue="你是一个温柔的陪伴者" className="custom-textarea" />
          <Switch checked={enabled} onCheckedChange={setEnabled} aria-label="启用流式输出" />
          <Checkbox checked={checked} onCheckedChange={setChecked} label="记住选择" />
          <Segment
            value={seg}
            onValueChange={setSeg}
            options={[
              { value: 'chat', label: '聊天' },
              { value: 'memory', label: '记忆' },
            ]}
          />
          <Slider value={temp} onValueChange={setTemp} min={0} max={1} step={0.1} aria-label="温度" />
          <Select
            value={model}
            onValueChange={setModel}
            aria-label="选择模型"
            options={[
              { value: 'claude-sonnet', label: 'Claude Sonnet' },
              { value: 'gpt-4o', label: 'GPT-4o' },
            ]}
          />
          <Tabs
            value={tab}
            onValueChange={setTab}
            tabs={[
              { value: 'general', label: '常规', content: <div>常规面板</div> },
              { value: 'advanced', label: '高级', content: <div>高级面板</div> },
            ]}
          />
          <Popover trigger={<button type="button">打开浮层</button>}>
            <div>浮层详情</div>
          </Popover>
          <Tooltip content="快捷键提示">
            <button type="button">悬停按钮</button>
          </Tooltip>
          <ScrollArea className="custom-scroll">
            <div>滚动区域正文</div>
          </ScrollArea>
        </div>
      );
    }

    const { container } = render(<FormHarness />);

    expect(screen.getByText('模型名称')).not.toBeNull();
    expect(screen.getByText('名称不能为空')).not.toBeNull();
    const input = screen.getByDisplayValue('Claude') as HTMLInputElement;
    const textarea = screen.getByDisplayValue('你是一个温柔的陪伴者') as HTMLTextAreaElement;
    expect(input).not.toBeNull();
    expect(textarea).not.toBeNull();

    input.focus();
    const inputFocusStyle = window.getComputedStyle(input);
    expect(inputFocusStyle.height).toBe('36px');
    expect(inputFocusStyle.outlineStyle).toBe('solid');
    expect(inputFocusStyle.outlineWidth).toBe('2px');

    textarea.focus();
    const textareaFocusStyle = window.getComputedStyle(textarea);
    expect(textareaFocusStyle.outlineStyle).toBe('solid');
    expect(textareaFocusStyle.outlineWidth).toBe('2px');

    const segRoot = container.querySelector('.vc-segment') as HTMLElement;
    expect(window.getComputedStyle(segRoot).height).toBe('32px');

    expect(screen.getByText('记住选择')).not.toBeNull();
    expect(screen.getByText('常规面板')).not.toBeNull();
    expect(screen.getByText('滚动区域正文')).not.toBeNull();

    const memoryRadio = screen.getByRole('radio', { name: '记忆' });
    fireEvent.click(memoryRadio);
    expect(memoryRadio.getAttribute('aria-checked')).toBe('true');

    const popTrigger = screen.getByRole('button', { name: '打开浮层' });
    fireEvent.click(popTrigger);
    expect(await screen.findByText('浮层详情')).not.toBeNull();
  });
});
