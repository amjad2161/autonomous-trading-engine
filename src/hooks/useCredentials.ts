import { useState, useEffect, useCallback } from 'react';

export interface GateCredentials {
  apiKey: string;
  apiSecret: string;
}

// SECURITY: Always use server-side credentials - never store in browser
const USE_SERVER_CREDENTIALS = true;

export function useCredentials() {
  const [credentials, setCredentialsState] = useState<GateCredentials | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    // SECURITY: Always use server mode - credentials stored in cloud only
    setCredentialsState({ apiKey: 'SERVER', apiSecret: 'SERVER' });
    setIsLoading(false);
  }, []);

  const setCredentials = useCallback((_creds: GateCredentials) => {
    // SECURITY: No-op - credentials should only be set via cloud
    console.warn('setCredentials is disabled - use cloud settings panel');
  }, []);

  const clearCredentials = useCallback(() => {
    // SECURITY: No-op - credentials managed in cloud
    console.warn('clearCredentials is disabled - use cloud settings panel');
  }, []);

  // Always true - credentials are managed server-side
  const hasCredentials = true;

  return {
    credentials,
    setCredentials,
    clearCredentials,
    hasCredentials,
    isLoading,
    isServerMode: USE_SERVER_CREDENTIALS,
  };
}
