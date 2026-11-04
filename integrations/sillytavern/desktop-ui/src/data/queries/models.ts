import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAppClient } from '../../app/providers';
import { queryKeys } from '../queryKeys';

export function useProvidersQuery() {
  const client = useAppClient();
  return useQuery({
    queryKey: queryKeys.providers,
    queryFn: () => client.go.fetchProviders(),
  });
}

export function usePurposesQuery() {
  const client = useAppClient();
  return useQuery({
    queryKey: queryKeys.purposes,
    queryFn: () => client.go.fetchModelPurposes(),
  });
}

export function useLocalModelsQuery() {
  const client = useAppClient();
  return useQuery({
    queryKey: queryKeys.localModels,
    queryFn: () => client.go.fetchLocalModels(),
  });
}

export function useUsageQuery(month: string) {
  const client = useAppClient();
  return useQuery({
    queryKey: queryKeys.usage(month),
    enabled: Boolean(month),
    queryFn: () => client.go.fetchUsageSummary(month),
  });
}

export function useSaveProviderMutation() {
  const client = useAppClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      providerId,
      payload,
      body,
    }: {
      providerId: string;
      payload?: Record<string, unknown>;
      body?: Record<string, unknown>;
    }) => client.go.saveProvider(providerId, (payload ?? body)!),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.providers }),
        queryClient.invalidateQueries({ queryKey: queryKeys.purposes }),
      ]);
    },
  });
}

export function useSaveModelPurposeMutation() {
  const client = useAppClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      purpose,
      payload,
      body,
    }: {
      purpose: string;
      payload?: Record<string, unknown>;
      body?: Record<string, unknown>;
    }) => client.go.saveModelPurpose(purpose, (payload ?? body)!),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.purposes }),
        queryClient.invalidateQueries({ queryKey: queryKeys.providers }),
      ]);
    },
  });
}

export function useSaveLocalRerankMutation() {
  const client = useAppClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: { enabled: boolean; expectedRevision: number }) =>
      client.go.saveLocalModelRerank(payload),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.localModels });
    },
  });
}

export function useDiscoverProviderModelsMutation() {
  const client = useAppClient();
  return useMutation({
    mutationFn: ({
      providerId,
      protocol,
      baseUrl,
      credential,
      body,
    }: {
      providerId: string;
      protocol?: string;
      baseUrl?: string;
      credential?: string;
      body?: { protocol: string; baseUrl: string; credential?: string };
    }) =>
      client.go.discoverProviderModels(
        providerId,
        {
          protocol: body?.protocol ?? protocol ?? '',
          baseUrl: body?.baseUrl ?? baseUrl ?? '',
          credential: body?.credential ?? credential ?? '',
        },
      ),
  });
}

export function useVerifyModelToolCallsMutation() {
  const client = useAppClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ providerId, profileKey }: { providerId: string; profileKey: string }) =>
      client.go.verifyModelToolCalls(providerId, profileKey),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.providers });
    },
  });
}
