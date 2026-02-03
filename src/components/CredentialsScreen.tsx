import { useState } from 'react';
import { Key, Shield, ArrowRight, Eye, EyeOff, AlertCircle, CheckCircle2 } from 'lucide-react';
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
        <div className="text-center mb-8">
          <div className="w-16 h-16 bg-primary/20 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <Shield className="w-8 h-8 text-primary" />
          </div>
          <h1 className="text-2xl font-bold mb-2">Connect to Gate.io</h1>
          <p className="text-muted-foreground text-sm">
            Enter your API credentials to start trading
          </p>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="terminal-card p-4 space-y-4">
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
                className="font-mono text-sm"
                autoComplete="off"
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
                  className="font-mono text-sm pr-10"
                  autoComplete="off"
                />
                <button
                  type="button"
                  onClick={() => setShowSecret(!showSecret)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
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
            className="w-full gap-2" 
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

        {/* Instructions */}
        <div className="mt-6 p-4 bg-muted/30 rounded-lg border border-border">
          <h3 className="text-sm font-medium mb-2 flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-profit" />
            How to get your API keys
          </h3>
          <ol className="text-xs text-muted-foreground space-y-1 list-decimal list-inside">
            <li>Log in to Gate.io</li>
            <li>Go to API Management</li>
            <li>Create new API key with "Spot Trade" & "Account Read" permissions</li>
            <li>Copy and paste the Key and Secret here</li>
          </ol>
        </div>

        {/* Security note */}
        <p className="text-xs text-muted-foreground text-center mt-4">
          🔒 Your credentials are stored locally on your device only
        </p>
      </div>
    </div>
  );
}
