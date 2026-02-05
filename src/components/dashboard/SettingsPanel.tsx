import { useState, useEffect } from "react";
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
  Cloud,
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

  // Check cloud status on mount
  useEffect(() => {
    handleVerifyCloud();
  }, []);

  async function handleUpdateCredentials() {
    if (!apiKey.trim() || !apiSecret.trim()) {
      toast.error("נא להזין API Key ו-Secret");
      return;
    }

    // SECURITY: Input validation
    const apiKeyRegex = /^[A-Za-z0-9_-]+$/;
    if (apiKey.length < 10 || apiKey.length > 100 || !apiKeyRegex.test(apiKey)) {
      toast.error("API Key לא תקין - בדוק שהמפתח נכון");
      return;
    }
    if (apiSecret.length < 20 || apiSecret.length > 200 || !apiKeyRegex.test(apiSecret)) {
      toast.error("פורמט לא תקין - בדוק שהמפתחות נכונים");
      return;
    }

    setIsLoading(true);
    try {
      // SECURITY: Save ONLY to cloud - never store locally
      const response = await supabase.functions.invoke('update-secrets', {
        body: { apiKey, apiSecret },
      });
      
      if (response.error) {
        throw response.error;
      }
      
      setCloudSynced(true);
      toast.success("המפתחות עודכנו בענן!");
      setLastVerified(new Date().toISOString());
      setApiKey("");
      setApiSecret("");
    } catch (error) {
      console.error('Error updating credentials:', error);
      toast.error("שגיאה בעדכון המפתחות");
    } finally {
      setIsLoading(false);
    }
  }

  async function handleVerifyCloud() {
    setIsVerifying(true);
    try {
      const response = await supabase.functions.invoke('gate-api', {
        body: {
          endpoint: '/spot/accounts',
          method: 'GET',
        },
      });

      if (response.error) {
        setCloudSynced(false);
      } else {
        setCloudSynced(true);
        setLastVerified(new Date().toISOString());
      }
    } catch (error) {
      setCloudSynced(false);
    } finally {
      setIsVerifying(false);
    }
  }

  return (
    <Card className="h-full">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <Settings className="h-5 w-5" />
            הגדרות API
          </CardTitle>
          {cloudSynced && (
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
              <Cloud className="h-3 w-3" />
              סטטוס חיבור
            </span>
            <Badge variant={cloudSynced ? "default" : "secondary"} className="text-xs">
              <Cloud className="h-3 w-3 mr-1" />
              {cloudSynced ? "מחובר ✓" : "לא מחובר"}
            </Badge>
          </div>
          
          {lastVerified && (
            <p className="text-xs text-muted-foreground">
              אימות אחרון: {new Date(lastVerified).toLocaleString('he-IL')}
            </p>
          )}
        </div>

        {/* Verify Button */}
        <Button
          variant="outline"
          size="sm"
          onClick={handleVerifyCloud}
          disabled={isVerifying}
          className="w-full"
        >
          <Cloud className={`h-4 w-4 mr-2 ${isVerifying ? 'animate-pulse' : ''}`} />
          {isVerifying ? 'בודק...' : 'בדוק חיבור ענן'}
        </Button>

        <Separator />

        {/* Update Credentials */}
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-sm font-medium">
            <Key className="h-4 w-4" />
            {cloudSynced ? "עדכון מפתחות" : "הזנת מפתחות"}
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
                  maxLength={100}
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
                  maxLength={200}
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

          {/* Save Button */}
          <Button
            onClick={handleUpdateCredentials}
            disabled={isLoading || !apiKey.trim() || !apiSecret.trim()}
            className="w-full"
          >
            {isLoading ? (
              <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Cloud className="h-4 w-4 mr-2" />
            )}
            שמור בענן
          </Button>
        </div>

        {/* Info */}
        <div className="p-3 bg-green-500/10 border border-green-500/30 rounded-lg">
          <div className="flex items-start gap-2">
            <Shield className="h-4 w-4 text-green-500 mt-0.5 shrink-0" />
            <div className="text-xs text-green-600 dark:text-green-400">
              <p className="font-medium">מצב מאובטח:</p>
              <p className="text-muted-foreground mt-1">
                המפתחות נשמרים בענן בלבד - לא נשמרים בדפדפן. 
                המערכת עובדת 24/7 אוטונומית.
              </p>
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