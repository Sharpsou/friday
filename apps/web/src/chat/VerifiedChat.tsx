import type {
  ChatConversation,
  ChatMessage,
  ChatMode,
  ChatRun,
  ChatWebUsage,
} from '@friday/contracts';
import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type FormEvent,
} from 'react';
import {
  acknowledgeChatSend,
  cancelChatRun,
  createChatConversation,
  deleteChatConversation,
  getChatActiveRun,
  getChatAvailability,
  getChatMessages,
  getChatRun,
  getChatWebUsage,
  listChatConversations,
  readPendingChatSend,
  sendChatMessage,
  updateChatConversation,
} from '../sync/chat-client.js';

export const AssistantMarkdown = lazy(() => import('../AssistantMarkdown.js'));

const STAGE_LABELS: Record<ChatRun['stage'], string> = {
  queued: 'En attente',
  routing: 'Analyse',
  research: 'Recherche',
  writing: 'Rédaction',
  auditing: 'Vérification',
  finalizing: 'Finalisation',
  completed: 'Terminé',
};

export function ChatAnswerStatus({
  status,
}: {
  status: ChatMessage['answerStatus'];
}) {
  const label =
    status === 'verified'
      ? 'Vérifié par des sources'
      : status === 'partial'
        ? 'Réponse partielle'
        : status === 'abstained'
          ? 'Abstention'
          : status === 'audit_error'
            ? 'Vérification impossible'
            : 'Non vérifié par des sources';
  return (
    <span className={`assistant-answer-status is-${status ?? 'unverified'}`}>
      {label}
    </span>
  );
}

const CHAT_MODES: ReadonlyArray<{ mode: ChatMode; label: string }> = [
  { mode: 'friday', label: 'Friday' },
  { mode: 'local', label: 'Local' },
  { mode: 'web', label: 'Recherche Web' },
];

interface PendingChatMessage {
  conversationId: string | null;
  content: string;
}

