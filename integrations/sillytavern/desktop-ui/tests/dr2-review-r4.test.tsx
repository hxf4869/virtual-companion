import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AppProviders, queryClient } from '../src/app/providers';
import { createTestChatEnv } from './chat/fixtures';
import { SettingsRoute } from '../src/features/settings/SettingsRoute';
import { VoiceSection } from '../src/features/settings/VoiceSection';
import { DesktopVoiceForm } from '../src/features/settings/DesktopVoiceForm';
import { VoiceForm, voiceFormValues } from '../src/features/settings/VoiceForm';
import { AppearanceSection } from '../src/features/settings/AppearanceSection';
import { TavernRoute } from '../src/features/tavern/TavernRoute';
import { TavernEditor } from '../src/features/tavern/TavernEditor';
import { TavernActionButton } from '../src/features/tavern/CodeField';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function makeVoiceSettingsPayload(overrides: Record<string, unknown> = {}) {
  return {
    kokoroEnabled: true,
    cosyVoiceEnabled: false,
    asrEnabled: true,
    kokoroTimeoutSeconds: 30,
    cosyVoiceTimeoutSeconds: 30,
    asrTimeoutSeconds: 15,
    dailyChatLimit: 60,
    dailyProactiveLimit: 10,
    maxRecordingSeconds: 30,
    voiceFrequency: 'STANDARD',
    cosyVoiceInstructions: {
      morning: '早安指令',
      night: '晚安指令',
      care: '关心指令',
      share: '分享指令',
      default: '默认指令',
    },
    proactiveVoiceRates: {
      morning: 0.3,
      night: 0.3,
      care: 0.4,
      share: 0.2,
      default: 0.1,
    },
    kokoroMoodSpeeds: {
      开心: 1.28,
      黏人: 0.64,
      好奇: 1.28,
      得意: 1.28,
      懒洋洋: 0.64,
      有点累: 0.64,
      想独处: 0.64,
      有点烦: 1.28,
      困: 0.64,
    },
    revision: 1,
    ...overrides,
  };
}

function makeVoiceEnginesPayload(cosyConfigured = false) {
  return {
    tts: [
      {
        engine: 'kokoro',
        configured: true,
        enabled: true,
        healthy: true,
        voices: [{ id: 'zf_001', name: '中文女声', gender: 'FEMALE' }],
      },
      {
        engine: 'cosyvoice',
        configured: cosyConfigured,
        enabled: cosyConfigured,
        healthy: cosyConfigured,
        voices: [],
      },
    ],
    asr: {
      engine: 'asr',
      configured: true,
      enabled: true,
      healthy: true,
    },
  };
}

