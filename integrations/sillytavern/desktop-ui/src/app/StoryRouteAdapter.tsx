import { useCallback, type ComponentType } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { StoryRoute, type StoryRouteProps } from '../features/story/StoryRoute';
import { useLeaveGuard } from '../shell/useLeaveGuard';
import { useReducedMotion } from '../shell/useReducedMotion';

export interface StoryRouteAdapterProps {
  runId?: string;
  View?: ComponentType<StoryRouteProps>;
}

function StoryLeaveGuard({ dirty }: { dirty: boolean }) {
  const guardNode = useLeaveGuard(dirty);
  return <>{guardNode}</>;
}

export function StoryRouteAdapter({
  runId,
  View = StoryRoute,
}: StoryRouteAdapterProps) {
  const navigate = useNavigate();
  const reducedMotion = useReducedMotion();

  const handleOpenRun = useCallback(
    (nextRunId: string) => {
      void navigate({ to: '/story/$runId', params: { runId: nextRunId } });
    },
    [navigate],
  );

  const handleConfigure = useCallback(() => {
    void navigate({ to: '/settings/$category', params: { category: 'model' } });
  }, [navigate]);

  const handleRenderLeaveGuard = useCallback(
    (dirty: boolean) => <StoryLeaveGuard dirty={dirty} />,
    [],
  );

  return (
    <View
      runId={runId}
      reducedMotion={reducedMotion}
      onOpenRun={handleOpenRun}
      onConfigure={handleConfigure}
      renderLeaveGuard={handleRenderLeaveGuard}
    />
  );
}
