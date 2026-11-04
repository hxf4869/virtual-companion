import { createDesktopClient } from '../../../extension/vc-model-settings/desktop/standalone/client.js';
import * as goApi from '../../../extension/vc-model-settings/api.js';
import { ApiError, setStHeadersProvider } from '../../../extension/vc-model-settings/api.js';

export { ApiError };

export type DesktopClient = ReturnType<typeof createDesktopClient>;
export type GoApi = typeof goApi;
export type AppClient = DesktopClient & {
    go: GoApi;
};

export interface CreateAppClientOptions {
    fetchImpl?: typeof fetch;
    document?: Pick<Document, 'querySelector'>;
    onGenerateResponse?: (response: Response) => void;
}

export class ConflictError extends Error {
    kind: string;
    status: number;
    code: string;
    details: unknown;
    override cause?: unknown;

    constructor(
        message = '这段配置已在另一处更新。',
        {
            kind = 'conflict-revision',
            code = 'REVISION_CONFLICT',
            details = null,
            cause,
        }: {
            kind?: string;
            code?: string;
            details?: unknown;
            cause?: unknown;
        } = {},
    ) {
        super(message);
        this.name = 'ConflictError';
        this.kind = kind;
        this.status = 409;
        this.code = code;
        this.details = details;
        if (cause !== undefined) {
            this.cause = cause;
        }
    }
}

function readMetaContent(doc: Pick<Document, 'querySelector'> | undefined, name: string): string {
    const node = doc?.querySelector(`meta[name="${name}"]`) as
        | { content?: string; getAttribute?: (attr: string) => string | null }
        | null
        | undefined;
    if (!node) return '';
    if (typeof node.getAttribute === 'function') {
        const attr = node.getAttribute('content');
        if (attr !== null && attr !== undefined) return attr;
    }
    return typeof node.content === 'string' ? node.content : '';
}

function readDocumentIdentity(doc: Pick<Document, 'querySelector'> | undefined) {
    return {
        accountId: readMetaContent(doc, 'vc-account-id'),
        sessionId: readMetaContent(doc, 'vc-session-id'),
    };
}

export function createAppClient(options: CreateAppClientOptions = {}): AppClient {
    const doc = options.document ?? (typeof document !== 'undefined' ? document : undefined);

    let desktopClient!: DesktopClient;

    function createSupersededError(cause?: unknown): ConflictError {
        const current = readDocumentIdentity(doc);
        return new ConflictError('登录状态已变化，请重新打开页面。', {
            kind: 'context-changed',
            code: 'ACCOUNT_CONTEXT_CHANGED',
            details: {
                expected: { ...desktopClient.identity },
                actual: current,
            },
            cause,
        });
    }

    function isIdentitySuperseded(): boolean {
        if (!doc || !desktopClient) return false;
        const current = readDocumentIdentity(doc);
        return (
            current.accountId !== desktopClient.identity.accountId ||
            current.sessionId !== desktopClient.identity.sessionId
        );
    }

    function assertIdentityCurrent(): void {
        if (isIdentitySuperseded()) {
            throw createSupersededError();
        }
    }

    function normalizeError(error: unknown): unknown {
        if (isIdentitySuperseded()) {
            return createSupersededError(error);
        }
        if (error instanceof ConflictError) {
            return error;
        }
        if (error && typeof error === 'object' && (error as { status?: number }).status === 409) {
            const errObj = error as {
                message?: string;
                kind?: string;
                code?: string;
                details?: unknown;
            };
            const rawDetails = errObj.details ?? null;
            const code =
                (typeof errObj.code === 'string' && errObj.code) ||
                (rawDetails &&
                typeof rawDetails === 'object' &&
                typeof (rawDetails as { code?: unknown }).code === 'string'
                    ? (rawDetails as { code: string }).code
                    : 'REVISION_CONFLICT');
            const details =
                rawDetails &&
                typeof rawDetails === 'object' &&
                'details' in rawDetails &&
                (rawDetails as { details?: unknown }).details !== undefined
                    ? (rawDetails as { details: unknown }).details
                    : rawDetails;
            const kind =
                typeof errObj.kind === 'string' && errObj.kind
                    ? errObj.kind
                    : code === 'ACCOUNT_CONTEXT_CHANGED'
                      ? 'context-changed'
                      : 'conflict-revision';
            return new ConflictError(errObj.message || '这段配置已在另一处更新。', {
                kind,
                code,
                details,
                cause: error,
            });
        }
        return error;
    }

    const guardedFetch: typeof fetch = async (input, init) => {
        assertIdentityCurrent();
        const activeFetch = options.fetchImpl ?? globalThis.fetch;
        const response = await activeFetch(input, init);
        assertIdentityCurrent();
        return response;
    };

    const desktopInit = {
        fetchImpl: guardedFetch,
        document: doc as Document | undefined,
        onGenerateResponse: options.onGenerateResponse,
    };
    desktopClient = createDesktopClient(desktopInit as Parameters<typeof createDesktopClient>[0]);

    setStHeadersProvider(desktopClient.headers, { identity: desktopClient.identity });

    function wrapAsync<TArgs extends unknown[], TResult>(
        fn: (...args: TArgs) => Promise<TResult>,
    ): (...args: TArgs) => Promise<TResult> {
        return async (...args: TArgs): Promise<TResult> => {
            assertIdentityCurrent();
            try {
                const result = await fn(...args);
                assertIdentityCurrent();
                return result;
            } catch (error) {
                throw normalizeError(error);
            }
        };
    }

    const wrappedGo = {} as Record<string, unknown>;
    for (const [key, value] of Object.entries(goApi)) {
        if (typeof value !== 'function' || key === 'ApiError' || key === 'setStHeadersProvider') {
            wrappedGo[key] = value;
            continue;
        }
        wrappedGo[key] = wrapAsync(
            value as (...fnArgs: unknown[]) => Promise<unknown>,
        );
    }

    const documents = {
        ...desktopClient.documents,
        saveSettings: wrapAsync(desktopClient.documents.saveSettings),
        savePreset: wrapAsync(desktopClient.documents.savePreset),
        saveWorldbook: wrapAsync(desktopClient.documents.saveWorldbook),
    };

    return {
        ...desktopClient,
        documents,
        raw: wrapAsync(desktopClient.raw),
        post: wrapAsync(desktopClient.post),
        request: wrapAsync(desktopClient.request),
        saveSettings: documents.saveSettings,
        savePreset: documents.savePreset,
        saveWorldbook: documents.saveWorldbook,
        settings: wrapAsync(desktopClient.settings),
        generate: wrapAsync(desktopClient.generate),
        initialize: wrapAsync(desktopClient.initialize),
        characters: wrapAsync(desktopClient.characters),
        recent: wrapAsync(desktopClient.recent),
        readChat: wrapAsync(desktopClient.readChat),
        go: wrappedGo as GoApi,
    };
}
