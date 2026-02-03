import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { 
  Settings, 
  Key, 
  Eye, 
  EyeOff, 
  RefreshCw, 
  CheckCircle2,
  AlertTriangle,
  Shield,
  Server
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

export function SettingsPanel() {
  const [apiKey, setApiKey] = useState("");
  const [apiSecret, setApiSecret] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [showSecret, setShowSecret] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isVerifying, setIsVerifying] = useState(false);
  const [lastVerified, setLastVerified] = useState<string | null>(null);

  async function handleUpdateCredentials() {
    if (!apiKey.trim() || !apiSecret.trim()) {
      toast.error("נא להזין API Key ו-Secret");
      return;
    }

    // Validate format
    if (apiKey.length < 10 || apiSecret.length < 20) {
      toast.error("פורמט לא תקין - בדוק שהמפתחות נכונים");
      return;
    }

    setIsLoading(true);
    try {
      // First verify the credentials work
      const verifyResponse = await supabase.functions.invoke('gate-api', {
        body: {
          endpoint: '/spot/accounts',
          method: 'GET',
          apiKey,
          apiSecret,
        },
      });

      if (verifyResponse.error) {
        throw new Error('Failed to verify credentials');
      }

      // Store in localStorage for local mode
      localStorage.setItem('gate_api_key', apiKey);
      localStorage.setItem('gate_api_secret', apiSecret);
      
      toast.success("המפתחות עודכנו והאומתו בהצלחה!");
      setLastVerified(new Date().toISOString());
      
      // Clear inputs after success
      setApiKey("");
      setApiSecret("");
      
    } catch (error) {
      console.error('Error updating credentials:', error);
      toast.error("שגיאה באימות המפתחות - בדוק שהם נכונים");
    } finally {
      setIsLoading(false);
    }
  }

  async function handleVerifyExisting() {
    setIsVerifying(true);
    try {
      const existingKey = localStorage.getItem('gate_api_key');
      const existingSecret = localStorage.getItem('gate_api_secret');

      if (!existingKey || !existingSecret) {
        toast.error("לא נמצאו מפתחות שמורים");
        setIsVerifying(false);
        return;
      }

      const response = await supabase.functions.invoke('gate-api', {
        body: {
          endpoint: '/spot/accounts',
          method: 'GET',
          apiKey: existingKey,
          apiSecret: existingSecret,
        },
      });

      if (response.error) {
        toast.error("המפתחות הקיימים לא תקינים");
      } else {
        toast.success("המפתחות הקיימים תקינים!");
        setLastVerified(new Date().toISOString());
      }
    } catch (error) {
      toast.error("שגיאה באימות");
    } finally {
      setIsVerifying(false);
    }
  }

  function handleClearCredentials() {
    localStorage.removeItem('gate_api_key');
    localStorage.removeItem('gate_api_secret');
    setLastVerified(null);
    toast.success("המפתחות נמחקו");
  }

  const hasStoredCredentials = !!localStorage.getItem('gate_api_key');

  return (
    <Card className="h-full">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <Settings className="h-5 w-5" />
            הגדרות API
          </CardTitle>
          {hasStoredCredentials && (
            <Badge variant="outline" className="border-primary/50 text-primary">
              <CheckCircle2 className="h-3 w-3 mr-1" />
              מחובר
            </Badge>
          )}
        </div>
      </CardHeader>
      
      <CardContent className="space-y-4">
        {/* Current Status */}
        <div className="p-3 bg-muted/30 rounded-lg space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground flex items-center gap-1">
              <Server className="h-3 w-3" />
              סטטוס חיבור
            </span>
            <Badge variant={hasStoredCredentials ? "default" : "secondary"}>
              {hasStoredCredentials ? "מחובר" : "לא מחובר"}
            </Badge>
          </div>
          
          {lastVerified && (
            <p className="text-xs text-muted-foreground">
              אימות אחרון: {new Date(lastVerified).toLocaleString('he-IL')}
            </p>
          )}
        </div>

        {/* Verify Existing */}
        {hasStoredCredentials && (
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handleVerifyExisting}
              disabled={isVerifying}
              className="flex-1"
            >
              <RefreshCw className={`h-4 w-4 mr-2 ${isVerifying ? 'animate-spin' : ''}`} />
              בדוק חיבור
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleClearCredentials}
              className="text-destructive hover:text-destructive"
            >
              מחק
            </Button>
          </div>
        )}

        <Separator />

        {/* Update Credentials */}
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-sm font-medium">
            <Key className="h-4 w-4" />
            {hasStoredCredentials ? "עדכון מפתחות" : "הזנת מפתחות"}
          </div>
          
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">API Key</Label>
              <div className="relative">
                <Input
                  type={showKey ? "text" : "password"}
                  placeholder="הזן API Key..."
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  className="pr-10"
                  dir="ltr"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="absolute left-1 top-1/2 -translate-y-1/2 h-7 w-7"
                  onClick={() => setShowKey(!showKey)}
                >
                  {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </Button>
              </div>
            </div>
            
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">API Secret</Label>
              <div className="relative">
                <Input
                  type={showSecret ? "text" : "password"}
                  placeholder="הזן API Secret..."
                  value={apiSecret}
                  onChange={(e) => setApiSecret(e.target.value)}
                  className="pr-10"
                  dir="ltr"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="absolute left-1 top-1/2 -translate-y-1/2 h-7 w-7"
                  onClick={() => setShowSecret(!showSecret)}
                >
                  {showSecret ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </Button>
              </div>
            </div>
          </div>

          <Button
            onClick={handleUpdateCredentials}
            disabled={isLoading || !apiKey.trim() || !apiSecret.trim()}
            className="w-full"
          >
            {isLoading ? (
              <>
                <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                מאמת...
              </>
            ) : (
              <>
                <Shield className="h-4 w-4 mr-2" />
                {hasStoredCredentials ? "עדכן מפתחות" : "שמור מפתחות"}
              </>
            )}
          </Button>
        </div>

        {/* Security Note */}
        <div className="p-3 bg-muted/20 rounded-lg">
          <div className="flex items-start gap-2">
            <AlertTriangle className="h-4 w-4 text-amber-500 mt-0.5 shrink-0" />
            <div className="text-xs text-muted-foreground space-y-1">
              <p className="font-medium">הערות אבטחה:</p>
              <ul className="list-disc list-inside space-y-0.5">
                <li>המפתחות נשמרים מקומית בדפדפן</li>
                <li>ודא שהמפתחות מוגבלים ל-Spot Trading בלבד</li>
                <li>אל תשתף את המפתחות עם אף אחד</li>
              </ul>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
