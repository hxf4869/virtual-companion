import { useCallback, useEffect, useRef, useState } from 'react';
import {
  FREQUENCIES,
  IMAGE_FORMATS,
  SETTINGS_KEY,
  STICKER_FOLDER,
  displayStickerRows,
  isSendableTag,
  loadBundledManifest,
  normalizeSettings,
  readSettings,
  setStickerRuntime,
  tagFromFilename,
  writeStickerSettings,
} from '../../../../extension/vc-model-settings/stickers-logic.js';
import { useAppClient } from '../../app/providers';
import { AlertDialog } from '../../design/components/AlertDialog';
import { Button } from '../../design/components/Button';
import { Icon } from '../../design/components/Icon';
import { Segment } from '../../design/components/Segment';
import { Switch } from '../../design/components/Switch';
import { toast } from '../../design/components/Toast';
import { useSessionBridge } from '../../runtime/session-bridge';

interface StickerRowItem {
  id: string;
  tag: string;
  name?: string;
  src?: string;
  builtin?: boolean;
  attribution?: string;
}

function readDataUrl(file: File): Promise<string> {
  if (typeof FileReader === 'function') {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });
  }
  return file.arrayBuffer().then((buf) => {
    const bytes = new Uint8Array(buf);
    let binary = '';
    for (let i = 0; i < bytes.length; i += 1) {
      binary += String.fromCharCode(bytes[i]);
    }
    const base64 = typeof btoa === 'function' ? btoa(binary) : '';
    return `data:${file.type || 'image/png'};base64,${base64}`;
  });
}

function StickerTagInput({
  row,
  onCommit,
}: {
  row: StickerRowItem;
  onCommit: (id: string, value: string) => void;
}) {
  const [value, setValue] = useState(row.tag);
  useEffect(() => {
    setValue(row.tag);
  }, [row.tag]);

  return (
    <input
      className="vc-sticker-tag"
      data-vc-sticker-tag=""
      aria-label="标签"
      value={value}
      readOnly={row.builtin}
      onChange={(e) => setValue(e.currentTarget.value)}
      onBlur={() => {
        if (!row.builtin && value !== row.tag) {
          onCommit(row.id, value);
        }
      }}
    />
  );
}

