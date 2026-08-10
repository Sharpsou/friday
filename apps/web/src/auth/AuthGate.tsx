import { useEffect, useState } from 'react';

import type { useClosedAuth } from './use-closed-auth.js';

type ClosedAuthController = ReturnType<typeof useClosedAuth>;

type EntryMode = 'login' | 'pair';

export function AuthGate({ auth }: { auth: ClosedAuthController }) {
  const [mode, setMode] = useState<EntryMode>('login');
  const [name, setName] = useState('');
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [deviceName, setDeviceName] = useState('Mon téléphone');
  const [code, setCode] = useState('');

  useEffect(() => {
    if (!auth.pendingApproval) return undefined;
    const interval = window.setInterval(() => {
      void auth.pollDeviceApproval();
    }, 2_500);
    return () => window.clearInterval(interval);
  }, [auth]);

  if (auth.loading) {
    return (
      <main className="auth-shell">
        <section className="auth-card" aria-live="polite">
          <span className="eyebrow">Friday</span>
          <h1>Ouverture du foyer…</h1>
        </section>
      </main>
    );
  }

  if (auth.state.connection === 'offline') {
    return (
      <main className="auth-shell">
        <section className="auth-card">
          <span className="eyebrow">Appairage requis</span>
          <h1>Reconnectez-vous au hub Friday.</h1>
          <p>
            Un premier appairage doit être réalisé en ligne. Aucun compte ne
            peut être créé hors connexion.
          </p>
          <button
            className="primary-button"
            type="button"
            onClick={() => void auth.refresh()}
          >
            Réessayer
          </button>
        </section>
      </main>
    );
  }

  const bootstrap = auth.state.bootstrapRequired;
  const showIdentity = bootstrap || mode === 'pair';
  const showDeviceName = bootstrap || mode === 'pair' || mode === 'login';
  const approvalExpiresAt = auth.pendingApproval
    ? new Date(auth.pendingApproval.approval.expiresAt).toLocaleTimeString(
        'fr-FR',
        { hour: '2-digit', minute: '2-digit' },
      )
    : null;
  return (
    <main className="auth-shell">
      <section className="auth-card" aria-labelledby="auth-title">
        <span className="eyebrow">
          {bootstrap ? 'Initialisation privée' : 'Foyer fermé'}
        </span>
        <h1 id="auth-title">
          {bootstrap
            ? 'Créer le premier adulte'
            : mode === 'pair'
              ? 'Rejoindre le foyer'
              : 'Se connecter'}
        </h1>
        <p>
          {bootstrap
            ? 'Ce compte devient propriétaire du foyer. L’inscription publique sera ensuite fermée.'
            : mode === 'pair'
              ? 'Utilisez le code temporaire affiché sur l’appareil du propriétaire.'
              : 'Seul un appareil déjà appairé peut ouvrir cette session.'}
        </p>

        {auth.pendingApproval ? (
          <div className="auth-approval-wait" role="status">
            <strong>Demande envoyee</strong>
            <span>
              Autorisez {deviceName} depuis un appareil deja connecte avant{' '}
              {approvalExpiresAt}.
            </span>
          </div>
        ) : null}

        {!bootstrap ? (
          <div
            className="auth-mode-switch"
            role="group"
            aria-label="Mode d’accès"
          >
            <button
              type="button"
              aria-pressed={mode === 'login'}
              onClick={() => setMode('login')}
            >
              Connexion
            </button>
            <button
              type="button"
              aria-pressed={mode === 'pair'}
              onClick={() => setMode('pair')}
            >
              J’ai un code
            </button>
          </div>
        ) : null}

        <form
          className="auth-form"
          onSubmit={(event) => {
            event.preventDefault();
            if (bootstrap) {
              void auth.bootstrap({ deviceName, identifier, name, password });
            } else if (mode === 'pair') {
              void auth.pair({
                code,
                deviceName,
                identifier,
                name,
                password,
              });
            } else {
              void auth.login({ deviceName, identifier, password });
            }
          }}
        >
          {mode === 'pair' && !bootstrap ? (
            <label>
              <span>Code à 8 chiffres</span>
              <input
                inputMode="numeric"
                pattern="[0-9]{8}"
                autoComplete="one-time-code"
                required
                value={code}
                onChange={(event) =>
                  setCode(event.target.value.replace(/\D/gu, '').slice(0, 8))
                }
              />
            </label>
          ) : null}
          {showIdentity ? (
            <label>
              <span>Prénom ou nom</span>
              <input
                autoComplete="name"
                maxLength={80}
                required
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </label>
          ) : null}
          <label>
            <span>Identifiant Friday</span>
            <input
              autoCapitalize="none"
              autoComplete="username"
              maxLength={40}
              minLength={2}
              placeholder="Ex. adulte1"
              required
              spellCheck={false}
              value={identifier}
              onChange={(event) => setIdentifier(event.target.value)}
            />
          </label>
          <label>
            <span>Phrase secrète</span>
            <input
              type="password"
              minLength={12}
              maxLength={128}
              autoComplete={
                bootstrap || mode === 'pair'
                  ? 'new-password'
                  : 'current-password'
              }
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>
          {showDeviceName ? (
            <label>
              <span>Nom de cet appareil</span>
              <input
                maxLength={80}
                required
                value={deviceName}
                onChange={(event) => setDeviceName(event.target.value)}
              />
            </label>
          ) : null}
          {auth.error ? (
            <p className="auth-error" role="alert">
              {auth.error}
            </p>
          ) : null}
          <button
            className="primary-button"
            type="submit"
            disabled={auth.submitting}
          >
            {auth.submitting
              ? 'Validation…'
              : bootstrap
                ? 'Créer le foyer'
                : mode === 'pair'
                  ? 'Appairer cet appareil'
                  : 'Se connecter'}
          </button>
        </form>
      </section>
    </main>
  );
}
