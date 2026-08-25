import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from 'react';

import type {
  AssistantConversation,
  AssistantExaUsage,
  AssistantMessage,
  AssistantModel,
  AssistantMode,
  AssistantRun,
  AssistantRunEvent,
  AssistantWebUsage,
  ResearchDiagnostic,
} from '@friday/contracts';

import {
  cancelAssistantRun,
  createAssistantConversation,
  deleteAssistantConversation,
  flushAssistantOutbox,
  getAssistantMessages,
  getAssistantExaUsage,
  getAssistantResearchDiagnostics,
  getAssistantRun,
  getAssistantRunEvents,
  getAssistantWebUsage,
  hasQueuedAssistantMessages,
  listAssistantConversations,
  retryAssistantRun,
  sendAssistantMessage,
  submitAssistantSearchConsent,
  updateAssistantConversation,
} from './sync/assistant-client.js';
import {
  formatResponseDuration,
  processingDuration,
  processingOffsets,
  responseDurations,
} from './assistant-duration.js';

const TERMINAL = new Set(['completed', 'cancelled', 'failed']);
const AssistantMarkdown = lazy(() => import('./AssistantMarkdown.js'));

function modeLabel(mode: AssistantMode): string {
  if (mode === 'web_light') return 'Web léger';
  if (mode === 'web_deep') return 'Web approfondi';
  if (mode === 'friday') return 'Friday';
  return 'local';
}

function modelLabel(model: AssistantModel): string {
  return model === 'qwen3.5' ? 'Qwen 3.5 9B Q4' : 'Gemma 4 E4B QAT';
}

function diagnosticStatusLabel(status: ResearchDiagnostic['status']): string {
  if (status === 'success') return 'sources trouvées';
  if (status === 'empty') return 'aucun résultat';
  if (status === 'rate_limited') return 'limite atteinte';
  if (status === 'unavailable') return 'indisponible';
  if (status === 'skipped') return 'ignoré';
  return 'échec';
}