export function StickerSettings() {
  const client = useAppClient();
  const bridge = useSessionBridge();
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [enabled, setEnabled] = useState<boolean>(true);
  const [frequency, setFrequency] = useState<string>('normal');
  const [rows, setRows] = useState<StickerRowItem[]>([]);
  const [uploadTag, setUploadTag] = useState<string>('');
  const [uploadError, setUploadError] = useState<string>('');
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const syncFromRuntime = useCallback(() => {
    const current = readSettings();
    setEnabled(current.enabled !== false);
    setFrequency(current.frequency || 'normal');
    setRows(displayStickerRows() as StickerRowItem[]);
  }, []);

  useEffect(() => {
    setStickerRuntime({
      getContext: () => bridge.getContext?.(),
    });
    let cancelled = false;
    void (async () => {
      try {
        const packet: any = await client.settings?.();
        if (!cancelled && packet?.settings) {
          const parsed = JSON.parse(packet.settings);
          const ctx = bridge.getContext?.();
          if (ctx) {
            ctx.extensionSettings = ctx.extensionSettings || {};
            if (parsed?.extension_settings?.[SETTINGS_KEY] && !ctx.extensionSettings[SETTINGS_KEY]) {
              ctx.extensionSettings[SETTINGS_KEY] = normalizeSettings(
                parsed.extension_settings[SETTINGS_KEY],
              );
            }
          }
        }
      } catch {
        // ignore
      }
      await loadBundledManifest({ getContext: () => bridge.getContext?.() }).catch(() => {});
      if (!cancelled) {
        syncFromRuntime();
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [bridge, client, syncFromRuntime]);

  const persistStickerSettings = useCallback(
    (next: { enabled: boolean; frequency: string; uploads: any[] }) => {
      const ctx = bridge.getContext?.();
      const before = ctx?.extensionSettings?.[SETTINGS_KEY];
      const hadBefore = Boolean(ctx?.extensionSettings && SETTINGS_KEY in ctx.extensionSettings);
      writeStickerSettings(next);
      syncFromRuntime();
      void bridge
        .applySettings?.([
          {
            path: ['extension_settings', SETTINGS_KEY],
            before: { exists: hadBefore, value: before },
            after: { exists: true, value: next },
          },
        ])
        .catch(() => {});
    },
    [bridge, syncFromRuntime],
  );

  const handleEnabledChange = useCallback(
    (nextEnabled: boolean) => {
      const current = readSettings();
      persistStickerSettings({ ...current, enabled: nextEnabled });
    },
    [persistStickerSettings],
  );

  const handleFrequencyChange = useCallback(
    (nextFreq: string) => {
      if (!FREQUENCIES.some((f) => f.id === nextFreq)) return;
      const current = readSettings();
      persistStickerSettings({ ...current, frequency: nextFreq });
    },
    [persistStickerSettings],
  );

  const handleTagCommit = useCallback(
    (id: string, rawTag: string) => {
      const tag = String(rawTag || '').trim();
      if (tag && !isSendableTag(tag)) {
        setUploadError('标签需为2–4个中文字');
        syncFromRuntime();
        return;
      }
      setUploadError('');
      const current = readSettings();
      const uploads = current.uploads.map((item: any) =>
        item.id === id ? { ...item, tag } : item,
      );
      persistStickerSettings({ ...current, uploads });
    },
    [persistStickerSettings, syncFromRuntime],
  );

  const handleUploadFile = useCallback(
    async (file: File) => {
      const explicitTag = uploadTag.trim();
      const candidateTag = explicitTag || tagFromFilename(file.name);
      if (!isSendableTag(candidateTag)) {
        setUploadError('标签需为2–4个中文字');
        return;
      }
      const format = String(file.name || 'png')
        .split('.')
        .pop()!
        .toLowerCase();
      if (!IMAGE_FORMATS.includes(format)) {
        setUploadError('不支持的图片格式');
        return;
      }
      setUploadError('');
      try {
        const dataUrl = await readDataUrl(file);
        const image = dataUrl.split(',')[1] || '';
        const payload = {
          image,
          format,
          ch_name: STICKER_FOLDER,
          filename: file.name || 'sticker.png',
        };
        let resBody: any;
        if (typeof (client as any).request === 'function') {
          resBody = await (client as any).request('/api/images/upload', payload);
        } else {
          const response = await fetch('/api/images/upload', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          });
          if (!response.ok) throw new Error('upload failed');
          resBody = await response.json();
        }
        if (!resBody?.path) throw new Error('missing path');
        const current = readSettings();
        const nextUploads = [
          ...current.uploads,
          {
            id: `vc-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
            tag: candidateTag,
            path: String(resBody.path),
            name: file.name || '',
          },
        ];
        persistStickerSettings({ ...current, uploads: nextUploads });
        setUploadTag('');
      } catch {
        toast.show({ title: '没有完成，请重试。', kind: 'error' });
      }
    },
    [uploadTag, client, persistStickerSettings],
  );

  const handleConfirmDelete = useCallback(async () => {
    if (!deletingId) return;
    const id = deletingId;
    setDeletingId(null);
    const current = readSettings();
    const target = current.uploads.find((item: any) => item.id === id);
    const nextUploads = current.uploads.filter((item: any) => item.id !== id);
    persistStickerSettings({ ...current, uploads: nextUploads });
    if (target?.path) {
      try {
        if (typeof (client as any).request === 'function') {
          await (client as any).request('/api/images/delete', { path: target.path });
        } else {
          await fetch('/api/images/delete', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ path: target.path }),
          });
        }
      } catch {
        // item already removed from list
      }
    }
  }, [deletingId, client, persistStickerSettings]);

  const notes = [
    ...new Set(rows.map((r) => r.attribution?.trim() || '').filter(Boolean)),
  ];

  const uploadControls = (
    <div className="vc-cell vc-sticker-actions">
      <input
        type="text"
        className="vc-input vc-sticker-tag-input"
        placeholder="2–4字中文标签"
        aria-label="2–4字中文标签"
        data-vc-sticker-upload-tag=""
        value={uploadTag}
        onChange={(e) => {
          setUploadTag(e.currentTarget.value);
          if (uploadError) setUploadError('');
        }}
      />
      <Button
        type="button"
        variant="filled"
        className="vc-sticker-upload"
        data-vc-sticker-upload=""
        onClick={() => fileInputRef.current?.click()}
      >
        上传
      </Button>
    </div>
  );

  return (
    <section className="vc-sticker-page vc-settings-section" data-vc-sticker-page="">
      <div className="vc-navbar">
        <div className="vc-nav-title" data-vc-sticker-title="">
          表情包
        </div>
      </div>

      <div className="vc-group">
        <div className="vc-cell vc-sticker-row">
          <span className="vc-grow">发送</span>
          <Switch
            aria-label="发送"
            checked={enabled}
            onCheckedChange={handleEnabledChange}
          />
        </div>
      </div>

      <div className="vc-group-title">频率</div>
      <Segment
        aria-label="频率"
        value={frequency}
        options={FREQUENCIES.map((f) => ({ value: f.id, label: f.label }))}
        onValueChange={handleFrequencyChange}
      />

      {uploadError && (
        <p className="vc-field-error" role="alert" data-vc-sticker-error="">
          {uploadError}
        </p>
      )}

      <div className="vc-group" data-vc-sticker-list="">
        {rows.length ? (
          <>
            {uploadControls}
            {rows.map((row) => (
              <div
                key={row.id}
                className="vc-cell vc-sticker-row"
                data-vc-sticker-id={row.id}
              >
                {row.src && (
                  <img
                    className="vc-sticker-thumb"
                    alt={row.tag || ''}
                    src={row.src}
                  />
                )}
                <StickerTagInput row={row} onCommit={handleTagCommit} />
                {!row.builtin && (
                  <Button
                    type="button"
                    variant="text"
                    data-vc-sticker-delete=""
                    aria-label="删除"
                    onClick={() => setDeletingId(row.id)}
                  >
                    <Icon name="trash-2" size={18} />
                  </Button>
                )}
              </div>
            ))}
          </>
        ) : (
          <div className="vc-empty" data-vc-sticker-empty="">
            <span>
              <Icon name="image" size={32} />
            </span>
            <p>还没有表情包</p>
            {uploadControls}
          </div>
        )}
      </div>

      {notes.map((note) => (
        <p key={note} className="vc-footnote" data-vc-sticker-attribution="">
          {note}
        </p>
      ))}

      <input
        ref={fileInputRef}
        className="vc-sticker-file"
        type="file"
        data-vc-sticker-file=""
        accept="image/png,image/jpeg,image/webp,image/gif"
        onChange={(e) => {
          const picked = e.currentTarget.files?.[0];
          if (picked) {
            void handleUploadFile(picked);
          }
          e.currentTarget.value = '';
        }}
      />

      <AlertDialog
        open={Boolean(deletingId)}
        onOpenChange={(open) => {
          if (!open) setDeletingId(null);
        }}
        title="删除这张表情包？"
        description="删除后不能恢复。"
        confirmLabel="删除"
        cancelLabel="取消"
        danger
        onConfirm={() => void handleConfirmDelete()}
      />
    </section>
  );
}
export default StickerSettings;
