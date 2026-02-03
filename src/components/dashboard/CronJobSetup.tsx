import { useState } from "react";
import { 
  Clock, 
  Copy, 
  CheckCircle2, 
  ExternalLink,
  Play,
  AlertCircle,
  Zap
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

export function CronJobSetup() {
  const { toast } = useToast();
  const [copied, setCopied] = useState<string | null>(null);
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<'success' | 'error' | null>(null);

  const schedulerUrl = `${SUPABASE_URL}/functions/v1/scheduler`;
  const schedulerBody = JSON.stringify({ durationMinutes: 10, intervalSeconds: 30 });

  const copyToClipboard = async (text: string, label: string) => {
    await navigator.clipboard.writeText(text);
    setCopied(label);
    toast({ title: 'הועתק!', description: `${label} הועתק ללוח` });
    setTimeout(() => setCopied(null), 2000);
  };

  const testScheduler = async () => {
    setIsTesting(true);
    setTestResult(null);
    try {
      const { data, error } = await supabase.functions.invoke('scheduler', {
        body: { durationMinutes: 1, intervalSeconds: 30 },
      });
      
      if (error) throw error;
      
      setTestResult('success');
      toast({ 
        title: '✅ ה-Scheduler הופעל!', 
        description: `${data.estimatedCycles} מחזורים יופעלו בדקה הקרובה` 
      });
    } catch (err) {
      setTestResult('error');
      toast({ 
        title: 'שגיאה', 
        description: err instanceof Error ? err.message : 'נכשל', 
        variant: 'destructive' 
      });
    } finally {
      setIsTesting(false);
    }
  };

  return (
    <div className="terminal-card h-full flex flex-col">
      <div className="terminal-header">
        <div className="flex items-center gap-2">
          <Clock className="w-4 h-4 text-primary" />
          <h2 className="font-semibold text-sm">הגדרת Cron Job חיצוני</h2>
        </div>
        <Badge variant="outline" className="text-xs">24/7</Badge>
      </div>

      <div className="flex-1 overflow-auto p-4 space-y-6">
        {/* Quick Test */}
        <div className="bg-muted/30 rounded-lg p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-medium text-sm">בדיקה מהירה</h3>
              <p className="text-xs text-muted-foreground">הפעל את ה-scheduler לדקה אחת</p>
            </div>
            <Button 
              onClick={testScheduler}
              disabled={isTesting}
              size="sm"
              className="gap-2"
            >
              {isTesting ? (
                <Clock className="w-4 h-4 animate-spin" />
              ) : testResult === 'success' ? (
                <CheckCircle2 className="w-4 h-4 text-profit" />
              ) : testResult === 'error' ? (
                <AlertCircle className="w-4 h-4" />
              ) : (
                <Play className="w-4 h-4" />
              )}
              {isTesting ? 'מפעיל...' : 'בדוק עכשיו'}
            </Button>
          </div>
        </div>

        {/* Webhook URL */}
        <div className="space-y-2">
          <Label className="text-sm">Webhook URL</Label>
          <div className="flex gap-2">
            <Input 
              value={schedulerUrl} 
              readOnly 
              className="font-mono text-xs bg-muted/50"
            />
            <Button 
              variant="outline" 
              size="icon"
              onClick={() => copyToClipboard(schedulerUrl, 'URL')}
            >
              {copied === 'URL' ? <CheckCircle2 className="w-4 h-4 text-profit" /> : <Copy className="w-4 h-4" />}
            </Button>
          </div>
        </div>

        {/* Headers */}
        <div className="space-y-2">
          <Label className="text-sm">Headers</Label>
          <div className="space-y-2 bg-muted/30 rounded-lg p-3 font-mono text-xs">
            <div className="flex justify-between items-center">
              <span className="text-muted-foreground">Content-Type:</span>
              <span>application/json</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-muted-foreground">Authorization:</span>
              <div className="flex items-center gap-2">
                <span className="truncate max-w-32">Bearer {SUPABASE_ANON_KEY?.slice(0, 20)}...</span>
                <Button 
                  variant="ghost" 
                  size="icon"
                  className="h-6 w-6"
                  onClick={() => copyToClipboard(`Bearer ${SUPABASE_ANON_KEY}`, 'Authorization')}
                >
                  {copied === 'Authorization' ? <CheckCircle2 className="w-3 h-3 text-profit" /> : <Copy className="w-3 h-3" />}
                </Button>
              </div>
            </div>
          </div>
        </div>

        {/* Body */}
        <div className="space-y-2">
          <Label className="text-sm">Request Body (POST)</Label>
          <div className="flex gap-2">
            <Input 
              value={schedulerBody} 
              readOnly 
              className="font-mono text-xs bg-muted/50"
            />
            <Button 
              variant="outline" 
              size="icon"
              onClick={() => copyToClipboard(schedulerBody, 'Body')}
            >
              {copied === 'Body' ? <CheckCircle2 className="w-4 h-4 text-profit" /> : <Copy className="w-4 h-4" />}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            durationMinutes: כמה דקות להריץ | intervalSeconds: מרווח בין מחזורים
          </p>
        </div>

        {/* Instructions */}
        <div className="space-y-3">
          <h3 className="font-medium text-sm flex items-center gap-2">
            <Zap className="w-4 h-4 text-warning" />
            הוראות הגדרה ב-cron-job.org
          </h3>
          <ol className="space-y-2 text-sm text-muted-foreground list-decimal list-inside">
            <li>היכנס ל-<a href="https://cron-job.org" target="_blank" rel="noopener noreferrer" className="text-primary underline inline-flex items-center gap-1">cron-job.org <ExternalLink className="w-3 h-3" /></a></li>
            <li>צור חשבון חינמי והתחבר</li>
            <li>לחץ על "Create cronjob"</li>
            <li>הדבק את ה-URL למעלה בשדה "URL"</li>
            <li>בחר Schedule: <Badge variant="outline" className="mx-1">Every 10 minutes</Badge></li>
            <li>בסעיף "Advanced" → "Request Method" בחר <Badge variant="outline">POST</Badge></li>
            <li>הוסף Headers:
              <ul className="mr-4 mt-1 space-y-1">
                <li>• Content-Type: application/json</li>
                <li>• Authorization: Bearer [הטוקן למעלה]</li>
              </ul>
            </li>
            <li>בסעיף "Request Body" הדבק את ה-JSON למעלה</li>
            <li>לחץ "Create" והמערכת תרוץ 24/7!</li>
          </ol>
        </div>

        {/* Alternative: Zapier */}
        <div className="bg-muted/20 rounded-lg p-3 space-y-2">
          <h4 className="text-xs font-medium flex items-center gap-2">
            <Zap className="w-3 h-3" />
            אפשרות חלופית: Zapier
          </h4>
          <p className="text-xs text-muted-foreground">
            אתה יכול גם להשתמש ב-Zapier עם טריגר "Schedule by Zapier" 
            שקורא ל-Webhook כל 15 דקות.
          </p>
        </div>
      </div>
    </div>
  );
}
