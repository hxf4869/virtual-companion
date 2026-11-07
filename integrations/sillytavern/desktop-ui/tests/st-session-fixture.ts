export const ST_CHAT_STORAGE_SESSION_URL = '/auth/api/session?include=chatStorage';

export const stSessionIdentity = {
    accountId: '9007199254740993',
    sessionId: '17',
};

export const stChatStorageSession = {
    ...stSessionIdentity,
    chatStorage: { mode: 'ST', authorityEpoch: '1' },
};
