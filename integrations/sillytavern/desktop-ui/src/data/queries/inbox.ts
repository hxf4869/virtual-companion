import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';
import { useAppClient } from '../../app/providers';
import { queryKeys } from '../queryKeys';
import {
  passesFilter,
  proactivePolicyPayload,
  readProactivePolicy,
} from '../../../../extension/vc-model-settings/inbox-logic.js';

export type InboxFilter = 'all' | 'pending' | 'written' | 'broken' | string;

export interface ProactivePolicy {
  relationshipId: string;
  enabled: boolean;
  supportsMode: boolean;
  supportsCheckIn: boolean;
  mode: string;
  checkInAfterMinutes: number | null;
  quietHoursStart: string;
  quietHoursEnd: string;
  quietHoursTimezone: string;
  dailyLimit: number;
  recentInteractionMinutes: number;
  allowedModes: string[];
  offlineCapable: boolean;
}

export interface PolicyInput {
  relationshipId: string;
  enabled?: boolean;
  supportsMode?: boolean;
  supportsCheckIn?: boolean;
  mode?: string;
  checkInAfterMinutes?: number | null;
  quietHoursStart?: string | null;
  quietHoursEnd?: string | null;
  quietHoursTimezone?: string | null;
  dailyLimit?: number;
  recentInteractionMinutes?: number;
  allowedModes?: string[];
  offlineCapable?: boolean;
}

export interface FollowUpItem {
  followUpId: string;
  relationshipId: string;
  status: string;
  eventId: string;
  eventDate?: string;
  eventTime?: string;
  triggerAt?: string;
  body: string;
}

export interface InboxEvent {
  eventId: string;
  relationshipId: string;
  conversationId: string;
  conversationKey?: string;
  linkStatus: 'present' | 'removed' | 'invalidated' | string;
  intent: 'WAITING_HOST' | 'BODY' | string;
  body: string;
  voice?: {
    clipId: string;
    status: string;
    durationMs: number;
  } | null;
  stDelivered: boolean;
  read: boolean;
  createdAt?: string;
}

export interface Channel {
  channelId: string;
  channel: 'EMAIL' | 'FEISHU' | string;
  configuredTarget: string;
  relationshipIds: string[];
  enabled: boolean;
  previewBody: boolean;
  credentialState?: 'configured' | 'withheld' | 'missing';
}

export interface SaveChannelInput {
  channel: 'EMAIL' | 'FEISHU' | string;
  enabled: boolean;
  configuredTarget: string;
  previewBody: boolean;
  relationshipIds: string[];
  credential?: string | null;
}

export interface Delivery {
  deliveryId: string;
  eventId: string;
  relationshipId?: string;
  channel: 'EMAIL' | 'FEISHU' | string;
  configuredTarget: string;
  status: 'pending' | 'sending' | 'accepted' | 'failed' | 'unknown' | 'stopped' | string;
  stoppedReason?: string;
}

export function normalizeProactivePolicy(
  raw: Record<string, unknown> | null | undefined,
  relId: string,
): ProactivePolicy {
  return readProactivePolicy(raw ?? {}, relId) as ProactivePolicy;
}

export function useProactivePolicy(relId: string | null): UseQueryResult<ProactivePolicy, Error> {
  const client = useAppClient();
  return useQuery({
    queryKey: queryKeys.proactivePolicy(relId ?? ''),
    enabled: Boolean(relId),
    queryFn: async () => {
      if (!relId) return readProactivePolicy({}, '') as ProactivePolicy;
      const raw = (await client.go.storyRequest(
        'GET',
        `/api/v1/relationships/${encodeURIComponent(relId)}/proactive-policy`,
      )) as Record<string, unknown>;
      return readProactivePolicy(raw, relId) as ProactivePolicy;
    },
  });
}

