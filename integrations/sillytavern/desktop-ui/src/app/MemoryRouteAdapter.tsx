import type { ComponentType, ReactNode } from 'react';
import { useNavigate } from '@tanstack/react-router';
import {
  MemoryRoute,
  type LocateMessagePayload,
  type MemoryRouteProps,
} from '../features/memory/MemoryRoute';
import { useLeaveGuard } from '../shell/useLeaveGuard';

function MemoryLeaveGuardHost({ dirty }: { dirty: boolean }) {
  return <>{useLeaveGuard(dirty)}</>;
}

export function renderDesktopMemoryLeaveGuard(dirty: boolean): ReactNode {
  return <MemoryLeaveGuardHost dirty={dirty} />;
}

export interface MemoryRouteAdapterProps extends Partial<MemoryRouteProps> {
  View?: ComponentType<MemoryRouteProps>;
}

export function MemoryRouteAdapter({
  initialRelationshipId = null,
  onNavigateToMessage,
  renderLeaveGuard = renderDesktopMemoryLeaveGuard,
  View = MemoryRoute,
}: MemoryRouteAdapterProps) {
  const navigate = useNavigate();

  const handleNavigateToMessage = async (payload: LocateMessagePayload) => {
    if (onNavigateToMessage) {
      await onNavigateToMessage(payload);
      return;
    }
    if (!payload.conversationKey) return;
    await navigate({
      to: '/chat/$conversationKey',
      params: { conversationKey: payload.conversationKey },
    });
  };

  return (
    <View
      initialRelationshipId={initialRelationshipId}
      onNavigateToMessage={handleNavigateToMessage}
      renderLeaveGuard={renderLeaveGuard}
    />
  );
}
