import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import Editor, { loader } from '@monaco-editor/react';
import {
  CODE_EDITOR_STORAGE_KEY,
  buildCodeEditorFields,
  defaults as codeEditorDefaults,
  enums as codeEditorEnums,
  labels as codeEditorLabels,
  readCodeEditorPreferences,
  toOptions as toCodeEditorOptions,
  validateCodeEditorField,
  writeCodeEditorPreferences,
} from '../../../../extension/vc-model-settings/desktop/tavern-controller.js';
import { AlertDialog } from '../../design/components/AlertDialog';
import { Button } from '../../design/components/Button';
import { Dialog } from '../../design/components/Dialog';
import { Switch } from '../../design/components/Switch';
import type {
  TavernAction,
  TavernField,
  TavernGalleryItem,
  TavernGroup,
  TavernListItem,
  TavernResource,
  UseTavernControllerResult,
} from '../../data/queries/tavern';

export {
  CODE_EDITOR_STORAGE_KEY,
  buildCodeEditorFields,
  codeEditorDefaults,
  codeEditorEnums,
  codeEditorLabels,
  readCodeEditorPreferences,
  toCodeEditorOptions,
  validateCodeEditorField,
  writeCodeEditorPreferences,
};

export type CodeFieldLanguage = 'json' | 'javascript' | 'markdown' | 'css' | 'ejs';

export type CodeEditorPreferences = Record<string, unknown>;

export const SELF_HOSTED_EDITOR_URL =
  '/scripts/extensions/third-party/ST-Prompt-Template/dist/desktop-editor.js';

export const SELF_HOSTED_WORKER_BASE =
  '/scripts/extensions/third-party/ST-Prompt-Template/dist/';

export const SELF_HOSTED_WORKER_SPECS: Record<
  string,
  { entry: string; chunks: readonly string[]; needsPromiseDefaultShim?: boolean }
> = {
  json: {
    entry: '2184.index.js',
    chunks: ['4108.index.js', '2641.index.js', '5323.index.js'],
  },
  css: {
    entry: '8720.index.js',
    chunks: ['4108.index.js', '2641.index.js'],
  },
  javascript: {
    entry: '2749.index.js',
    chunks: ['4108.index.js', '2641.index.js'],
    needsPromiseDefaultShim: true,
  },
};

export function resolveSelfHostedMonacoWorkerUrl(_moduleId: string, label: string): string {
  const spec = SELF_HOSTED_WORKER_SPECS[label];
  return SELF_HOSTED_WORKER_BASE + (spec ? spec.entry : 'editor.worker.js');
}

export function configureSelfHostedMonacoWorkers(): void {
  const g = globalThis as Record<string, unknown>;
  const prev =
    g.MonacoEnvironment && typeof g.MonacoEnvironment === 'object'
      ? (g.MonacoEnvironment as Record<string, unknown>)
      : {};
  const getWorker = (_moduleId: string, label: string): Worker => {
    const spec = SELF_HOSTED_WORKER_SPECS[label];
    if (!spec) {
      return new Worker(SELF_HOSTED_WORKER_BASE + 'editor.worker.js', {
        name: label || 'editorWorkerService',
        type: 'module',
      });
    }
    let base = SELF_HOSTED_WORKER_BASE;
    try {
      base = new URL(
        SELF_HOSTED_WORKER_BASE,
        globalThis.location?.origin || 'http://localhost',
      ).href;
    } catch {
      base = SELF_HOSTED_WORKER_BASE;
    }
    const entryBoot = spec.needsPromiseDefaultShim
      ? [
          'Object.defineProperty(Promise.prototype,"default",{value:{},configurable:true,writable:true});',
          'try{await import(base+entry);}finally{delete Promise.prototype.default;}',
        ].join('\n')
      : 'await import(base+entry);';
    const code = [
      'const q=[],queueHandler=e=>{q.push(e);};self.onmessage=queueHandler;',
      `const base=${JSON.stringify(base)},chunks=${JSON.stringify(spec.chunks)},entry=${JSON.stringify(spec.entry)};`,
      'self.webpackChunkextension_prompt_template=[];',
      'for(const c of chunks){await import(base+c);}',
      'const saved=self.webpackChunkextension_prompt_template.map(c=>[c[0].slice(),c[1],c[2]]);',
      'self.webpackChunkextension_prompt_template=[];',
      'self.importScripts=()=>{for(const c of saved){self.webpackChunkextension_prompt_template.push([c[0].slice(),c[1],c[2]]);}};',
      entryBoot,
      'for(let i=0;i<32&&self.onmessage===queueHandler;i++){await Promise.resolve();}',
      'if(self.onmessage===queueHandler){self.onmessage=null;throw new Error("Monaco worker entry did not install onmessage");}',
      'while(q.length){const ev=q.shift();if(typeof self.onmessage==="function")self.onmessage(ev);}',
    ].join('\n');
    const blobUrl = URL.createObjectURL(
      new Blob([code], { type: 'application/javascript' }),
    );
    let revoked = false;
    const revoke = () => {
      if (!revoked) {
        revoked = true;
        URL.revokeObjectURL(blobUrl);
      }
    };
    try {
      const worker = new Worker(blobUrl, { name: label, type: 'module' });
      worker.addEventListener('error', revoke, { once: true });
      const origTerminate = worker.terminate.bind(worker);
      worker.terminate = () => {
        revoke();
        return origTerminate();
      };
      return worker;
    } catch (err) {
      revoke();
      throw err;
    }
  };
  g.MonacoEnvironment = {
    ...prev,
    globalAPI: false,
    getWorkerUrl: resolveSelfHostedMonacoWorkerUrl,
    getWorker,
  };
}

