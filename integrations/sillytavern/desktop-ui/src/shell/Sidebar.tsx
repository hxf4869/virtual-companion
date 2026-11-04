import { useCallback, useEffect, useLayoutEffect, useRef } from 'react';
import { Avatar } from '../design/components/Avatar';
import { Icon } from '../design/components/Icon';
import type { ChromeTier } from './useChrome';

export type ShellDestination = 'chat' | 'characters' | 'memory' | 'inbox' | 'story';

export interface DestinationItem {
  nav: ShellDestination;
  label: string;
  icon: string;
}

export const SHELL_DESTINATIONS: readonly DestinationItem[] = [
  { nav: 'chat', label: '聊天', icon: 'message-circle' },
  { nav: 'characters', label: '角色', icon: 'users-round' },
  { nav: 'memory', label: '记忆', icon: 'brain' },
  { nav: 'inbox', label: '陪伴', icon: 'heart' },
  { nav: 'story', label: '剧情', icon: 'book-open' },
];

export interface SidebarProps {
  chrome: ChromeTier;
  activeDestination: ShellDestination | null;
  settingsActive?: boolean;
  collapsed: boolean;
  inboxBadge?: number;
  chatDot?: boolean;
  characterName?: string;
  characterAvatarUrl?: string;
  onSelectDestination?: (nav: ShellDestination) => void;
  onOpenSettings?: () => void;
  onToggleCollapse?: () => void;
}

export function Sidebar({
  chrome,
  activeDestination,
  settingsActive = false,
  collapsed,
  inboxBadge = 0,
  chatDot = false,
  characterName = '',
  characterAvatarUrl = '',
  onSelectDestination,
  onOpenSettings,
  onToggleCollapse,
}: SidebarProps) {
  const isCompactOrNarrow = chrome === 'compact' || chrome === 'narrow';
  const effectiveCollapsed = isCompactOrNarrow ? true : Boolean(collapsed);

  const sidebarRef = useRef<HTMLElement | null>(null);
  const lensRef = useRef<HTMLElement | null>(null);

  const lensTarget = settingsActive ? 'settings' : (activeDestination ?? '');

  const syncLens = useCallback(() => {
    const sidebar = sidebarRef.current;
    const lens = lensRef.current;
    if (!sidebar || !lens) return;
    const activeEl = sidebar.querySelector('[aria-current="page"]') as HTMLElement | null;
    if (!activeEl) {
      lens.style.opacity = '0';
      return;
    }
    lens.style.opacity = '1';
    const r = activeEl.getBoundingClientRect();
    const p = sidebar.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) {
      lens.style.width = `${r.width}px`;
      lens.style.height = `${r.height}px`;
      lens.style.transform = `translate(${r.left - p.left}px, ${r.top - p.top + sidebar.scrollTop}px)`;
    } else {
      const w = activeEl.offsetWidth || (effectiveCollapsed ? 44 : 176);
      const h = activeEl.offsetHeight || 40;
      const x = activeEl.offsetLeft || 0;
      const y = activeEl.offsetTop || 0;
      lens.style.width = `${w}px`;
      lens.style.height = `${h}px`;
      lens.style.transform = `translate(${x}px, ${y}px)`;
    }
  }, [effectiveCollapsed]);

  useLayoutEffect(() => {
    syncLens();
  }, [lensTarget, effectiveCollapsed, syncLens]);

  useEffect(() => {
    const sidebar = sidebarRef.current;
    if (!sidebar || typeof ResizeObserver !== 'function') return undefined;
    const ro = new ResizeObserver(() => {
      syncLens();
    });
    ro.observe(sidebar);
    return () => ro.disconnect();
  }, [syncLens]);

  useEffect(() => {
    if (isCompactOrNarrow || !onToggleCollapse) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === '\\') {
        event.preventDefault();
        onToggleCollapse();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isCompactOrNarrow, onToggleCollapse]);

  const badgeCount = Number(inboxBadge) || 0;
  const badgeText = badgeCount > 99 ? '99+' : badgeCount > 0 ? String(badgeCount) : '';

  return (
    <aside
      ref={sidebarRef}
      className={['vc-sidebar', effectiveCollapsed ? 'is-collapsed' : '']
        .filter(Boolean)
        .join(' ')}
      aria-label="主导航"
      data-collapsed={effectiveCollapsed ? 'true' : 'false'}
    >
      <i
        ref={lensRef}
        className="vc-desktop-lens"
        data-side-lens=""
        data-lens-target={lensTarget}
        aria-hidden="true"
      />
      <div className="vc-side-top">
        {!effectiveCollapsed ? (
          <span className="vc-side-brand" aria-hidden="true">
            陪伴
          </span>
        ) : null}
        {!isCompactOrNarrow ? (
          <button
            type="button"
            className="vc-icon-btn vc-side-collapse"
            data-collapse=""
            aria-label="收起或展开侧栏"
            title={effectiveCollapsed ? '展开侧栏 (⌘\\)' : '收起侧栏 (⌘\\)'}
            onClick={() => onToggleCollapse?.()}
          >
            <Icon name="panel-left" size={18} />
          </button>
        ) : null}
      </div>

      <nav className="vc-side-nav" aria-label="一级导航">
        {SHELL_DESTINATIONS.map((item) => {
          const isActive = !settingsActive && activeDestination === item.nav;
          return (
            <button
              key={item.nav}
              type="button"
              className={['vc-side-item', isActive ? 'is-active' : ''].filter(Boolean).join(' ')}
              data-nav={item.nav}
              aria-current={isActive ? 'page' : undefined}
              aria-label={item.label}
              title={effectiveCollapsed ? item.label : undefined}
              onClick={() => onSelectDestination?.(item.nav)}
            >
              <span className="vc-side-icon" aria-hidden="true">
                <Icon name={item.icon} size={20} />
              </span>
              {!effectiveCollapsed ? <span className="vc-side-label">{item.label}</span> : null}
              {item.nav === 'chat' ? (
                <span
                  className="vc-side-dot"
                  data-dot="chat"
                  hidden={!chatDot}
                  aria-hidden="true"
                />
              ) : null}
              {item.nav === 'inbox' ? (
                <span className="vc-side-badge" data-badge="inbox" hidden={!badgeText}>
                  <span className="vc-badge">{badgeText}</span>
                </span>
              ) : null}
            </button>
          );
        })}
      </nav>

      <div className="vc-side-foot">
        <div
          className="vc-side-avatar"
          title={characterName || '当前角色'}
          data-character-name={characterName || undefined}
        >
          <Avatar src={characterAvatarUrl || undefined} name={characterName || '伴'} size={36} />
        </div>
        <button
          type="button"
          className={[
            'vc-side-item',
            'vc-side-settings',
            settingsActive ? 'is-active' : '',
          ]
            .filter(Boolean)
            .join(' ')}
          data-settings=""
          aria-current={settingsActive ? 'page' : undefined}
          aria-label="设置"
          title="设置"
          onClick={() => onOpenSettings?.()}
        >
          <span className="vc-side-icon" aria-hidden="true">
            <Icon name="settings" size={20} />
          </span>
          {!effectiveCollapsed ? <span className="vc-side-label">设置</span> : null}
        </button>
      </div>
    </aside>
  );
}
