/* Service Worker — كلية طب الأسنان / جامعة ذي قار
 * - يجعل البرنامج المثبَّت يفتح بدون إنترنت
 * - الصفحة: الشبكة أولاً (لتصل التحديثات فوراً) ثم النسخة المخزنة عند الانقطاع
 * - المكتبات الخارجية (Firebase SDK، QR، Excel، الخط): من المخزن أولاً
 * - لا يلمس بيانات قاعدة البيانات ولا تسجيل الدخول أبداً
 * غيّر رقم الإصدار عند كل تحديث للملفات
 */
const VERSION = 'dental-v2.0.1';
const CORE = VERSION + '-core';
const LIBS = VERSION + '-libs';

const CORE_ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  './icon-maskable-192.png',
  './icon-maskable-512.png',
  './apple-touch-icon.png'
];

// مكتبات تُخزَّن مسبقاً حتى يعمل البرنامج من أول فتح بدون إنترنت
const LIB_ASSETS = [
  'https://www.gstatic.com/firebasejs/9.23.0/firebase-app-compat.js',
  'https://www.gstatic.com/firebasejs/9.23.0/firebase-database-compat.js',
  'https://www.gstatic.com/firebasejs/9.23.0/firebase-auth-compat.js',
  'https://cdn.jsdelivr.net/npm/xlsx-js-style@1.2.0/dist/xlsx.bundle.js',
  'https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.js',
  'https://cdn.jsdelivr.net/npm/qrcodejs@1.0.0/qrcode.min.js'
];

// نطاقات المكتبات والخطوط المسموح تخزينها
const LIB_HOSTS = ['www.gstatic.com', 'cdn.jsdelivr.net', 'cdnjs.cloudflare.com', 'fonts.googleapis.com', 'fonts.gstatic.com'];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil((async () => {
    const core = await caches.open(CORE);
    await core.addAll(CORE_ASSETS).catch((e) => console.warn('[SW] core cache:', e));
    const libs = await caches.open(LIBS);
    // no-cors لأن الوسوم <script> تطلبها بدون CORS — كل ملف على حدة حتى لا يُفشل أحدها الباقي
    await Promise.all(LIB_ASSETS.map((u) =>
      fetch(new Request(u, { mode: 'no-cors' })).then((r) => libs.put(u, r)).catch(() => {})
    ));
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== CORE && k !== LIBS).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // بيانات Firebase وتسجيل الدخول: لا تخزين إطلاقاً
  if (url.hostname.endsWith('firebaseio.com') || url.hostname.endsWith('firebasedatabase.app') ||
      url.hostname.includes('identitytoolkit') || url.hostname.includes('securetoken') ||
      url.protocol === 'chrome-extension:') return;

  // الصفحة نفسها: الشبكة أولاً ثم المخزن
  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const res = await fetch(req);
        if (res && res.ok) {
          const c = await caches.open(CORE);
          c.put('./index.html', res.clone());
        }
        return res;
      } catch (e) {
        return (await caches.match(req, { ignoreSearch: true })) ||
               (await caches.match('./index.html')) ||
               (await caches.match('./'));
      }
    })());
    return;
  }

  // المكتبات والخطوط الخارجية: المخزن أولاً
  if (LIB_HOSTS.includes(url.hostname)) {
    event.respondWith((async () => {
      const cached = await caches.match(req);
      if (cached) return cached;
      try {
        const res = await fetch(req);
        if (res && (res.ok || res.type === 'opaque')) {
          const c = await caches.open(LIBS);
          c.put(req, res.clone());
        }
        return res;
      } catch (e) {
        return cached || Response.error();
      }
    })());
    return;
  }

  // manifest.json: الشبكة دائماً حتى تصل أي تغييرات على هوية التطبيق فوراً
  if (url.origin === self.location.origin && url.pathname.endsWith('/manifest.json')) {
    event.respondWith(fetch(req).catch(() => caches.match(req)));
    return;
  }

  // ملفات الموقع نفسه (الأيقونات): المخزن أولاً مع تحديث في الخلفية
  if (url.origin === self.location.origin) {
    event.respondWith((async () => {
      const cached = await caches.match(req);
      const net = fetch(req).then((res) => {
        if (res && res.ok) { const copy = res.clone(); caches.open(CORE).then((c) => c.put(req, copy)); }
        return res;
      }).catch(() => cached);
      return cached || net;
    })());
  }
});
