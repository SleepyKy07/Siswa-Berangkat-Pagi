/* ================================================================
   SUPABASE CLIENT
   ================================================================
   Helper untuk sistem Siswa Berangkat Pagi.
   Semua operasi data lewat modul ini — status/sesi TIDAK pernah
   disimpan di localStorage.

   REVISI: identitas check-in tidak lagi memakai NIS.
   Yang dipakai: nama (dipilih dari daftar), kelas (dari database),
   selfie, dan timestamp server. Frontend tidak pernah menerima NIS.

   Didaftarkan sebagai global `window.SBPag`, dimuat lewat <script src>
   biasa. JANGAN menambahkan `export` di file ini — file yang memakai
   `export` hanya bisa dimuat sebagai module dan akan gagal bila dipanggil
   dengan <script> biasa.
   ================================================================ */

'use strict';

var SBPag = (function () {
  var cfg = window.SUPABASE_CONFIG || {};
  var supa = window.supabase;

  // Initialize Supabase client
  function init() {
    // Periksa apakah konfigurasi penuh
    if (!cfg.url || cfg.url.indexOf('YOUR-PROJECT') > -1) {
      console.warn('[SB] SUPABASE CONFIG BELUM DIISI — paste URL + anonKey di assets/js/supabase-config.js');
      return false;
    }

    if (!supa) {
      // Coba ambil supabase-js dari CDN jika belum ada
      var s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2';
      s.async = false;
      s.onload = function () {
        supa = window.supabase;
        if (init()) console.log('[SB] Supabase client initialized');
      };
      document.head.appendChild(s);
      return false; // inisialisasi async, dipanggil lagi di load
    }

    if (!window.__sb) {
      window.__sb = supa.createClient(cfg.url, cfg.anonKey);
      console.log('[SB] Supabase client initialized:', cfg.url);
    }
    return true;
  }

  // --- SESSION STATUS (inti QR permanen) ---

  /**
   * Status sesi absensi dari server (fungsi Postgres get_session_status()).
   * Returns: { active, manual_override, scheduled_starts_at,
   *            scheduled_ends_at, server_time }
   */
  async function getSessionStatus() {
    if (!init()) return { error: 'BACKEND_BELUM_KONFIGURASI', fallback: true };

    try {
      var res = await window.__sb.rpc('get_session_status');
      if (res.error) {
        console.error('[SB] RPC error:', res.error);
        return { error: 'RPC_FAILED', fallbackCompute: true };
      }
      return res.data || { active: false };
    } catch (err) {
      console.error('[SB] Exception:', err);
      return { error: 'EXCEPTION', fallback: true };
    }
  }

  /**
   * Tanggal hari ini menurut SERVER (bukan jam device siswa).
   * Fallback ke jam device hanya bila RPC gagal, agar dashboard tidak kosong.
   */
  async function getServerDate() {
    try {
      var status = await getSessionStatus();
      if (status && status.server_time) {
        // server_time format: 'YYYY-MM-DD HH24:MI:SS'
        return String(status.server_time).slice(0, 10);
      }
    } catch (err) {
      console.error('[SB] getServerDate exception:', err);
    }
    // Fallback: jam device
    var d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  // --- PENCARIAN SISWA (TANPA NIS) ---

  /**
   * Cari siswa berdasarkan NAMA (case-insensitive).
   * Hanya mengembalikan { id, nama, kelas } — tanpa NIS.
   * @param {string} q - kata kunci nama (boleh kosong untuk 25 pertama)
   * @returns {Promise<Object>} { students: Array, error }
   */
  async function findStudentsByName(q) {
    if (!init()) return { error: 'BACKEND_BELUM_KONFIGURASI', students: [] };

    try {
      var res = await window.__sb.rpc('find_students', { p_q: q || '' });
      if (res.error) {
        console.error('[SB] find_students error:', res.error);
        return { error: 'PENCARIAN_GAGAL', detail: res.error.message, students: [] };
      }
      return { students: res.data || [], error: null };
    } catch (err) {
      console.error('[SB] findStudentsByName exception:', err);
      return { error: 'EXCEPTION', detail: err.message, students: [] };
    }
  }

  /**
   * Ambil identitas publik siswa (nama + kelas) dari id internal.
   * Dipakai untuk menampilkan kelas otomatis setelah nama dipilih.
   * @param {number|string} id
   * @returns {Promise<Object>} { student: {id, nama, kelas} | null, error }
   */
  async function getStudentPublic(id) {
    if (!init()) return { error: 'BACKEND_BELUM_KONFIGURASI' };

    try {
      var res = await window.__sb.rpc('get_student_public', { p_id: id });
      if (res.error) {
        return { error: 'GAGAL_AMBIL_SISWA', detail: res.error.message };
      }
      if (!res.data) return { error: 'SISWA_TIDAK_DITEMUKAN' };
      return { student: res.data, error: null };
    } catch (err) {
      console.error('[SB] getStudentPublic exception:', err);
      return { error: 'EXCEPTION', detail: err.message };
    }
  }

  // --- SESSION ADMIN OVERRIDES ---

  /** Admin: nonaktifkan sesi absensi (override manual). */
  async function setSessionInactive(reason) {
    if (!init()) return { error: 'BACKEND_BELUM_KONFIGURASI' };
    try {
      var res = await window.__sb
        .from('sessions')
        .update({ manual_override: 'NONAKTIF', override_reason: reason, updated_at: new Date() })
        .eq('id', 1);
      if (res.error) return { error: 'GAGAL_NONAKTIFKAN', detail: res.error.message };
      return { success: true, data: res.data };
    } catch (err) {
      console.error('[SB] setSessionInactive exception:', err);
      return { error: 'EXCEPTION', detail: err.message };
    }
  }

  /** Admin: aktifkan sesi absensi (override manual). */
  async function setSessionActive(reason) {
    if (!init()) return { error: 'BACKEND_BELUM_KONFIGURASI' };
    try {
      var res = await window.__sb
        .from('sessions')
        .update({ manual_override: 'AKTIF', override_reason: reason, updated_at: new Date() })
        .eq('id', 1);
      if (res.error) return { error: 'GAGAL_AKTIFKAN', detail: res.error.message };
      return { success: true, data: res.data };
    } catch (err) {
      console.error('[SB] setSessionActive exception:', err);
      return { error: 'EXCEPTION', detail: err.message };
    }
  }

  // --- SCHEDULE ---

  /** Admin: set jam mulai & selesai auto-schedule ("HH:MM"). */
  async function setSchedule(starts, ends) {
    if (!init()) return { error: 'BACKEND_BELUM_KONFIGURASI' };

    // Jika dipanggil kosong -> hapus override manual
    if (!starts && !ends) {
      try {
        var clr = await window.__sb
          .from('sessions')
          .update({ manual_override: null, updated_at: new Date() })
          .eq('id', 1);
        if (clr.error) return { error: 'GAGAL_HAPUS_OVERRIDE', detail: clr.error.message };
        return { success: true, data: clr.data };
      } catch (err) {
        return { error: 'EXCEPTION', detail: err.message };
      }
    }

    var re = /^([01]\d|2[0-3]):([0-5]\d)$/;
    if (!re.test(starts) || !re.test(ends)) {
      return { error: 'INVALID_SCHEDULE_FORMAT' };
    }

    try {
      var res = await window.__sb
        .from('sessions')
        .update({
          scheduled_starts_at: starts + ':00',
          scheduled_ends_at: ends + ':00',
          manual_override: null, // clear manual override when schedule is set
          updated_at: new Date()
        })
        .eq('id', 1);
      if (res.error) return { error: 'GAGAL_SET_SCHEDULE', detail: res.error.message };
      return { success: true, data: res.data };
    } catch (err) {
      console.error('[SB] setSchedule exception:', err);
      return { error: 'EXCEPTION', detail: err.message };
    }
  }

  // --- SELFIE UPLOAD ---

  /**
   * Unggah selfie ke bucket privat 'selfies'.
   * Path: {tanggal}/{student_id}_{jam}.{ext}
   * @param {string} dataUrl - data URL base64
   * @param {number|string} studentId - id internal siswa
   */
  async function uploadSelfie(dataUrl, studentId) {
    if (!init()) return { error: 'BACKEND_BELUM_KONFIGURASI' };

    if (!dataUrl || dataUrl.indexOf('data:image/') !== 0) {
      return { error: 'INVALID_DATA_URL' };
    }

    try {
      var parts = dataUrl.split(',');
      var meta = parts[0];
      var base64 = parts[1] || '';
      var mime = meta.match(/image\/(\w+)/);
      var ext = mime ? mime[1] : 'jpg';

      // Path memakai tanggal server bila tersedia (konsisten dengan checkin_date)
      var dateStr = await getServerDate();
      var now = new Date();
      var timeStr = String(now.getHours()).padStart(2, '0') + String(now.getMinutes()).padStart(2, '0') + String(now.getSeconds()).padStart(2, '0');
      var rand = Math.random().toString(36).slice(2, 7);
      var filePath = dateStr + '/' + studentId + '_' + timeStr + '_' + rand + '.' + ext;

      var res = await window.__sb
        .storage
        .from('selfies')
        .upload(filePath, base64, {
          contentType: 'image/' + ext,
          encoding: 'base64',
          upsert: false
        });

      if (res.error) {
        console.error('[SB] Upload selfie error:', res.error);
        if (res.error.message && res.error.message.indexOf('bucket') > -1) {
          return { error: 'BUCKET_SELFIES_BELUM_BUAT', detail: 'Buat bucket "selfies" di Supabase Storage terlebih dahulu' };
        }
        return { error: 'GAGAL_UPLOAD_SELFIE', detail: res.error.message };
      }

      console.log('[SB] Selfie uploaded:', res.data.path);
      return { success: true, path: res.data.path || filePath };
    } catch (err) {
      console.error('[SB] uploadSelfie exception:', err);
      return { error: 'EXCEPTION', detail: err.message };
    }
  }

  // --- CHECK-IN ---

  /**
   * Catat check-in siswa. Validasi & timestamp dilakukan SERVER
   * lewat RPC submit_checkin().
   * @param {number|string} studentId - id internal siswa (bukan NIS)
   * @param {string} selfieDataUrl - data URL foto selfie (opsional)
   * @returns {Promise<Object>} { success, nama, kelas, timestamp, selfiePath } | { error, detail }
   */
  async function submitCheckIn(studentId, selfieDataUrl) {
    if (!init()) return { error: 'BACKEND_BELUM_KONFIGURASI' };

    // Langkah 1: pastikan sesi AKTIF (server-side)
    var statusResult = await getSessionStatus();
    if (statusResult.error) {
      return { error: 'TIDAK_BISA_CHECKIN_STATUS_ERROR', detail: statusResult.error };
    }
    if (!statusResult.active) {
      return { error: 'ABSENSI_TIDAK_AKTIF', detail: statusResult.manual_override || 'Tidak dalam jadwal' };
    }

    // Langkah 2: validasi siswa (nama + kelas dari server)
    var studentResult = await getStudentPublic(studentId);
    if (studentResult.error) {
      return { error: 'SISWA_TIDAK_DITEMUKAN', detail: studentResult.error };
    }
    var student = studentResult.student;

    // Langkah 3: upload selfie (jika ada). Kegagalan upload tidak memblokir check-in.
    var selfiePath = null;
    if (selfieDataUrl) {
      var uploadResult = await uploadSelfie(selfieDataUrl, student.id);
      if (uploadResult.error) {
        console.warn('[SB] Selfie upload failed:', uploadResult.error);
      } else {
        selfiePath = uploadResult.path;
      }
    }

    // Langkah 4: simpan check-in via RPC (tanggal & jam SERVER, anti-duplikat)
    try {
      var res = await window.__sb.rpc('submit_checkin', {
        p_student_id: student.id,
        p_selfie_path: selfiePath
      });

      if (res.error) return { error: 'GAGAL_SIMPAN_CHECKIN', detail: res.error.message };

      var data = res.data || {};
      if (data.error) {
        // Error logis dari server: ABSENSI_TIDAK_AKTIF / SUDAH_CHECKIN_HARI_INI / SISWA_TIDAK_DITEMUKAN
        return { error: data.error, detail: data.error };
      }

      return {
        success: true,
        student: { id: student.id, nama: student.nama, kelas: student.kelas },
        timestamp: data.timestamp,
        selfiePath: data.selfie_path || selfiePath,
        checkinId: data.checkin_id
      };
    } catch (err) {
      console.error('[SB] submitCheckIn exception:', err);
      return { error: 'EXCEPTION', detail: err.message };
    }
  }

  // --- TODAY CHECK-INS (dashboard admin) ---

  /**
   * Daftar check-in hari ini (tanggal server), urut dari paling pagi.
   * Mengembalikan baris check_ins + relasi students(nama, kelas).
   * TANPA NIS.
   * @returns {Promise<Array>}
   */
  async function getTodayCheckIns() {
    if (!init()) return [];

    var todayStr = await getServerDate();

    try {
      var res = await window.__sb
        .from('check_ins')
        .select(`
          id,
          student_id,
          checked_in_at,
          selfie_path,
          students!inner(nama, kelas)
        `)
        .eq('checkin_date', todayStr)
        .order('checked_in_at', { ascending: true });

      if (res.error) {
        console.error('[SB] getTodayCheckIns error:', res.error);
        return [];
      }
      return res.data || [];
    } catch (err) {
      console.error('[SB] getTodayCheckIns exception:', err);
      return [];
    }
  }

  // --- EARLIEST CHECK-IN (Siswa paling pagi) ---

  /**
   * Check-in terawal hari ini = "Siswa Paling Pagi".
   * Semua check-in tetap tersimpan; ini hanya menandai yang terawal.
   * @returns {Promise<Object>} { student:{nama,kelas}, timestamp } | null
   */
  async function getEarliestCheckInToday() {
    var checkIns = await getTodayCheckIns();
    if (!checkIns || checkIns.length === 0) return null;

    checkIns.sort(function (a, b) { return new Date(a.checked_in_at) - new Date(b.checked_in_at); });
    var earliest = checkIns[0];

    return {
      student: {
        id: earliest.student_id,
        nama: earliest.students ? earliest.students.nama : 'Siswa',
        kelas: earliest.students ? earliest.students.kelas : ''
      },
      timestamp: earliest.checked_in_at
    };
  }

  // --- SELFIE UNTUK ADMIN ---

  /**
   * Buat signed URL sementara untuk melihat selfie (bucket tetap privat).
   * Memakai Storage API (createSignedUrl), BUKAN fungsi SQL.
   *
   * PENTING: createSignedUrl mengembalikan path RELATIF seperti
   *   "/object/sign/selfies/...?token=..."
   * yang harus diawali endpoint Storage Supabase. Tanpa awalan itu, browser
   * akan meminta ke domain halaman sendiri (mis. github.io) dan gagal 404.
   * Fungsi ini mengembalikan URL ABSOLUT yang siap dipasang ke <img src>.
   *
   * Syarat: ada policy SELECT pada storage.objects untuk bucket 'selfies'
   * (lihat bagian 6 di supabase/setup.sql).
   * @param {string} path - selfie_path
   * @param {number} [expires] - masa berlaku (detik), default 3600 (1 jam)
   * @returns {Promise<Object>} { url } | { error, detail }
   */
  async function getSelfieUrl(path, expires) {
    if (!init()) return { error: 'BACKEND_BELUM_KONFIGURASI' };

    if (!path || String(path).trim() === '') {
      return { error: 'PATH_KOSONG' };
    }

    try {
      var ttl = expires || 3600;
      var res = await window.__sb
        .storage
        .from('selfies')
        .createSignedUrl(path, ttl);

      if (res.error) {
        console.error('[SB] createSignedUrl error:', res.error);
        return { error: 'GAGAL_BUAT_URL', detail: res.error.message };
      }
      if (!res.data || !res.data.signedUrl) {
        return { error: 'GAGAL_BUAT_URL', detail: 'signedUrl kosong' };
      }

      var signed = res.data.signedUrl;

      // Jadikan URL absolut bila masih relatif
      if (signed.indexOf('http') !== 0) {
        var base = String(cfg.url || '').replace(/\/+$/, '');
        signed = base + '/storage/v1' + (signed.charAt(0) === '/' ? signed : '/' + signed);
      }

      return { url: signed };
    } catch (err) {
      console.error('[SB] getSelfieUrl exception:', err);
      return { error: 'EXCEPTION', detail: err.message };
    }
  }

  /**
   * Ambil selfie sebagai BLOB dan kembalikan blob URL siap dipakai di <img>.
   *
   * Kenapa tidak cukup <img src="signedUrl"> ?
   * Cloudflare menyetel cookie `__cf_bm` (SameSite=None) pada respons file.
   * Browser memuat <img> cross-origin dalam mode `no-cors`, dan respons yang
   * menyetel cookie seperti itu ditolak oleh ORB (Opaque Response Blocking):
   *   "A resource is blocked by OpaqueResponseBlocking".
   *
   * Solusinya: unduh memakai Storage API (permintaan CORS resmi via supabase-js),
   * ubah ke blob, lalu tampilkan lewat URL.createObjectURL(). Objek di URL
   * tersebut bisa dicabut kembali dengan revokeSelfieBlob().
   *
   * @param {string} path - selfie_path
   * @param {number} [expires] - masa berlaku signed URL (detik)
   * @returns {Promise<Object>} { blobUrl } | { error, detail }
   */
  async function getSelfieBlob(path, expires) {
    if (!init()) return { error: 'BACKEND_BELUM_KONFIGURASI' };
    if (!path || String(path).trim() === '') return { error: 'PATH_KOSONG' };

    try {
      var ttl = expires || 3600;
      // 1. Buat signed URL
      var sg = await window.__sb.storage.from('selfies').createSignedUrl(path, ttl);
      if (sg.error || !sg.data || !sg.data.signedUrl) {
        return { error: 'GAGAL_BUAT_URL', detail: (sg.error && sg.error.message) || 'signedUrl kosong' };
      }

      var signed = sg.data.signedUrl;
      if (signed.indexOf('http') !== 0) {
        var base = String(cfg.url || '').replace(/\/+$/, '');
        signed = base + '/storage/v1' + (signed.charAt(0) === '/' ? signed : '/' + signed);
      }

      // 2. Unduh sebagai blob (mode CORS biasa, bukan no-cors)
      var resp = await fetch(signed, { mode: 'cors', credentials: 'omit', cache: 'no-store' });
      if (!resp.ok) {
        return { error: 'GAGAL_UNDUH_SELFIE', detail: 'HTTP ' + resp.status };
      }
      var blob = await resp.blob();

      // Pastikan memang gambar
      if (blob.type && blob.type.indexOf('image') !== 0 && blob.type.indexOf('octet-stream') === -1) {
        return { error: 'BUKAN_GAMBAR', detail: blob.type };
      }

      return { blobUrl: URL.createObjectURL(blob), size: blob.size, type: blob.type, url: signed };
    } catch (err) {
      console.error('[SB] getSelfieBlob exception:', err);
      return { error: 'EXCEPTION', detail: err.message };
    }
  }

  // Cabut blob URL agar memori tidak menumpuk
  function revokeSelfieBlob(blobUrl) {
    try {
      if (blobUrl && blobUrl.indexOf('blob:') === 0) URL.revokeObjectURL(blobUrl);
    } catch (e) { /* ignore */ }
  }

  // --- EXPORTS ---

  var api = {
    init: init,
    getSessionStatus: getSessionStatus,
    getServerDate: getServerDate,
    findStudentsByName: findStudentsByName,
    getStudentPublic: getStudentPublic,
    setSessionInactive: setSessionInactive,
    setSessionActive: setSessionActive,
    setSchedule: setSchedule,
    uploadSelfie: uploadSelfie,
    submitCheckIn: submitCheckIn,
    getTodayCheckIns: getTodayCheckIns,
    getEarliestCheckInToday: getEarliestCheckInToday,
    getSelfieUrl: getSelfieUrl,
    getSelfieBlob: getSelfieBlob,
    revokeSelfieBlob: revokeSelfieBlob
  };

  // Daftarkan sebagai global (untuk <script> biasa)
  window.SBPag = window.SBPag || {};
  Object.keys(api).forEach(function (k) { window.SBPag[k] = api[k]; });

  return api;
})();
