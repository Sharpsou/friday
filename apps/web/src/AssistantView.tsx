import type {
  AssistantConversation,
  AssistantMessage,
} from '@friday/contracts';
import { Suspense, useCallback, useEffect, useState } from 'react';
import { ignoreAvailabilityChange } from './chat/chat-availability.js';
import { AssistantMarkdown, VerifiedChat } from './chat/VerifiedChat.js';
import {
  deleteAssistantConversation,
  getAssistantMessages,
  listAssistantConversations,
  updateAssistantConversation,
} from './sync/assistant-client.js';

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
  const [deleteConfirmationOpen, setDeleteConfirmationOpen] = useState(false);
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
    if (!selected) return;
    setBusy(true);
    setError(null);
    try {
      await deleteAssistantConversation(selected.id);
      setSelectedId(null);
      setDeleteConfirmationOpen(false);
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
                  onClick={() => setDeleteConfirmationOpen(true)}
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
      {deleteConfirmationOpen && selected ? (
        <div
          className="settings-backdrop"
          onMouseDown={() => {
            if (!busy) setDeleteConfirmationOpen(false);
          }}
        >
          <section
            aria-labelledby="legacy-chat-delete-title"
            aria-modal="true"
            className="settings-dialog deletion-dialog"
            onMouseDown={(event) => event.stopPropagation()}
            role="dialog"
          >
            <div className="settings-heading">
              <div>
                <span className="eyebrow">Archive historique</span>
                <h2 id="legacy-chat-delete-title">
                  Supprimer définitivement&nbsp;?
                </h2>
              </div>
            </div>
            <p>
              «&nbsp;{selected.title}&nbsp;» et tous ses messages historiques
              seront supprimés. Cette action est irréversible.
            </p>
            <div className="deletion-actions">
              <button
                className="secondary-button"
                disabled={busy}
                onClick={() => setDeleteConfirmationOpen(false)}
                type="button"
              >
                Annuler
              </button>
              <button
                className="delete-series-button"
                disabled={busy}
                onClick={() => void deleteSelected()}
                type="button"
              >
                {busy ? 'Suppression…' : 'Supprimer la conversation'}
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </section>
  );
}

export { ChatAnswerStatus } from './chat/VerifiedChat.js';
