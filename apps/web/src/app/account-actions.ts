import {
  approveDeviceApprovalRequest,
  createPairingCode,
  forgetAdult,
  rejectDeviceApprovalRequest,
  revokeAuthDevice,
} from '../auth/auth-client.js';

import type { useAccountsState } from './use-accounts-state.js';
interface Context {
  setPairingCode: ReturnType<typeof useAccountsState>['setPairingCode'];
  setAuthManagementMessage: ReturnType<
    typeof useAccountsState
  >['setAuthManagementMessage'];
  reloadAuthManagement: () => Promise<void>;
  setConfirmAdultForget: ReturnType<
    typeof useAccountsState
  >['setConfirmAdultForget'];
}
export function createAccountActions({
  setPairingCode,
  setAuthManagementMessage,
  reloadAuthManagement,
  setConfirmAdultForget,
}: Context) {
  async function generatePairingCode() {
    try {
      setPairingCode(await createPairingCode());
      setAuthManagementMessage(
        'Code créé. Il est valable dix minutes et une seule fois.',
      );
    } catch (error) {
      setAuthManagementMessage(
        error instanceof Error ? error.message : 'Création du code impossible.',
      );
    }
  }
  async function revokeDevice(deviceId: string) {
    try {
      await revokeAuthDevice(deviceId);
      setAuthManagementMessage('Appareil révoqué. Ses sessions sont fermées.');
      await reloadAuthManagement();
    } catch (error) {
      setAuthManagementMessage(
        error instanceof Error ? error.message : 'Révocation impossible.',
      );
    }
  }
  async function approveNewDevice(requestId: string) {
    try {
      await approveDeviceApprovalRequest(requestId);
      setAuthManagementMessage('Nouvel appareil autorise.');
      await reloadAuthManagement();
    } catch (error) {
      setAuthManagementMessage(
        error instanceof Error ? error.message : 'Autorisation impossible.',
      );
    }
  }
  async function rejectNewDevice(requestId: string) {
    try {
      await rejectDeviceApprovalRequest(requestId);
      setAuthManagementMessage('Demande refusee.');
      await reloadAuthManagement();
    } catch (error) {
      setAuthManagementMessage(
        error instanceof Error ? error.message : 'Refus impossible.',
      );
    }
  }
  async function forgetSecondAdult() {
    try {
      await forgetAdult();
      setConfirmAdultForget(false);
      setPairingCode(null);
      setAuthManagementMessage(
        'Second adulte oublié. Vous pouvez maintenant créer un nouveau code.',
      );
      await reloadAuthManagement();
    } catch (error) {
      setAuthManagementMessage(
        error instanceof Error
          ? error.message
          : 'Suppression du second adulte impossible.',
      );
    }
  }
  return {
    generatePairingCode,
    revokeDevice,
    approveNewDevice,
    rejectNewDevice,
    forgetSecondAdult,
  };
}
