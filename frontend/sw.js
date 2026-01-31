// Service Worker - طاقات السلطان
// ملاحظة: OneSignal يستخدم Service Worker خاص به (OneSignalSDKWorker.js)
// هذا الملف للتخزين المؤقت فقط

const CACHE_NAME = 'sultan-fuel-v2';
const urlsToCache = [
  '/',
  '/index.html',
  '/css/style.css',
  '/js/api.js',
  '/js/app.js',
  '/manifest.json',
  'https://fonts.googleapis.com/css2?family=Tajawal:wght@400;500;700;800&display=swap',
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css'
];

// تثبيت Service Worker
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log('فتح الكاش');
        return cache.addAll(urlsToCache);
      })
      .catch((err) => {
        console.log('خطأ في الكاش:', err);
      })
  );
  self.skipWaiting();
});

// تفعيل Service Worker
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME) {
            console.log('حذف كاش قديم:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
  self.clients.claim();
});

// استراتيجية Network First مع Fallback للكاش
self.addEventListener('fetch', (event) => {
  // تجاهل طلبات API
  if (event.request.url.includes('/api/')) {
    return;
  }

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        // نسخ الاستجابة للكاش
        if (response.status === 200) {
          const responseClone = response.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseClone);
          });
        }
        return response;
      })
      .catch(() => {
        // إذا فشل الاتصال، جرب الكاش
        return caches.match(event.request).then((response) => {
          if (response) {
            return response;
          }
          // صفحة offline افتراضية
          if (event.request.mode === 'navigate') {
            return caches.match('/index.html');
          }
        });
      })
  );
});

// ملاحظة: الإشعارات تتم معالجتها بواسطة OneSignal Service Worker
// هذا الكود للتوافق مع الإصدارات القديمة فقط