export function VerifiedChat({
  createRequest,
  onAvailabilityChange,
}: {
  createRequest: number;
  onAvailabilityChange(available: boolean): void;
}) {
  const [conversations, setConversations] = useState<ChatConversation[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draftMode, setDraftMode] = useState<ChatMode>('friday');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [content, setContent] = useState('');
  const [pendingMessage, setPendingMessage] =
    useState<PendingChatMessage | null>(null);
  const [run, setRun] = useState<ChatRun | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [online, setOnline] = useState(() => navigator.onLine);
  const [disabled, setDisabled] = useState(false);
  const [cacheNotice, setCacheNotice] = useState<string | null>(null);
  const selectedIdRef = useRef(selectedId);
  useLayoutEffect(() => {
    selectedIdRef.current = selectedId;
  }, [selectedId]);
  const [conversationBusy, setConversationBusy] = useState(false);
  const [renameTarget, setRenameTarget] = useState<ChatConversation | null>(
    null,
  );
  const [renameTitle, setRenameTitle] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<ChatConversation | null>(
    null,
  );
  const [webUsage, setWebUsage] = useState<ChatWebUsage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const previousCreateRequest = useRef(createRequest);
  const actionMenuRef = useRef<HTMLDetailsElement>(null);
  const messagesRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const update = () => {
      const state = getChatAvailability();
      const unavailable = state.status !== 'ready';
      setDisabled(unavailable);
      onAvailabilityChange(!unavailable);
      setCacheNotice(
        state.status === 'disabled'
          ? 'Le Chat est désactivé. Historique en lecture seule.'
          : state.status === 'auth-required'
            ? 'Reconnectez-vous au Hub pour utiliser le Chat.'
            : state.status === 'offline'
              ? 'Copie en cache : le Hub est indisponible.'
              : state.cacheWarning
                ? 'Historique reçu, mais sa disponibilité hors ligne n’est pas garantie.'
                : null,
      );
    };
    window.addEventListener('friday-chat-availability', update);
    return () => window.removeEventListener('friday-chat-availability', update);
  }, [onAvailabilityChange]);

  useEffect(() => {
    const updateOnlineState = () => setOnline(navigator.onLine);
    window.addEventListener('online', updateOnlineState);
    window.addEventListener('offline', updateOnlineState);
    return () => {
      window.removeEventListener('online', updateOnlineState);
      window.removeEventListener('offline', updateOnlineState);
    };
  }, []);

  const refreshMessages = useCallback(async (conversationId: string) => {
    const result = await getChatMessages(conversationId);
    if (selectedIdRef.current === conversationId) setMessages(result.messages);
  }, []);

  const refreshConversations = useCallback(async () => {
    const next = await listChatConversations();
    setConversations(next);
    setSelectedId((current) =>
      current &&
      next.some(({ id, archivedAt }) => id === current && !archivedAt)
        ? current
        : (next.find(({ archivedAt }) => !archivedAt)?.id ?? null),
    );
  }, []);

  useEffect(() => {
    const refresh = () => {
      if (!navigator.onLine || document.visibilityState === 'hidden') return;
      void refreshConversations()
        .then(async () => {
          const id = selectedIdRef.current;
          if (id) await refreshMessages(id);
        })
        .catch(() => setError('Historique du Chat indisponible.'));
    };
    window.addEventListener('online', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      window.removeEventListener('online', refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [refreshConversations, refreshMessages]);

  const refreshWebUsage = useCallback(async () => {
    const usage = await getChatWebUsage().catch(() => null);
    setWebUsage(usage?.source === 'tavily' ? usage : null);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([
      listChatConversations(),
      getChatWebUsage().catch(() => null),
    ])
      .then(([next, usage]) => {
        if (cancelled) return;
        setConversations(next);
        setSelectedId(next.find(({ archivedAt }) => !archivedAt)?.id ?? null);
        setWebUsage(usage?.source === 'tavily' ? usage : null);
        onAvailabilityChange(getChatAvailability().status === 'ready');
      })
      .catch((caught: unknown) => {
        if (cancelled) return;
        if (caught instanceof Error && caught.message === 'CHAT_DISABLED') {
          setDisabled(true);
          onAvailabilityChange(false);
        } else setError('Le Chat est momentanément indisponible.');
      });
    return () => {
      cancelled = true;
    };
  }, [onAvailabilityChange]);

  useEffect(() => {
    if (!selectedId) return;
    let cancelled = false;
    void Promise.all([
      getChatMessages(selectedId),
      getChatActiveRun(selectedId).catch(() => null),
      readPendingChatSend(selectedId),
    ])
      .then(([result, activeRun, pending]) => {
        if (cancelled) return;
        setMessages(result.messages);
        if (pending) {
          setContent((current) => current || pending.content);
          setError(
            'Un envoi reste à confirmer. Renvoyez ce même message pour reprendre son suivi sans créer de doublon.',
          );
        }
        setRun((current) =>
          current?.conversationId === selectedId &&
          (current.status === 'queued' || current.status === 'running')
            ? current
            : activeRun,
        );
      })
      .catch(() => {
        if (!cancelled) setError('Historique du Chat indisponible.');
      });
    return () => {
      cancelled = true;
    };
  }, [selectedId]);

  const runId = run?.id ?? null;
  const runActive = Boolean(
    run && (run.status === 'queued' || run.status === 'running'),
  );

  useEffect(() => {
    if (!runId || !runActive) return;
    let cancelled = false;
    let timer: number | undefined;
    const poll = async () => {
      try {
        const next = await getChatRun(runId);
        if (cancelled || selectedIdRef.current !== next.conversationId) return;
        if (next.status === 'completed') {
          await Promise.all([
            refreshConversations(),
            refreshMessages(next.conversationId),
            refreshWebUsage(),
          ]);
          if (cancelled) return;
          setRun(next);
          setError(null);
        } else if (next.status === 'failed') {
          setRun(next);
          setError('La réponse n’a pas pu être produite.');
        } else if (next.status === 'queued' || next.status === 'running') {
          setRun(next);
          setError(null);
          timer = window.setTimeout(() => void poll(), 900);
        } else {
          setRun(next);
        }
      } catch {
        if (!cancelled) {
          setError(
            'Connexion au Hub interrompue. Le suivi reprend automatiquement.',
          );
          timer = window.setTimeout(() => void poll(), 1_500);
        }
      }
    };
    timer = window.setTimeout(() => void poll(), 250);
    return () => {
      cancelled = true;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [
    refreshConversations,
    refreshMessages,
    refreshWebUsage,
    runActive,
    runId,
  ]);

  const createConversation = useCallback(
    async (mode: ChatMode): Promise<string> => {
      if (getChatAvailability().status !== 'ready')
        throw new Error('CHAT_UNAVAILABLE');
      const conversation = await createChatConversation(mode);
      await refreshConversations();
      setDraftMode(conversation.mode);
      setSelectedId(conversation.id);
      return conversation.id;
    },
    [refreshConversations],
  );

  useEffect(() => {
    if (previousCreateRequest.current === createRequest) return;
    previousCreateRequest.current = createRequest;
    void createConversation(selectedId ? 'friday' : draftMode).catch(() =>
      setError('Création de la conversation impossible.'),
    );
  }, [createConversation, createRequest, draftMode, selectedId]);

  const selected = conversations.find(({ id }) => id === selectedId) ?? null;
  const selectedMode = selected?.mode ?? draftMode;
  const isWorking = submitting || runActive;
  const visibleConversations = conversations.filter(
    ({ archivedAt }) => !archivedAt,
  );

  useEffect(() => {
    if (!isWorking) return;
    const container = messagesRef.current;
    if (container) container.scrollTop = container.scrollHeight;
  }, [isWorking, messages.length, runId]);

  async function selectMode(mode: ChatMode): Promise<void> {
    if (!selected) {
      setDraftMode(mode);
      return;
    }
    if (selected.mode === mode) return;
    setError(null);
    try {
      const updated = await updateChatConversation(selected.id, { mode });
      setDraftMode(updated.mode);
      setConversations((current) =>
        current.map((conversation) =>
          conversation.id === updated.id ? updated : conversation,
        ),
      );
    } catch {
      setError('Le mode de réponse n’a pas pu être modifié.');
    }
  }

  function requestRename(): void {
    if (!selected) return;
    actionMenuRef.current?.removeAttribute('open');
    setRenameTarget(selected);
    setRenameTitle(selected.title);
  }

  async function renameConversation(event: FormEvent): Promise<void> {
    event.preventDefault();
    const title = renameTitle.trim();
    if (!renameTarget || !title || title === renameTarget.title) {
      setRenameTarget(null);
      return;
    }
    setConversationBusy(true);
    setError(null);
    try {
      const updated = await updateChatConversation(renameTarget.id, { title });
      setConversations((current) =>
        current.map((conversation) =>
          conversation.id === updated.id ? updated : conversation,
        ),
      );
      setRenameTarget(null);
    } catch {
      setError('Le titre de la conversation n’a pas pu être modifié.');
    } finally {
      setConversationBusy(false);
    }
  }

  async function confirmDelete(): Promise<void> {
    if (!deleteTarget || disabled) return;
    setConversationBusy(true);
    setError(null);
    try {
      await deleteChatConversation(deleteTarget.id);
      setDraftMode(deleteTarget.mode);
      setMessages([]);
      setPendingMessage(null);
      setRun((current) =>
        current?.conversationId === deleteTarget.id ? null : current,
      );
      setSelectedId(null);
      setDeleteTarget(null);
      await refreshConversations();
    } catch {
      setError('Suppression de la conversation impossible.');
    } finally {
      setConversationBusy(false);
    }
  }

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    const question = content.trim();
    if (!question || isWorking || disabled) return;
    setError(null);
    setSubmitting(true);
    setPendingMessage({ conversationId: selectedId, content: question });
    setContent('');
    try {
      const conversationId =
        selectedId ?? (await createConversation(draftMode));
      setPendingMessage({ conversationId, content: question });
      const { runId, clientRequestId } = await sendChatMessage(
        conversationId,
        question,
      );
      const [nextRun] = await Promise.all([
        getChatRun(runId),
        refreshMessages(conversationId),
        refreshConversations(),
      ]);
      await acknowledgeChatSend(conversationId, clientRequestId);
      setPendingMessage(null);
      if (selectedIdRef.current !== conversationId) return;
      setRun(nextRun);
      if (nextRun.status === 'completed') {
        await Promise.all([
          refreshMessages(conversationId),
          refreshConversations(),
          refreshWebUsage(),
        ]);
      } else if (nextRun.status === 'failed') {
        setError('La réponse n’a pas pu être produite.');
      }
    } catch (caught) {
      setPendingMessage(null);
      setContent((current) => current || question);
      if (
        caught instanceof Error &&
        caught.message === 'CHAT_SEND_UNRESOLVED' &&
        selectedId &&
        selectedIdRef.current === selectedId
      ) {
        const pending = await readPendingChatSend(selectedId).catch(() => null);
        if (pending && selectedIdRef.current === selectedId)
          setContent(pending.content);
      }
      setError(
        caught instanceof Error && caught.message === 'CHAT_OFFLINE'
          ? 'L’envoi nécessite une connexion au Hub. L’historique reste consultable.'
          : caught instanceof Error && caught.message === 'CHAT_SEND_UNRESOLVED'
            ? 'Le texte du précédent envoi a été rétabli. Renvoyez-le pour confirmer son suivi sans doublon.'
            : 'Envoi impossible. Renvoyez le même message pour reprendre sans doublon.',
      );
    } finally {
      setSubmitting(false);
    }
  }

  const visibleMessages = messages.filter(
    (message) => message.conversationId === selectedId,
  );

  if (disabled && conversations.length === 0)
    return (
      <aside className="assistant-reset-notice" role="status">
        <strong>Nouveau Chat prêt, activation en attente</strong>
        <span>
          Le moteur vérifié reste fermé jusqu’à la réussite de sa gate
          d’évaluation. L’archive demeure disponible ci-dessous.
        </span>
      </aside>
    );

  return (
    <section className="assistant-live" aria-label="Nouveau Chat">
      <header className="assistant-live-header">
        <h2>Friday</h2>
        {webUsage ? (
          <small
            className="assistant-remaining-searches"
            aria-label={`${webUsage.remainingSearches.toString()} recherches Web approfondies restantes ce mois`}
            title="Quota Tavily commun. Une question peut lancer plusieurs recherches approfondies."
          >
            Web · {webUsage.remainingSearches} restantes
          </small>
        ) : null}
      </header>
      {cacheNotice ? <p role="status">{cacheNotice}</p> : null}
      {error ? <p className="error-banner">{error}</p> : null}
      {visibleConversations.length ? (
        <nav
          className="assistant-conversation-list"
          aria-label="Nouvelles conversations"
        >
          {visibleConversations.map((conversation) => (
            <button
              className={conversation.id === selectedId ? 'is-active' : ''}
              key={conversation.id}
              onClick={() => {
                setMessages([]);
                setPendingMessage(null);
                setRun(null);
                setDraftMode(conversation.mode);
                setSelectedId(conversation.id);
              }}
              type="button"
            >
              <strong>{conversation.title}</strong>
              <small>
                {new Date(conversation.updatedAt).toLocaleDateString('fr-FR')}
              </small>
            </button>
          ))}
        </nav>
      ) : null}
      <div className="assistant-chat-toolbar">
        <div className="assistant-mode" aria-label="Mode de réponse">
          {CHAT_MODES.map(({ mode, label }) => (
            <button
              aria-pressed={selectedMode === mode}
              disabled={isWorking || disabled}
              key={mode}
              onClick={() => void selectMode(mode)}
              type="button"
            >
              {label}
            </button>
          ))}
        </div>
        {selected ? (
          <details
            className="assistant-conversation-actions"
            ref={actionMenuRef}
          >
            <summary aria-label={`Actions pour ${selected.title}`}>•••</summary>
            <div>
              <button
                disabled={conversationBusy || disabled}
                onClick={requestRename}
                type="button"
              >
                Renommer
              </button>
              <button
                className="danger"
                disabled={conversationBusy || disabled}
                onClick={() => {
                  actionMenuRef.current?.removeAttribute('open');
                  setDeleteTarget(selected);
                }}
                type="button"
              >
                Supprimer
              </button>
            </div>
          </details>
        ) : null}
      </div>
      <div className="assistant-messages" aria-live="polite" ref={messagesRef}>
        {visibleMessages.length === 0 ? (
          <p className="assistant-empty assistant-chat-empty">
            {selected
              ? 'Commencez une conversation privée avec Friday.'
              : 'Choisissez un mode, puis écrivez votre premier message.'}
          </p>
        ) : null}
        {visibleMessages.map((message) => (
          <article
            className={`assistant-message is-${message.role}`}
            key={message.id}
          >
            <small>{message.role === 'user' ? 'Vous' : 'Friday'}</small>
            {message.role === 'assistant' ? (
              <>
                <ChatAnswerStatus status={message.answerStatus} />
                <Suspense fallback={<p>{message.content}</p>}>
                  <AssistantMarkdown
                    content={message.content}
                    messageId={message.id}
                    sources={message.sources}
                  />
                </Suspense>
              </>
            ) : (
              <p>{message.content}</p>
            )}
          </article>
        ))}
        {pendingMessage &&
        (pendingMessage.conversationId === selectedId ||
          (pendingMessage.conversationId === null && selectedId === null)) ? (
          <article className="assistant-message is-user is-pending">
            <small>Vous · envoi en cours</small>
            <p>{pendingMessage.content}</p>
          </article>
        ) : null}
        {isWorking ? (
          <div
            className="assistant-run-progress"
            aria-live="assertive"
            role="status"
          >
            <span className="assistant-working-label">
              <i aria-hidden="true" />
              <strong>Friday travaille</strong>
              <small>
                {submitting
                  ? 'Préparation'
                  : run
                    ? STAGE_LABELS[run.stage]
                    : 'En attente'}
              </small>
            </span>
            {run && runActive ? (
              <button
                className="secondary-button danger"
                onClick={() =>
                  void cancelChatRun(run.id).then(() =>
                    setRun({ ...run, status: 'cancelled' }),
                  )
                }
                type="button"
              >
                Annuler
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
      <form
        className="assistant-composer"
        onSubmit={(event) => void submit(event)}
      >
        <textarea
          aria-label="Votre message"
          disabled={!online || isWorking || disabled}
          maxLength={8000}
          onChange={(event) => setContent(event.target.value)}
          placeholder={
            online ? 'Écrivez votre message…' : 'Envoi indisponible hors ligne'
          }
          rows={3}
          value={content}
        />
        <button
          className="primary-button"
          disabled={!content.trim() || !online || isWorking || disabled}
          type="submit"
        >
          Envoyer
        </button>
      </form>
      {renameTarget ? (
        <div
          className="settings-backdrop"
          onMouseDown={() => {
            if (!conversationBusy) setRenameTarget(null);
          }}
        >
          <section
            aria-labelledby="chat-rename-title"
            aria-modal="true"
            className="settings-dialog assistant-conversation-dialog"
            onMouseDown={(event) => event.stopPropagation()}
            role="dialog"
          >
            <div className="settings-heading">
              <div>
                <span className="eyebrow">Conversation</span>
                <h2 id="chat-rename-title">Renommer</h2>
              </div>
            </div>
            <form onSubmit={(event) => void renameConversation(event)}>
              <label htmlFor="chat-conversation-title">Titre</label>
              <input
                autoFocus
                id="chat-conversation-title"
                maxLength={120}
                onChange={(event) => setRenameTitle(event.target.value)}
                required
                value={renameTitle}
              />
              <div className="settings-actions">
                <button
                  className="secondary-button"
                  disabled={conversationBusy || disabled}
                  onClick={() => setRenameTarget(null)}
                  type="button"
                >
                  Annuler
                </button>
                <button
                  className="primary-button"
                  disabled={!renameTitle.trim() || conversationBusy || disabled}
                  type="submit"
                >
                  {conversationBusy ? 'Enregistrement…' : 'Enregistrer'}
                </button>
              </div>
            </form>
          </section>
        </div>
      ) : null}
      {deleteTarget ? (
        <div
          className="settings-backdrop"
          onMouseDown={() => {
            if (!conversationBusy) setDeleteTarget(null);
          }}
        >
          <section
            aria-labelledby="chat-delete-title"
            aria-modal="true"
            className="settings-dialog deletion-dialog"
            onMouseDown={(event) => event.stopPropagation()}
            role="dialog"
          >
            <div className="settings-heading">
              <div>
                <span className="eyebrow">Conversation</span>
                <h2 id="chat-delete-title">Supprimer définitivement&nbsp;?</h2>
              </div>
            </div>
            <p>
              «&nbsp;{deleteTarget.title}&nbsp;» et tous ses messages seront
              supprimés. Cette action est irréversible.
            </p>
            <div className="deletion-actions">
              <button
                className="secondary-button"
                disabled={conversationBusy || disabled}
                onClick={() => setDeleteTarget(null)}
                type="button"
              >
                Annuler
              </button>
              <button
                className="delete-series-button"
                disabled={conversationBusy || disabled}
                onClick={() => void confirmDelete()}
                type="button"
              >
                {conversationBusy
                  ? 'Suppression…'
                  : 'Supprimer la conversation'}
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </section>
  );
}