let monacoLoadPromise: Promise<unknown> | null = null;

async function ensureSelfHostedMonaco(): Promise<unknown> {
  if (!monacoLoadPromise) {
    monacoLoadPromise = import(/* @vite-ignore */ SELF_HOSTED_EDITOR_URL)
      .then(async (mod: { loadDesktopMonaco?: () => Promise<unknown> }) => {
        if (typeof mod?.loadDesktopMonaco !== 'function') {
          throw new Error('Missing loadDesktopMonaco export');
        }
        const monaco = await mod.loadDesktopMonaco();
        if (!monaco) {
          throw new Error('Monaco instance unavailable');
        }
        configureSelfHostedMonacoWorkers();
        loader.config({ monaco: monaco as any });
        return monaco;
      })
      .catch((err) => {
        monacoLoadPromise = null;
        throw err;
      });
  }
  return monacoLoadPromise;
}

export interface CodeFieldProps {
  id?: string;
  language?: CodeFieldLanguage;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  error?: string;
  className?: string;
  placeholder?: string;
  mode?: 'inline' | 'monaco';
  preferences?: CodeEditorPreferences;
  onReadyChange?: (ready: boolean) => void;
}

export function CodeField({
  id,
  language = 'markdown',
  value,
  onChange,
  disabled = false,
  error,
  className,
  placeholder,
  mode = 'inline',
  preferences,
  onReadyChange,
}: CodeFieldProps) {
  const generatedId = useId();
  const fieldId = id ?? generatedId;
  const [monacoState, setMonacoState] = useState<'idle' | 'loading' | 'ready' | 'error'>(() =>
    mode === 'monaco' ? 'loading' : 'idle',
  );

  useEffect(() => {
    if (mode !== 'monaco') {
      setMonacoState('idle');
      onReadyChange?.(false);
      return undefined;
    }

    let cancelled = false;
    setMonacoState('loading');
    onReadyChange?.(false);

    ensureSelfHostedMonaco()
      .then(() => {
        if (!cancelled) {
          setMonacoState('ready');
        }
      })
      .catch(() => {
        if (!cancelled) {
          setMonacoState('error');
          onReadyChange?.(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [mode, onReadyChange]);

  const resolvedOptions = useMemo((): Record<string, unknown> => {
    const activePrefs = preferences ?? readCodeEditorPreferences();
    const baseOpts = toCodeEditorOptions(activePrefs) as Record<string, unknown>;
    return {
      ...baseOpts,
      readOnly: Boolean(disabled),
      automaticLayout: true,
    };
  }, [preferences, disabled]);

  if (mode === 'monaco') {
    const activeTheme = String(resolvedOptions.theme || codeEditorDefaults.theme || 'ejsTheme');
    return (
      <div
        id={fieldId}
        role="region"
        aria-label="世界书代码"
        data-language={language}
        data-readonly={disabled ? 'true' : 'false'}
        className={['vc-world-code-canvas', className].filter(Boolean).join(' ')}
      >
        {monacoState === 'loading' ? <p role="status">正在加载…</p> : null}
        {monacoState === 'error' ? (
          <p role="alert">代码编辑器没有加载出来，请关闭后重试。</p>
        ) : null}
        {monacoState === 'ready' ? (
          <Editor
            language={language}
            theme={activeTheme}
            value={value ?? ''}
            loading={<p role="status">正在加载…</p>}
            options={resolvedOptions}
            onMount={() => {
              onReadyChange?.(true);
            }}
            onChange={(nextVal) => {
              if (disabled) return;
              onChange(String(nextVal ?? ''));
            }}
          />
        ) : null}
      </div>
    );
  }

  return (
    <textarea
      id={fieldId}
      className={['vc-tavern-code', className].filter(Boolean).join(' ')}
      data-language={language}
      value={value ?? ''}
      disabled={disabled}
      placeholder={placeholder}
      aria-invalid={error ? 'true' : undefined}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

export interface WorldCodeEditorDialogProps {
  open: boolean;
  initialValue: string;
  onApply: (value: string) => void;
  onClose: () => void;
  onDirtyChange?: (dirty: boolean) => void;
}

export function WorldCodeEditorDialog({
  open,
  initialValue,
  onApply,
  onClose,
  onDirtyChange,
}: WorldCodeEditorDialogProps) {
  const [draft, setDraft] = useState(initialValue);
  const [baselinePrefs, setBaselinePrefs] = useState<CodeEditorPreferences>(() =>
    readCodeEditorPreferences(),
  );
  const [prefsDraft, setPrefsDraft] = useState<CodeEditorPreferences>(() =>
    readCodeEditorPreferences(),
  );
  const [fieldDrafts, setFieldDrafts] = useState<Map<string, string>>(() => new Map());
  const [fieldErrors, setFieldErrors] = useState<Map<string, string>>(() => new Map());
  const [editorReady, setEditorReady] = useState(false);
  const [confirmDiscardOpen, setConfirmDiscardOpen] = useState(false);

  useEffect(() => {
    if (open) {
      const freshBaseline = readCodeEditorPreferences();
      setBaselinePrefs(freshBaseline);
      setPrefsDraft({ ...freshBaseline });
      setFieldDrafts(new Map());
      setFieldErrors(new Map());
      setDraft(initialValue);
      setEditorReady(false);
      setConfirmDiscardOpen(false);
    }
  }, [open, initialValue]);

  const prefsChanged = useMemo(
    () => JSON.stringify(prefsDraft) !== JSON.stringify(baselinePrefs),
    [prefsDraft, baselinePrefs],
  );
  const isDirty = draft !== initialValue || prefsChanged || fieldErrors.size > 0;

  useEffect(() => {
    onDirtyChange?.(open && isDirty);
  }, [open, isDirty, onDirtyChange]);

  const handleRequestClose = useCallback(() => {
    if (isDirty) {
      setConfirmDiscardOpen(true);
      return;
    }
    onClose();
  }, [isDirty, onClose]);

  const handleApply = useCallback(() => {
    if (!editorReady || fieldErrors.size > 0) return;
    writeCodeEditorPreferences(prefsDraft);
    onApply(draft);
    onClose();
  }, [editorReady, fieldErrors.size, prefsDraft, draft, onApply, onClose]);

  const handlePrefField = useCallback((name: string, rawValue: unknown) => {
    const result = validateCodeEditorField(name, rawValue) as {
      ok: boolean;
      value?: unknown;
      draft?: string;
      error?: string;
    };
    if (!result.ok) {
      setFieldDrafts((prev) => {
        const next = new Map(prev);
        next.set(name, String(result.draft ?? rawValue ?? ''));
        return next;
      });
      setFieldErrors((prev) => {
        const next = new Map(prev);
        next.set(name, String(result.error || '请输入有效数值。'));
        return next;
      });
      return;
    }
    setFieldDrafts((prev) => {
      if (!prev.has(name)) return prev;
      const next = new Map(prev);
      next.delete(name);
      return next;
    });
    setFieldErrors((prev) => {
      if (!prev.has(name)) return prev;
      const next = new Map(prev);
      next.delete(name);
      return next;
    });
    setPrefsDraft((prev) => ({ ...prev, [name]: result.value }));
  }, []);

  const prefFields = useMemo(
    () => buildCodeEditorFields(prefsDraft, fieldDrafts, fieldErrors) as TavernField[],
    [prefsDraft, fieldDrafts, fieldErrors],
  );

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) handleRequestClose();
        }}
        title="代码编辑"
        width={760}
        className="vc-sheet"
        actions={
          <>
            <Button type="button" variant="gray" onClick={handleRequestClose}>
              取消
            </Button>
            <Button
              type="button"
              variant="filled"
              disabled={!editorReady || fieldErrors.size > 0}
              onClick={handleApply}
            >
              完成
            </Button>
          </>
        }
      >
        <div className="vc-world-code-editor">
          <details className="vc-world-code-prefs">
            <summary>编辑器设置</summary>
            <div className="vc-desk-group">
              {prefFields.map((f) => (
                <TavernFieldRow key={f.key} field={f} busy={false} onField={handlePrefField} />
              ))}
            </div>
          </details>
          <CodeField
            language="ejs"
            mode="monaco"
            value={draft}
            onChange={setDraft}
            preferences={prefsDraft}
            onReadyChange={setEditorReady}
          />
        </div>
      </Dialog>

      <AlertDialog
        open={confirmDiscardOpen}
        onOpenChange={setConfirmDiscardOpen}
        title="放弃更改？"
        description="未保存的更改会丢失。"
        confirmLabel="放弃"
        cancelLabel="继续编辑"
        danger
        className="vc-alert"
        onConfirm={() => {
          setConfirmDiscardOpen(false);
          onClose();
        }}
      />
    </>
  );
}

// ── Shared Tavern Form Building Blocks ──

export function TavernActionButton({
  action,
  busy,
  onAction,
}: {
  action: TavernAction;
  busy: boolean;
  onAction: (id: string, value?: unknown) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const variant = action.id.includes('delete') ? 'danger' : 'gray';

  return (
    <>
      <Button
        variant={variant}
        disabled={busy || action.disabled}
        data-tavern-action={action.id}
        onClick={() => {
          if (action.accept) {
            inputRef.current?.click();
          } else {
            onAction(action.id);
          }
        }}
      >
        {action.label}
      </Button>
      {action.accept ? (
        <input
          ref={inputRef}
          type="file"
          hidden
          accept={action.accept}
          disabled={busy || action.disabled}
          data-tavern-upload={action.id}
          onChange={(e) => {
            const file = e.currentTarget.files?.[0];
            e.currentTarget.value = '';
            if (file) onAction(action.id, file);
          }}
        />
      ) : null}
    </>
  );
}

export function TavernResourceRow({
  resource,
  busy,
  onAction,
}: {
  resource: TavernResource;
  busy: boolean;
  onAction: (id: string, value?: unknown) => void;
}) {
  const selectId = useId();
  return (
    <div className="vc-desk-field">
      <label htmlFor={selectId}>{resource.label}</label>
      <select
        id={selectId}
        value={resource.value}
        disabled={busy}
        data-tavern-resource={resource.key}
        onChange={(e) => onAction(`select-${resource.key}`, e.target.value)}
      >
        {resource.options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}

export function TavernFieldRow({
  field: f,
  busy,
  onField,
}: {
  field: TavernField;
  busy: boolean;
  onField: (id: string, value: unknown) => void;
}) {
  const id = useId();
  const disabled = busy || f.disabled;
  return (
    <div className="vc-desk-field" data-tavern-field={f.key}>
      <label htmlFor={id}>{f.label}</label>
      {f.kind === 'boolean' ? (
        <Switch
          id={id}
          checked={Boolean(f.value)}
          disabled={disabled}
          aria-label={f.label}
          onCheckedChange={(checked) => onField(f.key, checked)}
        />
      ) : f.kind === 'select' || f.nullableBoolean ? (
        <select
          id={id}
          value={String(f.value ?? '')}
          disabled={disabled}
          onChange={(e) => onField(f.key, e.target.value)}
        >
          {(f.options || []).map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      ) : f.kind === 'code' || f.kind === 'json' ? (
        <CodeField
          id={id}
          language={f.kind === 'json' ? 'json' : f.key.endsWith('custom_css') ? 'css' : 'markdown'}
          value={String(f.value ?? '')}
          disabled={disabled}
          error={f.error}
          onChange={(nextVal) => onField(f.key, nextVal)}
        />
      ) : f.kind === 'list' ? (
        <textarea
          id={id}
          className="vc-tavern-list-input"
          value={Array.isArray(f.value) ? f.value.join('\n') : String(f.value ?? '')}
          disabled={disabled}
          onChange={(e) => onField(f.key, e.target.value)}
        />
      ) : f.kind === 'multiselect' ? (
        <div id={id} className="vc-tavern-checks">
          {(f.options || []).map((o) => {
            const list = Array.isArray(f.value) ? (f.value as string[]) : [];
            const checked = list.includes(o.value);
            return (
              <label key={o.value} className="vc-tavern-check">
                <input
                  type="checkbox"
                  checked={checked}
                  disabled={disabled}
                  onChange={(e) =>
                    onField(
                      f.key,
                      e.target.checked
                        ? [...list, o.value]
                        : list.filter((item) => item !== o.value),
                    )
                  }
                />
                <span>{o.label}</span>
              </label>
            );
          })}
        </div>
      ) : f.kind === 'number' && f.min !== undefined && f.max !== undefined ? (
        <div className="vc-tavern-number">
          <input
            type="range"
            aria-label={`${f.label} 滑杆`}
            min={f.min}
            max={f.max}
            step={f.step ?? 1}
            value={Number.isFinite(Number(f.value)) ? Number(f.value) : f.min}
            disabled={disabled}
            onChange={(e) => onField(f.key, e.target.value)}
          />
          <input
            id={id}
            type="number"
            min={f.min}
            max={f.max}
            step={f.step ?? 1}
            value={String(f.value ?? '')}
            disabled={disabled}
            aria-invalid={f.error ? 'true' : undefined}
            onChange={(e) => onField(f.key, e.target.value)}
          />
        </div>
      ) : (
        <input
          id={id}
          type="text"
          inputMode={f.kind === 'number' ? 'decimal' : undefined}
          min={f.min}
          max={f.max}
          step={f.step}
          value={String(f.value ?? '')}
          disabled={disabled}
          aria-invalid={f.error ? 'true' : undefined}
          onChange={(e) => onField(f.key, e.target.value)}
        />
      )}
      {f.error ? (
        <span className="vc-desk-error" role="alert">
          {f.error}
        </span>
      ) : null}
    </div>
  );
}

export function TavernGroupSection({
  group,
  busy,
  onField,
  onAction,
}: {
  group: TavernGroup;
  busy: boolean;
  onField: (id: string, value: unknown) => void;
  onAction: (id: string, value?: unknown) => void;
}) {
  return (
    <section className="vc-desk-group" data-tavern-group={group.id}>
      <h2>{group.title}</h2>
      {group.actions?.length ? (
        <div className="vc-desk-actions">
          {group.actions.map((a) => (
            <TavernActionButton key={a.id} action={a} busy={busy} onAction={onAction} />
          ))}
        </div>
      ) : null}
      {group.fields.map((f) => (
        <TavernFieldRow key={f.key} field={f} busy={busy} onField={onField} />
      ))}
    </section>
  );
}

export function TavernItemList({
  title,
  items,
  busy,
  onSelect,
}: {
  title: string;
  items: TavernListItem[];
  busy: boolean;
  onSelect: (id: string) => void;
}) {
  return (
    <section className="vc-desk-group" data-tavern-group="items">
      <h2>{title}</h2>
      <div className="vc-tavern-list" role="listbox" aria-label="条目">
        {items.map((item) => (
          <button
            key={item.id}
            type="button"
            data-vc-light=""
            className={item.selected ? 'is-selected' : undefined}
            aria-selected={Boolean(item.selected)}
            disabled={busy}
            data-tavern-action="select-item"
            data-tavern-value={item.id}
            onClick={() => onSelect(item.id)}
          >
            {item.name}
          </button>
        ))}
      </div>
    </section>
  );
}

export function TavernGalleryGrid({
  title,
  items,
  busy,
  onSelect,
}: {
  title: string;
  items: TavernGalleryItem[];
  busy: boolean;
  onSelect: (id: string) => void;
}) {
  return (
    <section className="vc-desk-group" data-tavern-group="gallery">
      <h2>{title}</h2>
      <div className="vc-tavern-gallery">
        {items.map((item) => (
          <button
            key={item.id}
            type="button"
            data-vc-light=""
            className={item.selected ? 'is-selected' : undefined}
            aria-pressed={Boolean(item.selected)}
            disabled={busy}
            data-tavern-action="select-image"
            data-tavern-value={item.id}
            onClick={() => onSelect(item.id)}
          >
            <img src={item.src} alt="" loading="lazy" />
            <span>{item.name}</span>
          </button>
        ))}
      </div>
    </section>
  );
}

export function TavernFormContainer({
  controller,
  children,
}: {
  controller: UseTavernControllerResult;
  children: React.ReactNode;
}) {
  const { loading, busy, error, conflict, setCheckValidity, save, onAction } = controller;
  const formRef = useRef<HTMLFormElement | null>(null);

  useEffect(() => {
    setCheckValidity(() => !formRef.current?.querySelector('[aria-invalid="true"]'));
    return () => {
      setCheckValidity(null);
    };
  }, [setCheckValidity]);

  if (loading) {
    return (
      <div className="vc-tavern-skeleton" aria-busy="true">
        <div className="vc-skeleton" />
        <div className="vc-skeleton" />
        <div className="vc-skeleton" />
      </div>
    );
  }
  return (
    <form
      ref={formRef}
      className="vc-tavern-form"
      aria-busy={busy}
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      {error ? (
        <div className="vc-tavern-banner" role="alert">
          <span>{error}</span>
          {conflict ? (
            <button
              type="button"
              className="vc-btn vc-btn-text"
              disabled={busy}
              data-tavern-action="reload"
              onClick={() => onAction('reload')}
            >
              加载最新
            </button>
          ) : null}
        </div>
      ) : null}
      {children}
    </form>
  );
}

export function triggerTavernBrowserDownload(value: unknown, name: string): void {
  if (typeof document === 'undefined' || typeof URL?.createObjectURL !== 'function') return;
  const blob =
    value instanceof Blob
      ? value
      : new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function TavernDialogs({ controller }: { controller: UseTavernControllerResult }) {
  const { askNameDialog, charDeleteDialog, confirmDialog, codeEditorDialog } = controller;

  return (
    <>
      <Dialog
        open={askNameDialog.open}
        onOpenChange={(nextOpen: boolean) => {
          if (!nextOpen) askNameDialog.close();
        }}
        title={askNameDialog.title}
        className="vc-sheet"
        actions={
          <>
            <Button type="button" variant="gray" onClick={askNameDialog.close}>
              取消
            </Button>
            <Button type="button" variant="filled" onClick={askNameDialog.submit}>
              完成
            </Button>
          </>
        }
      >
        <form
          className="vc-tavern-name"
          onSubmit={(e: React.FormEvent) => {
            e.preventDefault();
            askNameDialog.submit();
          }}
        >
          <label>
            名称
            <input
              required
              maxLength={120}
              value={askNameDialog.value}
              aria-invalid={askNameDialog.error ? 'true' : undefined}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                askNameDialog.setValue(e.target.value)
              }
            />
          </label>
          {askNameDialog.error ? (
            <span className="vc-desk-error" role="alert">
              {askNameDialog.error}
            </span>
          ) : null}
        </form>
      </Dialog>

      <Dialog
        open={charDeleteDialog.open}
        onOpenChange={(nextOpen: boolean) => {
          if (!nextOpen) charDeleteDialog.close();
        }}
        title="删除角色卡"
        className="vc-sheet"
      >
        <div className="vc-column">
          {(
            [
              [false, '仅删除角色卡'],
              [true, '同时删除聊天'],
            ] as const
          ).map(([deleteChats, label]) => (
            <button
              key={label}
              type="button"
              className="vc-btn vc-btn-danger"
              onClick={() => charDeleteDialog.select(deleteChats, label)}
            >
              {label}
            </button>
          ))}
        </div>
      </Dialog>

      <AlertDialog
        open={confirmDialog.open}
        onOpenChange={(nextOpen: boolean) => {
          if (!nextOpen) confirmDialog.cancel();
        }}
        title={confirmDialog.title}
        description={confirmDialog.message}
        confirmLabel={confirmDialog.confirmLabel}
        cancelLabel={confirmDialog.cancelLabel}
        danger={confirmDialog.danger}
        className="vc-alert"
        onConfirm={confirmDialog.confirm}
      />

      <WorldCodeEditorDialog
        open={codeEditorDialog.open}
        initialValue={codeEditorDialog.initialValue}
        onDirtyChange={codeEditorDialog.setDirty}
        onApply={codeEditorDialog.apply}
        onClose={codeEditorDialog.close}
      />
    </>
  );
}
