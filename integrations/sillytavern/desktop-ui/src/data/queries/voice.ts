import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAppClient } from '../../app/providers';
import { queryKeys } from '../queryKeys';

export function useVoiceEnginesQuery() {
  const client = useAppClient();
  return useQuery({
    queryKey: queryKeys.voiceEngines,
    queryFn: () => client.go.fetchVoiceEngines(),
  });
}

export function useVoiceSettingsQuery() {
  const client = useAppClient();
  return useQuery({
    queryKey: queryKeys.voiceSettings,
    queryFn: () => client.go.fetchVoiceSettings(),
  });
}

export function useVoiceUsageQuery(enabled = true) {
  const client = useAppClient();
  return useQuery({
    queryKey: queryKeys.voiceUsage,
    enabled,
    queryFn: () => client.go.fetchVoiceUsage(),
  });
}

export function useSaveVoiceSettingsMutation() {
  const client = useAppClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: Record<string, unknown>) => client.go.saveVoiceSettings(payload),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.voiceSettings }),
        queryClient.invalidateQueries({ queryKey: queryKeys.voiceEngines }),
      ]);
    },
  });
}

export function usePreviewVoiceMutation() {
  const client = useAppClient();
  return useMutation({
    mutationFn: (payload: Record<string, unknown>) => client.go.previewVoice(payload),
  });
}
