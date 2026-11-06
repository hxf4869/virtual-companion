import React from 'react';
import { useNavigate } from '@tanstack/react-router';
import {
  InboxRoute,
  type InboxRouteProps,
} from '../features/inbox/InboxRoute';
import { useLeaveGuard } from '../shell/useLeaveGuard';

export interface InboxRouteAdapterProps extends Partial<InboxRouteProps> {
  View?: React.ComponentType<InboxRouteProps>;
}

export function InboxRouteAdapter({
  View = InboxRoute,
  initialRelationshipId = null,
  onOpenConversation,
  guard = useLeaveGuard,
}: InboxRouteAdapterProps) {
  const navigate = useNavigate();

  return (
    <View
      initialRelationshipId={initialRelationshipId}
      guard={guard}
      onOpenConversation={
        onOpenConversation ??
        (async (conversationKey) => {
          await navigate({
            to: '/chat/$conversationKey',
            params: { conversationKey },
          });
        })
      }
    />
  );
}
