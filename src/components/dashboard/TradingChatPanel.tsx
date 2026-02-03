import { useState, useRef, useEffect } from "react";
import { Send, Bot, User, Loader2, Sparkles, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { supabase } from "@/integrations/supabase/client";
import ReactMarkdown from "react-markdown";

interface Message {
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
}

export function TradingChatPanel() {
  const [messages, setMessages] = useState<Message[]>([
    {
      role: "assistant",
      content: "שלום! 👋 אני בוט המסחר שלך. אני רואה את כל מה שקורה בשוק ובמערכת.\n\nתוכל לשאול אותי על:\n- 📊 מצב התיק והפוזיציות\n- 📈 הזדמנויות בשוק\n- ⚙️ הפעלה/עצירה של המערכת\n- 🔄 הרצת מחזורי סריקה\n\nמה תרצה לעשות?",
      timestamp: new Date(),
    },
  ]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const sendMessage = async () => {
    if (!input.trim() || isLoading) return;

    const userMessage: Message = {
      role: "user",
      content: input.trim(),
      timestamp: new Date(),
    };

    setMessages((prev) => [...prev, userMessage]);
    setInput("");
    setIsLoading(true);

    try {
      const { data, error } = await supabase.functions.invoke("trading-chat", {
        body: {
          messages: [...messages, userMessage].map((m) => ({
            role: m.role,
            content: m.content,
          })),
        },
      });

      if (error) throw error;

      const assistantMessage: Message = {
        role: "assistant",
        content: data.response,
        timestamp: new Date(),
      };

      setMessages((prev) => [...prev, assistantMessage]);
    } catch (error) {
      console.error("Chat error:", error);
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: "⚠️ שגיאה בתקשורת. נסה שוב.",
          timestamp: new Date(),
        },
      ]);
    } finally {
      setIsLoading(false);
      inputRef.current?.focus();
    }
  };

  const quickActions = [
    { label: "הרץ מחזור", icon: Zap, message: "הרץ מחזור סריקה" },
    { label: "מצב התיק", icon: Sparkles, message: "מה מצב התיק?" },
  ];

  return (
    <div className="terminal-card h-full flex flex-col">
      <div className="terminal-header">
        <div className="flex items-center gap-2">
          <Bot className="w-4 h-4 text-primary animate-pulse" />
          <h2 className="font-semibold text-sm">בוט שליטה AI</h2>
        </div>
      </div>

      <ScrollArea className="flex-1 p-3">
        <div className="space-y-3">
          {messages.map((message, index) => (
            <div
              key={index}
              className={`flex gap-2 ${
                message.role === "user" ? "flex-row-reverse" : ""
              }`}
            >
              <div
                className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 ${
                  message.role === "user"
                    ? "bg-primary/20"
                    : "bg-profit/20"
                }`}
              >
                {message.role === "user" ? (
                  <User className="w-4 h-4 text-primary" />
                ) : (
                  <Bot className="w-4 h-4 text-profit" />
                )}
              </div>
              <div
                className={`max-w-[85%] rounded-lg p-2.5 text-sm ${
                  message.role === "user"
                    ? "bg-primary/10 text-foreground"
                    : "bg-muted/50 text-foreground"
                }`}
              >
                <div className="prose prose-sm dark:prose-invert max-w-none">
                  <ReactMarkdown>{message.content}</ReactMarkdown>
                </div>
                <p className="text-[10px] text-muted-foreground mt-1 opacity-60">
                  {message.timestamp.toLocaleTimeString("he-IL")}
                </p>
              </div>
            </div>
          ))}
          {isLoading && (
            <div className="flex gap-2">
              <div className="w-7 h-7 rounded-full bg-profit/20 flex items-center justify-center">
                <Loader2 className="w-4 h-4 text-profit animate-spin" />
              </div>
              <div className="bg-muted/50 rounded-lg p-2.5">
                <div className="flex gap-1">
                  <span className="w-2 h-2 bg-profit/50 rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
                  <span className="w-2 h-2 bg-profit/50 rounded-full animate-bounce" style={{ animationDelay: "150ms" }} />
                  <span className="w-2 h-2 bg-profit/50 rounded-full animate-bounce" style={{ animationDelay: "300ms" }} />
                </div>
              </div>
            </div>
          )}
          <div ref={scrollRef} />
        </div>
      </ScrollArea>

      {/* Quick Actions */}
      <div className="px-3 pb-2 flex gap-2">
        {quickActions.map((action) => (
          <Button
            key={action.label}
            variant="outline"
            size="sm"
            className="text-xs h-7"
            onClick={() => {
              setInput(action.message);
              setTimeout(() => sendMessage(), 100);
            }}
            disabled={isLoading}
          >
            <action.icon className="w-3 h-3 mr-1" />
            {action.label}
          </Button>
        ))}
      </div>

      {/* Input */}
      <div className="p-3 pt-0 flex gap-2">
        <Input
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && sendMessage()}
          placeholder="הקלד פקודה או שאלה..."
          className="text-sm"
          disabled={isLoading}
          dir="rtl"
        />
        <Button
          onClick={sendMessage}
          disabled={!input.trim() || isLoading}
          size="icon"
          className="shrink-0"
        >
          <Send className="w-4 h-4" />
        </Button>
      </div>
    </div>
  );
}