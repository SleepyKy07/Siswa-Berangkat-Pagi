'use strict';

/* ================================================================
   GERBANG SCAN QR (/checkin/)
   ----------------------------------------------------------------
   - Sesi AKTIF    -> langsung pindah ke form pengisian nama (login.html)
   - Sesi NONAKTIF -> tampilkan tulisan besar + jadwal (tanpa tombol)
   - Error         -> pesan jelas + tombol "Coba Lagi" (hindari layar putih)
   ================================================================ */

(function () {
  var MAX_AUTO_RETRY = 2; // percobaan otomatis tambahan bila gagal

  function $(s) { return document.querySelector(s); }

  function show(el) { if (el) el.style.display = 'block'; }
  function hide(el) { if (el) el.style.display = 'none'; }

  function showLoading() {
    show($('#loading'));
    hide($('#inactiveScreen'));
    hide($('#errorBox'));
  }

  function showError(msg) {
    hide($('#loading'));
    hide($('#inactiveScreen'));
    $('#errorMessage').textContent = msg;
    show($('#errorBox'));
  }

  function showInactive(result) {
    hide($('#loading'));
    hide($('#errorBox'));

    var mulai = result && result.scheduled_starts_at;
    var selesai = result && result.scheduled_ends_at;

    if (mulai && selesai) {
      $('#scheduleValue').textContent = mulai + ' – ' + selesai;
      $('#scheduleWrap').style.display = 'block';

      var note = $('#scheduleNote');
      if (result.manual_override === 'NONAKTIF') {
        note.textContent = 'Sesi dinonaktifkan sementara oleh petugas. Silakan coba lagi nanti.';
      } else {
        note.textContent = 'Silakan kembali pada jam tersebut untuk melakukan absensi.';
      }
    } else {
      $('#scheduleWrap').style.display = 'none';
    }

    show($('#inactiveScreen'));
  }

  // Sesi aktif -> LANGSUNG ke form pengisian nama.
  // Pakai replace() supaya tombol "back" HP tidak kembali ke halaman ini.
  function goToForm() {
    window.location.replace('./login.html');
  }

  function handleStatus(result, siap) {
    // Konfigurasi backend belum diisi / gagal memuat library
    if (result.error && result.fallback) {
      if (!siap) {
        showError('Backend belum dikonfigurasi. Lengkapi URL + anon key di supabase-config.js lalu jalankan supabase/setup.sql.');
      } else {
        showError('Gagal menghubungi server. Periksa koneksi internet lalu coba lagi.');
      }
      return;
    }

    // RPC gagal (tabel/fungsi belum dibuat)
    if (result.error && result.fallbackCompute) {
      showError('Fungsi get_session_status() belum tersedia. Jalankan supabase/setup.sql di Supabase SQL Editor.');
      return;
    }

    if (result.error) {
      showError('Gagal memeriksa status: ' + (result.error || 'Kesalahan tidak diketahui'));
      return;
    }

    if (result.active) {
      goToForm();
    } else {
      showInactive(result);
    }
  }

  async function checkAndRender(attempt) {
    attempt = attempt || 0;
    showLoading();

    try {
      // Tunggu library & client siap (menghindari gagal pada percobaan pertama)
      var siap = await window.SBPag.ready();
      var result = await window.SBPag.getSessionStatus();

      // Kalau gagal dan masih ada jatah retry, coba lagi otomatis
      if (result.error && attempt < MAX_AUTO_RETRY) {
        // Coba lagi otomatis setelah jeda singkat
        setTimeout(function () { checkAndRender(attempt + 1); }, 900 * (attempt + 1));
        return;
      }

      handleStatus(result, siap);
    } catch (err) {
      console.error('[CHECKIN] Exception:', err);
      if (attempt < MAX_AUTO_RETRY) {
        setTimeout(function () { checkAndRender(attempt + 1); }, 900 * (attempt + 1));
        return;
      }
      showError('Gagal memeriksa status: ' + (err.message || 'Kesalahan koneksi'));
    }
  }

  document.addEventListener('DOMContentLoaded', function () {
    if (!window.SBPag) {
      console.error('[CHECKIN] SBPag tidak tersedia — cek supabase-client.js');
      showError('Klien backend tidak tersedia. Muat ulang halaman.');
      return;
    }

    window.SBPag.init();
    checkAndRender(0);

    var btnRetry = $('#btnRetry');
    if (btnRetry) {
      btnRetry.addEventListener('click', function () { checkAndRender(0); });
    }
  });

})();