function formatProgressOffset(durationMs: number) {
  const seconds = Math.max(0, Math.round(durationMs / 1_000));
  if (seconds < 60) return `+${seconds.toString()} s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return remainingSeconds === 0
    ? `+${minutes.toString()} min`
    : `+${minutes.toString()} min ${remainingSeconds.toString()} s`;
}

function AssistantProgress({
  active,
  events,
  runId,
}: {
  active: boolean;
  events: AssistantRunEvent[];
  runId: string;
}) {
  const lastLabel = events.at(-1)?.label ?? 'Préparation';
  const offsets = processingOffsets(events);
  return (
    <details
      className={`assistant-progress${active ? ' is-active' : ''}`}
      open={active ? true : undefined}
      key={`${runId}-${active ? 'active' : 'complete'}`}
    >
      <summary>
        {active
          ? `Traitement en cours · ${lastLabel}`
          : `Détails du traitement · ${events.length.toString()} étape(s)`}
      </summary>
      <ol aria-live={active ? 'polite' : 'off'}>
        {events.map((event, index) => (
          <li className={`is-${event.status}`} key={event.sequence}>
            <span>{event.label}</span>
            <time dateTime={event.createdAt}>
              {formatProgressOffset(offsets[index] ?? 0)}
            </time>
          </li>
        ))}
      </ol>
      <small>
        Étapes opérationnelles uniquement : le raisonnement interne brut n’est
        pas enregistré.
      </small>
    </details>
  );
}

export default function AssistantView({
  assistantModel,
  createRequest,
}: {
  assistantModel: AssistantModel;
  createRequest: number;
}) {
  const [conversations, setConversations] = useState<AssistantConversation[]>(
    [],
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [messages, setMessages] = useState<AssistantMessage[]>([]);
  const [activeRun, setActiveRun] = useState<AssistantRun | null>(null);
  const [activeRunEvents, setActiveRunEvents] = useState<AssistantRunEvent[]>(
    [],
  );
  const [draft, setDraft] = useState('');
  const [offlinePending, setOfflinePending] = useState(false);
  const [clockNow, setClockNow] = useState(() => Date.now());
  const [busy, setBusy] = useState(false);
  const [webUsage, setWebUsage] = useState<AssistantWebUsage | null>(null);
  const [exaUsage, setExaUsage] = useState<AssistantExaUsage | null>(null);
  const [researchDiagnostics, setResearchDiagnostics] = useState<
    ResearchDiagnostic[]
  >([]);
  const [error, setError] = useState<string | null>(null);
  const handledCreateRequest = useRef(createRequest);

  const reloadConversations = useCallback(async () => {
    const [next, usage, nextExaUsage] = await Promise.all([
      listAssistantConversations(),
      navigator.onLine ? getAssistantWebUsage().catch(() => null) : null,
      navigator.onLine ? getAssistantExaUsage().catch(() => null) : null,
    ]);
    setConversations(next);
    setWebUsage(usage);
    setExaUsage(nextExaUsage);
    setSelectedId(
      (current) => current ?? next.find((item) => !item.archivedAt)?.id ?? null,
    );
  }, []);

  const reloadMessages = useCallback(async (conversationId: string) => {
    const [result, pending, diagnostics] = await Promise.all([
      getAssistantMessages(conversationId),
      hasQueuedAssistantMessages(),
      navigator.onLine
        ? getAssistantResearchDiagnostics(conversationId).catch(() => ({
            diagnostics: [],
          }))
        : Promise.resolve({ diagnostics: [] }),
    ]);
    const progressEvents = result.activeRun
      ? await getAssistantRunEvents(result.activeRun.id).catch(() => [])
      : [];
    setMessages(result.messages);
    setActiveRun(result.activeRun);
    setActiveRunEvents(progressEvents);
    setOfflinePending(pending);
    setResearchDiagnostics(diagnostics.diagnostics);
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
      setClockNow(Date.now());
      void Promise.all([
        getAssistantRun(activeRun.id),
        getAssistantRunEvents(activeRun.id),
      ])
        .then(async ([run, events]) => {
          setActiveRun(run);
          setActiveRunEvents(events);
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

  const createConversation = useCallback(async () => {
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
  }, [reloadConversations]);

  useEffect(() => {
    if (createRequest === handledCreateRequest.current) return;
    handledCreateRequest.current = createRequest;
    void createConversation();
  }, [createConversation, createRequest]);

  async function sendMessage(event: FormEvent) {
    event.preventDefault();
    const content = draft.trim();
    if (!selectedId || !content) return;
    setBusy(true);
    setError(null);
    const mode =
      conversations.find((conversation) => conversation.id === selectedId)
        ?.mode ?? 'local';
    const input = {
      clientRequestId: crypto.randomUUID(),
      content,
      mode,
      model: assistantModel,
      thinkingPolicy: 'auto',
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

  async function changeMode(mode: AssistantMode) {
    if (!selectedId) return;
    setBusy(true);
    setError(null);
    try {
      const updated = await updateAssistantConversation(selectedId, { mode });
      setConversations((current) =>
        current.map((conversation) =>
          conversation.id === updated.id ? updated : conversation,
        ),
      );
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : 'Changement de mode impossible.',
      );
    } finally {
      setBusy(false);
    }
  }

  async function handleConsent(approved: boolean) {
    if (!activeRun) return;
    setBusy(true);
    try {
      setActiveRun(
        await submitAssistantSearchConsent(
          activeRun.id,
          approved,
          activeRun.searchQueries,
        ),
      );
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : 'Réponse impossible.',
      );
    } finally {
      setBusy(false);
    }
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
    setBusy(true);
    setError(null);
    try {
      const run =
        action === 'cancel'
          ? await cancelAssistantRun(activeRun.id)
          : await retryAssistantRun(activeRun.id);
      const events = await getAssistantRunEvents(run.id).catch(() => []);
      setActiveRun(run);
      setActiveRunEvents(events);
      setClockNow(Date.now());
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Action impossible.');
    } finally {
      setBusy(false);
    }
  }

  const selected =
    conversations.find((conversation) => conversation.id === selectedId) ??
    null;
  const durationsByMessage = useMemo(
    () => responseDurations(messages),
    [messages],
  );
  const activeProcessingDuration = useMemo(
    () => processingDuration(activeRunEvents, clockNow),
    [activeRunEvents, clockNow],
  );
  const diagnosticsByRun = useMemo(() => {
    const result = new Map<string, ResearchDiagnostic[]>();
    for (const diagnostic of researchDiagnostics)
      result.set(diagnostic.runId, [
        ...(result.get(diagnostic.runId) ?? []),
        diagnostic,
      ]);
    return result;
  }, [researchDiagnostics]);

  return (
    <section className="assistant-view" aria-label="Chat">
      <div className="assistant-heading-actions">
        {webUsage ? (
          <small
            className="assistant-remaining-searches"
            aria-label={`${webUsage.remainingBasicSearches.toString()} recherches Web légères restantes ce mois, quota partagé entre les deux profils`}
            title="Compteur commun aux deux profils. Une recherche approfondie peut compter double."
          >
            Web · {webUsage.remainingBasicSearches} req. restantes
          </small>
        ) : null}
        {exaUsage ? (
          <small
            className="assistant-remaining-searches"
            aria-label={`${exaUsage.calls.toString()} appels Exa effectués ce mois`}
            title="Compteur local des appels anonymes. Exa ne communique pas de quota restant."
          >
            Exa · {exaUsage.calls} appel{exaUsage.calls > 1 ? 's' : ''}
            {exaUsage.status === 'untested'
              ? ' · non testé'
              : exaUsage.status === 'rate_limited'
                ? ' · limité'
                : exaUsage.status === 'unavailable'
                  ? ' · indisponible'
                  : ''}
          </small>
        ) : null}
      </div>

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
                        {modelLabel(message.model)} · {modeLabel(message.mode)}
                        {message.thinkingUsed ? ' · réflexion active' : ''}
                        {message.creditsUsed > 0
                          ? ` · ${message.creditsUsed.toString()} crédit(s)`
                          : ''}
                        {durationsByMessage.has(message.id)
                          ? ` · ${formatResponseDuration(
                              durationsByMessage.get(message.id) ?? 0,
                            )} de traitement`
                          : ''}
                      </small>
                    ) : null}
                    {message.role === 'assistant' &&
                    message.runId &&
                    message.progressEvents.length > 0 ? (
                      <AssistantProgress
                        active={false}
                        events={message.progressEvents}
                        runId={message.runId}
                      />
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
                    {message.role === 'assistant' &&
                    message.runId &&
                    (diagnosticsByRun.get(message.runId)?.length ?? 0) > 0 ? (
                      <details className="assistant-sources assistant-diagnostics">
                        <summary>Diagnostic de recherche</summary>
                        <ul>
                          {diagnosticsByRun.get(message.runId)?.map((item) => (
                            <li key={`${item.runId}-${item.provider}`}>
                              <strong>
                                {item.provider === 'exa' ? 'Exa' : 'Tavily'}
                              </strong>{' '}
                              · {diagnosticStatusLabel(item.status)} ·{' '}
                              {item.results.toString()} résultat(s) ·{' '}
                              {(item.durationMs / 1_000).toFixed(1)} s
                              <small>{item.message}</small>
                            </li>
                          ))}
                        </ul>
                      </details>
                    ) : null}
                  </article>
                ))}
                {offlinePending ? (
                  <div className="assistant-run">En attente de connexion</div>
                ) : null}
                {activeRun && !TERMINAL.has(activeRun.status) ? (
                  <div className="assistant-run" role="status">
                    <AssistantProgress
                      active
                      events={activeRunEvents}
                      runId={activeRun.id}
                    />
                    {activeRun.queuePosition ? (
                      <span>
                        {activeRun.queuePosition - 1} demande(s) avant la vôtre
                      </span>
                    ) : null}
                    <small>
                      {activeRun.status === 'queued'
                        ? 'Traitement · en attente'
                        : `Traitement cumulé · ${formatResponseDuration(
                            activeProcessingDuration,
                          )}`}
                    </small>
                    {activeRun.status === 'awaiting_search_consent' ? (
                      <div className="assistant-consent">
                        <p>
                          Une requête contenait une donnée potentiellement
                          personnelle. La version ci-dessous a été nettoyée.
                          Autoriser son envoi à Tavily ?
                        </p>
                        <ul>
                          {activeRun.searchQueries.map((query) => (
                            <li key={query}>{query}</li>
                          ))}
                        </ul>
                        <button
                          type="button"
                          onClick={() => void handleConsent(true)}
                        >
                          Autoriser
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleConsent(false)}
                        >
                          Rester en local
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        disabled={
                          busy || activeRun.status === 'cancel_requested'
                        }
                        onClick={() => void handleRunAction('cancel')}
                      >
                        {activeRun.status === 'cancel_requested'
                          ? 'Mise en pause…'
                          : 'Mettre en pause'}
                      </button>
                    )}
                  </div>
                ) : null}
                {activeRun?.status === 'cancelled' ? (
                  <div className="assistant-run" role="status">
                    <strong>Réponse mise en pause.</strong>
                    {activeRunEvents.length > 0 ? (
                      <AssistantProgress
                        active={false}
                        events={activeRunEvents}
                        runId={activeRun.id}
                      />
                    ) : null}
                    <small>
                      Traitement cumulé ·{' '}
                      {formatResponseDuration(activeProcessingDuration)}
                    </small>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void handleRunAction('retry')}
                    >
                      Reprendre
                    </button>
                  </div>
                ) : null}
                {activeRun?.status === 'failed' ? (
                  <div className="assistant-run is-error" role="alert">
                    <strong>
                      {activeRun.error?.message ?? 'La demande a échoué.'}
                    </strong>
                    {activeRunEvents.length > 0 ? (
                      <AssistantProgress
                        active={false}
                        events={activeRunEvents}
                        runId={activeRun.id}
                      />
                    ) : null}
                    <small>
                      Traitement cumulé ·{' '}
                      {formatResponseDuration(activeProcessingDuration)}
                    </small>
                    <button
                      type="button"
                      disabled={busy}
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
                  {(
                    [
                      ['local', 'Local'],
                      ['web_light', 'Web léger'],
                      ['web_deep', 'Web approfondi'],
                      ['friday', 'Friday'],
                    ] as const
                  ).map(([mode, label]) => (
                    <button
                      type="button"
                      key={mode}
                      className={selected.mode === mode ? 'is-selected' : ''}
                      aria-pressed={selected.mode === mode}
                      disabled={
                        busy ||
                        Boolean(activeRun && !TERMINAL.has(activeRun.status))
                      }
                      onClick={() => void changeMode(mode)}
                    >
                      {label}
                    </button>
                  ))}
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
