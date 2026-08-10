import { useCallback, useEffect, useState } from 'react';

import type {
  AuthBootstrapRequest,
  AuthDeviceApprovalRequired,
  AuthLoginRequest,
  AuthPairRequest,
  AuthSession,
} from '@friday/contracts';

import {
  bootstrapHousehold,
  getDeviceApprovalStatus,
  loadAuthState,
  login as loginWithFriday,
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
  const [pendingApproval, setPendingApproval] = useState<{
    approval: AuthDeviceApprovalRequired;
    input: Omit<AuthLoginRequest, 'deviceId'>;
  } | null>(null);

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
      setPendingApproval(null);
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

  const submitLogin = useCallback(
    async (input: Omit<AuthLoginRequest, 'deviceId'>) => {
      setSubmitting(true);
      setError(null);
      try {
        const result = await loginWithFriday(input);
        if ('approvalRequired' in result) {
          setPendingApproval({ approval: result, input });
          return;
        }
        setPendingApproval(null);
        setState({
          bootstrapRequired: false,
          connection: 'online',
          session: result,
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
    },
    [],
  );

  const pollDeviceApproval = useCallback(async () => {
    if (!pendingApproval) return;
    try {
      const status = await getDeviceApprovalStatus(
        pendingApproval.approval.requestId,
        pendingApproval.approval.statusToken,
      );
      if (status === 'pending') return;
      if (status === 'approved') {
        await submitLogin(pendingApproval.input);
        return;
      }
      setPendingApproval(null);
      setError(
        status === 'expired'
          ? 'Demande expiree. Relancez la connexion.'
          : 'Demande refusee.',
      );
    } catch (approvalError) {
      setError(
        approvalError instanceof Error
          ? approvalError.message
          : 'Verification de la demande impossible.',
      );
    }
  }, [pendingApproval, submitLogin]);

  return {
    error,
    loading,
    pendingApproval,
    pollDeviceApproval,
    refresh,
    session: state.session,
    state,
    submitting,
    bootstrap: (input: Omit<AuthBootstrapRequest, 'deviceId'>) =>
      submit(() => bootstrapHousehold(input)),
    login: submitLogin,
    pair: (input: Omit<AuthPairRequest, 'deviceId'>) =>
      submit(() => pairAdult(input)),
    logout: async () => {
      await logout();
      setState({
        bootstrapRequired: false,
        connection: 'online',
        session: null,
      });
      setPendingApproval(null);
    },
  };
}
