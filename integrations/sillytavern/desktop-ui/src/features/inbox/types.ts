export interface InboxRelationship {
    relationshipId: string;
    name: string;
    mode?: string;
}
export interface PolicyDraft {
    enabled: boolean;
    offlineCapable: boolean;
    supportsMode: boolean;
    supportsCheckIn: boolean;
    mode: string;
    quietHoursStart: string | null;
    quietHoursEnd: string | null;
    quietHoursTimezone: string | null;
    dailyLimit: string | number | null;
    recentInteractionMinutes: string | number | null;
    checkInAfterMinutes?: string | number | null;
    allowedModes: string[];
}
export interface FollowUp {
    followUpId: string;
    relationshipId: string;
    body: string;
    status: string;
    eventDate?: string;
    eventTime?: string;
    triggerAt?: string;
}
export interface InboxEvent {
    eventId: string;
    relationshipId: string;
    conversationId: string;
    body: string;
    intent: string;
    linkStatus: string;
    stDelivered: boolean;
    read: boolean;
    voice?: { clipId: string; status: string; durationMs: number } | null;
}
export interface ChannelDraft {
    key: string;
    channelId?: string;
    channel: string;
    enabled: boolean;
    previewBody: boolean;
    configuredTarget: string;
    relationshipIds: string[];
    exists: boolean;
    credentialState: string;
    credentialMode: string;
}
export interface Delivery {
    deliveryId: string;
    eventId: string;
    channel: string;
    status: string;
    stoppedReason?: string;
}
export interface InboxState {
    loading: boolean;
    busy: boolean;
    error: string;
    relationships: InboxRelationship[];
    relationshipId: string;
    policyDraft: PolicyDraft;
    policyError: string;
    policyNotice: string;
    policyConflict: boolean;
    followUps: FollowUp[];
    cancelAsk: string;
    inbox: InboxEvent[];
    inboxFilter: string;
    channelDrafts: ChannelDraft[];
    channelError: string;
    deliveries: Delivery[];
    reauth: { open: boolean; action: string; key: string };
}
export type InboxAction = (action: string, trigger: HTMLButtonElement) => void;
export interface InboxProps {
    state: InboxState;
    desktop: boolean;
    dirty: boolean;
    sprite: string;
    host: HTMLElement;
    labels: { follow: Record<string, string>; proactive: Record<string, string> };
    modes: readonly string[];
    filters: readonly (readonly string[])[];
    format: {
        write: (event: InboxEvent) => string;
        delivery: (row: Delivery) => { text: string; tone: string; status: string };
        credential: (draft: ChannelDraft) => string;
        credentialPlaceholder: (draft: ChannelDraft) => string;
        channel: (draft: ChannelDraft) => string;
        when: (row: FollowUp) => string;
        trigger: (row: FollowUp) => string;
        instance: (row: InboxRelationship, all: InboxRelationship[]) => string;
        zone: (zone: string | null) => string;
        passes: (event: InboxEvent, filter: string) => boolean;
    };
    events: {
        action: InboxAction;
        policy: (field: string, value: string) => void;
        channel: (key: string, field: string, value: string) => void;
        relationship: (id: string) => void;
        filter: (value: string) => void;
        mode: (value: string) => void;
        readSecret: (key: string) => string;
        voice: (id: string) => HTMLElement | null;
        authenticate: (password: string) => void;
        layerDismiss: () => void;
        returnFocus: () => HTMLElement | null;
    };
}
