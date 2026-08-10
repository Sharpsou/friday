import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
} from 'react';

import type {
  AssistantConversation,
  AssistantMessage,
  AssistantMode,
  AssistantRun,
} from '@friday/contracts';

import {
  answerAssistantSearchConsent,
  cancelAssistantRun,
  createAssistantConversation,
  deleteAssistantConversation,
  flushAssistantOutbox,
  getAssistantMessages,
  getAssistantRun,
  hasQueuedAssistantMessages,
  listAssistantConversations,
  retryAssistantRun,
  sendAssistantMessage,
  updateAssistantConversation,
} from './sync/assistant-client.js';
import {
  formatResponseDuration,
  responseDurations,
} from './assistant-duration.js';

const TERMINAL = new Set(['completed', 'cancelled', 'failed']);
const AssistantMarkdown = lazy(() => import('./AssistantMarkdown.js'));
type UiMode = 'auto' | 'web-fast' | 'web-deep' | 'classic';

export default function AssistantView() {
  const [conversations, setConversations] = useState<AssistantConversation[]>(
    [],
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [messages, setMessages] = useState<AssistantMessage[]>([]);
  const [activeRun, setActiveRun] = useState<AssistantRun | null>(null);
  const [mode, setMode] = useState<UiMode>('auto');
  const [draft, setDraft] = useState('');
  const [consentQueries, setConsentQueries] = useState<string[]>([]);
  const [offlinePending, setOfflinePending] = useState(false);
  const [elapsedMinutes, setElapsedMinutes] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reloadConversations = useCallback(async () => {
    const next = await listAssistantConversations();
    setConversations(next);
    setSelectedId(
      (current) => current ?? next.find((item) => !item.archivedAt)?.id ?? null,
    );
  }, []);

  const reloadMessages = useCallback(async (conversationId: string) => {
    const [result, pending] = await Promise.all([
      getAssistantMessages(conversationId),
      hasQueuedAssistantMessages(),
    ]);
    setMessages(result.messages);
    setActiveRun(result.activeRun);
    setOfflinePending(pending);
    if (result.activeRun?.status === 'awaiting_search_consent') {
      setConsentQueries(result.activeRun.searchQueries);
    }
  }, []);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      void reloadConversations().catch((caught: unknown) =>
        setError(
          caught instanceof Error ? caught.message : 'Assistant indisponible.',
        ),
      );
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [reloadConversations]);

  useEffect(() => {
    if (!selectedId) return;
    const timeout = window.setTimeout(() => {
      void reloadMessages(selectedId).catch((caught: unknown) =>
        setError(
          caught instanceof Error
            ? caught.message
            : 'Conversation indisponible.',
        ),
      );
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [reloadMessages, selectedId]);

  useEffect(() => {
    if (!activeRun || TERMINAL.has(activeRun.status)) return;
    const interval = window.setInterval(() => {
      setElapsedMinutes(
        Math.max(
          0,
          Math.floor((Date.now() - Date.parse(activeRun.createdAt)) / 60_000),
        ),
      );
      void getAssistantRun(activeRun.id)
        .then(async (run) => {
          setActiveRun(run);
          if (run.status === 'awaiting_search_consent')
            setConsentQueries(run.searchQueries);
          if (TERMINAL.has(run.status) && selectedId) {
            await Promise.all([
              reloadMessages(selectedId),
              reloadConversations(),
            ]);
          }
        })
        .catch(() => undefined);
    }, 2_500);
    return () => window.clearInterval(interval);
  }, [activeRun, reloadConversations, reloadMessages, selectedId]);

  useEffect(() => {
    const flush = () => {
      void flushAssistantOutbox().then(async () => {
        setOfflinePending(false);
        if (selectedId) await reloadMessages(selectedId);
      });
    };
    window.addEventListener('online', flush);
    if (navigator.onLine) flush();
    return () => window.removeEventListener('online', flush);
  }, [reloadMessages, selectedId]);

  async function createConversation() {
    if (!navigator.onLine) {
      setError('La création d’une conversation nécessite le hub.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const conversation = await createAssistantConversation();
      await reloadConversations();
      setSelectedId(conversation.id);
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : 'Création impossible.',
      );
    } finally {
      setBusy(false);
    }
  }

  async function sendMessage(event: FormEvent) {
    event.preventDefault();
    const content = draft.trim();
    if (!selectedId || !content) return;
    setBusy(true);
    setError(null);
    const input = {
      clientRequestId: crypto.randomUUID(),
      content,
      mode: (mode.startsWith('web-') ? 'web' : mode) as AssistantMode,
      webDepth:
        mode === 'web-fast' ? 'fast' : mode === 'web-deep' ? 'deep' : null,
    } as const;
    try {
      const result = await sendAssistantMessage(selectedId, input);
      setDraft('');
      if (result) {
        setActiveRun(result.run);
        await reloadMessages(selectedId);
      } else {
        setOfflinePending(true);
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Envoi impossible.');
    } finally {
      setBusy(false);
    }
  }

  async function renameConversation(conversation: AssistantConversation) {
    const title = window
      .prompt('Nom de la conversation', conversation.title)
      ?.trim();
    if (!title || title === conversation.title) return;
    await updateAssistantConversation(conversation.id, { title });
    await reloadConversations();
  }

  async function archiveConversation(conversation: AssistantConversation) {
    await updateAssistantConversation(conversation.id, {
      archived: !conversation.archivedAt,
    });
    await reloadConversations();
  }

  async function removeConversation(conversation: AssistantConversation) {
    if (
      !window.confirm(
        `Supprimer « ${conversation.title} » et tous ses messages ?`,
      )
    )
      return;
    await deleteAssistantConversation(conversation.id);
    setSelectedId(null);
    setMessages([]);
    setActiveRun(null);
    await reloadConversations();
  }

  async function handleRunAction(action: 'cancel' | 'retry') {
    if (!activeRun) return;
    const run =
      action === 'cancel'
        ? await cancelAssistantRun(activeRun.id)
        : await retryAssistantRun(activeRun.id);
    setActiveRun(run);
  }

  async function consent(approved: boolean) {
    if (!activeRun) return;
    const run = await answerAssistantSearchConsent(
      activeRun.id,
      approved,
      consentQueries,
    );
    setActiveRun(run);
  }

  const selected =
    conversations.find((conversation) => conversation.id === selectedId) ??
    null;
  const durationsByMessage = useMemo(
    () => responseDurations(messages),
    [messages],
  );

  return (
    <section className="assistant-view" aria-labelledby="assistant-title">
      <header className="section-heading assistant-heading">
        <div>
          <span className="eyebrow">Personnel</span>
          <h2 id="assistant-title">Assistant</h2>
        </div>
        <button
          type="button"
          className="secondary-button"
          onClick={() => void createConversation()}
          disabled={busy}
        >
          Nouvelle conversation
        </button>
      </header>

      <div className="assistant-layout">
        <aside className="assistant-conversations" aria-label="Conversations">
          {conversations.length === 0 ? <p>Aucune conversation.</p> : null}
          {conversations.map((conversation) => (
            <div
              className={conversation.id === selectedId ? 'is-selected' : ''}
              key={conversation.id}
            >
              <button
                type="button"
                onClick={() => setSelectedId(conversation.id)}
              >
                <strong>{conversation.title}</strong>
                <small>
                  {conversation.archivedAt
                    ? 'Archivée'
                    : new Date(conversation.updatedAt).toLocaleDateString(
                        'fr-FR',
                      )}
                </small>
              </button>
              <details>
                <summary aria-label={`Actions pour ${conversation.title}`}>
                  •••
                </summary>
                <button
                  type="button"
                  onClick={() => void renameConversation(conversation)}
                >
                  Renommer
                </button>
                <button
                  type="button"
                  onClick={() => void archiveConversation(conversation)}
                >
                  {conversation.archivedAt ? 'Restaurer' : 'Archiver'}
                </button>
                <button
                  type="button"
                  onClick={() => void removeConversation(conversation)}
                >
                  Supprimer
                </button>
              </details>
            </div>
          ))}
        </aside>

        <div className="assistant-chat">
          {selected ? (
            <>
              <div className="assistant-messages" aria-live="polite">
                {messages.length === 0 ? (
                  <p className="assistant-empty">
                    Commencez une conversation privée avec Friday.
                  </p>
                ) : null}
                {messages.map((message) => (
                  <article
                    className={`assistant-message is-${message.role}`}
                    key={message.id}
                  >
                    <span>{message.role === 'user' ? 'Vous' : 'Friday'}</span>
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
                    {message.role === 'assistant' ? (
                      <small>
                        {message.effectiveMode === 'web'
                          ? message.webDepth === 'deep'
                            ? 'Web approfondi'
                            : 'Web rapide'
                          : 'Classique'}
                        {durationsByMessage.has(message.id)
                          ? ` · ${formatResponseDuration(
                              durationsByMessage.get(message.id) ?? 0,
                            )} au total`
                          : ''}
                      </small>
                    ) : null}
                    {message.sources.length > 0 ? (
                      <details className="assistant-sources">
                        <summary>
                          Sources consultées ({message.sources.length})
                        </summary>
                        <ol>
                          {message.sources.map((source) => (
                            <li
                              key={source.id}
                              id={`assistant-source-${message.id}-${source.id}`}
                            >
                              <a
                                href={source.url}
                                target="_blank"
                                rel="noreferrer"
                              >
                                {source.id} · {source.title}
                              </a>
                              <small>{source.domain}</small>
                            </li>
                          ))}
                        </ol>
                      </details>
                    ) : null}
                  </article>
                ))}
                {offlinePending ? (
                  <div className="assistant-run">En attente de connexion</div>
                ) : null}
                {activeRun && !TERMINAL.has(activeRun.status) ? (
                  <div className="assistant-run" role="status">
                    <strong>{activeRun.stageLabel}</strong>
                    {activeRun.queuePosition ? (
                      <span>
                        {activeRun.queuePosition - 1} demande(s) avant la vôtre
                      </span>
                    ) : null}
                    <small>{elapsedMinutes} min écoulée(s)</small>
                    {activeRun.status === 'awaiting_search_consent' ? (
                      <div className="assistant-consent">
                        <p>
                          Ces requêtes peuvent contenir des informations
                          personnelles :
                        </p>
                        {consentQueries.map((query, index) => (
                          <input
                            key={`${activeRun.id}-${index.toString()}`}
                            value={query}
                            onChange={(event) =>
                              setConsentQueries((current) =>
                                current.map((item, itemIndex) =>
                                  itemIndex === index
                                    ? event.target.value
                                    : item,
                                ),
                              )
                            }
                          />
                        ))}
                        <div>
                          <button
                            type="button"
                            onClick={() => void consent(false)}
                          >
                            Refuser
                          </button>
                          <button
                            type="button"
                            className="primary-button"
                            onClick={() => void consent(true)}
                          >
                            Autoriser
                          </button>
                        </div>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => void handleRunAction('cancel')}
                      >
                        Annuler
                      </button>
                    )}
                  </div>
                ) : null}
                {activeRun?.status === 'failed' ? (
                  <div className="assistant-run is-error" role="alert">
                    <strong>
                      {activeRun.error?.message ?? 'La demande a échoué.'}
                    </strong>
                    <button
                      type="button"
                      onClick={() => void handleRunAction('retry')}
                    >
                      Réessayer
                    </button>
                  </div>
                ) : null}
              </div>

              <form
                className="assistant-composer"
                onSubmit={(event) => void sendMessage(event)}
              >
                <div className="assistant-mode" aria-label="Mode de réponse">
                  {(['auto', 'web-fast', 'web-deep', 'classic'] as const).map(
                    (value) => (
                      <button
                        key={value}
                        type="button"
                        aria-pressed={mode === value}
                        onClick={() => setMode(value)}
                      >
                        {value === 'auto'
                          ? 'Auto'
                          : value === 'web-fast'
                            ? 'Web rapide'
                            : value === 'web-deep'
                              ? 'Web approfondi'
                              : 'Classique'}
                      </button>
                    ),
                  )}
                </div>
                <textarea
                  value={draft}
                  maxLength={8_000}
                  rows={3}
                  placeholder="Écrivez à Friday…"
                  onChange={(event) => setDraft(event.target.value)}
                />
                <button
                  type="submit"
                  className="primary-button"
                  disabled={
                    busy ||
                    Boolean(activeRun && !TERMINAL.has(activeRun.status))
                  }
                >
                  Envoyer
                </button>
              </form>
            </>
          ) : (
            <p className="assistant-empty">
              Créez une conversation pour commencer.
            </p>
          )}
        </div>
      </div>
      {error ? (
        <p className="assistant-error" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
}
