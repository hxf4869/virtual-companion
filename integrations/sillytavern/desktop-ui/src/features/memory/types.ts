import type { DiaryProps, FavoritesProps, MemoryAction } from './Auxiliary';
export interface Relationship {
    relationshipId: string | number;
    companionName?: string;
}
export interface MemoryTime {
    eventDate?: string;
    eventTime?: string;
    eventTimezone?: string;
    recordedAt?: string;
}
export interface MemoryRecord {
    memoryId: string | number;
    relationshipId: string | number;
    summary: string;
    lifecycle: string;
    sourceStatus: string;
    version?: number;
    mode?: string;
    type?: string;
    time?: MemoryTime;
    createdAt?: string;
    pinnedAt?: string | null;
    recallEligible?: boolean;
    cleanup?: { state: string; detail?: string };
    history?: MemoryRecord[];
}
export interface Evidence {
    evidenceId?: string;
    chatDisplayName?: string;
    messageId?: string;
    revision?: number;
    sourceTimestamp?: string;
    sourceTimezone?: string;
    excerpt?: string;
    status?: string;
}
export interface MemoryState {
    relationships: Relationship[];
    relationshipId: string;
    items: MemoryRecord[];
    filters?: Record<string, string>;
    filterDraft?: Record<string, string>;
    loading?: boolean;
    listError?: string;
    detailLoading?: boolean;
    detailError?: string;
    detail?: MemoryRecord | null;
    selectedId?: string;
    evidence?: Evidence[];
    evidenceError?: string;
    busy?: boolean;
    editing?: boolean;
    draft?: string;
    conflict?: boolean;
    notice?: string;
    reauthAction?: string | null;
    nextCursor?: string | null;
    view?: string;
}
export interface MemoryProps {
    state: MemoryState;
    desktop?: boolean;
    sprite: string;
    glyphs: Record<string, string>;
    forgetNotice: string;
    emptyDialog: string;
    labels: { lifecycle: Record<string, string>; source: Record<string, string>; type: Record<string, string> };
    sections: readonly (readonly string[])[];
    segments: readonly (readonly string[])[];
    statusOptions: readonly (readonly string[])[];
    format: {
        stamp: (at?: string, zone?: string) => string;
        relationship: (rel: Relationship, all: Relationship[]) => string;
        mode: (mode?: string) => string;
        day: (day?: string) => string;
        dates: (draft?: Record<string, string>) => string;
        lifeTone: (value: string) => string;
        sourceTone: (value: string) => string;
        group: (items: MemoryRecord[], now?: Date) => { key: string; label: string; items: MemoryRecord[] }[];
        clock: (at?: string) => string;
        moment: (item: MemoryRecord) => string;
    };
    ui: {
        section?: string;
        inlineId?: string;
        incognito?: boolean;
        font?: string;
        sources?: Map<string, { line: string }>;
        now?: Date;
    };
    diary?: DiaryProps;
    favorites?: FavoritesProps;
    confirmForget?: boolean;
    action: MemoryAction;
    draft: (value: string) => void;
    filter: (name: string, value: string) => void;
    submit: (kind: string, form: HTMLFormElement) => void;
    status: (value: string) => void;
    incognito: (value: boolean) => void;
    collapse?: {
        ids: ReadonlySet<string>;
        done: (id: string) => void;
        animate: (element: HTMLElement, keyframes: Keyframe[], options: { duration: number }) => Animation;
    };
}
