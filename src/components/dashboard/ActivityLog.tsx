import { History, ArrowUpRight, ArrowDownRight, Info, AlertTriangle, CheckCircle, XCircle } from "lucide-react";
import { useState } from "react";

type LogType = 'info' | 'trade' | 'warning' | 'success' | 'error';

interface LogEntry {
  id: string;
  timestamp: string;
  type: LogType;
  message: string;
  details?: string;
}

// Mock activity log
const mockLogs: LogEntry[] = [
  {
    id: '1',
    timestamp: new Date().toISOString(),
    type: 'info',
    message: 'System initialized in SHADOW mode',
    details: 'All scanners active, monitoring market conditions'
  },
  {
    id: '2',
    timestamp: new Date(Date.now() - 30000).toISOString(),
    type: 'success',
    message: 'Connected to Gate.io API',
    details: 'WebSocket connection established'
  },
  {
    id: '3',
    timestamp: new Date(Date.now() - 60000).toISOString(),
    type: 'info',
    message: 'Fetched account balances',
    details: 'Treasury sync complete'
  },
];

const getTypeIcon = (type: LogType) => {
  switch (type) {
    case 'info': return Info;
    case 'trade': return ArrowUpRight;
    case 'warning': return AlertTriangle;
    case 'success': return CheckCircle;
    case 'error': return XCircle;
  }
};

const getTypeColor = (type: LogType) => {
  switch (type) {
    case 'info': return 'text-info';
    case 'trade': return 'text-primary';
    case 'warning': return 'text-warning';
    case 'success': return 'text-profit';
    case 'error': return 'text-destructive';
  }
};

export function ActivityLog() {
  const [filter, setFilter] = useState<LogType | 'all'>('all');
  
  const filteredLogs = filter === 'all' 
    ? mockLogs 
    : mockLogs.filter(log => log.type === filter);

  const formatTime = (iso: string) => {
    return new Date(iso).toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false
    });
  };

  return (
    <div className="terminal-card h-full flex flex-col">
      <div className="terminal-header">
        <div className="flex items-center gap-2">
          <History className="w-4 h-4 text-primary" />
          <h2 className="font-semibold text-sm">Activity Log</h2>
        </div>
        <div className="flex items-center gap-1">
          {(['all', 'info', 'trade', 'warning', 'error'] as const).map((type) => (
            <button
              key={type}
              onClick={() => setFilter(type)}
              className={`px-2 py-1 text-xs rounded transition-colors ${
                filter === type
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {type === 'all' ? 'All' : type.charAt(0).toUpperCase() + type.slice(1)}
            </button>
          ))}
        </div>
      </div>
      
      <div className="flex-1 overflow-auto">
        {filteredLogs.length === 0 ? (
          <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
            No activity to show
          </div>
        ) : (
          <div className="divide-y divide-border">
            {filteredLogs.map((log) => {
              const Icon = getTypeIcon(log.type);
              return (
                <div key={log.id} className="p-3 hover:bg-muted/20 transition-colors">
                  <div className="flex items-start gap-3">
                    <Icon className={`w-4 h-4 mt-0.5 flex-shrink-0 ${getTypeColor(log.type)}`} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-sm text-foreground truncate">{log.message}</p>
                        <span className="text-xs text-muted-foreground font-mono flex-shrink-0">
                          {formatTime(log.timestamp)}
                        </span>
                      </div>
                      {log.details && (
                        <p className="text-xs text-muted-foreground mt-1">{log.details}</p>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
