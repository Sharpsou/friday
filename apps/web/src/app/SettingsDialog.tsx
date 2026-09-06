import { THEME_OPTIONS } from '../app-preferences.js';
import { useAppController } from './use-app-controller.js';
type Props = Pick<
  ReturnType<typeof useAppController>,
  | 'authSession'
  | 'settingsOpen'
  | 'setSettingsOpen'
  | 'settingsCloseRef'
  | 'submitPreferences'
  | 'authMembers'
  | 'generatePairingCode'
  | 'pairingCode'
  | 'deviceApprovalRequests'
  | 'approveNewDevice'
  | 'rejectNewDevice'
  | 'authDevices'
  | 'revokeDevice'
  | 'confirmAdultForget'
  | 'setConfirmAdultForget'
  | 'forgetSecondAdult'
  | 'authManagementMessage'
  | 'auth'
  | 'robotBandwidth'
  | 'robotSettingsBusy'
  | 'changeRobotBandwidth'
  | 'robotPurgeConfirmation'
  | 'setRobotPurgeConfirmation'
  | 'purgeRobotPlaces'
  | 'robotSettingsMessage'
  | 'preferencesDraft'
  | 'setPreferencesDraft'
>;
export function SettingsDialog({
  authSession,
  settingsOpen,
  setSettingsOpen,
  settingsCloseRef,
  submitPreferences,
  authMembers,
  generatePairingCode,
  pairingCode,
  deviceApprovalRequests,
  approveNewDevice,
  rejectNewDevice,
  authDevices,
  revokeDevice,
  confirmAdultForget,
  setConfirmAdultForget,
  forgetSecondAdult,
  authManagementMessage,
  auth,
  robotBandwidth,
  robotSettingsBusy,
  changeRobotBandwidth,
  robotPurgeConfirmation,
  setRobotPurgeConfirmation,
  purgeRobotPlaces,
  robotSettingsMessage,
  preferencesDraft,
  setPreferencesDraft,
}: Props) {
  if (!authSession) return null;
  return (
    <>
      {settingsOpen ? (
        <div
          className="settings-backdrop"
          onMouseDown={() => setSettingsOpen(false)}
        >
          <section
            className="settings-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="settings-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="settings-heading">
              <div>
                <span className="eyebrow">Préférences locales</span>
                <h2 id="settings-title">Réglages</h2>
              </div>
              <button
                ref={settingsCloseRef}
                type="button"
                aria-label="Fermer les réglages"
                onClick={() => setSettingsOpen(false)}
              >
                ×
              </button>
            </div>
            <form onSubmit={(event) => void submitPreferences(event)}>
              <fieldset>
                <legend>Foyer et appareils</legend>
                <p>
                  Connecté comme {authSession.member.name} ·{' '}
                  {authSession.member.role === 'owner'
                    ? 'Propriétaire'
                    : 'Adulte'}
                </p>
                {authSession.member.role === 'owner' &&
                authMembers.length < 2 ? (
                  <button
                    className="secondary-button auth-settings-button"
                    type="button"
                    onClick={() => void generatePairingCode()}
                  >
                    {authMembers.length < 2
                      ? 'Ajouter le second adulte'
                      : 'Réappairer le second adulte'}
                  </button>
                ) : null}
                {pairingCode ? (
                  <div className="pairing-code" role="status">
                    <span>Code temporaire</span>
                    <strong>{pairingCode.code}</strong>
                    <small>
                      Expire à{' '}
                      {new Date(pairingCode.expiresAt).toLocaleTimeString(
                        'fr-FR',
                        { hour: '2-digit', minute: '2-digit' },
                      )}
                    </small>
                  </div>
                ) : null}
                {deviceApprovalRequests.length > 0 ? (
                  <ul className="auth-device-list">
                    {deviceApprovalRequests.map((request) => (
                      <li key={request.id}>
                        <span>
                          <strong>{request.deviceName}</strong>
                          <small>
                            Demande en attente
                            {request.requestIp ? ` · ${request.requestIp}` : ''}
                          </small>
                        </span>
                        <button
                          type="button"
                          onClick={() => void approveNewDevice(request.id)}
                        >
                          Autoriser
                        </button>
                        <button
                          type="button"
                          onClick={() => void rejectNewDevice(request.id)}
                        >
                          Refuser
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : null}
                {authDevices.length > 0 ? (
                  <ul className="auth-device-list">
                    {authDevices.map((device) => (
                      <li key={device.id}>
                        <span>
                          <strong>{device.name}</strong>
                          <small>
                            {device.memberName}
                            {device.current ? ' · Cet appareil' : ''}
                            {device.revokedAt ? ' · Révoqué' : ''}
                          </small>
                        </span>
                        {authSession.member.role === 'owner' &&
                        !device.current &&
                        !device.revokedAt ? (
                          <button
                            type="button"
                            onClick={() => void revokeDevice(device.id)}
                          >
                            Révoquer
                          </button>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                ) : null}
                {authSession.member.role === 'owner' &&
                authMembers.some((member) => member.role === 'adult') &&
                !authDevices.some(
                  (device) =>
                    device.memberName !== authSession.member.name &&
                    !device.revokedAt,
                ) ? (
                  confirmAdultForget ? (
                    <div className="adult-forget-confirmation" role="alert">
                      <p>
                        L’identifiant et la phrase secrète de l’ancien adulte
                        seront supprimés. Les données partagées et les tâches
                        attribuées au second adulte restent conservées.
                      </p>
                      <div>
                        <button
                          type="button"
                          onClick={() => setConfirmAdultForget(false)}
                        >
                          Annuler
                        </button>
                        <button
                          className="delete-series-button"
                          type="button"
                          onClick={() => void forgetSecondAdult()}
                        >
                          Confirmer l’oubli
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button
                      className="secondary-button auth-settings-button"
                      type="button"
                      onClick={() => setConfirmAdultForget(true)}
                    >
                      Oublier le second adulte
                    </button>
                  )
                ) : null}
                {authManagementMessage ? (
                  <p role="status">{authManagementMessage}</p>
                ) : null}
                <button
                  className="secondary-button auth-settings-button"
                  type="button"
                  onClick={() => {
                    setSettingsOpen(false);
                    void auth.logout();
                  }}
                >
                  Se déconnecter
                </button>
              </fieldset>
              {authSession.member.role === 'owner' ? (
                <fieldset>
                  <legend>Robot</legend>
                  <p>
                    Le profil réduit garde l’image en 640 × 480, passe de 15 à 7
                    images/s et compresse davantage. Gain estimé : environ 60 %
                    de trafic caméra, selon la scène.
                  </p>
                  <div
                    className="robot-bandwidth-options"
                    role="group"
                    aria-label="Consommation Wi-Fi du robot"
                  >
                    <button
                      className={
                        robotBandwidth?.profile === 'normal'
                          ? 'primary-button'
                          : 'secondary-button'
                      }
                      type="button"
                      disabled={robotSettingsBusy}
                      aria-pressed={robotBandwidth?.profile === 'normal'}
                      onClick={() => void changeRobotBandwidth('normal')}
                    >
                      Normal
                    </button>
                    <button
                      className={
                        robotBandwidth?.profile === 'reduced'
                          ? 'primary-button'
                          : 'secondary-button'
                      }
                      type="button"
                      disabled={robotSettingsBusy}
                      aria-pressed={robotBandwidth?.profile === 'reduced'}
                      onClick={() => void changeRobotBandwidth('reduced')}
                    >
                      Réduit
                    </button>
                  </div>
                  <p>
                    Mémoire des lieux : la dernière heure cible seulement les
                    lieux créés depuis moins d’une heure. Les objets, vues,
                    trajets et apprentissages associés sont supprimés avec eux.
                  </p>
                  {robotPurgeConfirmation ? (
                    <div className="adult-forget-confirmation" role="alert">
                      <p>
                        {robotPurgeConfirmation === 'all'
                          ? 'Effacer tous les lieux et tous les apprentissages autonomes ?'
                          : 'Effacer les lieux créés pendant la dernière heure et leurs apprentissages associés ?'}
                      </p>
                      <div>
                        <button
                          type="button"
                          disabled={robotSettingsBusy}
                          onClick={() => setRobotPurgeConfirmation(null)}
                        >
                          Annuler
                        </button>
                        <button
                          className="delete-series-button"
                          type="button"
                          disabled={robotSettingsBusy}
                          onClick={() =>
                            void purgeRobotPlaces(robotPurgeConfirmation)
                          }
                        >
                          {robotSettingsBusy ? 'Suppression…' : 'Confirmer'}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="robot-memory-actions">
                      <button
                        className="secondary-button"
                        type="button"
                        disabled={robotSettingsBusy}
                        onClick={() => setRobotPurgeConfirmation('last_hour')}
                      >
                        Effacer la dernière heure
                      </button>
                      <button
                        className="delete-series-button"
                        type="button"
                        disabled={robotSettingsBusy}
                        onClick={() => setRobotPurgeConfirmation('all')}
                      >
                        Tout effacer
                      </button>
                    </div>
                  )}
                  {robotSettingsMessage ? (
                    <p role="status">{robotSettingsMessage}</p>
                  ) : null}
                </fieldset>
              ) : null}
              <fieldset>
                <legend>Responsables</legend>
                <p>
                  Les noms changent seulement l’affichage. Les tâches gardent
                  leur responsable.
                </p>
                <label htmlFor="current-responsible-name">
                  <span>Premier responsable</span>
                  <input
                    id="current-responsible-name"
                    maxLength={40}
                    required
                    value={preferencesDraft.currentResponsibleName}
                    onChange={(event) =>
                      setPreferencesDraft((current) => ({
                        ...current,
                        currentResponsibleName: event.target.value,
                      }))
                    }
                  />
                </label>
                <label htmlFor="other-responsible-name">
                  <span>Deuxième responsable</span>
                  <input
                    id="other-responsible-name"
                    maxLength={40}
                    required
                    value={preferencesDraft.otherResponsibleName}
                    onChange={(event) =>
                      setPreferencesDraft((current) => ({
                        ...current,
                        otherResponsibleName: event.target.value,
                      }))
                    }
                  />
                </label>
              </fieldset>
              <fieldset>
                <legend>Palette de couleurs</legend>
                <div className="palette-grid">
                  {THEME_OPTIONS.map((theme) => (
                    <label
                      className={`palette-option is-${theme.value}`}
                      key={theme.value}
                    >
                      <input
                        type="radio"
                        name="theme"
                        value={theme.value}
                        checked={preferencesDraft.theme === theme.value}
                        onChange={() =>
                          setPreferencesDraft((current) => ({
                            ...current,
                            theme: theme.value,
                          }))
                        }
                      />
                      <span className="palette-swatches" aria-hidden="true">
                        <i />
                        <i />
                        <i />
                      </span>
                      <strong>{theme.label}</strong>
                    </label>
                  ))}
                </div>
              </fieldset>
              <fieldset>
                <legend>Nombre de tâches affichées</legend>
                <label htmlFor="today-task-limit">
                  <span>Aujourd’hui</span>
                  <input
                    id="today-task-limit"
                    type="number"
                    min="1"
                    max="50"
                    required
                    value={preferencesDraft.todayTaskLimit}
                    onChange={(event) =>
                      setPreferencesDraft((current) => ({
                        ...current,
                        todayTaskLimit: Number(event.target.value),
                      }))
                    }
                  />
                </label>
                <label htmlFor="home-task-limit">
                  <span>Chaque liste Agenda</span>
                  <input
                    id="home-task-limit"
                    type="number"
                    min="1"
                    max="200"
                    required
                    value={preferencesDraft.homeTaskLimit}
                    onChange={(event) =>
                      setPreferencesDraft((current) => ({
                        ...current,
                        homeTaskLimit: Number(event.target.value),
                      }))
                    }
                  />
                </label>
              </fieldset>
              <div className="settings-actions">
                <button
                  className="secondary-button"
                  type="button"
                  onClick={() => setSettingsOpen(false)}
                >
                  Annuler
                </button>
                <button className="primary-button" type="submit">
                  Enregistrer
                </button>
              </div>
            </form>
          </section>
        </div>
      ) : null}
    </>
  );
}
