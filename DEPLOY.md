# نشر على Render (GitHub)

## ⚠️ مهم قبل الرفع

**لا ترفع على Render إلا بعد:**
1. تشغيل المشروع محلياً (`npm start`) والتأكد أن كل شيء يعمل.
2. اختبار الصفحات والأزرار والإشعارات (راجع TEST-CHECKLIST.md).
3. الموافقة على النشر بعد المراجعة.

---

## إعدادات Render

المشروع يستخدم `render.yaml` (Blueprint). عند ربط الـ Repository بـ Render:

- **Build Command:** `cd backend && npm install`
- **Start Command:** `cd backend && npm start`
- **Root Directory:** (اتركه فارغاً – الجذر يحتوي على `backend/` و `frontend/`)

السيرفر يخدم:
- الـ API من `/api/*`
- الملفات الثابتة (Frontend) من مجلد `frontend/`

---

## متغيرات البيئة (Environment Variables) في Render

يجب تعيينها يدوياً من لوحة Render:

| المتغير | مطلوب للنشر | الوصف |
|---------|--------------|--------|
| `NODE_ENV` | نعم | `production` (غالباً مضبوط من الـ Blueprint) |
| `TURSO_DATABASE_URL` | نعم (للإنتاج) | رابط قاعدة Turso (للاستخدام السحابي) |
| `TURSO_AUTH_TOKEN` | نعم (للإنتاج) | توكن Turso |
| `ONESIGNAL_APP_ID` | اختياري | لتفعيل إشعارات Push (OneSignal) |
| `ONESIGNAL_API_KEY` | اختياري | مفتاح API لـ OneSignal |

**ملاحظة:** بدون `TURSO_*` السيرفر يستخدم SQLite محلياً (ملف داخل الحاوية)، والبيانات قد تُفقد عند إعادة النشر. للإنتاج المستقر استخدم Turso.

---

## الإشعارات (محلياً و على Render)

- **داخل التطبيق (لوحة الإشعارات):** تعمل دائماً – تُخزّن في جدول `notifications` وتُعرض عند فتح زر الجرس.
- **Push (OneSignal):** تحتاج `ONESIGNAL_APP_ID` و `ONESIGNAL_API_KEY` في الـ Backend، وتهيئة OneSignal في الـ Frontend (موجودة في `index.html`). بدونها الـ Push لا يعمل لكن لوحة الإشعارات تبقى تعمل.

---

## مراجعة الأكواد قبل النشر

- [ ] تشغيل لوكال ومرور على TEST-CHECKLIST.md
- [ ] التأكد من عدم وجود أخطاء في Console (F12)
- [ ] التأكد من عمل الإشعارات (الجرس + العدد)
- [ ] الموافقة على الرفع ثم ربط الـ Repo بـ Render وضبط المتغيرات أعلاه
