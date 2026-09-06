import type {
  AuthDevice,
  AuthDeviceApprovalRequest,
  AuthMember,
} from '@friday/contracts';
import { useState } from 'react';

export function useAccountsState() {
  const [authDevices, setAuthDevices] = useState<AuthDevice[]>([]);
  const [deviceApprovalRequests, setDeviceApprovalRequests] = useState<
    AuthDeviceApprovalRequest[]
  >([]);
  const [authMembers, setAuthMembers] = useState<AuthMember[]>([]);
  const [pairingCode, setPairingCode] = useState<{
    code: string;
    expiresAt: string;
  } | null>(null);
  const [authManagementMessage, setAuthManagementMessage] = useState<
    string | null
  >(null);
  const [confirmAdultForget, setConfirmAdultForget] = useState(false);
  return {
    authDevices,
    setAuthDevices,
    deviceApprovalRequests,
    setDeviceApprovalRequests,
    authMembers,
    setAuthMembers,
    pairingCode,
    setPairingCode,
    authManagementMessage,
    setAuthManagementMessage,
    confirmAdultForget,
    setConfirmAdultForget,
  };
}
