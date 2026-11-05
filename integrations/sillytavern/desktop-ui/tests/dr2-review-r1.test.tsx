import fs from 'node:fs';
import path, { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import { RouterProvider } from '@tanstack/react-router';
import { describe, expect, it, vi } from 'vitest';
import { AppProviders } from '../src/app/providers';
import { createDesktopRouter } from '../src/app/router';
import type { AppClient } from '../src/data/client';
import { Icon } from '../src/design/components/Icon';
import { Sidebar } from '../src/shell/Sidebar';
import { AppShell } from '../src/shell/AppShell';

const DESKTOP_UI_ROOT = resolve(__dirname, '..');
const ST_ROOT = resolve(DESKTOP_UI_ROOT, '..');
const LUCIDE_SPRITE_PATH = path.join(
  ST_ROOT,
  'extension/vc-model-settings/ui/icons/lucide.svg',
);

const ORIGINAL_54_SYMBOLS = [
  'message-circle',
  'users-round',
  'brain',
  'heart',
  'book-open',
  'chevron-left',
  'chevron-right',
  'chevrons-up-down',
  'ellipsis',
  'plus',
  'arrow-up',
  'arrow-down',
  'square',
  'refresh-cw',
  'pencil',
  'copy',
  'search',
  'x',
  'history',
  'key-round',
  'watch',
  'image',
  'settings',
  'sliders-horizontal',
  'sparkles',
  'quote',
  'book-marked',
  'puzzle',
  'user-round',
  'monitor',
  'link',
  'bell',
  'shield',
  'layers',
  'check',
  'trash-2',
  'text-cursor',
  'play',
  'wand-sparkles',
  'zap',
  'square-pen',
  'git-branch',
  'globe',
  'upload',
  'download',
  'circle-alert',
  'wifi-off',
  'lock',
  'file-text',
  'cpu',
  'mic',
  'pause',
  'volume-2',
  'smile',
] as const;

function parseSpriteSymbols(svgText: string): Map<string, string> {
  const map = new Map<string, string>();
  const re = /<symbol\s+id="([^"]+)"[^>]*>([\s\S]*?)<\/symbol>/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(svgText)) !== null) {
    map.set(match[1], match[2].trim());
  }
  return map;
}

function collectUsedIconsInDesktopSrc(srcDir: string): Set<string> {
  const icons = new Set<string>();
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'components' && dir === srcDir) continue;
        walk(full);
      } else if (/\.(tsx|ts)$/.test(entry.name)) {
        const text = fs.readFileSync(full, 'utf8');
        for (const m of text.matchAll(/<(?:Icon|IconButton|EmptyState)\b[^>]*\b(?:name|icon)\s*=\s*["']([^"']+)["']/g)) {
          icons.add(m[1]);
        }
        for (const m of text.matchAll(/\bicon\s*=\s*["']([^"']+)["']/g)) {
          icons.add(m[1]);
        }
        for (const m of text.matchAll(/\bicon\s*:\s*["']([^"']+)["']/g)) {
          icons.add(m[1]);
        }
      }
    }
  };
  walk(srcDir);
  return icons;
}

