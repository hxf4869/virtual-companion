import { useCallback } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAppClient } from '../../app/providers';
import { useSessionBridge } from '../../runtime/session-bridge';
import { queryKeys } from '../queryKeys';

export function useExitDesktopAccount() {
  const queryClient = useQueryClient();
  const bridge = useSessionBridge();
  return useCallback(() => {
    bridge.destroy();
    queryClient.clear();
    window.location.replace('/auth/');
  }, [bridge, queryClient]);
}

export function useSessionQuery(enabled = true) {
  const client = useAppClient();
  return useQuery({
    queryKey: queryKeys.session,
    enabled,
    queryFn: () => client.go.fetchSession(),
  });
}

export function useSessionsQuery(enabled = true) {
  const client = useAppClient();
  return useQuery({
    queryKey: queryKeys.sessions,
    enabled,
    queryFn: () => client.go.listSessions(),
  });
}

export function useTrustedDevicesQuery(enabled = true) {
  const client = useAppClient();
  return useQuery({
    queryKey: queryKeys.trustedDevices,
    enabled,
    queryFn: () => client.go.listTrustedDevices(),
  });
}

export function useConsentsQuery(enabled = true) {
  const client = useAppClient();
  return useQuery({
    queryKey: queryKeys.consents,
    enabled,
    queryFn: () => client.go.listConsents(),
  });
}

export function useDataExportQuery(exportId: string | null, enabled = true) {
  const client = useAppClient();
  return useQuery({
    queryKey: queryKeys.dataExport(exportId || ''),
    enabled: Boolean(exportId) && enabled,
    queryFn: () => client.go.getDataExport(exportId!),
  });
}

export function useRevokeSessionMutation() {
  const client = useAppClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (sessionId: string) => client.go.revokeSession(sessionId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.sessions });
    },
  });
}

export function useRevokeTrustedDeviceMutation() {
  const client = useAppClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (deviceId: string) => client.go.revokeTrustedDevice(deviceId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.trustedDevices });
    },
  });
}

export function useRecordConsentMutation() {
  const client = useAppClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: {
      consentType: string;
      version: string;
      granted: boolean;
      currentPassword?: string;
    }) => client.go.recordConsent(body),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.consents });
    },
  });
}
