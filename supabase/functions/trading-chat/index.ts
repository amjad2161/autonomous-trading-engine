import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { createHmac } from "https://deno.land/std@0.177.0/node/crypto.ts";
import { encodeHex } from "https://deno.land/std@0.224.0/encoding/hex.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const supabase = createClient(supabaseUrl, supabaseKey);

const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY')!;
const AI_GATEWAY = 'https://ai.gateway.lovable.dev/v1/chat/completions';

// ===================== GATE.IO API =====================
async function sha512Hash(message: string): Promise<string> {
  const msgBuffer = new TextEncoder().encode(message);
  const hashBuffer = await crypto.subtle.digest('SHA-512', msgBuffer);
  return encodeHex(new Uint8Array(hashBuffer));
}

async function generateSignature(method: string, url: string, queryString: string, payloadString: string, timestamp: string, secret: string): Promise<string> {
  const hashedPayload = await sha512Hash(payloadString);
  const signatureString = `${method}\n${url}\n${queryString}\n${hashedPayload}\n${timestamp}`;
  return createHmac('sha512', secret).update(signatureString).digest('hex');
}

async function gateRequest(endpoint: string, method: 'GET' | 'POST' | 'DELETE' = 'GET', params: Record<string, string> = {}, body?: Record<string, unknown>): Promise<any> {
  const GATE_API_KEY = Deno.env.get('GATE_API_KEY')!;
  const GATE_API_SECRET = Deno.env.get('GATE_API_SECRET')!;
  const baseUrl = 'https://api.gateio.ws';
  const apiPrefix = '/api/v4';
  const url = `${apiPrefix}${endpoint}`;
  const queryString = new URLSearchParams(params).toString();
  const fullUrl = queryString ? `${baseUrl}${url}?${queryString}` : `${baseUrl}${url}`;
  const payloadString = body ? JSON.stringify(body) : '';
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const signature = await generateSignature(method, url, queryString, payloadString, timestamp, GATE_API_SECRET);

  const response = await fetch(fullUrl, {
    method,
    headers: { 'KEY': GATE_API_KEY, 'SIGN': signature, 'Timestamp': timestamp, 'Content-Type': 'application/json' },
    body: payloadString || undefined,
  });
  return response.json();
}

// ===================== GET SYSTEM STATUS =====================
async function getSystemStatus() {
  const { data: state } = await supabase.from('trading_system_state').select('*').limit(1).single();
  const { data: recentTrades } = await supabase.from('trade_history').select('*').order('executed_at', { ascending: false }).limit(10);
  const { data: recentLogs } = await supabase.from('system_log').select('*').order('created_at', { ascending: false }).limit(20);
  
  const balances = await gateRequest('/spot/accounts');
  const tickers = await gateRequest('/spot/tickers');
  
  const usdtBalance = balances?.find((b: any) => b.currency === 'USDT');
  
  let totalValue = usdtBalance ? parseFloat(usdtBalance.available) : 0;
  const positions: any[] = [];
  
  for (const balance of balances || []) {
    if (balance.currency === 'USDT' || parseFloat(balance.available) <= 0) continue;
    const ticker = tickers?.find((t: any) => t.currency_pair === `${balance.currency}_USDT`);
    if (!ticker) continue;
    const value = parseFloat(balance.available) * parseFloat(ticker.last);
    if (value < 1) continue;
    totalValue += value;
    positions.push({
      currency: balance.currency,
      amount: parseFloat(balance.available),
      price: parseFloat(ticker.last),
      value,
      change24h: parseFloat(ticker.change_percentage),
    });
  }
  
  return {
    isActive: state?.is_active || false,
    balance: totalValue,
    usdtAvailable: usdtBalance ? parseFloat(usdtBalance.available) : 0,
    positions,
    totalCycles: state?.total_cycles || 0,
    totalTrades: state?.total_trades || 0,
    successfulTrades: state?.successful_trades || 0,
    totalPnL: state?.total_pnl || 0,
    recentTrades: recentTrades || [],
    recentLogs: recentLogs || [],
    lastHeartbeat: state?.last_heartbeat,
  };
}

