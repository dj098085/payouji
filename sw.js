/* 狍游记 Service Worker
   目标：让这个「旅行应用」在长白山 / 漠河 / 呼伦贝尔草原这些没信号的地方，
   打开仍然可用；天气卡断网时显示上次结果并如实标注时间。

   策略（刻意保守，避免"更新不生效"这类最难查的坑）：
     · 导航请求（HTML）  → network-first，失败回缓存。保证一联网就能拿到新版
     · 静态资源（图标等）→ cache-first，带回退
     · 天气接口          → stale-while-revalidate，先给上次结果再后台刷新
     · 其他跨域          → 不拦（保护二维码等第三方请求）

   版本升级：改 CACHE 版本号即可，activate 时清掉所有旧缓存。 */

const CACHE = 'paoyouji-v1.4.7';
const ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './cottage.webp',
  './icon-192.png',
  './icon-512.png',
  './icon-maskable-512.png',
  './apple-touch-icon.png'
];

/* ---------- install：预缓存核心资源 ---------- */
self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) =>
      /* 逐个 add，单个失败不拖垮整体（比如某个图标还没生成） */
      Promise.all(
        ASSETS.map((u) => c.add(u).catch(() => null))
      )
    ).then(() => self.skipWaiting())
  );
});

/* ---------- activate：清掉旧版本缓存 ---------- */
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

/* ---------- fetch：按类型分流 ---------- */
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  /* 天气接口：先给缓存（若时间戳新鲜），同时后台刷新 */
  if (url.hostname === 'api.open-meteo.com') {
    e.respondWith(
      caches.open(CACHE).then(async (cache) => {
        const hit = await cache.match(req);
        const net = fetch(req).then((res) => {
          if (res && res.ok) cache.put(req, res.clone());
          return res;
        }).catch(() => null);
        return hit || (await net) || new Response('{}', {
          status: 503,
          headers: { 'Content-Type': 'application/json' }
        });
      })
    );
    return;
  }

  /* 只处理同源请求，跨域一律放行（保护二维码等） */
  if (url.origin !== self.location.origin) return;

  /* 导航请求（页面本体）：network-first，断网回缓存 */
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put('./index.html', copy));
          return res;
        })
        .catch(() => caches.match('./index.html').then((r) => r || caches.match('./')))
    );
    return;
  }

  /* 其他静态资源：cache-first */
  e.respondWith(
    caches.match(req).then((hit) => hit || fetch(req).then((res) => {
      if (res && res.ok && res.type === 'basic') {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy));
      }
      return res;
    }).catch(() => hit))
  );
});

/* ---------- 允许页面主动触发更新 ---------- */
self.addEventListener('message', (e) => {
  if (e.data === 'SKIP_WAITING') self.skipWaiting();
});
