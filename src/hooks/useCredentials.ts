import { useState, useEffect, useCallback } from 'react';

export interface GateCredentials {
  apiKey: string;
  apiSecret: string;
}

const STORAGE_KEY = 'gate_credentials';

export function useCredentials() {
  const [credentials, setCredentialsState] = useState<GateCredentials | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
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
    localStorage.setItem(STORAGE_KEY, JSON.stringify(creds));
    setCredentialsState(creds);
  }, []);

  const clearCredentials = useCallback(() => {
    localStorage.removeItem(STORAGE_KEY);
    setCredentialsState(null);
  }, []);

  const hasCredentials = credentials !== null && 
    credentials.apiKey.length > 0 && 
    credentials.apiSecret.length > 0;

  return {
    credentials,
    setCredentials,
    clearCredentials,
    hasCredentials,
    isLoading,
  };
}
