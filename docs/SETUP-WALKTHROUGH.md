# מדריך התקנה צעד-אחר-צעד (Setup Walkthrough)

מדריך מלא, לחיצה-אחר-לחיצה, מאפס עד שהמערכת רצה על המחשב שלך ב‑DRY_RUN
(קוראת נתונים אמיתיים, **לא** שולחת פקודות). פקודות באנגלית — הסבר בעברית.

> כלל זהב: עד שאתה לא רואה GO ירוק ב‑`npm run preflight` ולא בדקת ב‑DRY_RUN —
> אל תעבור ל‑LIVE. ברירת המחדל בטוחה: שום כסף לא זז.

---

## שלב 0 — מה צריך מותקן (פעם אחת)

| כלי | למה | קישור |
|---|---|---|
| **Node.js 18+** | מריץ את הדשבורד | https://nodejs.org (הורד "LTS") |
| **Docker Desktop** | מריץ את ה‑Supabase המקומי | https://www.docker.com/products/docker-desktop |
| **Supabase CLI** | מקים את ה‑DB והפונקציות | ראה התקנה למטה ↓ |

**התקנת Supabase CLI:**
- **Windows** (PowerShell) — דרך Scoop:
  ```powershell
  Invoke-RestMethod -Uri https://get.scoop.sh | Invoke-Expression
  scoop bucket add supabase https://github.com/supabase/scoop-bucket.git
  scoop install supabase
  ```
  אם Scoop כבר מותקן, רק שתי השורות האחרונות.
- **Mac** — `brew install supabase/tap/supabase`
- **Linux** — ראה https://supabase.com/docs/guides/cli

איך לבדוק שהכול הותקן — פתח טרמינל והקלד:
```bash
node -v        # צריך להראות v18 ומעלה
docker --version
supabase --version
```
אם אחד מהם נכשל — התקן אותו מהקישור ופתח טרמינל מחדש.

> **Windows:** התקן Docker Desktop והפעל אותו (אייקון בלוויין). את כל הפקודות
> אפשר להריץ ישירות ב‑**PowerShell** — `npm run setup` ו‑`npm run preflight`
> רצים דרך Node (לא צריך bash/Git Bash).
> **Mac:** פתח את אפליקציית Docker פעם אחת כדי שהיא תרוץ ברקע.

---

## שלב 1 — להביא את הפרויקט למחשב

אם עוד אין לך את הקוד מקומית:
```bash
git clone <כתובת-הריפו> autonomous-trading-engine
cd autonomous-trading-engine
git checkout claude/epic-planck-Hxelz   # הענף עם כל התיקונים
```
אם כבר יש לך אותו — רק היכנס לתיקייה ומשוך עדכונים:
```bash
cd autonomous-trading-engine
git checkout claude/epic-planck-Hxelz
git pull origin claude/epic-planck-Hxelz
```

---

## שלב 2 — התקנה בפקודה אחת

ודא ש‑Docker Desktop **פתוח ורץ**, ואז:
```bash
npm run setup
```
מה זה עושה (אוטומטית, לא דורס כלום קיים):
1. מתקין תלויות (`npm install`).
2. יוצר `supabase/functions/.env.local` עם `TRADING_MODE=DRY_RUN` וסוד אקראי.
3. מרים Supabase מקומי (Docker) ומריץ מיגרציות.
4. יוצר `.env` לדשבורד עם אותו סוד.
5. מרים את הפונקציות ברקע ופותח את הדשבורד.

בסוף יודפס: פתח **http://localhost:8080**. השאר את הטרמינל הזה פתוח (Ctrl‑C עוצר הכול).

> נתקעת? הלוג של הפונקציות נמצא ב‑`/tmp/ate-functions.log`. שלח לי אותו ואתקן.

---

## שלב 3 — לבדוק שהכול ירוק (לפני מפתחות)

