import React, { useCallback, useMemo } from 'react';
import { useNavigate } from '@tanstack/react-router';
import type { AppearancePreferencesBinding } from '../features/settings/AppearanceSection';
import {
  SettingsRoute,
  type ProductSettingsCategory,
  type SettingsLeaveGuardState,
  type SettingsRouteProps,
} from '../features/settings/SettingsRoute';
import { useLeaveGuard } from '../shell/useLeaveGuard';
import { usePreferences } from '../shell/usePreferences';

function DesktopRouterLeaveGuard({ dirty, busy }: SettingsLeaveGuardState) {
  return <>{useLeaveGuard(dirty, { busy })}</>;
}

export interface SettingsRouteAdapterProps {
  category?: string;
  relationshipId?: string;
  View?: React.ComponentType<SettingsRouteProps>;
}

export function SettingsRouteAdapter({
  category = 'account',
  relationshipId,
  View = SettingsRoute,
}: SettingsRouteAdapterProps) {
  const navigate = useNavigate();

  const themeMode = usePreferences((s) => s.themeMode);
  const desktopThemePrefs = usePreferences((s) => s.desktopThemePrefs);
  const replyStyle = usePreferences((s) => s.replyStyle);
  const reducedMotion = usePreferences((s) => s.reducedMotion);
  const setThemeMode = usePreferences((s) => s.setThemeMode);
  const setGlobalDesktopTheme = usePreferences((s) => s.setGlobalDesktopTheme);
  const setCharacterDesktopTheme = usePreferences((s) => s.setCharacterDesktopTheme);
  const setReplyStyle = usePreferences((s) => s.setReplyStyle);
  const setReducedMotion = usePreferences((s) => s.setReducedMotion);
  const syncFromStorage = usePreferences((s) => s.syncFromStorage);

  const preferences = useMemo<AppearancePreferencesBinding>(
    () => ({
      themeMode,
      desktopThemePrefs,
      replyStyle,
      reducedMotion,
      setThemeMode,
      setGlobalDesktopTheme,
      setCharacterDesktopTheme,
      setReplyStyle,
      setReducedMotion,
      syncFromStorage,
    }),
    [
      themeMode,
      desktopThemePrefs,
      replyStyle,
      reducedMotion,
      setThemeMode,
      setGlobalDesktopTheme,
      setCharacterDesktopTheme,
      setReplyStyle,
      setReducedMotion,
      syncFromStorage,
    ],
  );

  const handleSelectCategory = useCallback(
    (
      nextCategory: ProductSettingsCategory,
      options?: { relationshipId?: string },
    ) => {
      const relationshipSearch =
        nextCategory === 'voice' && options?.relationshipId
          ? { relationshipId: options.relationshipId }
          : undefined;
      void navigate({
        to: '/settings/$category',
        params: { category: nextCategory },
        ...(relationshipSearch ? { search: relationshipSearch } : {}),
      });
    },
    [navigate],
  );

  const handleSelectTavern = useCallback(
    (section: string) => {
      void navigate({
        to: '/settings/tavern/$section',
        params: { section },
      });
    },
    [navigate],
  );

  const handleOpenInbox = useCallback(() => {
    void navigate({ to: '/inbox' });
  }, [navigate]);

  const renderLeaveGuard = useCallback(
    (state: SettingsLeaveGuardState) => (
      <DesktopRouterLeaveGuard dirty={state.dirty} busy={state.busy} />
    ),
    [],
  );

  return (
    <View
      category={category}
      {...(category === 'voice' && relationshipId ? { relationshipId } : {})}
      onSelectCategory={handleSelectCategory}
      onSelectTavern={handleSelectTavern}
      onOpenInbox={handleOpenInbox}
      preferences={preferences}
      renderLeaveGuard={renderLeaveGuard}
    />
  );
}

export default SettingsRouteAdapter;
