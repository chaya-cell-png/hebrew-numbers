# מקריאים מספרים

כלי קטן להקראת מספרים בעברית למיקרופון, המרה אוטומטית למספרים והפקה ל-Excel.
רץ כולו בדפדפן (Chrome / Edge), בלי שרת ובלי מסד נתונים.

## הרצה מקומית

```bash
python -m http.server 8765
```

ואז לפתוח `http://localhost:8765` ב-Chrome או ב-Edge ולאשר גישה למיקרופון.
(המיקרופון עובד רק ב-`localhost` או ב-HTTPS.)

## מבנה

| קובץ | תפקיד |
|---|---|
| `index.html`, `app.js`, `style.css` | הכלי עצמו: הקראה, טבלה, רשימות שמורות, ייצוא |
| `parser.js` | המרת טקסט עברי ("מאתיים חמישים וארבעה אלף…") למספרים |
| `assembler.js` | חיבור מקטעים למספר באורך קבוע (ברירת מחדל 6 ספרות) |
| `speech.js` | האזנה רציפה דרך Web Speech API (he-IL) |
| `xlsx.js` | כתיבת קובץ XLSX בלי תלויות |
| `lab.html`, `lab.js` | דף בדיקות לאיכות הזיהוי, עם יומן וייצוא JSON |

## בדיקות

```bash
node test/parser.test.js
node test/assembler.test.js
node test/xlsx.test.js
```

## אחסון

הנתונים נשמרים ב-localStorage של הדפדפן, לפי כתובת האתר. הגיבוי הקבוע הוא קובץ ה-Excel.
