import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = 'PocketPalRootAgent.SessionModelSelection.v1';
const NEW_CHAT_KEY = '__new_chat__';
const MAX_SESSION_BINDINGS = 200;

type PersistedState = {
  defaultModelId?: string;
  pendingNewChatModelId?: string;
  sessions: Record<string, string>;
  updatedAt: Record<string, number>;
};

const cleanId = (value: unknown, max = 300): string | undefined => {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.replace(/\u0000/g, '').trim();
  return trimmed ? trimmed.slice(0, max) : undefined;
};

class SessionModelSelectionStore {
  private state: PersistedState = {sessions: {}, updatedAt: {}};
  private hydration: Promise<void>;

  constructor() {
    this.hydration = this.hydrate();
  }

  async ensureHydrated(): Promise<void> {
    await this.hydration;
  }

  /**
   * Remember an explicit model choice. A choice made with no active session is
   * the default for future chats and is also staged so the first session that
   * gets created from that blank chat can inherit it permanently.
   */
  async rememberSelection(
    sessionId: string | null | undefined,
    modelId: string,
  ): Promise<void> {
    await this.ensureHydrated();
    const safeModelId = cleanId(modelId);
    if (!safeModelId) return;

    const safeSessionId = cleanId(sessionId);
    if (safeSessionId) {
      this.state.sessions[safeSessionId] = safeModelId;
      this.state.updatedAt[safeSessionId] = Date.now();
    } else {
      this.state.defaultModelId = safeModelId;
      this.state.pendingNewChatModelId = safeModelId;
      this.state.updatedAt[NEW_CHAT_KEY] = Date.now();
    }
    await this.persist();
  }

  /**
   * Resolve which model should be restored for the requested chat.
   *
   * Existing pre-feature chats have no binding. On their first open we bind the
   * persisted ModelStore.lastUsedModelId fallback once, so subsequent restarts
   * stop asking the user to pick again. Historical model identity cannot be
   * reconstructed for chats created before this feature because upstream never
   * stored it per session.
   */
  async resolveModelId(
    sessionId: string | null | undefined,
    fallbackModelId?: string,
  ): Promise<string | undefined> {
    await this.ensureHydrated();
    const safeSessionId = cleanId(sessionId);
    const fallback = cleanId(fallbackModelId);

    if (safeSessionId) {
      const bound = cleanId(this.state.sessions[safeSessionId]);
      if (bound) return bound;

      const pending = cleanId(this.state.pendingNewChatModelId);
      if (pending) {
        this.state.sessions[safeSessionId] = pending;
        this.state.updatedAt[safeSessionId] = Date.now();
        this.state.pendingNewChatModelId = undefined;
        await this.persist();
        return pending;
      }

      if (fallback) {
        this.state.sessions[safeSessionId] = fallback;
        this.state.updatedAt[safeSessionId] = Date.now();
        await this.persist();
        return fallback;
      }
      return undefined;
    }

    const defaultModel = cleanId(this.state.defaultModelId);
    if (defaultModel) return defaultModel;

    // First launch after upgrading: adopt the already-persisted upstream
    // lastUsedModelId as the new-chat default instead of forcing another pick.
    if (fallback) {
      this.state.defaultModelId = fallback;
      this.state.updatedAt[NEW_CHAT_KEY] = Date.now();
      await this.persist();
      return fallback;
    }
    return undefined;
  }

  getSnapshot(sessionId?: string | null): {
    defaultModelId?: string;
    pendingNewChatModelId?: string;
    activeSessionModelId?: string;
    bindingCount: number;
  } {
    const safeSessionId = cleanId(sessionId);
    return {
      ...(this.state.defaultModelId
        ? {defaultModelId: this.state.defaultModelId}
        : {}),
      ...(this.state.pendingNewChatModelId
        ? {pendingNewChatModelId: this.state.pendingNewChatModelId}
        : {}),
      ...(safeSessionId && this.state.sessions[safeSessionId]
        ? {activeSessionModelId: this.state.sessions[safeSessionId]}
        : {}),
      bindingCount: Object.keys(this.state.sessions).length,
    };
  }

  private async hydrate(): Promise<void> {
    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as Partial<PersistedState>;
      if (!parsed || typeof parsed !== 'object') return;
      this.state = {
        ...(cleanId(parsed.defaultModelId)
          ? {defaultModelId: cleanId(parsed.defaultModelId)}
          : {}),
        ...(cleanId(parsed.pendingNewChatModelId)
          ? {pendingNewChatModelId: cleanId(parsed.pendingNewChatModelId)}
          : {}),
        sessions:
          parsed.sessions && typeof parsed.sessions === 'object'
            ? Object.fromEntries(
                Object.entries(parsed.sessions)
                  .map(([key, value]) => [cleanId(key), cleanId(value)] as const)
                  .filter(
                    (entry): entry is readonly [string, string] =>
                      !!entry[0] && !!entry[1],
                  ),
              )
            : {},
        updatedAt:
          parsed.updatedAt && typeof parsed.updatedAt === 'object'
            ? Object.fromEntries(
                Object.entries(parsed.updatedAt).filter(
                  ([key, value]) =>
                    !!cleanId(key) && typeof value === 'number' && Number.isFinite(value),
                ),
              )
            : {},
      };
      this.trim();
    } catch (error) {
      console.warn('[model-persistence] Failed to hydrate:', error);
      this.state = {sessions: {}, updatedAt: {}};
    }
  }

  private trim(): void {
    const entries = Object.entries(this.state.sessions);
    if (entries.length <= MAX_SESSION_BINDINGS) return;
    const newest = entries
      .sort(
        ([a], [b]) =>
          (this.state.updatedAt[b] ?? 0) - (this.state.updatedAt[a] ?? 0),
      )
      .slice(0, MAX_SESSION_BINDINGS);
    const keep = new Set(newest.map(([sessionId]) => sessionId));
    this.state.sessions = Object.fromEntries(newest);
    this.state.updatedAt = Object.fromEntries(
      Object.entries(this.state.updatedAt).filter(
        ([key]) => key === NEW_CHAT_KEY || keep.has(key),
      ),
    );
  }

  private async persist(): Promise<void> {
    this.trim();
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(this.state));
  }
}

export const sessionModelSelectionStore = new SessionModelSelectionStore();
