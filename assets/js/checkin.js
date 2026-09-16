'use strict';

(function () {
  // --- STATUS UTAMA: Cek dan render status sesi absensi ---

  function $(s) { return document.querySelector(s); }

  function showError(msg) {
    $('#loading').style.display = 'none';
    $('#contentArea').style.display = 'none';
    $('#errorBox').style.display = 'block';
    $('#errorMessage').textContent = msg;
  }

  function renderStatus(result) {
    $('#loading').style.display = 'none';
    $('#errorBox').style.display = 'none';
    $('#contentArea').style.display = 'block';

    var badge = $('#statusBadge');
    var isActive = result.active;
    var manualOverride = result.manual_override;
    var scheduledStarts = result.scheduled_starts_at;
    var scheduledEnds = result.scheduled_ends_at;
    var serverTime = result.server_time;

    // Badge status
    badge.textContent = isActive ? 'Sesi Absensi: AKTIF' : 'Sesi Absensi: NONAKTIF';
    badge.className = 'session-status ' + (isActive ? 'status-active' : 'status-inactive');

    // Info box detail
    var infoBox = $('#infoBox');
    if (scheduledStarts && scheduledEnds) {
      infoBox.style.display = 'block';
      $('#infoStatus').textContent = isActive ? 'AKTIF' : 'NONAKTIF';
      $('#infoSchedule').textContent = scheduledStarts + ' - ' + scheduledEnds;
      $('#infoTime').textContent = serverTime || '-';
    } else {
      infoBox.style.display = 'none';
    }

    // Section aktif / nonaktif
    if (isActive) {
      $('#activeSection').style.display = 'block';
      $('#inactiveSection').style.display = 'none';
    } else {
      $('#activeSection').style.display = 'none';
      $('#inactiveSection').style.display = 'block';
    }
  }

  async function checkAndRender() {
    $('#loading').style.display = 'block';
    $('#contentArea').style.display = 'none';
    $('#errorBox').style.display = 'none';

    try {
      // Tunggu sampai library & client siap (menghindari gagal pada percobaan pertama)
      var siap = await window.SBPag.ready();

      // Cek status session dari server (backend = sumber kebenaran)
      var result = await window.SBPag.getSessionStatus();

      if (result.error && result.fallback) {
        // Konfigurasi belum diisi, atau koneksi backend gagal
        if (!siap) {
          showError('Backend belum dikonfigurasi. Silakan lengkapi URL + anon key di supabase-config.js lalu jalankan supabase/setup.sql di dashboard Supabase.');
        } else {
          showError('Gagal menghubungi server. Periksa koneksi internet lalu coba lagi.');
        }
        return;
      }

      if (result.error && result.fallbackCompute) {
        // RPC gagal (tabel belum dibuat atau permission), tampilkan pesan
        showError('Gagal memeriksa status absensi. Pastikan tabel + fungsi get_session_status() sudah di-setup di Supabase (lihat supabase/setup.sql).');
        return;
      }

      if (result.error) {
        showError('Gagal memeriksa status: ' + (result.error || 'Kesalahan tidak diketahui'));
        return;
      }

      renderStatus(result);
    } catch (err) {
      console.error('[CHECKIN] Exception:', err);
      showError('Gagal memeriksa status: ' + (err.message || 'Kesalahan koneksi'));
    }
  }

  // --- EVENT LISTENERS ---

  document.addEventListener('DOMContentLoaded', function () {
    if (!window.SBPag) {
      console.error('[CHECKIN] SBPag tidak tersedia — cek supabase-client.js');
      showError('Klien backend tidak tersedia.');
      return;
    }

    window.SBPag.init();
    checkAndRender();

    // Tombol lanjut (aktif) -> ke proses login siswa (bagian D)
    var btnLanjut = $('#btnLanjut');
    if (btnLanjut) {
      btnLanjut.addEventListener('click', function () {
        window.location.href = './login.html';
      });
    }

    // Tombol refresh / retry
    ['btnRefresh', 'btnRetry'].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.addEventListener('click', checkAndRender);
    });
  });

})();