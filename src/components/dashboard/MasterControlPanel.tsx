import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { supabase } from "@/integrations/supabase/client";
import { 
  Play, 
  Pause, 
  Settings, 
  TrendingUp, 
  TrendingDown,
  Activity,
  Target,
  Shield,
  Zap,
  Brain,
  FlaskConical,
  RefreshCw
} from "lucide-react";
import { toast } from "sonner";

interface SystemState {
  is_active: boolean;
  total_trades: number;
  total_pnl: number;
  settings: {
    paper_mode?: boolean;
    momentum_allocation?: number;
    whale_allocation?: number;
    grid_allocation?: number;
    dca_allocation?: number;
    stop_loss_multiplier?: number;
    take_profit_multiplier?: number;
    max_position_size?: number;
    optimized?: boolean;
    lastOptimization?: string;
  };
}

export function MasterControlPanel() {
  const [isLoading, setIsLoading] = useState(false);
  const [systemState, setSystemState] = useState<SystemState | null>(null);
  const [paperMode, setPaperMode] = useState(false);
  const [isActive, setIsActive] = useState(false);
  
  // Parameters
  const [momentumAlloc, setMomentumAlloc] = useState(30);
  const [whaleAlloc, setWhaleAlloc] = useState(25);
  const [gridAlloc, setGridAlloc] = useState(20);
  const [dcaAlloc, setDcaAlloc] = useState(25);
  const [maxPositionSize, setMaxPositionSize] = useState(15);

  useEffect(() => {
    fetchSystemState();
    const interval = setInterval(fetchSystemState, 10000);
    return () => clearInterval(interval);
  }, []);

  async function fetchSystemState() {
    try {
      const { data, error } = await supabase
        .from('trading_system_state')
        .select('*')
        .eq('id', 'master-brain')
        .maybeSingle();
      
      if (data) {
        setSystemState(data as unknown as SystemState);
        setIsActive(data.is_active);
        const settings = data.settings as SystemState['settings'];
        if (settings) {
          setPaperMode(settings.paper_mode || false);
          if (settings.momentum_allocation) setMomentumAlloc(settings.momentum_allocation * 100);
          if (settings.whale_allocation) setWhaleAlloc(settings.whale_allocation * 100);
          if (settings.grid_allocation) setGridAlloc(settings.grid_allocation * 100);
          if (settings.dca_allocation) setDcaAlloc(settings.dca_allocation * 100);
          if (settings.max_position_size) setMaxPositionSize(settings.max_position_size * 100);
        }
      }
    } catch (e) {
      console.error('Error fetching system state:', e);
    }
  }

  async function toggleSystem() {
    setIsLoading(true);
    try {
      const newState = !isActive;
      await supabase
        .from('trading_system_state')
        .upsert({
          id: 'master-brain',
          is_active: newState,
          updated_at: new Date().toISOString(),
        });
      
      setIsActive(newState);
      toast.success(newState ? 'המערכת הופעלה!' : 'המערכת הופסקה');
      
      if (newState) {
        // Trigger the brain
        await supabase.functions.invoke('cron-trigger', {
          body: { action: 'brain' }
        });
      }
    } catch (e) {
      toast.error('שגיאה בהפעלת המערכת');
    } finally {
      setIsLoading(false);
    }
  }

  async function togglePaperMode() {
    const newMode = !paperMode;
    setPaperMode(newMode);
    
    await supabase
      .from('trading_system_state')
      .upsert({
        id: 'master-brain',
        settings: {
          ...systemState?.settings,
          paper_mode: newMode,
        },
        updated_at: new Date().toISOString(),
      });
    
    toast.success(newMode ? 'מצב Paper Trading מופעל' : 'מצב Live Trading מופעל');
  }

  async function saveParameters() {
    setIsLoading(true);
    try {
      await supabase
        .from('trading_system_state')
        .upsert({
          id: 'master-brain',
          settings: {
            ...systemState?.settings,
            momentum_allocation: momentumAlloc / 100,
            whale_allocation: whaleAlloc / 100,
            grid_allocation: gridAlloc / 100,
            dca_allocation: dcaAlloc / 100,
            max_position_size: maxPositionSize / 100,
          },
          updated_at: new Date().toISOString(),
        });
      
      toast.success('הפרמטרים נשמרו בהצלחה');
    } catch (e) {
      toast.error('שגיאה בשמירת הפרמטרים');
    } finally {
      setIsLoading(false);
    }
  }

  async function runOptimizer() {
    setIsLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('ai-optimizer', {});
      
      if (error) throw error;
      
      toast.success(`AI Optimizer: ${data?.message || 'הושלם'}`);
      fetchSystemState();
    } catch (e) {
      toast.error('שגיאה בהפעלת האופטימייזר');
    } finally {
      setIsLoading(false);
    }
  }

  const totalAlloc = momentumAlloc + whaleAlloc + gridAlloc + dcaAlloc;

  return (
    <Card className="h-full">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <Settings className="h-5 w-5" />
            פאנל בקרה
          </CardTitle>
          <div className="flex items-center gap-2">
            {paperMode && (
              <Badge variant="outline" className="bg-yellow-500/10 text-yellow-600 border-yellow-500/30">
                <FlaskConical className="h-3 w-3 mr-1" />
                Paper
              </Badge>
            )}
            <Badge variant={isActive ? "default" : "secondary"}>
              {isActive ? "פעיל" : "מושבת"}
            </Badge>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Main Controls */}
        <div className="flex flex-wrap gap-2">
          <Button
            onClick={toggleSystem}
            disabled={isLoading}
            variant={isActive ? "destructive" : "default"}
            className="flex-1"
          >
            {isActive ? (
              <>
                <Pause className="h-4 w-4 mr-2" />
                עצור מערכת
              </>
            ) : (
              <>
                <Play className="h-4 w-4 mr-2" />
                הפעל מערכת
              </>
            )}
          </Button>
          
          <Button
            onClick={runOptimizer}
            disabled={isLoading}
            variant="outline"
          >
            <Brain className="h-4 w-4 mr-2" />
            AI Optimize
          </Button>
        </div>

        {/* Paper Trading Toggle */}
        <div className="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
          <div className="flex items-center gap-2">
            <FlaskConical className="h-4 w-4 text-yellow-600" />
            <div>
              <Label className="font-medium">Paper Trading</Label>
              <p className="text-xs text-muted-foreground">סימולציה ללא כסף אמיתי</p>
            </div>
          </div>
          <Switch
            checked={paperMode}
            onCheckedChange={togglePaperMode}
          />
        </div>

        {/* Strategy Allocations */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <Label className="text-sm font-medium">הקצאות אסטרטגיה</Label>
            <span className={`text-xs ${totalAlloc === 100 ? 'text-green-500' : 'text-red-500'}`}>
              סה״כ: {totalAlloc}%
            </span>
          </div>
          
          <div className="space-y-2">
            <div className="flex items-center gap-3">
              <Zap className="h-4 w-4 text-blue-500" />
              <span className="text-xs w-20">Momentum</span>
              <Slider
                value={[momentumAlloc]}
                onValueChange={([v]) => setMomentumAlloc(v)}
                max={100}
                step={5}
                className="flex-1"
              />
              <span className="text-xs w-8">{momentumAlloc}%</span>
            </div>
            
            <div className="flex items-center gap-3">
              <TrendingUp className="h-4 w-4 text-purple-500" />
              <span className="text-xs w-20">Whale</span>
              <Slider
                value={[whaleAlloc]}
                onValueChange={([v]) => setWhaleAlloc(v)}
                max={100}
                step={5}
                className="flex-1"
              />
              <span className="text-xs w-8">{whaleAlloc}%</span>
            </div>
            
            <div className="flex items-center gap-3">
              <Activity className="h-4 w-4 text-green-500" />
              <span className="text-xs w-20">Grid</span>
              <Slider
                value={[gridAlloc]}
                onValueChange={([v]) => setGridAlloc(v)}
                max={100}
                step={5}
                className="flex-1"
              />
              <span className="text-xs w-8">{gridAlloc}%</span>
            </div>
            
            <div className="flex items-center gap-3">
              <TrendingDown className="h-4 w-4 text-orange-500" />
              <span className="text-xs w-20">DCA</span>
              <Slider
                value={[dcaAlloc]}
                onValueChange={([v]) => setDcaAlloc(v)}
                max={100}
                step={5}
                className="flex-1"
              />
              <span className="text-xs w-8">{dcaAlloc}%</span>
            </div>
          </div>
        </div>

        {/* Risk Settings */}
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <Shield className="h-4 w-4 text-red-500" />
            <Label className="text-sm font-medium">ניהול סיכונים</Label>
          </div>
          
          <div className="flex items-center gap-3">
            <span className="text-xs w-28">גודל פוזיציה מקס</span>
            <Slider
              value={[maxPositionSize]}
              onValueChange={([v]) => setMaxPositionSize(v)}
              max={30}
              min={5}
              step={1}
              className="flex-1"
            />
            <span className="text-xs w-8">{maxPositionSize}%</span>
          </div>
        </div>

        {/* Save Button */}
        <Button
          onClick={saveParameters}
          disabled={isLoading || totalAlloc !== 100}
          className="w-full"
          variant="outline"
        >
          <RefreshCw className={`h-4 w-4 mr-2 ${isLoading ? 'animate-spin' : ''}`} />
          שמור הגדרות
        </Button>

        {/* Last Optimization */}
        {systemState?.settings?.lastOptimization && (
          <p className="text-xs text-muted-foreground text-center">
            אופטימיזציה אחרונה: {new Date(systemState.settings.lastOptimization).toLocaleString('he-IL')}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
