import { useState } from 'react';
import {
  Gauge, Rocket, Bot, Shield, Sliders, Power, Activity, Target,
  Percent, DollarSign, Clock, RefreshCw, Leaf, Scale, Flame,
} from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import { Slider } from '@/components/ui/slider';
import { useTradingConfig, type ProfileName } from '@/hooks/useTradingConfig';

const MODES: { key: ProfileName; label: string; he: string; desc: string; icon: typeof Leaf; accent: string }[] = [
  { key: 'CONSERVATIVE', label: 'Conservative', he: 'שמרני', desc: 'סייזינג קטן, מעט עסקאות, סף-edge גבוה', icon: Leaf, accent: 'profit' },
  { key: 'BALANCED', label: 'Balanced', he: 'מאוזן', desc: 'ברירת מחדל שקולה', icon: Scale, accent: 'primary' },
  { key: 'AGGRESSIVE', label: 'Aggressive', he: 'אגרסיבי', desc: 'סייזינג גדול, תדירות גבוהה — בתוך התקרות', icon: Flame, accent: 'warning' },
  { key: 'CUSTOM', label: 'Custom', he: 'מותאם', desc: 'פרמטרים שאתה מגדיר', icon: Sliders, accent: 'primary' },
  { key: 'AUTO', label: 'Auto', he: 'אוטומטי', desc: 'אדפטיבי לפי השוק והאיזון שלך', icon: Bot, accent: 'primary' },
];

const CUSTOM_SLIDERS: { key: string; label: string; icon: typeof Target; min: number; max: number; step: number; unit: string }[] = [
  { key: 'maxTradeUsdt', label: 'גודל עסקה (USDT)', icon: DollarSign, min: 1, max: 100, step: 1, unit: '' },
  { key: 'riskPerTradePct', label: 'סיכון לעסקה', icon: Percent, min: 0.1, max: 3, step: 0.1, unit: '%' },
  { key: 'maxOpenPositions', label: 'פוזיציות מקבילות', icon: Activity, min: 1, max: 8, step: 1, unit: '' },
  { key: 'maxTradesPerHour', label: 'עסקאות לשעה', icon: Clock, min: 1, max: 40, step: 1, unit: '' },
  { key: 'minEdgePct', label: 'סף edge מינימלי', icon: Target, min: 0.1, max: 5, step: 0.05, unit: '%' },
];

