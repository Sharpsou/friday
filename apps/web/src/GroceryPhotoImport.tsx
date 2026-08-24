import { useRef, useState } from 'react';

import type { GroceryPhotoTranscriptionItem } from '@friday/contracts';

import { transcribeGroceryPhoto } from './sync/grocery-photo-client.js';

type DraftItem = GroceryPhotoTranscriptionItem & { id: string };
type PhotoStatus = 'idle' | 'analyzing' | 'ready' | 'error' | 'saving';

export function GroceryPhotoImport({
  available,
  onImport,
}: {
  available: boolean;
  onImport: (
    items: Array<{ label: string; quantityText: string | null }>,
  ) => Promise<void>;
}) {
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const galleryInputRef = useRef<HTMLInputElement>(null);
  const analysisControllerRef = useRef<AbortController | null>(null);
  const rowRefs = useRef(new Map<string, HTMLInputElement>());
  const [pickerOpen, setPickerOpen] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [status, setStatus] = useState<PhotoStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [items, setItems] = useState<DraftItem[]>([]);

  const buttonLabel =
    status === 'analyzing'
      ? 'Analyse…'
      : status === 'ready'
        ? 'Photo prête'
        : status === 'error'
          ? 'Réessayer photo'
          : 'Photo';

  function resetDraft() {
    setError(null);
    setPreviewUrl(null);
    setItems([]);
  }

  async function readPhoto(file: File) {
    const controller = new AbortController();
    analysisControllerRef.current?.abort();
    analysisControllerRef.current = controller;
    setPickerOpen(false);
    setDialogOpen(false);
    setStatus('analyzing');
    resetDraft();
    try {
      const result = await transcribeGroceryPhoto(file, {
        signal: controller.signal,
        onPrepared: setPreviewUrl,
      });
      if (controller.signal.aborted) return;
      setItems(
        result.items.map((item) => ({ ...item, id: crypto.randomUUID() })),
      );
      if (result.items.length === 0) {
        setError('Aucun produit lisible. Reprenez la photo de plus près.');
        setStatus('error');
      } else {
        setStatus('ready');
      }
    } catch (caught) {
      if (controller.signal.aborted) return;
      setError(
        caught instanceof Error
          ? caught.message
          : 'Lecture de la photo impossible.',
      );
      setStatus('error');
      setDialogOpen(false);
    } finally {
      if (analysisControllerRef.current === controller) {
        analysisControllerRef.current = null;
      }
      if (cameraInputRef.current) cameraInputRef.current.value = '';
      if (galleryInputRef.current) galleryInputRef.current.value = '';
    }
  }

  function cancelAnalysis() {
    analysisControllerRef.current?.abort(
      new DOMException('Analyse annulée.', 'AbortError'),
    );
    analysisControllerRef.current = null;
    setStatus('idle');
    setDialogOpen(false);
    resetDraft();
  }

  function openPhotoControl() {
    if (status === 'analyzing' || status === 'ready') {
      setDialogOpen(true);
      return;
    }
    setPickerOpen((current) => !current);
  }

  function updateItem(id: string, update: Partial<DraftItem>) {
    setItems((current) =>
      current.map((item) => (item.id === id ? { ...item, ...update } : item)),
    );
  }

  async function confirmImport() {
    const validItems = items
      .map((item) => ({
        label: item.label.trim(),
        quantityText: item.quantityText?.trim() || null,
      }))
      .filter((item) => item.label.length > 0);
    if (validItems.length === 0) return;
    setStatus('saving');
    setError(null);
    try {
      await onImport(validItems);
      setDialogOpen(false);
      setStatus('idle');
      resetDraft();
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : 'Ajout de la liste impossible.',
      );
      setStatus('ready');
    }
  }

  return (
    <div className="grocery-photo-control">
      <input
        ref={cameraInputRef}
        className="visually-hidden"
        type="file"
        accept="image/*"
        capture="environment"
        aria-label="Photo prise avec l’appareil photo"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void readPhoto(file);
        }}
      />
      <input
        ref={galleryInputRef}
        className="visually-hidden"
        type="file"
        accept="image/*"
        aria-label="Photo choisie dans la galerie"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void readPhoto(file);
        }}
      />
      <button
        className={`photo-groceries-button is-${status}`}
        type="button"
        disabled={
          status === 'saving' ||
          (!available && (status === 'idle' || status === 'error'))
        }
        aria-expanded={pickerOpen || dialogOpen}
        title={available ? undefined : 'La lecture nécessite le hub local.'}
        onClick={openPhotoControl}
      >
        {status === 'analyzing' ? (
          <span className="background-job-dot" aria-hidden="true" />
        ) : null}
        {buttonLabel}
      </button>

      {pickerOpen ? (
        <div className="grocery-photo-picker" role="menu">
          <button
            type="button"
            role="menuitem"
            onClick={() => cameraInputRef.current?.click()}
          >
            Prendre une photo
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => galleryInputRef.current?.click()}
          >
            Choisir dans la galerie
          </button>
        </div>
      ) : null}

      {dialogOpen ? (
        <div className="settings-backdrop grocery-photo-backdrop">
          <section
            className="settings-dialog grocery-photo-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="grocery-photo-title"
          >
            <header>
              <div>
                <small>Import local</small>
                <h2 id="grocery-photo-title">
                  {status === 'analyzing'
                    ? 'Analyse en cours'
                    : 'Vérifier la photo'}
                </h2>
              </div>
              <button
                type="button"
                disabled={status === 'saving'}
                aria-label="Continuer en arrière-plan"
                title="Continuer en arrière-plan"
                onClick={() => setDialogOpen(false)}
              >
                ×
              </button>
            </header>

            {status === 'analyzing' ? (
              <div className="grocery-photo-loading" role="status">
                <span className="background-job-dot" aria-hidden="true" />
                <strong>Friday lit la liste sur le PC…</strong>
                <small>
                  Vous pouvez fermer cette fenêtre et continuer à utiliser
                  Friday.
                </small>
              </div>
            ) : null}

            {previewUrl ? (
              <div className="grocery-photo-preview">
                <img src={previewUrl} alt="Liste de courses photographiée" />
                {items.map((item, index) => (
                  <button
                    key={item.id}
                    type="button"
                    className="grocery-photo-detection"
                    style={{
                      left: `${item.box.x / 10}%`,
                      top: `${item.box.y / 10}%`,
                      width: `${item.box.width / 10}%`,
                      height: `${item.box.height / 10}%`,
                    }}
                    title={item.sourceText}
                    aria-label={`Modifier ${item.label}`}
                    onClick={() => rowRefs.current.get(item.id)?.focus()}
                  >
                    {index + 1}
                  </button>
                ))}
              </div>
            ) : null}

            {items.length > 0 ? (
              <ol className="grocery-photo-items">
                {items.map((item, index) => (
                  <li key={item.id}>
                    <span>{index + 1}</span>
                    <div>
                      <small title={item.sourceText}>
                        Lu : {item.sourceText}
                      </small>
                      <input
                        ref={(element) => {
                          if (element) rowRefs.current.set(item.id, element);
                          else rowRefs.current.delete(item.id);
                        }}
                        aria-label={`Produit ${index + 1}`}
                        value={item.label}
                        maxLength={200}
                        onChange={(event) =>
                          updateItem(item.id, { label: event.target.value })
                        }
                      />
                    </div>
                    <input
                      aria-label={`Quantité ${index + 1}`}
                      value={item.quantityText ?? ''}
                      maxLength={80}
                      placeholder="Quantité"
                      onChange={(event) =>
                        updateItem(item.id, {
                          quantityText: event.target.value || null,
                        })
                      }
                    />
                    <button
                      type="button"
                      aria-label={`Retirer ${item.label}`}
                      onClick={() =>
                        setItems((current) =>
                          current.filter(
                            (candidate) => candidate.id !== item.id,
                          ),
                        )
                      }
                    >
                      ×
                    </button>
                  </li>
                ))}
              </ol>
            ) : null}

            {error ? <p className="form-error">{error}</p> : null}

            <footer className="dialog-actions grocery-photo-actions">
              {status === 'analyzing' ? (
                <>
                  <button type="button" onClick={cancelAnalysis}>
                    Annuler l’analyse
                  </button>
                  <button type="button" onClick={() => setDialogOpen(false)}>
                    Continuer en arrière-plan
                  </button>
                </>
              ) : status === 'error' ? (
                <>
                  <button type="button" onClick={() => setDialogOpen(false)}>
                    Fermer
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setDialogOpen(false);
                      setPickerOpen(true);
                    }}
                  >
                    Choisir une autre photo
                  </button>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    disabled={status === 'saving'}
                    onClick={() => {
                      setDialogOpen(false);
                      setStatus('idle');
                      resetDraft();
                    }}
                  >
                    Annuler
                  </button>
                  <button
                    type="button"
                    disabled={
                      status === 'saving' ||
                      items.every((item) => !item.label.trim())
                    }
                    onClick={() => void confirmImport()}
                  >
                    Ajouter les produits
                  </button>
                </>
              )}
            </footer>
          </section>
        </div>
      ) : null}
    </div>
  );
}
