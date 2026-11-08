// 通信がなくても開けるようにするための仕組み
const CACHE = 'app-12d92a-e8fbec43d9';
const SHELL = ['./', './index.html', './manifest.webmanifest', './icon-180.png', './icon-192.png', './icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  // ページ本体：通信できれば最新を取り、できなければ保存した分を出す
  if (req.mode === 'navigate') {
    e.respondWith(fetch(req.url, { cache: 'no-cache' }).then(res => { const copy = res.clone(); caches.open(CACHE).then(c => c.put('./index.html', copy)); return res; }).catch(() => caches.match('./index.html')));
    return;
  }
  // 文字のデータとアイコン：保存した分を先に使う
  if (url.origin === location.origin || url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    e.respondWith(caches.match(req).then(hit => hit || fetch(req).then(res => {
      const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); return res;
    }).catch(() => Response.error())));
  }
});

// ---- ここから push-sw.js ----
// 復習の通知を受け取って出す（build_pwa.py の --sw-extra で sw.js の最後に足す）
// サーバーからは中身なしの通知が届く。語数は、アプリが IndexedDB に書いた復習の予定から数える。

function pwGetDue() {
  return new Promise(resolve => {
    try {
      const r = indexedDB.open('parts-wordbook', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('kv');
      r.onsuccess = () => {
        const db = r.result;
        try {
          const q = db.transaction('kv').objectStore('kv').get('due');
          q.onsuccess = () => { db.close(); resolve(Array.isArray(q.result) ? q.result : null); };
          q.onerror = () => { db.close(); resolve(null); };
        } catch (e) { db.close(); resolve(null); }
      };
      r.onerror = () => resolve(null);
    } catch (e) { resolve(null); }
  });
}

self.addEventListener('push', e => {
  e.waitUntil((async () => {
    const due = await pwGetDue();
    const end = new Date(); end.setHours(23, 59, 59, 999);
    const n = due ? due.filter(t => typeof t === 'number' && t <= end.getTime()).length : 0;
    const body = n > 0 ? `今日の復習が ${n}語あります。` : '今日の復習の時間です。';
    // iPhone は、届いた通知を必ず画面に出さないと、通知を止めてしまう。語数が0でも出す
    await self.registration.showNotification('パーツで覚える英単語', {
      body, icon: 'icon-192.png', tag: 'review', data: { url: self.registration.scope },
    });
    try { if (n > 0 && self.navigator.setAppBadge) await self.navigator.setAppBadge(n); } catch (x) {}
  })());
});

// 通知を押したら、単語帳を開く（開いていればそれを前に出す）
self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil((async () => {
    const list = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of list) {
      if ('focus' in c) { try { await c.focus(); return; } catch (x) {} }
    }
    if (self.clients.openWindow) await self.clients.openWindow(self.registration.scope);
  })());
});
