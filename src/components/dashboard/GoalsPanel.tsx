import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { supabase } from "@/integrations/supabase/client";
import { 
  Target, 
  TrendingUp, 
  DollarSign, 
  Percent, 
  Trophy,
  Zap,
  Flame,
  Rocket,
  CheckCircle,
  XCircle,
  Plus,
  Trash2,
  RefreshCw
} from "lucide-react";
import { toast } from "sonner";

interface Goal {
  id: string;
  goal_type: string;
  target_value: number;
  current_value: number;
  start_value: number;
  deadline: string | null;
  status: string;
  priority: number;
  auto_adjust_aggression: boolean;
  created_at: string;
  achieved_at: string | null;
  notes: string | null;
}

const GOAL_TYPES = {
  daily_profit: { label: 'רווח יומי ($)', icon: DollarSign, color: 'text-green-500' },
  balance_target: { label: 'יעד יתרה ($)', icon: Target, color: 'text-blue-500' },
  growth_percentage: { label: 'צמיחה (%)', icon: Percent, color: 'text-purple-500' },
  winning_trades: { label: 'עסקאות מנצחות', icon: Trophy, color: 'text-yellow-500' },
};

export function GoalsPanel() {
  const [goals, setGoals] = useState<Goal[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [showAddGoal, setShowAddGoal] = useState(false);
  
  // New goal form
  const [newGoalType, setNewGoalType] = useState<string>('daily_profit');
  const [newTargetValue, setNewTargetValue] = useState<string>('');
  const [autoAdjust, setAutoAdjust] = useState(true);

  useEffect(() => {
    fetchGoals();
    const interval = setInterval(fetchGoals, 10000);
    return () => clearInterval(interval);
  }, []);

  // Realtime subscription
  useEffect(() => {
    const channel = supabase
      .channel('goals-changes')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'trading_goals' },
        () => fetchGoals()
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, []);

  async function fetchGoals() {
    try {
      const { data, error } = await supabase
        .from('trading_goals')
        .select('*')
        .order('priority', { ascending: true });

      if (error) throw error;
      setGoals(data || []);
    } catch (e) {
      console.error('Error fetching goals:', e);
    }
  }

  async function addGoal() {
    if (!newTargetValue || parseFloat(newTargetValue) <= 0) {
      toast.error('הכנס ערך יעד תקין');
      return;
    }

    setIsLoading(true);
    try {
      // Get current balance for start_value
      const { data: stateData } = await supabase
        .from('trading_system_state')
        .select('current_balance, total_pnl')
        .eq('id', 'master-brain')
        .maybeSingle();

      const currentBalance = stateData?.current_balance || 0;
      const todayPnl = stateData?.total_pnl || 0;

      let startValue = 0;
      let currentValue = 0;

      switch (newGoalType) {
        case 'daily_profit':
          startValue = 0;
          currentValue = todayPnl;
          break;
        case 'balance_target':
          startValue = currentBalance;
          currentValue = currentBalance;
          break;
        case 'growth_percentage':
          startValue = currentBalance;
          currentValue = 0;
          break;
        case 'winning_trades':
          // Get today's winning trades
          const today = new Date().toISOString().split('T')[0];
          const { count } = await supabase
            .from('trade_history')
            .select('*', { count: 'exact', head: true })
            .gte('created_at', today)
            .gt('actual_pnl', 0);
          startValue = 0;
          currentValue = count || 0;
          break;
      }

      const { error } = await supabase
        .from('trading_goals')
        .insert({
          goal_type: newGoalType,
          target_value: parseFloat(newTargetValue),
          start_value: startValue,
          current_value: currentValue,
          auto_adjust_aggression: autoAdjust,
          priority: goals.length + 1,
        });

      if (error) throw error;

      toast.success('🎯 יעד חדש נוסף! הבוט יעבוד להשיג אותו');
      setShowAddGoal(false);
      setNewTargetValue('');
      fetchGoals();
    } catch (e) {
      toast.error('שגיאה בהוספת יעד');
    } finally {
      setIsLoading(false);
    }
  }

  async function deleteGoal(id: string) {
    try {
      await supabase.from('trading_goals').delete().eq('id', id);
      toast.success('יעד נמחק');
      fetchGoals();
    } catch (e) {
      toast.error('שגיאה במחיקת יעד');
    }
  }

  async function resetDailyGoals() {
    setIsLoading(true);
    try {
      // Reset daily profit goals
      await supabase
        .from('trading_goals')
        .update({ 
          current_value: 0, 
          status: 'active',
          achieved_at: null 
        })
        .eq('goal_type', 'daily_profit');

      // Reset winning trades goals
      await supabase
        .from('trading_goals')
        .update({ 
          current_value: 0, 
          status: 'active',
          achieved_at: null 
        })
        .eq('goal_type', 'winning_trades');

      toast.success('יעדים יומיים אופסו');
      fetchGoals();
    } catch (e) {
      toast.error('שגיאה באיפוס');
    } finally {
      setIsLoading(false);
    }
  }

  function getProgress(goal: Goal): number {
    if (goal.target_value <= 0) return 0;
    
    if (goal.goal_type === 'balance_target') {
      const needed = goal.target_value - goal.start_value;
      if (needed <= 0) return 100;
      const progress = goal.current_value - goal.start_value;
      return Math.min(100, Math.max(0, (progress / needed) * 100));
    }
    
    return Math.min(100, Math.max(0, (goal.current_value / goal.target_value) * 100));
  }

  function getStatusBadge(goal: Goal) {
    const progress = getProgress(goal);
    
    if (goal.status === 'achieved') {
      return <Badge className="bg-profit/20 text-profit border-profit/30"><CheckCircle className="w-3 h-3 mr-1" />הושג!</Badge>;
    }
    if (goal.status === 'failed') {
      return <Badge variant="destructive"><XCircle className="w-3 h-3 mr-1" />נכשל</Badge>;
    }
    
    if (progress >= 90) {
      return <Badge className="bg-warning/20 text-warning border-warning/30 animate-pulse"><Flame className="w-3 h-3 mr-1" />כמעט שם!</Badge>;
    }
    if (progress >= 50) {
      return <Badge className="bg-info/20 text-info border-info/30"><Rocket className="w-3 h-3 mr-1" />בדרך</Badge>;
    }
    
    return <Badge variant="outline"><Zap className="w-3 h-3 mr-1" />פעיל</Badge>;
  }

  function formatValue(goal: Goal, value: number): string {
    switch (goal.goal_type) {
      case 'daily_profit':
      case 'balance_target':
        return `$${value.toFixed(2)}`;
      case 'growth_percentage':
        return `${value.toFixed(2)}%`;
      case 'winning_trades':
        return `${Math.floor(value)} עסקאות`;
      default:
        return value.toString();
    }
  }

  const activeGoals = goals.filter(g => g.status === 'active');
  const completedGoals = goals.filter(g => g.status === 'achieved');
  const overallProgress = activeGoals.length > 0 
    ? activeGoals.reduce((sum, g) => sum + getProgress(g), 0) / activeGoals.length 
    : 0;

  return (
    <Card className="h-full">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <Target className="h-5 w-5 text-primary" />
            יעדים ואתגרים
          </CardTitle>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={resetDailyGoals}
              disabled={isLoading}
            >
              <RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowAddGoal(!showAddGoal)}
            >
              <Plus className="h-4 w-4 mr-1" />
              יעד חדש
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Overall Progress */}
        <div className="p-3 bg-gradient-to-r from-primary/10 to-accent/10 rounded-lg border border-primary/20">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium">התקדמות כללית</span>
            <span className="text-lg font-bold text-primary">{overallProgress.toFixed(0)}%</span>
          </div>
          <Progress value={overallProgress} className="h-3" />
          <p className="text-xs text-muted-foreground mt-1">
            {activeGoals.length} יעדים פעילים | {completedGoals.length} הושגו
          </p>
        </div>

        {/* Add Goal Form */}
        {showAddGoal && (
          <div className="p-3 bg-muted/50 rounded-lg space-y-3 border border-dashed">
            <div className="grid grid-cols-2 gap-2">
              {Object.entries(GOAL_TYPES).map(([type, config]) => (
                <Button
                  key={type}
                  variant={newGoalType === type ? "default" : "outline"}
                  size="sm"
                  className="justify-start"
                  onClick={() => setNewGoalType(type)}
                >
                  <config.icon className={`h-4 w-4 mr-1 ${config.color}`} />
                  {config.label}
                </Button>
              ))}
            </div>
            
            <div className="flex gap-2">
              <Input
                type="number"
                placeholder="ערך יעד"
                value={newTargetValue}
                onChange={(e) => setNewTargetValue(e.target.value)}
                className="flex-1"
              />
              <Button onClick={addGoal} disabled={isLoading}>
                <Target className="h-4 w-4 mr-1" />
                הוסף
              </Button>
            </div>
            
            <div className="flex items-center justify-between">
              <Label className="text-xs">התאם אגרסיביות אוטומטית</Label>
              <Switch checked={autoAdjust} onCheckedChange={setAutoAdjust} />
            </div>
          </div>
        )}

        {/* Active Goals */}
        <Tabs defaultValue="active">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="active">פעילים ({activeGoals.length})</TabsTrigger>
            <TabsTrigger value="completed">הושגו ({completedGoals.length})</TabsTrigger>
          </TabsList>
          
          <TabsContent value="active" className="space-y-2 mt-2">
            {activeGoals.length === 0 ? (
              <p className="text-center text-muted-foreground py-4">
                אין יעדים פעילים. הוסף יעד חדש!
              </p>
            ) : (
              activeGoals.map((goal) => {
                const config = GOAL_TYPES[goal.goal_type as keyof typeof GOAL_TYPES];
                const progress = getProgress(goal);
                
                return (
                  <div
                    key={goal.id}
                    className="p-3 bg-card border rounded-lg space-y-2"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        {config && <config.icon className={`h-4 w-4 ${config.color}`} />}
                        <span className="text-sm font-medium">{config?.label}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        {getStatusBadge(goal)}
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => deleteGoal(goal.id)}
                          className="h-6 w-6 p-0"
                        >
                          <Trash2 className="h-3 w-3 text-muted-foreground" />
                        </Button>
                      </div>
                    </div>
                    
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-muted-foreground">
                        {formatValue(goal, goal.current_value)}
                      </span>
                      <span className="font-medium">
                        יעד: {formatValue(goal, goal.target_value)}
                      </span>
                    </div>
                    
                    <Progress 
                      value={progress} 
                      className={`h-2 ${progress >= 90 ? 'animate-pulse' : ''}`} 
                    />
                    
                    {goal.auto_adjust_aggression && (
                      <p className="text-[10px] text-muted-foreground">
                        ⚡ הבוט מתאים אגרסיביות אוטומטית
                      </p>
                    )}
                  </div>
                );
              })
            )}
          </TabsContent>
          
          <TabsContent value="completed" className="space-y-2 mt-2">
            {completedGoals.length === 0 ? (
              <p className="text-center text-muted-foreground py-4">
                עדיין לא הושגו יעדים
              </p>
            ) : (
              completedGoals.map((goal) => {
                const config = GOAL_TYPES[goal.goal_type as keyof typeof GOAL_TYPES];
                
                return (
                  <div
                    key={goal.id}
                    className="p-3 bg-profit/10 border border-profit/30 rounded-lg"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        {config && <config.icon className={`h-4 w-4 ${config.color}`} />}
                        <span className="text-sm font-medium">{config?.label}</span>
                      </div>
                      <Badge className="bg-profit/20 text-profit">
                        <Trophy className="w-3 h-3 mr-1" />
                        הושג!
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">
                      יעד: {formatValue(goal, goal.target_value)} | 
                      הושג: {goal.achieved_at ? new Date(goal.achieved_at).toLocaleDateString('he-IL') : '-'}
                    </p>
                  </div>
                );
              })
            )}
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}