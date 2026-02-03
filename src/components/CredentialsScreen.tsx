import { useState } from 'react';
import { Key, Shield, ArrowRight, Eye, EyeOff, AlertCircle, CheckCircle2, Zap } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useCredentials, GateCredentials } from '@/hooks/useCredentials';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

interface CredentialsScreenProps {
  onSuccess: () => void;
}

export function CredentialsScreen({ onSuccess }: CredentialsScreenProps) {
  const { setCredentials } = useCredentials();
  const [apiKey, setApiKey] = useState('');
  const [apiSecret, setApiSecret] = useState('');
  const [showSecret, setShowSecret] = useState(false);
  const [isValidating, setIsValidating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    
    if (!apiKey.trim() || !apiSecret.trim()) {
      setError('Both API Key and Secret are required');
      return;
    }

    setIsValidating(true);

    try {
      // Validate credentials by making a test API call
      const { data, error: invokeError } = await supabase.functions.invoke('gate-api', {
        body: { 
          endpoint: '/spot/accounts',
          method: 'GET',
          credentials: {
            apiKey: apiKey.trim(),
            apiSecret: apiSecret.trim(),
          }
        }
      });

      if (invokeError) {
        throw new Error(invokeError.message);
      }

      if (data?.error) {
        throw new Error(data.error);
      }

      // Success! Save credentials
      const creds: GateCredentials = {
        apiKey: apiKey.trim(),
        apiSecret: apiSecret.trim(),
      };
      
      setCredentials(creds);
      toast.success('Connected to Gate.io successfully!');
      onSuccess();

    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to validate credentials';
      if (message.includes('INVALID_KEY')) {
        setError('Invalid API Key. Please check and try again.');
      } else if (message.includes('Invalid signature')) {
        setError('Invalid API Secret. Please check and try again.');
      } else {
        setError(message);
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
          <div className="w-14 h-14 sm:w-16 sm:h-16 bg-primary/20 rounded-2xl flex items-center justify-center mx-auto mb-3 sm:mb-4">
            <Zap className="w-7 h-7 sm:w-8 sm:h-8 text-primary" />
          </div>
          <h1 className="text-xl sm:text-2xl font-bold mb-2">TradingCore</h1>
          <p className="text-muted-foreground text-sm">
            Connect your Gate.io account to start
          </p>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="terminal-card p-3 sm:p-4 space-y-4">
            {/* API Key */}
            <div className="space-y-2">
              <label className="text-sm font-medium flex items-center gap-2">
                <Key className="w-4 h-4 text-primary" />
                API Key
              </label>
              <Input
                type="text"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="Enter your Gate.io API Key"
                className="font-mono text-sm h-11"
                autoComplete="off"
                autoCapitalize="off"
                autoCorrect="off"
              />
            </div>

            {/* API Secret */}
            <div className="space-y-2">
              <label className="text-sm font-medium flex items-center gap-2">
                <Shield className="w-4 h-4 text-primary" />
                API Secret
              </label>
              <div className="relative">
                <Input
                  type={showSecret ? 'text' : 'password'}
                  value={apiSecret}
                  onChange={(e) => setApiSecret(e.target.value)}
                  placeholder="Enter your Gate.io API Secret"
                  className="font-mono text-sm pr-10 h-11"
                  autoComplete="off"
                  autoCapitalize="off"
                  autoCorrect="off"
                />
                <button
                  type="button"
                  onClick={() => setShowSecret(!showSecret)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground p-1"
                >
                  {showSecret ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
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

          {/* Submit button */}
          <Button 
            type="submit" 
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
                Connect
                <ArrowRight className="w-4 h-4" />
              </>
            )}
          </Button>
        </form>

        {/* Instructions - Collapsible on mobile */}
        <details className="mt-4 sm:mt-6">
          <summary className="p-3 sm:p-4 bg-muted/30 rounded-lg border border-border cursor-pointer">
            <span className="text-sm font-medium inline-flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-profit" />
              How to get your API keys
            </span>
          </summary>
          <div className="p-3 sm:p-4 pt-2 text-xs text-muted-foreground space-y-1.5">
            <p>1. Log in to <strong>Gate.io</strong></p>
            <p>2. Go to <strong>API Management</strong></p>
            <p>3. Create new API key with:</p>
            <ul className="ml-4 list-disc">
              <li>✓ Spot Trade permission</li>
              <li>✓ Account Read permission</li>
            </ul>
            <p>4. Copy and paste the Key and Secret here</p>
          </div>
        </details>

        {/* Security note */}
        <p className="text-xs text-muted-foreground text-center mt-4">
          🔒 Your credentials are stored locally on your device only
        </p>
      </div>
    </div>
  );
}
