/* ================================================================
   SERVICE WORKER — Portal Program Kerja OSIS
   ================================================================
   Tujuan: membuat portal bisa "dipasang" sebagai aplikasi (PWA)
   dan tetap terbuka meski koneksi sedang buruk.

   Strategi:
   - Aset statis (HTML/CSS/JS/gambar lokal): cache-first, lalu
     perbarui di latar belakang (stale-while-revalidate).
   - Permintaan ke Supabase / CDN pihak ketiga: langsung ke jaringan
     (tidak di-cache) supaya data absensi selalu yang terbaru.
   - Saat offline & tidak ada cache: pakai halaman portal cache-an
     sebagai fallback navigasi.

   Ubah CACHE_VERSION bila ingin memaksa semua klien mengambil
   aset terbaru (mis. setelah mengganti CSS/JS besar).
   ================================================================ */

'use strict';

var CACHE_VERSION = 'sbp-portal-v1';

// Aset inti (app-shell) yang di-cache saat install.
var APP_SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './assets/css/portal.css',
  './assets/js/supabase-config.js',
  './assets/js/supabase-client.js',
  './assets/js/portal.js',
  './assets/images/logo-osis.png',
  './assets/images/logo-sekolah.png'
];

// Install: cache app-shell.
self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE_VERSION).then(function (cache) {
      // addAll gagal bila ada satu 404 — pakai loop agar toleran.
      return Promise.all(
        APP_SHELL.map(function (url) {
          return cache.add(new Request(url, { cache: 'reload' })).catch(function () { /* lewati yang gagal */ });
        })
      );
    }).then(function () { return self.skipWaiting(); })
  );
});

// Activate: bersihkan cache versi lama.
self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(
        keys.map(function (k) {
          if (k !== CACHE_VERSION) return caches.delete(k);
        })
      );
    }).then(function () { return self.clients.claim(); })
  );
});

// Fetch: aset lokal pakai cache-first; pihak ketiga langsung jaringan.
self.addEventListener('fetch', function (event) {
  var req = event.request;

  // Hanya tangani GET.
  if (req.method !== 'GET') return;

  var url = new URL(req.url);

  // Permintaan ke luar origin (Supabase, CDN) → langsung jaringan.
  if (url.origin !== self.location.origin) return;

  // Navigasi halaman: fallback ke index.html cache-an bila offline.
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req).catch(function () {
        return caches.match('./index.html').then(function (r) {
          return r || caches.match('./');
        });
      })
    );
    return;
  }

  // Aset lokal lain: stale-while-revalidate.
  event.respondWith(
    caches.match(req).then(function (cached) {
      var network = fetch(req).then(function (res) {
        if (res && res.status === 200 && res.type === 'basic') {
          var copy = res.clone();
          caches.open(CACHE_VERSION).then(function (cache) { cache.put(req, copy); });
        }
        return res;
      }).catch(function () { return cached; });
      return cached || network;
    })
  );
});
