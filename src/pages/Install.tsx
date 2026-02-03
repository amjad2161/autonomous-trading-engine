import { useState, useEffect } from 'react';
import { Download, Share, Smartphone, CheckCircle2, ArrowLeft, Zap } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useNavigate } from 'react-router-dom';

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export default function Install() {
  const navigate = useNavigate();
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isInstalled, setIsInstalled] = useState(false);
  const [isIOS, setIsIOS] = useState(false);
  const [isStandalone, setIsStandalone] = useState(false);

  useEffect(() => {
    // Check if already installed
    if (window.matchMedia('(display-mode: standalone)').matches) {
      setIsStandalone(true);
      setIsInstalled(true);
    }

    // Detect iOS
    const iOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
    setIsIOS(iOS);

    // Listen for beforeinstallprompt event (Chrome, Edge, etc.)
    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);

    // Listen for successful installation
    window.addEventListener('appinstalled', () => {
      setIsInstalled(true);
      setDeferredPrompt(null);
    });

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    };
  }, []);

  const handleInstall = async () => {
    if (!deferredPrompt) return;

    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    
    if (outcome === 'accepted') {
      setIsInstalled(true);
    }
    setDeferredPrompt(null);
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        {/* Back button */}
        <Button
          variant="ghost"
          size="sm"
          onClick={() => navigate('/')}
          className="mb-6 -ml-2"
        >
          <ArrowLeft className="w-4 h-4 mr-2" />
          חזרה
        </Button>

        {/* Header */}
        <div className="text-center mb-8">
          <div className="w-20 h-20 bg-primary/20 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <Zap className="w-10 h-10 text-primary" />
          </div>
          <h1 className="text-2xl font-bold mb-2">התקן את TradingCore</h1>
          <p className="text-muted-foreground">
            קבל גישה מהירה מהמסך הראשי של הטלפון
          </p>
        </div>

        {/* Status / Instructions */}
        <div className="terminal-card p-6 space-y-6">
          {isInstalled || isStandalone ? (
            <div className="text-center space-y-4">
              <div className="w-16 h-16 bg-profit/20 rounded-full flex items-center justify-center mx-auto">
                <CheckCircle2 className="w-8 h-8 text-profit" />
              </div>
              <div>
                <h3 className="font-semibold text-lg">האפליקציה מותקנת!</h3>
                <p className="text-muted-foreground text-sm mt-1">
                  תוכל למצוא אותה במסך הראשי של הטלפון
                </p>
              </div>
              <Button onClick={() => navigate('/')} className="w-full">
                המשך לאפליקציה
              </Button>
            </div>
          ) : isIOS ? (
            <div className="space-y-4">
              <div className="flex items-center gap-3 text-primary">
                <Share className="w-6 h-6" />
                <h3 className="font-semibold">הוראות התקנה ל-iPhone</h3>
              </div>
              
              <ol className="space-y-4 text-sm">
                <li className="flex gap-3">
                  <span className="w-6 h-6 rounded-full bg-primary/20 text-primary flex items-center justify-center shrink-0 text-xs font-bold">1</span>
                  <span>לחץ על כפתור השיתוף <Share className="w-4 h-4 inline mx-1" /> בתפריט Safari</span>
                </li>
                <li className="flex gap-3">
                  <span className="w-6 h-6 rounded-full bg-primary/20 text-primary flex items-center justify-center shrink-0 text-xs font-bold">2</span>
                  <span>גלול למטה ובחר "הוסף למסך הבית"</span>
                </li>
                <li className="flex gap-3">
                  <span className="w-6 h-6 rounded-full bg-primary/20 text-primary flex items-center justify-center shrink-0 text-xs font-bold">3</span>
                  <span>לחץ "הוסף" בפינה הימנית העליונה</span>
                </li>
              </ol>

              <div className="bg-muted/30 rounded-lg p-3 text-xs text-muted-foreground">
                <Smartphone className="w-4 h-4 inline mr-1" />
                האפליקציה תופיע במסך הראשי ותפעל כמו אפליקציה רגילה
              </div>
            </div>
          ) : deferredPrompt ? (
            <div className="space-y-4">
              <div className="flex items-center gap-3 text-primary">
                <Download className="w-6 h-6" />
                <h3 className="font-semibold">מוכן להתקנה</h3>
              </div>
              
              <p className="text-sm text-muted-foreground">
                לחץ על הכפתור להתקנת האפליקציה על הטלפון שלך. היא תהיה זמינה ישירות מהמסך הראשי.
              </p>

              <Button onClick={handleInstall} size="lg" className="w-full gap-2">
                <Download className="w-5 h-5" />
                התקן עכשיו
              </Button>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex items-center gap-3 text-primary">
                <Smartphone className="w-6 h-6" />
                <h3 className="font-semibold">הוראות התקנה</h3>
              </div>
              
              <ol className="space-y-4 text-sm">
                <li className="flex gap-3">
                  <span className="w-6 h-6 rounded-full bg-primary/20 text-primary flex items-center justify-center shrink-0 text-xs font-bold">1</span>
                  <span>פתח את תפריט הדפדפן (שלוש נקודות)</span>
                </li>
                <li className="flex gap-3">
                  <span className="w-6 h-6 rounded-full bg-primary/20 text-primary flex items-center justify-center shrink-0 text-xs font-bold">2</span>
                  <span>בחר "התקן אפליקציה" או "הוסף למסך הבית"</span>
                </li>
                <li className="flex gap-3">
                  <span className="w-6 h-6 rounded-full bg-primary/20 text-primary flex items-center justify-center shrink-0 text-xs font-bold">3</span>
                  <span>אשר את ההתקנה</span>
                </li>
              </ol>

              <div className="bg-muted/30 rounded-lg p-3 text-xs text-muted-foreground">
                💡 אם אתה משתמש ב-Chrome, Edge או Samsung Internet - ההתקנה תהיה אוטומטית
              </div>
            </div>
          )}
        </div>

        {/* Benefits */}
        <div className="mt-6 space-y-3">
          <h4 className="text-sm font-medium text-muted-foreground">יתרונות ההתקנה:</h4>
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div className="bg-muted/20 rounded-lg p-3 flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-profit shrink-0" />
              <span>גישה מהירה</span>
            </div>
            <div className="bg-muted/20 rounded-lg p-3 flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-profit shrink-0" />
              <span>עובד אופליין</span>
            </div>
            <div className="bg-muted/20 rounded-lg p-3 flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-profit shrink-0" />
              <span>מסך מלא</span>
            </div>
            <div className="bg-muted/20 rounded-lg p-3 flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-profit shrink-0" />
              <span>טעינה מהירה</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
