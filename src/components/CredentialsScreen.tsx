import { useState } from 'react';
import { Key, Shield, ArrowRight, Eye, EyeOff, AlertCircle, CheckCircle2, Zap, Cloud } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useCredentials } from '@/hooks/useCredentials';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

interface CredentialsScreenProps {
  onSuccess: () => void;
}

export function CredentialsScreen({ onSuccess }: CredentialsScreenProps) {
  const { isServerMode } = useCredentials();
  const [isValidating, setIsValidating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // SECURITY: Test server connection without sending any credentials
  const handleTestConnection = async () => {
    setError(null);
    setIsValidating(true);

    try {
      // SECURITY: Only test connection - credentials are on server side only
      const { data, error: invokeError } = await supabase.functions.invoke('gate-api', {
        body: { 
          endpoint: '/spot/accounts',
          method: 'GET',
          // SECURITY: No credentials sent - server uses its own env vars
        }
      });

      if (invokeError) {
        throw new Error(invokeError.message);
      }

      if (data?.error) {
        throw new Error(data.error);
      }

      // Success! Server credentials are configured correctly
      toast.success('Cloud connection verified successfully!');
      onSuccess();

    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to validate credentials';
      if (message.includes('INVALID_KEY')) {
        setError('Server API Key not configured. Please set up credentials in the Settings panel.');
      } else if (message.includes('not configured')) {
        setError('Server credentials not configured. Go to Settings to add your Gate.io API keys.');
      } else {
        setError('Connection failed. Ensure server credentials are configured in Settings.');
      }
    } finally {
      setIsValidating(false);
    }
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        {/* Header */}
        <div className="text-center mb-6 sm:mb-8">
          <div className="w-14 h-14 sm:w-16 sm:h-16 bg-green-500/20 rounded-2xl flex items-center justify-center mx-auto mb-3 sm:mb-4">
            <Cloud className="w-7 h-7 sm:w-8 sm:h-8 text-green-500" />
          </div>
          <h1 className="text-xl sm:text-2xl font-bold mb-2">TradingCore</h1>
          <p className="text-muted-foreground text-sm">
            Cloud-Secured Trading System
          </p>
        </div>

        {/* Connection Test Panel */}
        <div className="space-y-4">
          <div className="terminal-card p-3 sm:p-4 space-y-4">
            {/* Security Info */}
            <div className="p-3 bg-green-500/10 border border-green-500/30 rounded-lg">
              <div className="flex items-start gap-2">
                <Shield className="w-4 h-4 text-green-500 mt-0.5 shrink-0" />
                <div className="text-xs text-green-600 dark:text-green-400">
                  <p className="font-medium">Cloud-Secured Mode</p>
                  <p className="text-muted-foreground mt-1">
                    API credentials are stored securely in the cloud. 
                    No sensitive data is stored in your browser.
                  </p>
                </div>
              </div>
            </div>

            {/* Error message */}
            {error && (
              <div className="flex items-start gap-2 p-3 bg-destructive/10 border border-destructive/20 rounded-lg">
                <AlertCircle className="w-4 h-4 text-destructive mt-0.5 shrink-0" />
                <p className="text-sm text-destructive">{error}</p>
              </div>
            )}
          </div>

          {/* Test Connection button */}
          <Button 
            type="button"
            onClick={handleTestConnection}
            className="w-full gap-2 h-12 text-base" 
            size="lg"
            disabled={isValidating}
          >
            {isValidating ? (
              <>
                <div className="animate-spin rounded-full h-4 w-4 border-2 border-primary-foreground border-t-transparent" />
                Validating...
              </>
            ) : (
              <>
                Test Cloud Connection
                <ArrowRight className="w-4 h-4" />
              </>
            )}
          </Button>
        </div>

        {/* Instructions - Collapsible on mobile */}
        <details className="mt-4 sm:mt-6">
          <summary className="p-3 sm:p-4 bg-muted/30 rounded-lg border border-border cursor-pointer">
            <span className="text-sm font-medium inline-flex items-center gap-2">
              <Key className="w-4 h-4 text-primary" />
              How to configure server credentials
            </span>
          </summary>
          <div className="p-3 sm:p-4 pt-2 text-xs text-muted-foreground space-y-1.5">
            <p>1. Go to the <strong>Settings</strong> panel in the dashboard</p>
            <p>2. Enter your Gate.io API Key and Secret</p>
            <p>3. Click <strong>Save to Cloud</strong></p>
            <p>4. Return here and test the connection</p>
          </div>
        </details>

        {/* Security note */}
        <p className="text-xs text-muted-foreground text-center mt-4">
          🔒 Credentials are encrypted and stored in the cloud only
        </p>
      </div>
    </div>
  );
}
