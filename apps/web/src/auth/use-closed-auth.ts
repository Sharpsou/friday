import { useCallback, useEffect, useState } from 'react';

import type {
  AuthBootstrapRequest,
  AuthLoginRequest,
  AuthPairRequest,
  AuthSession,
} from '@friday/contracts';

import {
  bootstrapHousehold,
  loadAuthState,
  login,
  logout,
  pairAdult,
  type LocalAuthState,
} from './auth-client.js';

const INITIAL_STATE: LocalAuthState = {
  bootstrapRequired: false,
  connection: 'offline',
  session: null,
};

export function useClosedAuth() {
  const [state, setState] = useState(INITIAL_STATE);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    const nextState = await loadAuthState();
    setState(nextState);
    setLoading(false);
  }, []);

  useEffect(() => {
    window.queueMicrotask(() => void refresh());
  }, [refresh]);

  const submit = useCallback(async (action: () => Promise<AuthSession>) => {
    setSubmitting(true);
    setError(null);
    try {
      const session = await action();
      setState({
        bootstrapRequired: false,
        connection: 'online',
        session,
      });
    } catch (submitError) {
      setError(
        submitError instanceof Error
          ? submitError.message
          : 'Authentification impossible.',
      );
    } finally {
      setSubmitting(false);
    }
  }, []);

  return {
    error,
    loading,
    refresh,
    session: state.session,
    state,
    submitting,
    bootstrap: (input: Omit<AuthBootstrapRequest, 'deviceId'>) =>
      submit(() => bootstrapHousehold(input)),
    login: (input: Omit<AuthLoginRequest, 'deviceId'>) =>
      submit(() => login(input)),
    pair: (input: Omit<AuthPairRequest, 'deviceId'>) =>
      submit(() => pairAdult(input)),
    logout: async () => {
      await logout();
      setState({
        bootstrapRequired: false,
        connection: 'online',
        session: null,
      });
    },
  };
}