// ===================== EXECUTE COMMANDS =====================
async function executeCommand(command: string): Promise<string> {
  const cmd = command.toLowerCase();
  
  if (cmd.includes('start') || cmd.includes('הפעל') || cmd.includes('התחל')) {
    await supabase.from('trading_system_state').update({ is_active: true, started_at: new Date().toISOString() }).neq('id', '');
    return 'המערכת הופעלה! מצב: פעיל 24/7';
  }
  
  if (cmd.includes('stop') || cmd.includes('עצור') || cmd.includes('הפסק')) {
    await supabase.from('trading_system_state').update({ is_active: false }).neq('id', '');
    return 'המערכת נעצרה. המסחר הופסק.';
  }
  
  if (cmd.includes('cycle') || cmd.includes('מחזור') || cmd.includes('רוץ')) {
    const response = await fetch(`${supabaseUrl}/functions/v1/autonomous-orchestrator`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${supabaseKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ command: 'cycle' }),
    });
    const result = await response.json();
    return `מחזור הושלם! סרקתי ${result.scanned} זוגות, ${result.entries} כניסות, ${result.exits} יציאות. P&L: $${result.pnl?.toFixed(2) || 0}`;
  }
  
  if (cmd.includes('10 cycle') || cmd.includes('10 מחזור')) {
    let totalEntries = 0, totalExits = 0, totalPnL = 0;
    for (let i = 0; i < 10; i++) {
      const response = await fetch(`${supabaseUrl}/functions/v1/autonomous-orchestrator`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${supabaseKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ command: 'cycle' }),
      });
      const result = await response.json();
      totalEntries += result.entries || 0;
      totalExits += result.exits || 0;
      totalPnL += result.pnl || 0;
    }
    return `10 מחזורים הושלמו! כניסות: ${totalEntries}, יציאות: ${totalExits}, P&L כולל: $${totalPnL.toFixed(2)}`;
  }
  
  return '';
}

// ===================== AI CHAT =====================
async function chat(messages: { role: string; content: string }[]) {
  const status = await getSystemStatus();
  
  const systemPrompt = `אתה בוט מסחר מומחה שמנהל מערכת מסחר אוטונומית בבורסת Gate.io.
אתה יכול לראות את מצב המערכת בזמן אמת ולתת המלצות.

📊 **מצב נוכחי:**
- סטטוס: ${status.isActive ? '🟢 פעיל' : '🔴 מושבת'}
- יתרה כוללת: $${status.balance.toFixed(2)}
- USDT זמין: $${status.usdtAvailable.toFixed(2)}
- פוזיציות פתוחות: ${status.positions.length}
- מחזורים: ${status.totalCycles}
- עסקאות: ${status.successfulTrades}/${status.totalTrades}
- P&L כולל: $${status.totalPnL.toFixed(2)}

📈 **פוזיציות:**
${status.positions.map(p => `- ${p.currency}: $${p.value.toFixed(2)} (${p.change24h >= 0 ? '+' : ''}${p.change24h.toFixed(2)}%)`).join('\n') || 'אין פוזיציות פתוחות'}

📝 **עסקאות אחרונות:**
${status.recentTrades.slice(0, 5).map(t => `- ${t.side} ${t.symbol}: $${t.actual_pnl?.toFixed(2) || 0}`).join('\n') || 'אין עסקאות'}

**פקודות זמינות (המשתמש יכול לבקש):**
- "הפעל" - להפעיל את המערכת
- "עצור" - לעצור את המערכת
- "הרץ מחזור" - להריץ מחזור סריקה ומסחר
- "הרץ 10 מחזורים" - להריץ 10 מחזורים ברצף

כשמבקשים פקודה, הגב עם הפקודה בתחילת ההודעה בפורמט: [COMMAND:xxx]
לדוגמה: [COMMAND:cycle] או [COMMAND:start]

היה פרואקטיבי! תמיד תן המלצות לפעולה הבאה.
דבר בעברית, קצר וענייני, עם אימוג'ים.`;

  const response = await fetch(AI_GATEWAY, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${LOVABLE_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'google/gemini-2.5-flash',
      messages: [
        { role: 'system', content: systemPrompt },
        ...messages,
      ],
      max_tokens: 1000,
      temperature: 0.7,
    }),
  });

  const data = await response.json();
  let aiResponse = data.choices?.[0]?.message?.content || 'שגיאה בתקשורת עם ה-AI';
  
  // Extract and execute commands
  const commandMatch = aiResponse.match(/\[COMMAND:(\w+)\]/);
  if (commandMatch) {
    const cmd = commandMatch[1];
    const cmdResult = await executeCommand(cmd);
    aiResponse = aiResponse.replace(/\[COMMAND:\w+\]/g, '') + (cmdResult ? `\n\n✅ ${cmdResult}` : '');
  }
  
  return aiResponse.trim();
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { messages } = await req.json();
    
    // Check if user message contains a direct command
    const userMessage = messages[messages.length - 1]?.content || '';
    const directCommand = await executeCommand(userMessage);
    
    const aiResponse = await chat(messages);
    
    return new Response(JSON.stringify({
      success: true,
      response: directCommand ? `${directCommand}\n\n${aiResponse}` : aiResponse,
      status: await getSystemStatus(),
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Chat error:', error);
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});