export function useSavePolicy(relId?: string | null): UseMutationResult<ProactivePolicy, Error, PolicyInput> {
  const client = useAppClient();
  const queryClient = useQueryClient();

  return useMutation<ProactivePolicy, Error, PolicyInput>({
    mutationFn: async (input) => {
      const targetRelId = input.relationshipId || relId || '';
      const payload = proactivePolicyPayload(input);
      const saved = (await client.go.storyRequest(
        'PUT',
        `/api/v1/relationships/${encodeURIComponent(targetRelId)}/proactive-policy`,
        payload,
      )) as Record<string, unknown>;
      return readProactivePolicy(saved, targetRelId) as ProactivePolicy;
    },
    onSuccess: (saved) => {
      queryClient.setQueryData(queryKeys.proactivePolicy(saved.relationshipId), saved);
    },
  });
}

export function useFollowUps(relId: string | null): UseQueryResult<FollowUpItem[], Error> {
  const client = useAppClient();
  return useQuery({
    queryKey: queryKeys.followUps(relId ?? ''),
    enabled: Boolean(relId),
    queryFn: async () => {
      if (!relId) return [];
      const rows = await client.go.storyRequest(
        'GET',
        `/api/v1/relationships/${encodeURIComponent(relId)}/follow-ups`,
      );
      return Array.isArray(rows) ? (rows as FollowUpItem[]) : [];
    },
  });
}

export function useCancelFollowUp(relId: string | null): UseMutationResult<FollowUpItem, Error, string> {
  const client = useAppClient();
  const queryClient = useQueryClient();
  return useMutation<FollowUpItem, Error, string>({
    mutationFn: async (followUpId) => {
      const res = await client.go.storyRequest(
        'POST',
        `/api/v1/follow-ups/${encodeURIComponent(followUpId)}/cancel`,
      );
      return res as FollowUpItem;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.followUps(relId ?? '') });
    },
  });
}

export function useInbox(filter: InboxFilter = 'all'): UseQueryResult<InboxEvent[], Error> {
  const client = useAppClient();
  return useQuery({
    queryKey: queryKeys.inbox(filter),
    queryFn: async () => {
      const rows = await client.go.storyRequest('GET', '/api/v1/inbox');
      const list = Array.isArray(rows) ? (rows as InboxEvent[]) : [];
      if (!filter || filter === 'all') return list;
      return list.filter((item) => passesFilter(item, filter));
    },
  });
}

export function useMarkInboxRead(): UseMutationResult<InboxEvent, Error, string> {
  const client = useAppClient();
  const queryClient = useQueryClient();
  return useMutation<InboxEvent, Error, string>({
    mutationFn: async (eventId) => {
      const res = await client.go.storyRequest(
        'POST',
        `/api/v1/inbox/${encodeURIComponent(eventId)}/read`,
      );
      return res as InboxEvent;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['inbox'] });
    },
  });
}

export function useChannels(): UseQueryResult<Channel[], Error> {
  const client = useAppClient();
  return useQuery({
    queryKey: queryKeys.channels,
    queryFn: async () => {
      const rows = await client.go.storyRequest('GET', '/api/v1/notification-channels');
      return Array.isArray(rows) ? (rows as Channel[]) : [];
    },
  });
}

export function useSaveChannel(): UseMutationResult<Channel, Error, SaveChannelInput> {
  const client = useAppClient();
  const queryClient = useQueryClient();
  return useMutation<Channel, Error, SaveChannelInput>({
    mutationFn: async (body) => {
      const res = await client.go.storyRequest('PUT', '/api/v1/notification-channels', body);
      return res as Channel;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.channels });
    },
  });
}

export function useDeliveries(relId?: string | null): UseQueryResult<Delivery[], Error> {
  const client = useAppClient();
  return useQuery({
    queryKey: queryKeys.deliveries(relId ?? undefined),
    queryFn: async () => {
      const rows = await client.go.storyRequest('GET', '/api/v1/notification-deliveries');
      const list = Array.isArray(rows) ? (rows as Delivery[]) : [];
      if (!relId) return list;
      return list.filter((row) => !row.relationshipId || String(row.relationshipId) === String(relId));
    },
  });
}

export function useReauth(): UseMutationResult<{ ok: boolean }, Error, string> {
  const client = useAppClient();
  return useMutation<{ ok: boolean }, Error, string>({
    mutationFn: async (password) => {
      const res = await client.go.reauth(password);
      return (res as { ok: boolean }) ?? { ok: true };
    },
  });
}