export function TradingModePanel() {
  const { settings, resolved, isLoading, isSaving, error, save } = useTradingConfig();
  const [customDraft, setCustomDraft] = useState<Record<string, number>>({});

  const activeProfile = settings?.profile ?? 'BALANCED';
  const autopilot = settings?.autopilot ?? false;

  const customValue = (key: string, fallback: number) =>
    customDraft[key] ?? (settings?.custom?.[key] as number | undefined) ?? fallback;

  return (
    <div className="terminal-card h-full flex flex-col">
      <div className="terminal-header">
        <div className="flex items-center gap-2">
          <Gauge className="w-4 h-4 text-primary" />
          <h2 className="font-semibold text-sm">Autopilot / מצב מסחר</h2>
          <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-primary/10 border border-primary/30 text-primary">
            {activeProfile}
          </span>
        </div>
        {isSaving && <RefreshCw className="w-3.5 h-3.5 text-muted-foreground animate-spin" />}
      </div>

      <div className="p-3 sm:p-4 space-y-4 flex-1 overflow-auto">
        {error && (
          <div className="p-2 rounded border border-destructive/30 bg-destructive/10 text-xs text-destructive">
            {error}
          </div>
        )}

        {/* Master autopilot toggle */}
        <div className={`p-4 rounded-lg border ${autopilot ? 'bg-profit/10 border-profit/30' : 'bg-muted/30 border-border'}`}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className={`w-10 h-10 rounded-full flex items-center justify-center ${autopilot ? 'bg-profit/20' : 'bg-muted'}`}>
                <Rocket className={`w-5 h-5 ${autopilot ? 'text-profit' : 'text-muted-foreground'}`} />
              </div>
              <div>
                <p className="font-semibold text-sm">טייס אוטומטי</p>
                <p className="text-xs text-muted-foreground">
                  {autopilot ? 'פעיל — המערכת פועלת לפי המצב' : 'כבוי'}
                </p>
              </div>
            </div>
            <Switch
              checked={autopilot}
              disabled={isLoading}
              onCheckedChange={(checked) => save({ autopilot: checked })}
            />
          </div>
        </div>

        {/* Mode selector */}
        <div className="space-y-2">
          <h3 className="text-xs text-muted-foreground flex items-center gap-1">
            <Sliders className="w-3 h-3" /> בורר מצבים
          </h3>
          <div className="grid grid-cols-2 gap-2">
            {MODES.map((m) => {
              const Icon = m.icon;
              const selected = activeProfile === m.key;
              return (
                <button
                  key={m.key}
                  onClick={() => save({ profile: m.key, adaptive: m.key === 'AUTO' })}
                  disabled={isLoading}
                  className={`text-right p-3 rounded-lg border transition-colors ${
                    selected ? 'bg-primary/10 border-primary/50' : 'bg-muted/20 border-border hover:bg-muted/40'
                  }`}
                >
                  <div className="flex items-center justify-between mb-1">
                    <Icon className={`w-4 h-4 ${selected ? 'text-primary' : 'text-muted-foreground'}`} />
                    <span className={`text-sm font-medium ${selected ? 'text-primary' : ''}`}>{m.he}</span>
                  </div>
                  <p className="text-[10px] text-muted-foreground leading-tight">{m.desc}</p>
                </button>
              );
            })}
          </div>
        </div>

        {/* Custom sliders */}
        {activeProfile === 'CUSTOM' && resolved && (
          <div className="space-y-4 p-3 rounded-lg bg-muted/20 border border-border">
            {CUSTOM_SLIDERS.map((s) => {
              const Icon = s.icon;
              const val = customValue(s.key, (resolved as unknown as Record<string, number>)[s.key] ?? s.min);
              return (
                <div key={s.key} className="space-y-2">
                  <label className="text-xs flex items-center justify-between">
                    <span className="flex items-center gap-2"><Icon className="w-3.5 h-3.5" />{s.label}</span>
                    <span className="font-mono text-primary">{val}{s.unit}</span>
                  </label>
                  <Slider
                    value={[val]}
                    min={s.min}
                    max={s.max}
                    step={s.step}
                    onValueChange={([v]) => setCustomDraft((d) => ({ ...d, [s.key]: v }))}
                    onValueCommit={([v]) => save({ custom: { ...(settings?.custom ?? {}), ...customDraft, [s.key]: v } })}
                  />
                </div>
              );
            })}
          </div>
        )}

        {/* Adaptive note for AUTO */}
        {activeProfile === 'AUTO' && (
          <div className="p-3 rounded-lg bg-primary/5 border border-primary/20 text-xs text-muted-foreground">
            <p className="flex items-center gap-1 text-primary font-medium mb-1"><Bot className="w-3.5 h-3.5" /> מצב אדפטיבי</p>
            המערכת מתאימה את הסייזינג, התדירות וסף-ה-edge לפי תנודתיות, מגמה, יתרה ו-drawdown בזמן אמת.
          </div>
        )}

        {/* Resolved effective parameters */}
        {resolved && (
          <div className="space-y-2">
            <h3 className="text-xs text-muted-foreground flex items-center gap-1">
              <Activity className="w-3 h-3" /> פרמטרים אפקטיביים
            </h3>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <Stat icon={DollarSign} label="גודל עסקה" value={`$${resolved.maxTradeUsdt}`} />
              <Stat icon={Percent} label="סיכון/עסקה" value={`${resolved.riskPerTradePct}%`} />
              <Stat icon={Activity} label="פוזיציות" value={`${resolved.maxOpenPositions}`} />
              <Stat icon={Clock} label="עסקאות/שעה" value={`${resolved.maxTradesPerHour}`} />
              <Stat icon={Target} label="סף edge" value={`${resolved.minEdgePct}%`} />
              <Stat icon={Target} label="TP / SL" value={`${resolved.takeProfitPct}/${resolved.stopLossPct}%`} />
            </div>
            {resolved.rationale && (
              <p className="text-[10px] text-muted-foreground italic">{resolved.rationale}</p>
            )}
          </div>
        )}

        {/* Hard safety floor note */}
        <div className="p-3 rounded-lg bg-muted/20 border border-border">
          <p className="text-xs flex items-center gap-1 text-muted-foreground">
            <Shield className="w-3.5 h-3.5 text-primary" />
            רצפת-בטיחות (שרת): DRY_RUN כברירת מחדל, תקרות, kill-switch, בלי מינוף.
          </p>
          <p className="text-[10px] text-muted-foreground mt-1">
            הבורר שולט באגרסיביות בלבד — לא ברצפת-הבטיחות. "אגרסיבי" ≠ ממונף ≠ לא-בטוח.
            מסחר חי דורש <span className="font-mono">TRADING_MODE=LIVE</span> בשרת.
          </p>
        </div>
      </div>
    </div>
  );
}

function Stat({ icon: Icon, label, value }: { icon: typeof Target; label: string; value: string }) {
  return (
    <div className="p-2 rounded bg-muted/30 border border-border flex items-center justify-between">
      <span className="flex items-center gap-1 text-muted-foreground"><Icon className="w-3 h-3" />{label}</span>
      <span className="font-mono">{value}</span>
    </div>
  );
}