בטרמינל **שני** (באותה תיקייה):
```bash
npm run preflight
```
זה בודק את רצפת הבטיחות (DRY_RUN, kill switch, התאמת סוד, caps) ומדפיס
`✓ GO` או `✗ NO-GO` עם בדיוק מה לתקן. אם מופיע `✗` — תקן אותו (לרוב: הרצת
`npm run setup` ראשון) והרץ שוב. זה לא משנה כלום — קריאה בלבד.

---

## שלב 4 — מפתח Gate.io נכון ובטוח (חשוב!)

1. היכנס לחשבון Gate.io שלך → **API Management**.
2. אם דלף לך מפתח אי‑פעם — **בטל (Delete) אותו עכשיו**.
3. **צור מפתח חדש (Create API Key)** עם ההרשאות המינימליות בלבד:
   - ✅ **Spot Trade** (מסחר ספוט) + **Read** (קריאה)
   - ❌ **בלי** Withdraw (משיכה)
   - ❌ **בלי** Transfer / Internal Transfer (העברות)
   - ❌ **בלי** Sub‑account / Margin / Futures
4. הפעל **IP restriction** והכנס את כתובת ה‑IP שלך (חפש בגוגל "what is my ip").
5. שמור את ה‑**Key** וה‑**Secret** במקום בטוח לרגע — תכף תדביק אותם בדשבורד.

> למה ככה: מפתח Spot+Read בלי משיכה לא יכול להוציא כסף מהחשבון — גם אם משהו
> משתבש, אף אחד לא יכול למשוך. זו השכבה הכי חשובה.

---

## שלב 5 — להדביק את המפתחות בדשבורד

1. בדפדפן: **http://localhost:8080** → לשונית **Settings**.
2. הדבק **API Key** ו‑**API Secret** → **Save**.
3. המערכת **מאמתת** מול Gate.io, **מצפינה** ושומרת מקומית, ומתחברת.
   (אם האימות נכשל — בדוק שהעתקת נכון ושה‑IP מורשה.)

המפתחות נשמרים מוצפנים ב‑DB המקומי שלך בלבד — לא בקוד, לא ב‑git, לא אצלי.

---

## שלב 6 — להריץ ולצפות (DRY_RUN)

```bash
npm run preflight     # עכשיו אמור להראות GO
```
בדשבורד → לשונית **Autopilot** → הדלק **Autopilot ON** ובחר מצב.
ב‑`TRADING_MODE=DRY_RUN` המערכת "סוחרת בצל" על נתונים אמיתיים ו**לא** שולחת
אף פקודה. ככה אתה רואה מה היא *הייתה* עושה, בלי סיכון.

**עצירה מיידית בכל רגע:** כבה Autopilot, או הגדר `KILL_SWITCH=1` ב‑`.env.local`
והרץ מחדש את שרת הפונקציות.

---

## שלב 7 — מעבר ל‑LIVE (מכוון, רק אחרי בדיקה)

זה הצעד שמסכן כסף אמיתי — עשה אותו רק כשאתה בטוח:
1. הרץ DRY_RUN מספיק זמן וראה שההתנהגות הגיונית.
2. ב‑`supabase/functions/.env.local` שנה `TRADING_MODE=LIVE`.
   (אם הפעלת `REQUIRE_VALIDATION=1`, צריך גם `VALIDATION_PASSED=1` — שער קשיח.)
3. הרץ מחדש את שרת הפונקציות, והרץ שוב `npm run preflight`.
4. התחל **קטן** (caps נמוכים: `MAX_TRADE_USDT`, `MAX_DAILY_LOSS_USDT`).

> כנות: אין edge מובטח. הסוחרים ה"מהירים" הם תוחלת שלילית בגלל עמלות. המנוע
> הראשי הבטוח (orchestrator) + caps נמוכים + התחלה קטנה — זו הדרך השפויה.

---

## אם משהו נכשל

שלח לי אחד מאלה ואתקן מיד:
- הפלט של `npm run preflight`
- הלוג `/tmp/ate-functions.log`
- הודעת השגיאה מהדשבורד (Settings) או מהטרמינל

זה המקום שבו החלק שלי מתחבר לחלק שלך: אתה מריץ — אני מתקן מה שצץ.