describe('DR2-12-R1 regression suite (F1, F2, F3, F17, F22)', () => {
  it('F2: preserves all 54 original Lucide symbols and resolves every literal/dynamic icon used in desktop-ui to non-empty SVG geometry', () => {
    const svgText = fs.readFileSync(LUCIDE_SPRITE_PATH, 'utf8');
    const symbols = parseSpriteSymbols(svgText);

    for (const orig of ORIGINAL_54_SYMBOLS) {
      expect(symbols.has(orig), `Missing original symbol: ${orig}`).toBe(true);
    }

    const usedIcons = collectUsedIconsInDesktopSrc(path.join(DESKTOP_UI_ROOT, 'src'));
    for (const name of [
      'close',
      'send',
      'stop',
      'edit',
      'refresh',
      'volume',
      'alert',
      'panel-left',
      'chevron-down',
      'clock',
      'star',
      'book',
      'inbox',
    ]) {
      usedIcons.add(name);
    }

    for (const iconName of usedIcons) {
      const { container, unmount } = render(<Icon name={iconName} />);
      const useEl = container.querySelector('svg use');
      expect(useEl, `<Icon name="${iconName}"> must render <use>`).not.toBeNull();
      const href = useEl?.getAttribute('href') ?? '';
      expect(href.startsWith('/scripts/extensions/third-party/vc-model-settings/ui/icons/lucide.svg#')).toBe(
        true,
      );
      const symbolId = href.split('#')[1] ?? '';
      expect(
        symbols.has(symbolId),
        `Icon "${iconName}" resolved to "#${symbolId}", which is missing from lucide.svg`,
      ).toBe(true);
      const body = symbols.get(symbolId) ?? '';
      expect(
        /<(?:path|circle|rect|line|polyline|polygon)\b/.test(body),
        `Symbol "#${symbolId}" for icon "${iconName}" has no SVG geometry`,
      ).toBe(true);
      unmount();
    }

    // Distinct semantic icons must not collapse onto the same fallback symbol
    const renderedSymbolIds = [
      'close',
      'send',
      'stop',
      'edit',
      'panel-left',
      'chevron-down',
      'inbox',
    ].map((name) => {
      const { container, unmount } = render(<Icon name={name} />);
      const href = container.querySelector('svg use')?.getAttribute('href') ?? '';
      unmount();
      return href.split('#')[1];
    });
    expect(new Set(renderedSymbolIds).size).toBe(renderedSymbolIds.length);

    // Explicit custom sprite preserves raw name semantics without applying default aliases
    const customRender = render(<Icon name="close" sprite="/custom-icons.svg" size="1.5rem" label="关闭图标" style={{ opacity: 0.8 }} />);
    const customSvg = customRender.container.querySelector('svg') as SVGSVGElement;
    const customUse = customRender.container.querySelector('svg use');
    expect(customUse?.getAttribute('href')).toBe('/custom-icons.svg#close');
    expect(customSvg.getAttribute('role')).toBe('img');
    expect(customSvg.getAttribute('aria-label')).toBe('关闭图标');
    expect(customSvg.getAttribute('aria-hidden')).toBeNull();
    expect(customSvg.style.getPropertyValue('--vc-icon-size')).toBe('1.5rem');
    expect(customSvg.style.opacity).toBe('0.8');
    customRender.unmount();
  });

  it('F1 & F17: unifies .vc-icon-button, .vc-icon-btn, .vc-circle skin and defines public semantic rules (.vc-sr, .vc-meta, .vc-note, .vc-glass, .vc-dim, .vc-link)', () => {
    const baseCss = fs.readFileSync(
      path.join(DESKTOP_UI_ROOT, 'src/design/base.css'),
      'utf8',
    );
    const iconBtnCss = fs.readFileSync(
      path.join(DESKTOP_UI_ROOT, 'src/design/components/IconButton.css'),
      'utf8',
    );
    const appShellCss = fs.readFileSync(
      path.join(DESKTOP_UI_ROOT, 'src/shell/AppShell.css'),
      'utf8',
    );
    const combinedCss = `${baseCss}\n${iconBtnCss}\n${appShellCss}`;

    // base.css must not duplicate @import IconButton.css (already imported by IconButton component)
    expect(baseCss).not.toContain('IconButton.css');

    // .vc-sr must be visually hidden alongside .vc-sr-only, never display: none
    expect(baseCss).toMatch(/\.vc-sr\b/);
    const srBlockMatch = baseCss.match(/\.vc-sr(?:-only)?[^{]*\{([^}]+)\}/);
    expect(srBlockMatch).not.toBeNull();
    expect(srBlockMatch?.[1]).toContain('position: absolute');
    expect(srBlockMatch?.[1]).toContain('clip: rect(0, 0, 0, 0)');
    expect(srBlockMatch?.[1]).not.toContain('display: none');

    // Legacy icon button classes (.vc-icon-btn, .vc-circle) share unified skin with .vc-icon-button
    expect(combinedCss).toMatch(/\.vc-icon-btn\b/);
    expect(combinedCss).toMatch(/\.vc-circle\b/);
    // Must not indiscriminately reset all button elements in base.css
    expect(baseCss).not.toMatch(/^\s*button\s*\{/m);

    // Public semantic classes must have token-backed rules
    expect(combinedCss).toMatch(/\.vc-meta\s*\{/);
    expect(combinedCss).toMatch(/\.vc-dim\s*\{/);
    expect(combinedCss).toMatch(/\.vc-note\s*\{/);
    expect(combinedCss).toMatch(/\.vc-glass\s*\{/);
    expect(combinedCss).toMatch(/\.vc-link\s*\{/);
    expect(appShellCss).toMatch(/\.vc-chat-header__title-btn\s*\{/);

    // Sidebar collapse button uses unified IconButton skin while keeping .vc-icon-btn & aria-label
    const onToggleCollapse = vi.fn();
    render(
      <Sidebar
        chrome="regular"
        collapsed={false}
        activeDestination="chat"
        settingsActive={false}
        onSelectDestination={() => {}}
        onOpenSettings={() => {}}
        onToggleCollapse={onToggleCollapse}
      />,
    );
    const collapseBtn = screen.getByRole('button', { name: '收起或展开侧栏' });
    expect(collapseBtn.classList.contains('vc-icon-button')).toBe(true);
    expect(collapseBtn.classList.contains('vc-icon-btn')).toBe(true);
    fireEvent.click(collapseBtn);
    expect(onToggleCollapse).toHaveBeenCalledTimes(1);
  });

  it('F3: empty session renders header placeholder "选择一个会话开始聊天" while Sidebar avatar fallback stays "伴" (not "选")', () => {
    vi.stubGlobal(
      'matchMedia',
      vi.fn((query: string) => ({
        media: query,
        matches: query.includes('min-width: 744px') || query.includes('min-width: 1180px'),
        onchange: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    );
    const { container } = render(
      <AppShell
        destination="chat"
        activeConversationKey={null}
        activeCharacterName=""
        activeCharacterAvatar=""
        conversations={[]}
      >
        <div data-testid="chat-body" />
      </AppShell>,
    );

    const headerTitle = container.querySelector('.vc-chat-header__title');
    expect(headerTitle?.textContent).toBe('选择一个会话开始聊天');

    const sidebarAvatarFallback = container.querySelector(
      '.vc-side-avatar .vc-avatar__fallback',
    );
    expect(sidebarAvatarFallback?.textContent).toBe('伴');
    expect(sidebarAvatarFallback?.textContent).not.toBe('选');
    vi.unstubAllGlobals();
  });

  it('F4: empty conversation does not occupy wide right character panel column, hides/disables panel trigger in AppShell & DesktopChatHeader, and preserves user panel preference when entering conversation', async () => {
    vi.stubGlobal(
      'matchMedia',
      vi.fn((query: string) => ({
        media: query,
        matches:
          query.includes('min-width: 744px') ||
          query.includes('min-width: 1180px') ||
          query.includes('min-width: 1600px'),
        onchange: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    );

    const { container, rerender, unmount } = render(
      <AppShell
        destination="chat"
        activeConversationKey={null}
        conversations={[
          { key: 'conv-alice', title: 'Alice', avatar: 'alice.png', relationshipId: 'rel-1' },
          { key: 'conv-bob', title: 'Bob', avatar: 'bob.png', relationshipId: 'rel-2' },
        ]}
        characterPanel={<div data-testid="char-panel-content">Profile</div>}
      >
        <div data-testid="chat-body" />
      </AppShell>,
    );

    const shell = container.querySelector('#vc-shell') as HTMLElement;
    const panelEl = container.querySelector('[data-char-panel]') as HTMLElement;
    const panelToggle = container.querySelector('[data-panel-toggle]') as HTMLButtonElement;

    // 1. Wide tier with empty session: right column not occupied, trigger hidden & disabled
    expect(shell.dataset.chrome).toBe('wide');
    expect(shell.dataset.panelOpen).toBe('false');
    expect(shell.dataset.layout).toBe('list-main');
    expect(panelEl.hidden).toBe(true);
    expect(panelToggle.hidden).toBe(true);
    expect(panelToggle.disabled).toBe(true);

    // 2. Enter active conversation on wide: defaults to open (four-col), trigger visible & enabled
    rerender(
      <AppShell
        destination="chat"
        activeConversationKey="conv-alice"
        conversations={[
          { key: 'conv-alice', title: 'Alice', avatar: 'alice.png', relationshipId: 'rel-1' },
          { key: 'conv-bob', title: 'Bob', avatar: 'bob.png', relationshipId: 'rel-2' },
        ]}
        characterPanel={<div data-testid="char-panel-content">Profile</div>}
      >
        <div data-testid="chat-body" />
      </AppShell>,
    );
    expect(shell.dataset.panelOpen).toBe('true');
    expect(shell.dataset.layout).toBe('four-col');
    expect(panelEl.hidden).toBe(false);
    expect(panelToggle.hidden).toBe(false);
    expect(panelToggle.disabled).toBe(false);

    // 3. User closes panel -> returns to empty session -> enters another conversation: user preference (closed) preserved
    fireEvent.click(panelToggle);
    expect(shell.dataset.panelOpen).toBe('false');
    expect(shell.dataset.layout).toBe('list-main');

    rerender(
      <AppShell
        destination="chat"
        activeConversationKey={null}
        conversations={[
          { key: 'conv-alice', title: 'Alice', avatar: 'alice.png', relationshipId: 'rel-1' },
          { key: 'conv-bob', title: 'Bob', avatar: 'bob.png', relationshipId: 'rel-2' },
        ]}
        characterPanel={<div data-testid="char-panel-content">Profile</div>}
      >
        <div data-testid="chat-body" />
      </AppShell>,
    );
    expect(shell.dataset.panelOpen).toBe('false');
    expect(panelToggle.hidden).toBe(true);
    expect(panelToggle.disabled).toBe(true);

    rerender(
      <AppShell
        destination="chat"
        activeConversationKey="conv-bob"
        conversations={[
          { key: 'conv-alice', title: 'Alice', avatar: 'alice.png', relationshipId: 'rel-1' },
          { key: 'conv-bob', title: 'Bob', avatar: 'bob.png', relationshipId: 'rel-2' },
        ]}
        characterPanel={<div data-testid="char-panel-content">Profile</div>}
      >
        <div data-testid="chat-body" />
      </AppShell>,
    );
    expect(shell.dataset.panelOpen).toBe('false');
    expect(shell.dataset.layout).toBe('list-main');
    expect(panelToggle.hidden).toBe(false);
    expect(panelToggle.disabled).toBe(false);
    unmount();

    // 4. Router DesktopChatHeader also hides/disables [data-panel-toggle] when no conversation is active
    const fakeClient = {
      initialize: vi.fn(async () => ({ characters: [], chat: [], settings: {} })),
      go: {
        captureSessionContext: vi.fn(async () => ({ userId: 'u-1', sessionId: 's-1' })),
        listRelationships: vi.fn(async () => []),
        listInbox: vi.fn(async () => []),
      },
    } as unknown as AppClient;

    const router = createDesktopRouter({
      initialEntry: '/chat',
      conversations: [
        { key: 'conv-alice', title: 'Alice', avatar: 'alice.png', relationshipId: 'rel-1' },
      ],
      routeOverrides: {
        chat: () => <div data-testid="custom-chat-route" />,
      },
    });
    const routerRender = render(
      <AppProviders client={fakeClient}>
        <RouterProvider router={router} />
      </AppProviders>,
    );
    await act(async () => {
      await router.load();
    });

    await waitFor(() => {
      expect(routerRender.container.querySelector('#vc-shell')).toBeTruthy();
    });
    const routerShell = routerRender.container.querySelector('#vc-shell') as HTMLElement;
    const routerToggle = routerRender.container.querySelector(
      '[data-panel-toggle]',
    ) as HTMLButtonElement;
    expect(routerShell.dataset.panelOpen).toBe('false');
    expect(routerShell.dataset.layout).toBe('list-main');
    expect(routerToggle.hidden).toBe(true);
    expect(routerToggle.disabled).toBe(true);

    await act(async () => {
      await router.navigate({
        to: '/chat/$conversationKey',
        params: { conversationKey: 'conv-alice' },
      });
    });
    expect(routerShell.dataset.panelOpen).toBe('true');
    expect(routerShell.dataset.layout).toBe('four-col');
    expect(routerToggle.hidden).toBe(false);
    expect(routerToggle.disabled).toBe(false);

    routerRender.unmount();
    vi.unstubAllGlobals();
  });

  it(
    'F22: owned design/shell CSS places -webkit-backdrop-filter before standard backdrop-filter so production build retains standard backdrop-filter',
    () => {
      const ownedCssFiles = [
        'src/design/base.css',
        'src/design/components/AlertDialog.css',
        'src/design/components/Dialog.css',
        'src/design/components/Menu.css',
        'src/design/components/Popover.css',
        'src/design/components/Select.css',
        'src/design/components/Toast.css',
        'src/design/components/Tooltip.css',
        'src/shell/AppShell.css',
      ];

      for (const relPath of ownedCssFiles) {
        const fullPath = path.join(DESKTOP_UI_ROOT, relPath);
        const css = fs.readFileSync(fullPath, 'utf8');
        const wrongOrder =
          /(?<![-\w])backdrop-filter\s*:[^;]+;\s*-webkit-backdrop-filter\s*:/m.test(css);
        expect(
          wrongOrder,
          `${relPath} places standard backdrop-filter before -webkit-backdrop-filter, which causes LightningCSS to strip standard backdrop-filter`,
        ).toBe(false);
        expect(
          /-webkit-backdrop-filter\s*:[^;]+;\s*backdrop-filter\s*:/m.test(css),
          `${relPath} must place -webkit-backdrop-filter before standard backdrop-filter`,
        ).toBe(true);
      }

      const appAssetsDir = path.join(
        ST_ROOT,
        'server-plugin/virtual-companion/desktop/app/assets',
      );
      if (
        !fs.existsSync(appAssetsDir) ||
        !fs.readdirSync(appAssetsDir).some((f) => /^index-.*\.css$/.test(f))
      ) {
        const buildRes = spawnSync(
          process.execPath,
          [path.join(ST_ROOT, 'scripts/build-desktop.mjs')],
          { encoding: 'utf8' },
        );
        expect(buildRes.status).toBe(0);
      }

      const indexCssFile = fs
        .readdirSync(appAssetsDir)
        .find((f) => /^index-.*\.css$/.test(f));
      expect(indexCssFile).toBeDefined();
      const builtCss = fs.readFileSync(path.join(appAssetsDir, indexCssFile!), 'utf8');

      for (const selector of [
        '.vc-dialog{',
        '.vc-alert-dialog{',
        '.vc-menu{',
        '.vc-popover{',
        '.vc-select__popup{',
        '.vc-toast{',
        '.vc-glass{',
        '.vc-panel{',
        '.vc-sidebar{',
        '.vc-char-panel--floating{',
      ]) {
        const idx = builtCss.indexOf(selector);
        expect(idx, `Selector ${selector} must exist in built CSS`).toBeGreaterThanOrEqual(0);
        const ruleBlock = builtCss.slice(idx, builtCss.indexOf('}', idx) + 1);
        expect(
          /(?<![-\w])backdrop-filter:blur\(/.test(ruleBlock),
          `Built rule for ${selector} must retain standard backdrop-filter:blur(...), got: ${ruleBlock}`,
        ).toBe(true);
      }
    },
    25000,
  );
});
