import { useMemo, useState } from 'react';

import type { RobotVisualGraph } from '@friday/contracts';

import { findVisualPath } from './robot-graph-policy.js';

type PendingGraphAction =
  | { kind: 'delete-object'; objectId: string; objectName: string }
  | { kind: 'delete-place' }
  | { kind: 'merge' };

export default function RobotGraphView({
  graph,
  busy,
  error,
  isOwner,
  onClose,
  onDeleteObject,
  onDeletePlace,
  onMergePlaces,
  onNavigate,
  onTestRoute,
  onRename,
  onRenamePlace,
}: {
  graph: RobotVisualGraph;
  busy: boolean;
  error: string | null;
  isOwner: boolean;
  onClose: () => void;
  onDeleteObject: (objectId: string) => void;
  onDeletePlace: (placeId: string) => void;
  onMergePlaces: (targetPlaceId: string, sourcePlaceId: string) => void;
  onNavigate: (placeId: string) => void;
  onTestRoute: (placeId: string) => void;
  onRename: (objectId: string, currentName: string) => void;
  onRenamePlace: (placeId: string, currentName: string) => void;
}) {
  const [requestedSelectedId, setRequestedSelectedId] = useState(
    graph.currentPlaceId ?? graph.places[0]?.id ?? null,
  );
  const [pendingAction, setPendingAction] = useState<PendingGraphAction | null>(
    null,
  );
  const [mergeSourceId, setMergeSourceId] = useState('');
  const selectedId = graph.places.some(
    (item) => item.id === requestedSelectedId,
  )
    ? requestedSelectedId
    : (graph.currentPlaceId ?? graph.places[0]?.id ?? null);
  const place = graph.places.find((item) => item.id === selectedId) ?? null;
  const views = graph.views.filter((item) => item.placeId === selectedId);
  const objects = graph.objects.filter((item) => item.placeId === selectedId);
  const otherPlaces = graph.places.filter((item) => item.id !== selectedId);
  const mergeSource = graph.places.find((item) => item.id === mergeSourceId);
  const passageCount = graph.transitions.filter(
    (item) => item.fromPlaceId === selectedId || item.toPlaceId === selectedId,
  ).length;
  const placeById = useMemo(
    () => new Map(graph.places.map((item) => [item.id, item])),
    [graph.places],
  );
  const selectedSectors = graph.sectors.filter(
    (item) => item.placeId === selectedId,
  );
  const selectedPorts = graph.ports.filter(
    (item) => item.placeId === selectedId,
  );
  const validationPath = useMemo(
    () =>
      graph.currentPlaceId && selectedId
        ? findVisualPath(graph, graph.currentPlaceId, selectedId, true)
        : null,
    [graph, selectedId],
  );
  const confirmedPath = useMemo(
    () =>
      graph.currentPlaceId && selectedId
        ? findVisualPath(graph, graph.currentPlaceId, selectedId, false)
        : null,
    [graph, selectedId],
  );
  const neighbors = useMemo(
    () =>
      graph.transitions
        .filter((item) => item.fromPlaceId === selectedId)
        .map((transition) => ({
          transition,
          place: placeById.get(transition.toPlaceId),
        })),
    [graph.transitions, placeById, selectedId],
  );

  return (
    <section className="screen robot-map-modal" aria-label="Repères visuels">
      <header>
        <div>
          <h2>La carte du robot</h2>
          <small>
            Des scènes reliées par les passages réellement observés — aucune
            coordonnée 3D.
          </small>
        </div>
        <button type="button" onClick={onClose}>
          Fermer
        </button>
      </header>

      <div className="robot-graph-layout">
        <nav className="robot-graph-places" aria-label="Lieux visuels">
          {graph.places.map((item, index) => (
            <button
              className={`${item.id === selectedId ? 'is-selected' : ''}${item.id === graph.currentPlaceId ? ' is-current' : ''}`}
              key={item.id}
              type="button"
              onClick={() => {
                setRequestedSelectedId(item.id);
                setPendingAction(null);
                setMergeSourceId('');
              }}
            >
              <strong>{item.label ?? `Repère ${String(index + 1)}`}</strong>
              <small>
                {item.status} · {item.objectCount.toString()} objet(s)
              </small>
            </button>
          ))}
        </nav>

        {place ? (
          <article className="robot-graph-detail">
            <header>
              <div>
                <h3>{place.label ?? `Repère ${place.id.slice(0, 8)}`}</h3>
                <small>
                  {place.status} · confiance{' '}
                  {Math.round(place.confidence * 100).toString()} %
                </small>
              </div>
              {isOwner ? (
                <div className="robot-graph-place-actions">
                  <button
                    type="button"
                    onClick={() => onRenamePlace(place.id, place.label ?? '')}
                  >
                    Renommer le repère
                  </button>
                  <button
                    type="button"
                    disabled={busy || otherPlaces.length === 0}
                    onClick={() => {
                      setPendingAction({ kind: 'merge' });
                      setMergeSourceId(otherPlaces[0]?.id ?? '');
                    }}
                  >
                    Même lieu que…
                  </button>
                  <button
                    className="delete-series-button"
                    type="button"
                    disabled={busy}
                    onClick={() => setPendingAction({ kind: 'delete-place' })}
                  >
                    Supprimer
                  </button>
                  {place.status === 'confirmed' && confirmedPath ? (
                    <button type="button" onClick={() => onNavigate(place.id)}>
                      Va là
                    </button>
                  ) : null}
                  {place.status === 'confirmed' &&
                  validationPath &&
                  !confirmedPath ? (
                    <button type="button" onClick={() => onTestRoute(place.id)}>
                      Tester ce trajet
                    </button>
                  ) : null}
                </div>
              ) : null}
            </header>

            {error ? (
              <p className="robot-error" role="alert">
                {error}
              </p>
            ) : null}

            {pendingAction?.kind === 'merge' ? (
              <div className="robot-graph-confirmation" role="alert">
                <strong>Fusionner deux apparences du même lieu</strong>
                <p>
                  {place.label ?? `Repère ${place.id.slice(0, 8)}`} sera
                  conservé. Les vues et liens concordants seront regroupés ; les
                  directions contradictoires devront être réapprises.
                </p>
                <label>
                  <span>Repère à absorber</span>
                  <select
                    value={mergeSourceId}
                    onChange={(event) => setMergeSourceId(event.target.value)}
                  >
                    {otherPlaces.map((candidate, index) => (
                      <option key={candidate.id} value={candidate.id}>
                        {candidate.label ?? `Repère ${String(index + 1)}`}
                      </option>
                    ))}
                  </select>
                </label>
                {mergeSource ? (
                  <small>
                    Le repère «{' '}
                    {mergeSource.label ?? mergeSource.id.slice(0, 8)} » sera
                    supprimé après la fusion.
                  </small>
                ) : null}
                <div>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => setPendingAction(null)}
                  >
                    Annuler
                  </button>
                  <button
                    type="button"
                    disabled={busy || !mergeSourceId}
                    onClick={() => {
                      onMergePlaces(place.id, mergeSourceId);
                      setPendingAction(null);
                    }}
                  >
                    {busy ? 'Fusion…' : 'Confirmer la fusion'}
                  </button>
                </div>
              </div>
            ) : null}

            {pendingAction?.kind === 'delete-place' ? (
              <div className="robot-graph-confirmation is-danger" role="alert">
                <strong>Supprimer ce repère ?</strong>
                <p>
                  {views.length.toString()} vue(s), {objects.length.toString()}{' '}
                  objet(s) et {passageCount.toString()} passage(s) seront
                  oubliés. La scène pourra être réapprise plus tard.
                </p>
                <div>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => setPendingAction(null)}
                  >
                    Annuler
                  </button>
                  <button
                    className="delete-series-button"
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      onDeletePlace(place.id);
                      setPendingAction(null);
                    }}
                  >
                    {busy ? 'Suppression…' : 'Supprimer le repère'}
                  </button>
                </div>
              </div>
            ) : null}

            <div className="robot-graph-views">
              {views.map((view) =>
                view.hasImage ? (
                  <img
                    key={view.id}
                    src={`/api/robot/graph/places/${encodeURIComponent(place.id)}/views/${encodeURIComponent(view.id)}`}
                    alt={`Vue du repère ${place.label ?? place.id.slice(0, 8)}`}
                  />
                ) : (
                  <div className="robot-map-object-placeholder" key={view.id}>
                    Vue privée ou non conservée
                  </div>
                ),
              )}
              {views.length === 0 ? (
                <p>Aucune vue stable pour le moment.</p>
              ) : null}
            </div>

            <h4>Panorama corporel</h4>
            <p>
              {place.panoramaStatus} · {selectedSectors.length.toString()}{' '}
              secteur(s) stable(s) · {selectedPorts.length.toString()} port(s)
            </p>
            <div
              className="robot-panorama-ring"
              aria-label="Secteurs panoramiques"
            >
              {selectedSectors.map((sector) => {
                const port = selectedPorts.find(
                  (candidate) => candidate.sectorId === sector.id,
                );
                return (
                  <span
                    key={sector.id}
                    className={sector.isCanonical ? 'is-canonical' : ''}
                    title={port?.status ?? 'sans port'}
                  >
                    {sector.ordinal.toString()} · {port?.status ?? 'vue'}
                  </span>
                );
              })}
            </div>

            <h4>Objets associés à ce lieu</h4>
            {objects.length > 0 ? (
              <ul className="robot-graph-objects">
                {objects.map((object) => (
                  <li key={object.id}>
                    <span>
                      <strong>{object.displayName}</strong>
                      <small>
                        {object.sightingCount.toString()} observation(s)
                      </small>
                    </span>
                    {isOwner ? (
                      <div className="robot-graph-object-actions">
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() =>
                            onRename(object.id, object.displayName)
                          }
                        >
                          Renommer
                        </button>
                        <button
                          className="delete-series-button"
                          type="button"
                          disabled={busy}
                          onClick={() =>
                            setPendingAction({
                              kind: 'delete-object',
                              objectId: object.id,
                              objectName: object.displayName,
                            })
                          }
                        >
                          Supprimer
                        </button>
                      </div>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : (
              <p>Aucun objet reconnu ici.</p>
            )}

            {pendingAction?.kind === 'delete-object' ? (
              <div className="robot-graph-confirmation is-danger" role="alert">
                <strong>Supprimer cet objet ?</strong>
                <p>
                  « {pendingAction.objectName} » sera oublié. Il pourra
                  réapparaître si le robot le reconnaît de nouveau.
                </p>
                <div>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => setPendingAction(null)}
                  >
                    Annuler
                  </button>
                  <button
                    className="delete-series-button"
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      onDeleteObject(pendingAction.objectId);
                      setPendingAction(null);
                    }}
                  >
                    {busy ? 'Suppression…' : 'Supprimer l’objet'}
                  </button>
                </div>
              </div>
            ) : null}

            <h4>Passages connus</h4>
            <div className="robot-graph-neighbors">
              {neighbors.map(({ transition, place: target }) => (
                <button
                  key={transition.id}
                  type="button"
                  onClick={() => setRequestedSelectedId(transition.toPlaceId)}
                >
                  {transition.direction} · {transition.status} →{' '}
                  {target?.label ?? transition.toPlaceId.slice(0, 8)}
                </button>
              ))}
              {neighbors.length === 0 ? <p>Aucun passage confirmé.</p> : null}
            </div>
          </article>
        ) : (
          <p>Le robot n’a pas encore créé de repère visuel.</p>
        )}
      </div>
    </section>
  );
}
