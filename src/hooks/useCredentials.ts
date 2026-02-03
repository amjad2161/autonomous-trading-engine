import { useState, useEffect, useCallback } from 'react';

export interface GateCredentials {
  apiKey: string;
  apiSecret: string;
}

const STORAGE_KEY = 'gate_credentials';

// Server-side credentials are pre-configured - no need for user input
const USE_SERVER_CREDENTIALS = true;

export function useCredentials() {
  const [credentials, setCredentialsState] = useState<GateCredentials | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    // If using server credentials, we don't need to load from localStorage
    if (USE_SERVER_CREDENTIALS) {
      // Set a placeholder to indicate server mode
      setCredentialsState({ apiKey: 'SERVER', apiSecret: 'SERVER' });
      setIsLoading(false);
      return;
    }

    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      try {
        setCredentialsState(JSON.parse(stored));
      } catch {
        localStorage.removeItem(STORAGE_KEY);
      }
    }
    setIsLoading(false);
  }, []);

  const setCredentials = useCallback((creds: GateCredentials) => {
    if (USE_SERVER_CREDENTIALS) return; // No-op in server mode
    localStorage.setItem(STORAGE_KEY, JSON.stringify(creds));
    setCredentialsState(creds);
  }, []);

  const clearCredentials = useCallback(() => {
    if (USE_SERVER_CREDENTIALS) return; // No-op in server mode
    localStorage.removeItem(STORAGE_KEY);
    setCredentialsState(null);
  }, []);

  // In server mode, always consider as having credentials
  const hasCredentials = USE_SERVER_CREDENTIALS || (
    credentials !== null && 
    credentials.apiKey.length > 0 && 
    credentials.apiSecret.length > 0
  );

  return {
    credentials,
    setCredentials,
    clearCredentials,
    hasCredentials,
    isLoading,
    isServerMode: USE_SERVER_CREDENTIALS,
  };
}
