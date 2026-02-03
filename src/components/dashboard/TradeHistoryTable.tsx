import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { supabase } from "@/integrations/supabase/client";
import { 
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { 
  ArrowUpCircle, 
  ArrowDownCircle, 
  Clock,
  RefreshCw,
  Filter
} from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface Trade {
  id: string;
  symbol: string;
  type: string;
  side: string;
  amount: number;
  price: number;
  actual_pnl: number | null;
  status: string;
  created_at: string;
  executed_at: string | null;
}

export function TradeHistoryTable() {
  const [trades, setTrades] = useState<Trade[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [filter, setFilter] = useState<string>("all");
  const [strategyFilter, setStrategyFilter] = useState<string>("all");

  useEffect(() => {
    fetchTrades();
    const interval = setInterval(fetchTrades, 10000);
    return () => clearInterval(interval);
  }, []);

  async function fetchTrades() {
    try {
      const { data, error } = await supabase
        .from('trade_history')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(100);
      
      if (error) throw error;
      setTrades(data || []);
    } catch (e) {
      console.error('Error fetching trades:', e);
    } finally {
      setIsLoading(false);
    }
  }

  const filteredTrades = trades.filter(trade => {
    if (filter === "wins" && (trade.actual_pnl || 0) <= 0) return false;
    if (filter === "losses" && (trade.actual_pnl || 0) > 0) return false;
    if (strategyFilter !== "all" && trade.type !== strategyFilter) return false;
    return true;
  });

  const strategies = [...new Set(trades.map(t => t.type))];

  return (
    <Card className="h-full">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <Clock className="h-5 w-5" />
            היסטוריית עסקאות
          </CardTitle>
          <div className="flex items-center gap-2">
            <Select value={filter} onValueChange={setFilter}>
              <SelectTrigger className="w-24 h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">הכל</SelectItem>
                <SelectItem value="wins">רווחים</SelectItem>
                <SelectItem value="losses">הפסדים</SelectItem>
              </SelectContent>
            </Select>
            
            <Select value={strategyFilter} onValueChange={setStrategyFilter}>
              <SelectTrigger className="w-28 h-8 text-xs">
                <SelectValue placeholder="אסטרטגיה" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">הכל</SelectItem>
                {strategies.map(s => (
                  <SelectItem key={s} value={s}>{s}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={fetchTrades}
              disabled={isLoading}
            >
              <RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        <ScrollArea className="h-[400px]">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-24">זמן</TableHead>
                <TableHead>סימבול</TableHead>
                <TableHead>אסטרטגיה</TableHead>
                <TableHead>צד</TableHead>
                <TableHead className="text-right">מחיר</TableHead>
                <TableHead className="text-right">כמות</TableHead>
                <TableHead className="text-right">P&L</TableHead>
                <TableHead>סטטוס</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredTrades.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="text-center text-muted-foreground py-8">
                    אין עסקאות להצגה
                  </TableCell>
                </TableRow>
              ) : (
                filteredTrades.map((trade) => (
                  <TableRow key={trade.id}>
                    <TableCell className="text-xs text-muted-foreground">
                      {new Date(trade.created_at).toLocaleString('he-IL', {
                        hour: '2-digit',
                        minute: '2-digit',
                        day: '2-digit',
                        month: '2-digit',
                      })}
                    </TableCell>
                    <TableCell className="font-medium">{trade.symbol}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className="text-xs">
                        {trade.type}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {trade.side === 'buy' ? (
                        <span className="flex items-center text-green-500 text-xs">
                          <ArrowUpCircle className="h-3 w-3 mr-1" />
                          BUY
                        </span>
                      ) : (
                        <span className="flex items-center text-red-500 text-xs">
                          <ArrowDownCircle className="h-3 w-3 mr-1" />
                          SELL
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-right text-xs">
                      ${trade.price?.toFixed(6) || '-'}
                    </TableCell>
                    <TableCell className="text-right text-xs">
                      {trade.amount?.toFixed(4) || '-'}
                    </TableCell>
                    <TableCell className={`text-right font-medium ${
                      (trade.actual_pnl || 0) >= 0 ? 'text-green-500' : 'text-red-500'
                    }`}>
                      {trade.actual_pnl !== null ? `$${trade.actual_pnl.toFixed(2)}` : '-'}
                    </TableCell>
                    <TableCell>
                      <Badge 
                        variant={trade.status === 'executed' ? 'default' : 'secondary'}
                        className="text-xs"
                      >
                        {trade.status}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </ScrollArea>
      </CardContent>
    </Card>
  );
}
