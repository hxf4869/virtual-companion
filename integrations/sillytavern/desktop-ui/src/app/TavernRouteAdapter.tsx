import React, { useCallback } from 'react';
import { useNavigate, useRouterState } from '@tanstack/react-router';
import { TavernRoute, type TavernRouteProps } from '../features/tavern/TavernRoute';
import { useLeaveGuard } from '../shell/useLeaveGuard';

function ActiveLeaveGuard({ dirty }: { dirty: boolean }) {
  const modal = useLeaveGuard(dirty);
  return <>{modal}</>;
}

export interface TavernRouteAdapterProps extends TavernRouteProps {
  View?: React.ComponentType<TavernRouteProps>;
}

export function TavernRouteAdapter({
  section = 'left-nav-panel',
  initialCharacter: initialCharacterProp,
  embedded,
  onNavigateCategory,
  onNavigateTavern,
  onDirtyChange,
  renderLeaveGuard,
  onDownload,
  onNotify,
  View = TavernRoute,
}: TavernRouteAdapterProps) {
  const navigate = useNavigate();
  const routerCharacter = useRouterState({
    select: (s) => {
      const raw = (s.location.search as Record<string, unknown> | undefined)?.character;
      return typeof raw === 'string' && raw ? raw : undefined;
    },
  });
  const initialCharacter = initialCharacterProp ?? routerCharacter;

  const handleNavigateCategory = useCallback(
    (category: string) => {
      if (onNavigateCategory) {
        onNavigateCategory(category);
        return;
      }
      void navigate({ to: '/settings/$category', params: { category } });
    },
    [navigate, onNavigateCategory],
  );

  const handleNavigateTavern = useCallback(
    (nextSection: string) => {
      if (onNavigateTavern) {
        onNavigateTavern(nextSection);
        return;
      }
      void navigate({
        to: '/settings/tavern/$section',
        params: { section: nextSection },
      });
    },
    [navigate, onNavigateTavern],
  );

  const handleRenderLeaveGuard = useCallback(
    (dirty: boolean) => {
      if (renderLeaveGuard) {
        return renderLeaveGuard(dirty);
      }
      return <ActiveLeaveGuard dirty={dirty} />;
    },
    [renderLeaveGuard],
  );

  return (
    <View
      section={section}
      initialCharacter={initialCharacter}
      embedded={embedded}
      onNavigateCategory={handleNavigateCategory}
      onNavigateTavern={handleNavigateTavern}
      onDirtyChange={onDirtyChange}
      renderLeaveGuard={handleRenderLeaveGuard}
      onDownload={onDownload}
      onNotify={onNotify}
    />
  );
}