describe('DR2-12-R4: 设置/酒馆终审问题回归 (F18, F19, F20, F21, F23)', () => {
  beforeEach(() => {
    queryClient.clear();
    localStorage.clear();
    window.location.hash = '#/settings';
  });

  afterEach(() => {
    cleanup();
    queryClient.clear();
    vi.restoreAllMocks();
  });

  it('F23: 桌面语音设置三引擎开关使用 design/Switch（含 track/thumb），未配置引擎正确 disabled 且保留 track/thumb 结构', async () => {
    const env = createTestChatEnv();
    (env.client.go as any).fetchVoiceSettings = vi.fn(async () => makeVoiceSettingsPayload());
    (env.client.go as any).fetchVoiceEngines = vi.fn(async () => makeVoiceEnginesPayload(false));

    const { container } = render(
      <AppProviders client={env.client} queryClient={env.queryClient} sessionBridge={env.bridge}>
        <VoiceSection />
      </AppProviders>,
    );

    await waitFor(() => {
      expect(container.querySelector('[data-voice-field="dailyChatLimit"]')).toBeTruthy();
    });

    const kokoroSwitch = container.querySelector<HTMLElement>('[data-voice-field="kokoroEnabled"]');
    const cosySwitch = container.querySelector<HTMLElement>('[data-voice-field="cosyVoiceEnabled"]');
    const asrSwitch = container.querySelector<HTMLElement>('[data-voice-field="asrEnabled"]');

    expect(kokoroSwitch).toBeTruthy();
    expect(cosySwitch).toBeTruthy();
    expect(asrSwitch).toBeTruthy();

    // 三个引擎开关均必须渲染 design/Switch 的 track 与 thumb
    for (const sw of [kokoroSwitch!, cosySwitch!, asrSwitch!]) {
      expect(sw.getAttribute('role')).toBe('switch');
      expect(sw.classList.contains('vc-switch')).toBe(true);
      expect(sw.querySelector('.vc-switch__track')).toBeTruthy();
      expect(sw.querySelector('.vc-switch__thumb')).toBeTruthy();
    }

    // 已配置引擎可聚焦/点击切换（使用 Base UI switch 的真实 aria/data 属性语义）
    expect(kokoroSwitch!.hasAttribute('data-disabled')).toBe(false);
    expect(kokoroSwitch!.getAttribute('aria-checked')).toBe('true');
    kokoroSwitch!.focus();
    expect(document.activeElement).toBe(kokoroSwitch);
    fireEvent.click(kokoroSwitch!);
    expect(kokoroSwitch!.getAttribute('aria-checked')).toBe('false');

    // 未配置引擎正确 disabled（data-disabled / aria-disabled），点击不改变状态，且仍具备 track/thumb
    expect(cosySwitch!.hasAttribute('data-disabled')).toBe(true);
    expect(cosySwitch!.getAttribute('aria-disabled')).toBe('true');
    expect(cosySwitch!.getAttribute('aria-checked')).toBe('false');
    fireEvent.click(cosySwitch!);
    expect(cosySwitch!.getAttribute('aria-checked')).toBe('false');
    expect(cosySwitch!.querySelector('.vc-switch__track')).toBeTruthy();
  });

  it('F18: 桌面语音设置使用 Field/TextInput/Select 与 chevron details 皮肤，无重复页标题/次级 h3，保留原业务文案与数字中间态；原生 VoiceForm 保持不变', async () => {
    const env = createTestChatEnv();
    let savedBody: Record<string, unknown> | null = null;
    (env.client.go as any).fetchVoiceSettings = vi.fn(async () =>
      makeVoiceSettingsPayload({ cosyVoiceEnabled: true }),
    );
    (env.client.go as any).fetchVoiceEngines = vi.fn(async () => makeVoiceEnginesPayload(true));
    (env.client.go as any).saveVoiceSettings = vi.fn(async (payload: Record<string, unknown>) => {
      savedBody = payload;
      return { ...payload, revision: 2 };
    });

    const { container } = render(
      <AppProviders client={env.client} queryClient={env.queryClient} sessionBridge={env.bridge}>
        <SettingsRoute category="voice" />
      </AppProviders>,
    );

    await waitFor(() => {
      expect(container.querySelector('[data-voice-field="dailyChatLimit"]')).toBeTruthy();
    });

    const limitInput = container.querySelector<HTMLInputElement>('[data-voice-field="dailyChatLimit"]')!;

    // 1. 去掉 VoiceSection 重复页标题与多余次级 h3：整个设置页只有一个 h1「语音」
    const headings = screen.getAllByRole('heading', { name: '语音', level: 1 });
    expect(headings).toHaveLength(1);
    expect(container.querySelector('.vc-settings-title')).toBeNull();
    expect(container.querySelector('.vc-voice-settings h3')).toBeNull();

    // 2. 桌面行使用 design Field、TextInput 与 Select，声明式 wrapper marker 不使用 ref 篡改 DOM
    expect(limitInput.classList.contains('vc-text-input')).toBe(true);
    expect(limitInput.closest('.vc-field')).toBeTruthy();
    expect(limitInput.closest('.vc-field__row')).toBeTruthy();
    expect(limitInput.getAttribute('aria-label')).toBeTruthy();

    const freqWrap = container.querySelector<HTMLElement>('[data-voice-select="voiceFrequency"]');
    expect(freqWrap).toBeTruthy();
    const freqCombobox = freqWrap!.querySelector<HTMLElement>('[role="combobox"]');
    expect(freqCombobox).toBeTruthy();
    expect(freqCombobox!.classList.contains('vc-select')).toBe(true);
    expect(freqCombobox!.getAttribute('aria-label')).toBe('语音频率');

    // 3. 保留原始数字中间态（清空不跳回默认值）与原生 reportValidity 校验
    fireEvent.change(limitInput, { target: { value: '' } });
    expect(limitInput.value).toBe('');
    fireEvent.change(limitInput, { target: { value: '48' } });
    expect(limitInput.value).toBe('48');

    // 4. 折叠区保留原生 details/summary 展开与校验语义，并应用桌面 chevron 皮肤
    const detailsList = container.querySelectorAll('.vc-voice-settings details.vc-voice-details');
    expect(detailsList).toHaveLength(3);
    expect(container.querySelector('.vc-voice-settings summary.vc-voice-summary .vc-voice-chevron')).toBeTruthy();
    const careRateInput = container.querySelector<HTMLInputElement>('[data-voice-field="rate:care"]');
    expect(careRateInput).toBeTruthy();
    fireEvent.change(careRateInput!, { target: { value: '' } });
    expect(careRateInput!.value).toBe('');
    fireEvent.change(careRateInput!, { target: { value: '35' } });
    expect(careRateInput!.value).toBe('35');

    fireEvent.click(container.querySelector<HTMLButtonElement>('[data-voice-save]')!);
    await waitFor(() => {
      expect(savedBody).not.toBeNull();
    });
    expect(savedBody?.dailyChatLimit).toBe(48);
    expect((savedBody?.proactiveVoiceRates as Record<string, number>)?.care).toBe(0.35);

    // 5. 关系模式精确保留原业务/文案（optgroup 女生/男生/其他、!engine.enabled||!engine.healthy 禁用、正在生成语音…/暂停语音/试听）
    const relValues = voiceFormValues(makeVoiceSettingsPayload(), {
      kokoroVoice: 'zf_001',
      cosyVoice: '',
      speed: 1,
      voiceFrequency: '',
      proactiveEngine: '',
      proactiveVoice: true,
    });
    const relRender = render(
      <AppProviders client={env.client} queryClient={env.queryClient} sessionBridge={env.bridge}>
        <DesktopVoiceForm
          mode="relationship"
          values={relValues}
          engines={{
            tts: [
              {
                engine: 'kokoro',
                configured: true,
                enabled: false,
                healthy: true,
                voices: [{ id: 'zf_001', name: '中文女声', gender: 'FEMALE' }],
              },
              {
                engine: 'cosyvoice',
                configured: true,
                enabled: true,
                healthy: true,
                voices: [{ id: 'cv_1', name: '温柔男声', gender: 'MALE' }],
              },
            ],
            asr: { engine: 'asr', configured: true, enabled: true, healthy: true },
          }}
          disabled={false}
          preview={{ cosyvoice: { playing: true } }}
          onFieldChange={() => {}}
          onPreview={() => {}}
        />
      </AppProviders>,
    );
    const kokoroVoiceSelect = relRender.container.querySelector<HTMLSelectElement>(
      'select[data-voice-field="kokoroVoice"]',
    );
    expect(kokoroVoiceSelect).toBeTruthy();
    expect(
      Array.from(kokoroVoiceSelect!.querySelectorAll('optgroup')).map((g) => g.label),
    ).toEqual(['女生', '男生', '其他']);
    const kokoroPreviewBtn = relRender.container.querySelector<HTMLButtonElement>(
      '[data-preview-engine="kokoro"]',
    );
    const cosyPreviewBtn = relRender.container.querySelector<HTMLButtonElement>(
      '[data-preview-engine="cosyvoice"]',
    );
    expect(kokoroPreviewBtn!.disabled).toBe(true);
    expect(kokoroPreviewBtn!.textContent).toBe('试听');
    expect(cosyPreviewBtn!.disabled).toBe(false);
    expect(cosyPreviewBtn!.textContent).toBe('暂停语音');

    // 6. 原生桥接组件 VoiceForm 保持原契约不变
    const rawSettings = makeVoiceSettingsPayload();
    const nativeValues = voiceFormValues(rawSettings);
    expect(nativeValues.dailyChatLimit).toBe('60');
    const nativeRender = render(
      <VoiceForm
        mode="global"
        values={nativeValues}
        engines={makeVoiceEnginesPayload(true)}
        disabled={false}
        onFieldChange={() => {}}
      />,
    );
    expect(nativeRender.container.querySelector('details')).toBeTruthy();
  });

  it('F19: Appearance 控件列对齐一致，Segment 轨道宽度适配内容且保持主题/偏好行为', () => {
    const cssPath = resolve(__dirname, '../src/features/settings/settings.css');
    const css = readFileSync(cssPath, 'utf8');

    // 验证 CSS 明确约束 .vc-desk-field 控件列左对齐及 .vc-segment 宽度 fit-content
    expect(css).toMatch(/\.vc-desk-field[\s\S]*?justify-items:\s*start/);
    expect(css).toMatch(/\.vc-segment[\s\S]*?width:\s*fit-content/);

    const env = createTestChatEnv();
    render(
      <AppProviders client={env.client} queryClient={env.queryClient} sessionBridge={env.bridge}>
        <AppearanceSection />
      </AppProviders>,
    );
    fireEvent.click(screen.getByRole('radio', { name: '深色' }));
    expect(localStorage.getItem('vc-theme')).toBe('dark');
    expect(document.documentElement.dataset.vcTheme).toBe('dark');
  });

  it('F20: TavernRoute 复用 SettingsNav（相同标题、分组、16px 图标与条目顺序），保留离开保护与 embedded 模式', async () => {
    const env = createTestChatEnv();
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/settings/get') {
        return jsonResponse({
          settings: JSON.stringify({
            oai_settings: { preset_settings_openai: 'Default', temp_openai: 1, prompts: [], prompt_order: [] },
            power_user: {},
            world_info_settings: { world_info: { globalSelect: [], charLore: [] } },
            extension_settings: {},
          }),
          openai_setting_names: ['Default'],
          openai_settings: [JSON.stringify({})],
          context: [],
          instruct: [],
          sysprompt: [],
          reasoning: [],
        });
      }
      if (url.endsWith('/model-purposes') || url.endsWith('/providers')) {
        return jsonResponse({ items: [] });
      }
      return jsonResponse({});
    });
    vi.stubGlobal('fetch', fetchMock);

    const settingsRender = render(
      <AppProviders client={env.client} queryClient={env.queryClient} sessionBridge={env.bridge}>
        <SettingsRoute category="account" />
      </AppProviders>,
    );
    const settingsNav = settingsRender.container.querySelector('.vc-settings-categories')!;
    expect(settingsNav).toBeTruthy();
    const settingsCategories = [...settingsNav.querySelectorAll('[data-category]')].map((el) =>
      el.getAttribute('data-category'),
    );
    const settingsIconSizes = [...settingsNav.querySelectorAll('.vc-tile svg')].map((svg) =>
      svg.getAttribute('width'),
    );
    settingsRender.unmount();

    const tavernRender = render(
      <AppProviders client={env.client} queryClient={env.queryClient} sessionBridge={env.bridge}>
        <TavernRoute section="rm_api_block" />
      </AppProviders>,
    );
    await screen.findByRole('heading', { name: 'API 连接', level: 1 });

    const tavernNav = tavernRender.container.querySelector('.vc-settings-categories')!;
    expect(tavernNav).toBeTruthy();
    expect(tavernNav.tagName).toBe('ASIDE');
    expect(tavernNav.querySelector('.vc-settings-categories-title')?.textContent).toBe('设置');
    expect(tavernNav.querySelector('.vc-settings-categories-section')?.textContent).toBe('酒馆设置');

    const tavernCategories = [...tavernNav.querySelectorAll('[data-category]')].map((el) =>
      el.getAttribute('data-category'),
    );
    const tavernIconSizes = [...tavernNav.querySelectorAll('.vc-tile svg')].map((svg) =>
      svg.getAttribute('width'),
    );

    expect(tavernCategories).toEqual(settingsCategories);
    expect(tavernIconSizes).toEqual(settingsIconSizes);
    expect(tavernIconSizes.every((w) => w === '16')).toBe(true);
    tavernRender.unmount();

    // 验证 embedded 模式不渲染重复左栏
    const embeddedRender = render(
      <AppProviders client={env.client} queryClient={env.queryClient} sessionBridge={env.bridge}>
        <TavernRoute section="rm_api_block" embedded />
      </AppProviders>,
    );
    expect(embeddedRender.container.querySelector('.vc-settings-categories')).toBeNull();
  });

  it('F21: TavernEditor 与酒馆页面导入按钮均复用 design/Button variant="gray"，不含无意义 vc-btn-gray 类且保留文件选择事件', () => {
    const onEditorAction = vi.fn();
    const editorRender = render(
      <TavernEditor
        sprite="/sprite.svg"
        loading={false}
        busy={false}
        resources={[
          {
            key: 'preset',
            label: '预设',
            value: 'default',
            options: [{ value: 'default', label: '默认预设' }],
          },
        ]}
        actions={[
          { id: 'preset-import', label: '导入', accept: '.json' },
          { id: 'preset-save-as', label: '另存为' },
        ]}
        groups={[]}
        onField={() => {}}
        onAction={onEditorAction}
      />,
    );

    const editorImportBtn = editorRender.container.querySelector<HTMLButtonElement>(
      '[data-tavern-action="preset-import"]',
    );
    expect(editorImportBtn).toBeTruthy();
    expect(editorImportBtn!.tagName).toBe('BUTTON');
    expect(editorImportBtn!.classList.contains('vc-btn')).toBe(true);
    expect(editorImportBtn!.classList.contains('vc-btn--gray')).toBe(true);
    expect(editorImportBtn!.classList.contains('vc-btn-gray')).toBe(false);

    const editorFileInput = editorRender.container.querySelector<HTMLInputElement>(
      '[data-tavern-upload="preset-import"]',
    );
    expect(editorFileInput).toBeTruthy();
    const editorClickSpy = vi.spyOn(editorFileInput!, 'click');
    fireEvent.click(editorImportBtn!);
    expect(editorClickSpy).toHaveBeenCalledTimes(1);

    const testFile = new File(['{"temp":1}'], 'preset.json', { type: 'application/json' });
    fireEvent.change(editorFileInput!, { target: { files: [testFile] } });
    expect(onEditorAction).toHaveBeenCalledWith('preset-import', testFile);
    editorRender.unmount();

    // 验证桌面酒馆页面 TavernActionButton 同样使用 design/Button variant="gray"
    const onReplyAction = vi.fn();
    const replyRender = render(
      <TavernActionButton
        action={{ id: 'preset-import', label: '导入', accept: '.json' }}
        busy={false}
        onAction={onReplyAction}
      />,
    );

    const replyImportBtn = replyRender.container.querySelector<HTMLButtonElement>(
      '[data-tavern-action="preset-import"]',
    );
    expect(replyImportBtn).toBeTruthy();
    expect(replyImportBtn!.tagName).toBe('BUTTON');
    expect(replyImportBtn!.classList.contains('vc-btn')).toBe(true);
    expect(replyImportBtn!.classList.contains('vc-btn--gray')).toBe(true);
    expect(replyImportBtn!.classList.contains('vc-btn-gray')).toBe(false);

    const replyFileInput = replyRender.container.querySelector<HTMLInputElement>(
      '[data-tavern-upload="preset-import"]',
    );
    expect(replyFileInput).toBeTruthy();
    const replyClickSpy = vi.spyOn(replyFileInput!, 'click');
    fireEvent.click(replyImportBtn!);
    expect(replyClickSpy).toHaveBeenCalledTimes(1);
    fireEvent.change(replyFileInput!, { target: { files: [testFile] } });
    expect(onReplyAction).toHaveBeenCalledWith('preset-import', testFile);
  });
});
