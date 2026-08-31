import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from 'react';

import type {
  AssistantConversation,
  AssistantMessage,
  ChatConversation,
  ChatMode,
  ChatMessage,
  ChatRun,
  ChatWebUsage,
} from '@friday/contracts';

import {
  deleteAssistantConversation,
  getAssistantMessages,
  listAssistantConversations,
  updateAssistantConversation,
} from './sync/assistant-client.js';
import {
  cancelChatRun,
  createChatConversation,
  deleteChatConversation,
  getChatMessages,
  getChatRun,
  getChatWebUsage,
  listChatConversations,
  sendChatMessage,
  updateChatConversation,
} from './sync/chat-client.js';

const AssistantMarkdown = lazy(() => import('./AssistantMarkdown.js'));

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
const ignoreAvailabilityChange = () => undefined;

function VerifiedChat({
  createRequest,
  onAvailabilityChange,
}: {
  createRequest: number;
  onAvailabilityChange(available: boolean): void;
}) {
  const [conversations, setConversations] = useState<ChatConversation[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [content, setContent] = useState('');
  const [run, setRun] = useState<ChatRun | null>(null);
  const [disabled, setDisabled] = useState(false);
  const [webUsage, setWebUsage] = useState<ChatWebUsage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const previousCreateRequest = useRef(createRequest);

  const refreshMessages = useCallback(async (conversationId: string) => {
    const result = await getChatMessages(conversationId);
    setMessages(result.messages);
  }, []);

  const refreshConversations = useCallback(async () => {
    const next = await listChatConversations();
    setConversations(next);
    setSelectedId((current) =>
      current && next.some(({ id }) => id === current)
        ? current
        : (next[0]?.id ?? null),
    );
  }, []);

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
        setSelectedId(next[0]?.id ?? null);
        setWebUsage(usage?.source === 'tavily' ? usage : null);
        onAvailabilityChange(true);
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
    if (!selectedId) {
      return;
    }
    let cancelled = false;
    void getChatMessages(selectedId)
      .then(({ messages: next }) => {
        if (!cancelled) setMessages(next);
      })
      .catch(() => {
        if (!cancelled) setError('Historique du Chat indisponible.');
      });
    return () => {
      cancelled = true;
    };
  }, [selectedId]);

  useEffect(() => {
    if (!run || !['queued', 'running'].includes(run.status)) return;
    let cancelled = false;
    const poll = async () => {
      try {
        const next = await getChatRun(run.id);
        if (cancelled) return;
        setRun(next);
        if (next.status === 'completed') {
          await Promise.all([
            refreshConversations(),
            refreshMessages(next.conversationId),
            refreshWebUsage(),
          ]);
        } else if (next.status === 'failed') {
          setError('La réponse n’a pas pu être produite.');
        } else if (!cancelled) {
          window.setTimeout(() => void poll(), 900);
        }
      } catch {
        if (!cancelled) setError('Suivi de la réponse indisponible.');
      }
    };
    const timer = window.setTimeout(() => void poll(), 250);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [refreshConversations, refreshMessages, refreshWebUsage, run]);

  const createConversation = useCallback(async (): Promise<string> => {
    const conversation = await createChatConversation('friday');
    await refreshConversations();
    setSelectedId(conversation.id);
    return conversation.id;
  }, [refreshConversations]);

  useEffect(() => {
    if (previousCreateRequest.current === createRequest) return;
    previousCreateRequest.current = createRequest;
    void createConversation().catch(() =>
      setError('Création de la conversation impossible.'),
    );
  }, [createConversation, createRequest]);

  const selected = conversations.find(({ id }) => id === selectedId) ?? null;

  async function selectMode(mode: ChatMode): Promise<void> {
    if (!selected || selected.mode === mode) return;
    setError(null);
    try {
      const updated = await updateChatConversation(selected.id, { mode });
      setConversations((current) =>
        current.map((conversation) =>
          conversation.id === updated.id ? updated : conversation,
        ),
      );
    } catch {
      setError('Le mode de réponse n’a pas pu être modifié.');
    }
  }

  async function deleteSelected(): Promise<void> {
    if (
      !selected ||
      !window.confirm(`Supprimer définitivement « ${selected.title} » ?`)
    )
      return;
    setError(null);
    try {
      await deleteChatConversation(selected.id);
      setMessages([]);
      setRun((current) =>
        current?.conversationId === selected.id ? null : current,
      );
      setSelectedId(null);
      await refreshConversations();
    } catch {
      setError('Suppression de la conversation impossible.');
    }
  }

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    const question = content.trim();
    if (!question || run?.status === 'running' || run?.status === 'queued')
      return;
    setError(null);
    try {
      const conversationId = selectedId ?? (await createConversation());
      setContent('');
      const runId = await sendChatMessage(conversationId, question);
      setRun(await getChatRun(runId));
      await refreshMessages(conversationId);
    } catch (caught) {
      setError(
        caught instanceof Error && caught.message === 'CHAT_OFFLINE'
          ? 'L’envoi nécessite une connexion au Hub. L’historique reste consultable.'
          : 'Envoi impossible.',
      );
    }
  }

  if (disabled)
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
            Web · {webUsage.remainingSearches} recherches restantes
          </small>
        ) : null}
      </header>
      {error ? <p className="error-banner">{error}</p> : null}
      {conversations.length ? (
        <nav
          className="assistant-conversation-list"
          aria-label="Nouvelles conversations"
        >
          {conversations
            .filter(({ archivedAt }) => !archivedAt)
            .map((conversation) => (
              <button
                className={conversation.id === selectedId ? 'is-active' : ''}
                key={conversation.id}
                onClick={() => {
                  setMessages([]);
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
      {selected ? (
        <div className="assistant-chat-toolbar">
          <div className="assistant-mode" aria-label="Mode de réponse">
            {CHAT_MODES.map(({ mode, label }) => (
              <button
                aria-pressed={selected.mode === mode}
                disabled={run?.status === 'running' || run?.status === 'queued'}
                key={mode}
                onClick={() => void selectMode(mode)}
                type="button"
              >
                {label}
              </button>
            ))}
          </div>
          <button
            aria-label="Supprimer la conversation"
            className="secondary-button danger assistant-delete-conversation"
            onClick={() => void deleteSelected()}
            type="button"
          >
            Supprimer
          </button>
        </div>
      ) : null}
      <div className="assistant-messages" aria-live="polite">
        {messages.map((message) => (
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
      </div>
      {run && ['queued', 'running'].includes(run.status) ? (
        <div className="assistant-run-progress" role="status">
          <span>{STAGE_LABELS[run.stage]}</span>
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
        </div>
      ) : null}
      <form
        className="assistant-composer"
        onSubmit={(event) => void submit(event)}
      >
        <textarea
          aria-label="Votre message"
          disabled={
            !navigator.onLine ||
            run?.status === 'running' ||
            run?.status === 'queued'
          }
          maxLength={8000}
          onChange={(event) => setContent(event.target.value)}
          placeholder={
            navigator.onLine
              ? 'Écrivez votre message…'
              : 'Envoi indisponible hors ligne'
          }
          rows={3}
          value={content}
        />
        <button
          className="primary-button"
          disabled={
            !content.trim() ||
            !navigator.onLine ||
            run?.status === 'running' ||
            run?.status === 'queued'
          }
          type="submit"
        >
          Envoyer
        </button>
      </form>
    </section>
  );
}

export default function AssistantView({
  createRequest = 0,
  onAvailabilityChange = ignoreAvailabilityChange,
}: {
  createRequest?: number;
  onAvailabilityChange?(available: boolean): void;
}) {
  const [conversations, setConversations] = useState<AssistantConversation[]>(
    [],
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [messages, setMessages] = useState<AssistantMessage[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reloadConversations = useCallback(async () => {
    const next = await listAssistantConversations();
    setConversations(next);
    setSelectedId(
      (current) =>
        (current && next.some(({ id }) => id === current) ? current : null) ??
        next.find(({ archivedAt }) => !archivedAt)?.id ??
        next[0]?.id ??
        null,
    );
  }, []);

  useEffect(() => {
    let cancelled = false;
    void listAssistantConversations()
      .then((next) => {
        if (cancelled) return;
        setConversations(next);
        setSelectedId(
          next.find(({ archivedAt }) => !archivedAt)?.id ?? next[0]?.id ?? null,
        );
      })
      .catch((caught: unknown) => {
        if (cancelled) return;
        setError(
          caught instanceof Error
            ? caught.message
            : 'Archive du Chat indisponible.',
        );
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!selectedId) return;
    let cancelled = false;
    void getAssistantMessages(selectedId)
      .then(({ messages: next }) => {
        if (!cancelled) setMessages(next);
      })
      .catch((caught: unknown) => {
        if (cancelled) return;
        setError(
          caught instanceof Error
            ? caught.message
            : 'Conversation indisponible.',
        );
      });
    return () => {
      cancelled = true;
    };
  }, [selectedId]);

  const selected = conversations.find(({ id }) => id === selectedId) ?? null;

  async function archiveSelected(): Promise<void> {
    if (!selected) return;
    setBusy(true);
    setError(null);
    try {
      await updateAssistantConversation(selected.id, {
        archived: !selected.archivedAt,
      });
      await reloadConversations();
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : 'Archivage impossible.',
      );
    } finally {
      setBusy(false);
    }
  }

  async function deleteSelected(): Promise<void> {
    if (
      !selected ||
      !window.confirm('Supprimer définitivement cette conversation ?')
    )
      return;
    setBusy(true);
    setError(null);
    try {
      await deleteAssistantConversation(selected.id);
      setSelectedId(null);
      await reloadConversations();
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : 'Suppression impossible.',
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="assistant-shell" aria-label="Archive du Chat">
      <VerifiedChat
        createRequest={createRequest}
        onAvailabilityChange={onAvailabilityChange}
      />

      <details className="assistant-legacy-archive">
        <summary>Archive historique en lecture seule</summary>

        {error ? <p className="error-banner">{error}</p> : null}

        {conversations.length > 0 ? (
          <nav
            className="assistant-conversation-list"
            aria-label="Conversations"
          >
            {conversations.map((conversation) => (
              <button
                className={conversation.id === selectedId ? 'is-active' : ''}
                key={conversation.id}
                onClick={() => {
                  setMessages([]);
                  setSelectedId(conversation.id);
                }}
                type="button"
              >
                <strong>{conversation.title}</strong>
                <small>
                  {new Date(conversation.updatedAt).toLocaleDateString('fr-FR')}
                  {conversation.archivedAt ? ' · archivée' : ''}
                </small>
              </button>
            ))}
          </nav>
        ) : (
          <p className="assistant-empty">Aucune conversation conservée.</p>
        )}

        {selected ? (
          <article className="assistant-conversation-panel">
            <header className="assistant-archive-actions">
              <strong>{selected.title}</strong>
              <span>
                <button
                  className="secondary-button"
                  disabled={busy}
                  onClick={() => void archiveSelected()}
                  type="button"
                >
                  {selected.archivedAt ? 'Restaurer' : 'Archiver'}
                </button>
                <button
                  className="secondary-button danger"
                  disabled={busy}
                  onClick={() => void deleteSelected()}
                  type="button"
                >
                  Supprimer
                </button>
              </span>
            </header>

            <div className="assistant-messages">
              {messages.map((message) => (
                <article
                  className={`assistant-message is-${message.role}`}
                  key={message.id}
                >
                  <small>{message.role === 'user' ? 'Vous' : 'Friday'}</small>
                  {message.role === 'assistant' ? (
                    <Suspense fallback={<p>{message.content}</p>}>
                      <AssistantMarkdown
                        content={message.content}
                        messageId={message.id}
                        sources={message.sources}
                      />
                    </Suspense>
                  ) : (
                    <p>{message.content}</p>
                  )}
                </article>
              ))}
            </div>
          </article>
        ) : null}
      </details>
    </section>
  );
}
