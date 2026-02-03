import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { 
  Settings, 
  Key, 
  Eye, 
  EyeOff, 
  RefreshCw, 
  CheckCircle2,
  AlertTriangle,
  Shield,
  Server,
  Cloud,
  HardDrive
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
  const [cloudSynced, setCloudSynced] = useState(false);
  const [isSyncingCloud, setIsSyncingCloud] = useState(false);

  async function handleUpdateCredentials(saveToCloud: boolean = false) {
    if (!apiKey.trim() || !apiSecret.trim()) {
      toast.error("נא להזין API Key ו-Secret");
      return;
    }

    if (apiKey.length < 10 || apiSecret.length < 20) {
      toast.error("פורמט לא תקין - בדוק שהמפתחות נכונים");
      return;
    }

    setIsLoading(true);
    try {
      // Verify credentials
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

      // Store locally
      localStorage.setItem('gate_api_key', apiKey);
      localStorage.setItem('gate_api_secret', apiSecret);
      
      if (saveToCloud) {
        // Sync to cloud for autonomous 24/7 operation
        await syncToCloud(apiKey, apiSecret);
      }
      
      toast.success(saveToCloud ? "המפתחות עודכנו בענן ומקומית!" : "המפתחות עודכנו מקומית!");
      setLastVerified(new Date().toISOString());
      setApiKey("");
      setApiSecret("");
      
    } catch (error) {
      console.error('Error updating credentials:', error);
      toast.error("שגיאה באימות המפתחות");
    } finally {
      setIsLoading(false);
    }
  }

  async function syncToCloud(key: string, secret: string) {
    setIsSyncingCloud(true);
    try {
      // Call edge function to update cloud secrets
      const response = await supabase.functions.invoke('update-secrets', {
        body: { apiKey: key, apiSecret: secret },
      });
      
      if (response.error) {
        throw response.error;
      }
      
      setCloudSynced(true);
      toast.success("הסודות סונכרנו לענן בהצלחה!");
    } catch (error) {
      console.error('Cloud sync error:', error);
      // Even if cloud sync fails, local storage works
      toast.warning("סנכרון לענן נכשל - המפתחות נשמרו מקומית");
    } finally {
      setIsSyncingCloud(false);
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

  async function handleVerifyCloud() {
    setIsVerifying(true);
    try {
      const response = await supabase.functions.invoke('gate-api', {
        body: {
          endpoint: '/spot/accounts',
          method: 'GET',
          useCloudSecrets: true,
        },
      });

      if (response.error) {
        toast.error("הסודות בענן לא תקינים");
        setCloudSynced(false);
      } else {
        toast.success("הסודות בענן תקינים!");
        setCloudSynced(true);
        setLastVerified(new Date().toISOString());
      }
    } catch (error) {
      toast.error("שגיאה באימות ענן");
    } finally {
      setIsVerifying(false);
    }
  }

  function handleClearCredentials() {
    localStorage.removeItem('gate_api_key');
    localStorage.removeItem('gate_api_secret');
    setLastVerified(null);
    toast.success("המפתחות המקומיים נמחקו");
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
        {/* Status */}
        <div className="p-3 bg-muted/30 rounded-lg space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground flex items-center gap-1">
              <Server className="h-3 w-3" />
              סטטוס חיבור
            </span>
            <div className="flex gap-2">
              <Badge variant={hasStoredCredentials ? "default" : "secondary"} className="text-xs">
                <HardDrive className="h-3 w-3 mr-1" />
                {hasStoredCredentials ? "מקומי ✓" : "מקומי ✗"}
              </Badge>
              <Badge variant={cloudSynced ? "default" : "secondary"} className="text-xs">
                <Cloud className="h-3 w-3 mr-1" />
                {cloudSynced ? "ענן ✓" : "ענן ✗"}
              </Badge>
            </div>
          </div>
          
          {lastVerified && (
            <p className="text-xs text-muted-foreground">
              אימות אחרון: {new Date(lastVerified).toLocaleString('he-IL')}
            </p>
          )}
        </div>

        {/* Verify Buttons */}
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={handleVerifyExisting}
            disabled={isVerifying || !hasStoredCredentials}
            className="flex-1"
          >
            <HardDrive className={`h-4 w-4 mr-2 ${isVerifying ? 'animate-pulse' : ''}`} />
            בדוק מקומי
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handleVerifyCloud}
            disabled={isVerifying}
            className="flex-1"
          >
            <Cloud className={`h-4 w-4 mr-2 ${isVerifying ? 'animate-pulse' : ''}`} />
            בדוק ענן
          </Button>
          {hasStoredCredentials && (
            <Button
              variant="ghost"
              size="sm"
              onClick={handleClearCredentials}
              className="text-destructive hover:text-destructive"
            >
              מחק
            </Button>
          )}
        </div>

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

          {/* Save Buttons */}
          <div className="flex gap-2">
            <Button
              onClick={() => handleUpdateCredentials(false)}
              disabled={isLoading || !apiKey.trim() || !apiSecret.trim()}
              variant="outline"
              className="flex-1"
            >
              {isLoading && !isSyncingCloud ? (
                <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <HardDrive className="h-4 w-4 mr-2" />
              )}
              שמור מקומי
            </Button>
            <Button
              onClick={() => handleUpdateCredentials(true)}
              disabled={isLoading || !apiKey.trim() || !apiSecret.trim()}
              className="flex-1"
            >
              {isSyncingCloud ? (
                <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Cloud className="h-4 w-4 mr-2" />
              )}
              שמור + סנכרן ענן
            </Button>
          </div>
        </div>

        {/* Info */}
        <div className="p-3 bg-primary/10 border border-primary/30 rounded-lg">
          <div className="flex items-start gap-2">
            <Cloud className="h-4 w-4 text-primary mt-0.5 shrink-0" />
            <div className="text-xs text-primary space-y-1">
              <p className="font-medium">מצב עבודה:</p>
              <ul className="list-disc list-inside space-y-0.5 text-muted-foreground">
                <li><strong>מקומי</strong> - עובד כשהדפדפן פתוח</li>
                <li><strong>ענן</strong> - עובד 24/7 אוטונומית</li>
              </ul>
            </div>
          </div>
        </div>

        {/* Security Note */}
        <div className="p-3 bg-muted/20 rounded-lg">
          <div className="flex items-start gap-2">
            <AlertTriangle className="h-4 w-4 text-amber-500 mt-0.5 shrink-0" />
            <div className="text-xs text-muted-foreground space-y-1">
              <p className="font-medium">הערות אבטחה:</p>
              <ul className="list-disc list-inside space-y-0.5">
                <li>הסודות בענן מוצפנים ומאובטחים</li>
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
