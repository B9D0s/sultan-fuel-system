// Service Worker - طاقات السلطان
const STATIC_CACHE = 'sultan-fuel-static-v3';
const RUNTIME_CACHE = 'sultan-fuel-runtime-v3';

const urlsToCache = [
  '/',
  '/index.html',
  '/offline.html',
  '/css/style.css',
  '/js/api.js',
  '/js/app.js',
  '/manifest.json',
  '/icons/icon-192.png',
  '/icons/icon-512.png'
];

// تثبيت Service Worker
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE)
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
          if (![STATIC_CACHE, RUNTIME_CACHE].includes(cacheName) && cacheName.startsWith('sultan-fuel-')) {
            console.log('حذف كاش قديم:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
  self.clients.claim();
});

// دعم تحديث فوري عند وجود إصدار جديد
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

function isSameOrigin(url) {
  try {
    return new URL(url).origin === self.location.origin;
  } catch (e) {
    return false;
  }
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(STATIC_CACHE);
  const cached = await cache.match(request);
  const fetchPromise = fetch(request)
    .then((response) => {
      if (response && response.status === 200 && isSameOrigin(request.url)) {
        cache.put(request, response.clone());
      }
      return response;
    })
    .catch(() => null);
  return cached || (await fetchPromise) || cached;
}

async function networkFirst(request) {
  const cache = await caches.open(RUNTIME_CACHE);
  try {
    const response = await fetch(request);
    if (response && response.status === 200 && isSameOrigin(request.url)) {
      cache.put(request, response.clone());
    }
    return response;
  } catch (e) {
    const cached = await cache.match(request);
    if (cached) return cached;
    return null;
  }
}

// استراتيجية محسّنة مع fallback
self.addEventListener('fetch', (event) => {
  // تجاهل طلبات غير HTTP/HTTPS
  if (!event.request.url.startsWith('http')) {
    return;
  }

  // تجاهل غير GET
  if (event.request.method && event.request.method !== 'GET') {
    return;
  }

  // تجاهل طلبات API
  if (event.request.url.includes('/api/')) {
    return;
  }

  // تجاهل طلبات OneSignal
  if (event.request.url.includes('onesignal.com')) {
    return;
  }

  // تجاهل طلبات chrome-extension
  if (event.request.url.startsWith('chrome-extension://')) {
    return;
  }

  const reqUrl = new URL(event.request.url);
  const isAsset =
    reqUrl.pathname.startsWith('/css/') ||
    reqUrl.pathname.startsWith('/js/') ||
    reqUrl.pathname.startsWith('/icons/') ||
    reqUrl.pathname === '/manifest.json' ||
    ['style', 'script', 'image', 'font'].includes(event.request.destination);

  // تنقل الصفحات: Network First + offline fallback
  if (event.request.mode === 'navigate') {
    event.respondWith((async () => {
      const net = await networkFirst(event.request);
      if (net) return net;
      const cached = await caches.match('/offline.html');
      return cached || (await caches.match('/index.html'));
    })());
    return;
  }

  // الأصول: Stale-While-Revalidate لسرعة + تحديث تدريجي
  if (isAsset && isSameOrigin(event.request.url)) {
    event.respondWith(staleWhileRevalidate(event.request));
    return;
  }

  // باقي الطلبات من نفس الأصل: Network First مع fallback للكاش
  if (isSameOrigin(event.request.url)) {
    event.respondWith((async () => {
      const net = await networkFirst(event.request);
      if (net) return net;
      return caches.match(event.request);
    })());
  }
});

// استقبال الإشعارات
self.addEventListener('push', (event) => {
  let data = { title: 'طاقات السلطان', body: 'إشعار جديد' };

  if (event.data) {
    try {
      data = event.data.json();
    } catch (e) {
      data.body = event.data.text();
    }
  }

  const options = {
    body: data.body || data.message || 'إشعار جديد',
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-72.png',
    vibrate: [100, 50, 100],
    dir: 'rtl',
    lang: 'ar',
    data: {
      dateOfArrival: Date.now(),
      url: data.url || '/'
    }
  };

  event.waitUntil(
    self.registration.showNotification(data.title || 'طاقات السلطان', options)
  );
});

// التعامل مع النقر على الإشعار
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  event.waitUntil(
    clients.openWindow(event.notification.data.url || '/')
  );
});
