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

  // Promise yang selesai setelah library supabase-js tersedia & client dibuat.
  // Ini mencegah kegagalan "Gagal memeriksa status" pada percobaan pertama,
  // karena library dimuat dari CDN secara asinkron.
  var readyPromise = null;

  // Muat library supabase-js dari CDN bila halaman belum menyertakannya.
  function loadLibrary() {
    return new Promise(function (resolve, reject) {
      if (window.supabase) { resolve(); return; }

      // Sudah ada tag yang sedang dimuat? Tunggu.
      var existing = document.querySelector('script[data-sb-lib]');
      if (existing) {
        existing.addEventListener('load', function () { resolve(); });
        existing.addEventListener('error', function () { reject(new Error('CDN supabase-js gagal dimuat')); });
        return;
      }

      var s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2';
      s.async = true;
      s.setAttribute('data-sb-lib', '1');
      s.onload = function () { resolve(); };
      s.onerror = function () { reject(new Error('CDN supabase-js gagal dimuat')); };
      document.head.appendChild(s);
    });
  }

  // Siapkan client (idempotent).
  function createClientOnce() {
    if (!cfg.url || cfg.url.indexOf('YOUR-PROJECT') > -1) return false;
    if (!window.supabase) return false;
    if (!window.__sb) {
      window.__sb = window.supabase.createClient(cfg.url, cfg.anonKey);
      console.log('[SB] Supabase client initialized:', cfg.url);
    }
    supa = window.supabase;
    return true;
  }

  /**
   * Pastikan client siap. Mengembalikan Promise<boolean>.
   * Selalu bisa di-await — tidak lagi "gagal sekali lalu berhasil saat retry".
   */
  function ready() {
    if (!readyPromise) {
      if (!cfg.url || cfg.url.indexOf('YOUR-PROJECT') > -1) {
        console.warn('[SB] SUPABASE CONFIG BELUM DIISI — paste URL + anonKey di assets/js/supabase-config.js');
        readyPromise = Promise.resolve(false);
      } else if (window.supabase) {
        readyPromise = Promise.resolve(createClientOnce());
      } else {
        readyPromise = loadLibrary()
          .then(function () { return createClientOnce(); })
          .catch(function (err) {
            console.error('[SB] Gagal memuat library supabase-js:', err);
            // Reset agar percobaan berikutnya bisa memuat ulang
            readyPromise = null;
            return false;
          });
      }
    }
    return readyPromise;
  }

  // Versi sinkron (untuk kompatibilitas): coba siapkan tanpa menunggu.
  function init() {
    if (readyPromise) return !!window.__sb;
    if (!cfg.url || cfg.url.indexOf('YOUR-PROJECT') > -1) return false;
    if (window.supabase) return createClientOnce();
    // Mulai pemuatan di latar, hasil dipakai oleh ready()
    ready();
    return false;
  }

  // --- SESSION STATUS (inti QR permanen) ---

  /**
   * Status sesi absensi dari server (fungsi Postgres get_session_status()).
   * Returns: { active, manual_override, scheduled_starts_at,
   *            scheduled_ends_at, server_time }
   */
  async function getSessionStatus() {
    if (!(await ready())) return { error: 'BACKEND_BELUM_KONFIGURASI', fallback: true };

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

  // --- DATA SISWA MANUAL & PENDING ---

  /**
   * Daftar data siswa yang menunggu ditinjau admin.
   * @param {string} [status] - 'pending' (default) | 'approved' | 'rejected'
   * @returns {Promise<Object>} { items: Array, error }
   */
  async function listPendingStudents(status) {
    if (!(await ready())) return { error: 'BACKEND_BELUM_KONFIGURASI', items: [] };
    try {
      var res = await window.__sb.rpc('list_pending_students', { p_status: status || 'pending' });
      if (res.error) {
        console.error('[SB] list_pending_students error:', res.error);
        return { error: 'GAGAL_MUAT_PENDING', detail: res.error.message, items: [] };
      }
      return { items: res.data || [], error: null };
    } catch (err) {
      console.error('[SB] listPendingStudents exception:', err);
      return { error: 'EXCEPTION', detail: err.message, items: [] };
    }
  }

  /**
   * Setujui data pending -> dipindahkan ke tabel students.
   * @param {number|string} id - id baris pending_students
   */
  async function approvePendingStudent(id) {
    if (!(await ready())) return { error: 'BACKEND_BELUM_KONFIGURASI' };
    try {
      var res = await window.__sb.rpc('approve_pending_student', { p_id: id });
      if (res.error) return { error: 'GAGAL_SETUJUI', detail: res.error.message };
      if (res.data && res.data.error) return { error: res.data.error };
      return { success: true, data: res.data };
    } catch (err) {
      console.error('[SB] approvePendingStudent exception:', err);
      return { error: 'EXCEPTION', detail: err.message };
    }
  }

  /**
   * Abaikan data pending (tidak dimasukkan ke students).
   * @param {number|string} id
   */
  async function rejectPendingStudent(id) {
    if (!(await ready())) return { error: 'BACKEND_BELUM_KONFIGURASI' };
    try {
      var res = await window.__sb.rpc('reject_pending_student', { p_id: id });
      if (res.error) return { error: 'GAGAL_ABAIKAN', detail: res.error.message };
      if (res.data && res.data.error) return { error: res.data.error };
      return { success: true };
    } catch (err) {
      console.error('[SB] rejectPendingStudent exception:', err);
      return { error: 'EXCEPTION', detail: err.message };
    }
  }

  // --- SESSION ADMIN OVERRIDES ---

  /** Admin: nonaktifkan sesi absensi (override manual). */
  /**
   * Admin: nonaktifkan sesi absensi (override manual).
   * @param {string|null} [reason] - pesan custom untuk siswa (boleh kosong)
   */
  async function setSessionInactive(reason) {
    if (!(await ready())) return { error: 'BACKEND_BELUM_KONFIGURASI' };
    try {
      var pesan = reason == null ? null : String(reason).trim();
      var res = await window.__sb
        .from('sessions')
        .update({
          manual_override: 'NONAKTIF',
          override_reason: pesan ? pesan : null,
          updated_at: new Date()
        })
        .eq('id', 1);
      if (res.error) return { error: 'GAGAL_NONAKTIFKAN', detail: res.error.message };
      return { success: true, data: res.data };
    } catch (err) {
      console.error('[SB] setSessionInactive exception:', err);
      return { error: 'EXCEPTION', detail: err.message };
    }
  }

  /**
   * Admin: aktifkan sesi absensi (override manual).
   * @param {string|null} [reason] - catatan internal (tidak ditampilkan ke siswa)
   */
  async function setSessionActive(reason) {
    if (!(await ready())) return { error: 'BACKEND_BELUM_KONFIGURASI' };
    try {
      var catatan = reason == null ? null : String(reason).trim();
      var res = await window.__sb
        .from('sessions')
        .update({
          manual_override: 'AKTIF',
          override_reason: catatan ? catatan : null,
          updated_at: new Date()
        })
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
    if (!(await ready())) return { error: 'BACKEND_BELUM_KONFIGURASI' };

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
   * Ubah string base64 menjadi Uint8Array (byte biner asli).
   * Dipakai agar file yang diunggah benar-benar gambar, bukan teks base64.
   */
  function base64ToBytes(b64) {
    var clean = String(b64 || '').replace(/\s/g, '');
    var binary = atob(clean);
    var len = binary.length;
    var out = new Uint8Array(len);
    for (var i = 0; i < len; i++) out[i] = binary.charCodeAt(i);
    return out;
  }

  /**
   * Unggah selfie ke bucket privat 'selfies'.
   * Path: {tanggal}/{nama-slug}_{jam}_{random}.{ext}
   * @param {string} dataUrl - data URL base64
   * @param {number|string} studentId - id internal siswa
   */
  async function uploadSelfie(dataUrl, ownerTag) {
    if (!(await ready())) return { error: 'BACKEND_BELUM_KONFIGURASI' };

    if (!dataUrl || dataUrl.indexOf('data:image/') !== 0) {
      return { error: 'INVALID_DATA_URL' };
    }

    try {
      var parts = dataUrl.split(',');
      var meta = parts[0];
      var base64 = parts[1] || '';
      var mime = meta.match(/image\/(\w+)/);
      var ext = mime ? mime[1] : 'jpg';

      // PENTING: ubah base64 -> byte biner asli.
      // Kalau string base64 dikirim apa adanya, Supabase menyimpan TEKS base64
      // (bukan gambar), sehingga file tidak bisa ditampilkan.
      var bytes = base64ToBytes(base64);

      // Path memakai tanggal server bila tersedia (konsisten dengan checkin_date)
      var dateStr = await getServerDate();
      var now = new Date();
      var timeStr = String(now.getHours()).padStart(2, '0') + String(now.getMinutes()).padStart(2, '0') + String(now.getSeconds()).padStart(2, '0');
      var rand = Math.random().toString(36).slice(2, 7);
      var tag = slugify(ownerTag || 'siswa');
      var filePath = dateStr + '/' + tag + '_' + timeStr + '_' + rand + '.' + ext;

      var res = await window.__sb
        .storage
        .from('selfies')
        .upload(filePath, bytes, {
          contentType: 'image/' + ext,
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
   * Catat check-in dengan NAMA & KELAS yang diketik siswa sendiri.
   * Validasi, anti-duplikat, dan timestamp dilakukan SERVER lewat RPC
   * submit_checkin_manual().
   * @param {string} nama - nama siswa (input bebas)
   * @param {string} kelas - kelas siswa (input bebas)
   * @param {string} selfieDataUrl - data URL foto selfie (opsional)
   * @returns {Promise<Object>} { success, nama, kelas, timestamp, selfiePath } | { error, detail }
   */
  async function submitCheckInManual(nama, kelas, selfieDataUrl) {
    if (!(await ready())) return { error: 'BACKEND_BELUM_KONFIGURASI' };

    var n = String(nama || '').trim();
    var k = String(kelas || '').trim();
    if (n.length < 3) return { error: 'NAMA_TIDAK_VALID', detail: 'Nama minimal 3 karakter.' };
    if (k.length < 1) return { error: 'KELAS_TIDAK_VALID', detail: 'Kelas wajib diisi.' };

    // Langkah 1: pastikan sesi AKTIF (server-side)
    var statusResult = await getSessionStatus();
    if (statusResult.error) {
      return { error: 'TIDAK_BISA_CHECKIN_STATUS_ERROR', detail: statusResult.error };
    }
    if (!statusResult.active) {
      return { error: 'ABSENSI_TIDAK_AKTIF', detail: statusResult.manual_override || 'Tidak dalam jadwal' };
    }

    // Langkah 2: upload selfie (jika ada). Kegagalan upload tidak memblokir check-in.
    var selfiePath = null;
    if (selfieDataUrl) {
      // Pakai nama sebagai penanda folder file (bukan id, karena id belum ada)
      var uploadResult = await uploadSelfie(selfieDataUrl, slugify(n));
      if (uploadResult.error) {
        console.warn('[SB] Selfie upload failed:', uploadResult.error);
      } else {
        selfiePath = uploadResult.path;
      }
    }

    // Langkah 3: simpan check-in via RPC (tanggal & jam SERVER, anti-duplikat)
    try {
      var res = await window.__sb.rpc('submit_checkin_manual', {
        p_nama: n,
        p_kelas: k,
        p_selfie_path: selfiePath
      });

      if (res.error) return { error: 'GAGAL_SIMPAN_CHECKIN', detail: res.error.message };

      var data = res.data || {};
      if (data.error) {
        // Error logis: ABSENSI_TIDAK_AKTIF / SUDAH_CHECKIN_HARI_INI / NAMA_TIDAK_VALID / ...
        return { error: data.error, detail: data.error };
      }

      return {
        success: true,
        student: { nama: data.nama || n, kelas: data.kelas || k },
        timestamp: data.timestamp,
        selfiePath: data.selfie_path || selfiePath,
        checkinId: data.checkin_id,
        pendingId: data.pending_id
      };
    } catch (err) {
      console.error('[SB] submitCheckInManual exception:', err);
      return { error: 'EXCEPTION', detail: err.message };
    }
  }

  // Ubah nama jadi potongan aman untuk nama file
  function slugify(s) {
    return String(s || 'siswa')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 24) || 'siswa';
  }

  // --- TODAY CHECK-INS (dashboard admin) ---

  /**
   * Daftar check-in hari ini (tanggal server), urut dari paling pagi.
   * Memakai RPC list_today_checkins() yang mendukung siswa terdaftar
   * maupun siswa manual (nama/kelas diketik sendiri).
   * @returns {Promise<Array>} array { id, nama, kelas, checked_in_at, selfie_path, is_pending }
   */
  async function getTodayCheckIns() {
    if (!(await ready())) return [];

    try {
      var res = await window.__sb.rpc('list_today_checkins');
      if (res.error) {
        console.error('[SB] list_today_checkins error:', res.error);
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
        nama: earliest.nama || 'Siswa',
        kelas: earliest.kelas || ''
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
    if (!(await ready())) return { error: 'BACKEND_BELUM_KONFIGURASI' };

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
    if (!(await ready())) return { error: 'BACKEND_BELUM_KONFIGURASI' };
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

      // Toleransi file lama: sebagian selfie tersimpan sebagai TEKS base64
      // (bukan biner) karena bug unggah sebelumnya. Deteksi lalu perbaiki
      // di sisi klien supaya tetap bisa ditampilkan.
      var head = (await blob.slice(0, 8).text()).trim();
      if (head.indexOf('/9j/') === 0 || head.indexOf('iVBOR') === 0) {
        // Isinya base64 -> decode jadi biner
        var b64text = await blob.text();
        var bin = base64ToBytes(b64text);
        var guess = head.indexOf('iVBOR') === 0 ? 'image/png' : 'image/jpeg';
        blob = new Blob([bin], { type: guess });
      }

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

  // --- HAPUS RIWAYAT (admin) ---

  /**
   * Hitung berapa data yang akan terhapus (untuk konfirmasi admin).
   * @param {'before'|'today'|'all_before'|'all'} mode
   * @param {string} [beforeDate] - 'YYYY-MM-DD' (wajib bila mode='before')
   */
  async function countHistoryToDelete(mode, beforeDate) {
    if (!(await ready())) return { error: 'BACKEND_BELUM_KONFIGURASI' };
    try {
      var res = await window.__sb.rpc('count_history_to_delete', {
        p_mode: mode,
        p_before_date: mode === 'before' ? (beforeDate || null) : null
      });
      if (res.error) return { error: 'GAGAL_HITUNG', detail: res.error.message };
      return { data: res.data || {}, error: null };
    } catch (err) {
      console.error('[SB] countHistoryToDelete exception:', err);
      return { error: 'EXCEPTION', detail: err.message };
    }
  }

  /**
   * Hapus riwayat check-in + data pending yang sudah ditinjau.
   * File selfie di Storage ikut dihapus (diambil sebelum baris DB dihapus).
   *
   * @param {'before'|'today'|'all_before'|'all'} mode
   *   'before'     -> sebelum tanggal tertentu
   *   'today'      -> hari ini saja
   *   'all_before' -> semua riwayat (sebelum hari ini)
   *   'all'        -> SEMUA (termasuk hari ini)
   * @param {string} [beforeDate] - 'YYYY-MM-DD' (wajib bila mode='before')
   * @returns {Promise<Object>} { success, checkinsDeleted, pendingDeleted, selfiesDeleted, selfieErrors }
   */
  async function deleteHistory(mode, beforeDate) {
    if (!(await ready())) return { error: 'BACKEND_BELUM_KONFIGURASI' };

    if (mode === 'before' && !beforeDate) {
      return { error: 'TANGGAL_WAJIB_DIISI' };
    }

    var paths = [];
    var selfiesDeleted = 0;
    var selfieErrors = 0;

    try {
      // 1. Kumpulkan path selfie SEBELUM baris database dihapus
      var gp = await window.__sb.rpc('collect_selfie_paths', {
        p_mode: mode,
        p_before_date: mode === 'before' ? beforeDate : null
      });
      if (gp.error) {
        return { error: 'GAGAL_AMBIL_SELFIE', detail: gp.error.message };
      }
      paths = (gp.data || []).map(function (r) { return r.selfie_path; }).filter(Boolean);

      // 2. Hapus baris database (check_ins + pending yang ditinjau)
      var del = await window.__sb.rpc('delete_checkin_history', {
        p_mode: mode,
        p_before_date: mode === 'before' ? beforeDate : null
      });
      if (del.error) return { error: 'GAGAL_HAPUS', detail: del.error.message };
      var d = del.data || {};
      if (d.error) return { error: d.error };

      // 3. Hapus file selfie di Storage (best-effort, tidak menggagalkan proses)
      if (paths.length > 0) {
        // Supabase storage remove() menerima array path (maks ~1000 per panggilan)
        for (var i = 0; i < paths.length; i += 100) {
          var chunk = paths.slice(i, i + 100);
          try {
            var rm = await window.__sb.storage.from('selfies').remove(chunk);
            if (rm.error) {
              console.warn('[SB] Gagal hapus selfie:', rm.error.message);
              selfieErrors += chunk.length;
            } else {
              selfiesDeleted += (rm.data || chunk).length;
            }
          } catch (e) {
            console.warn('[SB] Exception hapus selfie:', e.message);
            selfieErrors += chunk.length;
          }
        }
      }

      return {
        success: true,
        checkinsDeleted: d.checkins_deleted || 0,
        pendingDeleted: d.pending_deleted || 0,
        selfiesDeleted: selfiesDeleted,
        selfieErrors: selfieErrors
      };
    } catch (err) {
      console.error('[SB] deleteHistory exception:', err);
      return { error: 'EXCEPTION', detail: err.message };
    }
  }

  // --- CRUD SISWA (untuk halaman apresiasi) ---

  /**
   * Tambah siswa baru. NIS dibuat otomatis bila kosong (kolom wajib unik).
   * @returns {Promise<Object>} { student } | { error, detail }
   */
  async function tambahSiswa(data) {
    if (!(await ready())) return { error: 'BACKEND_BELUM_KONFIGURASI' };
    try {
      var d = data || {};
      var nama = String(d.nama || '').trim();
      if (nama.length < 3) return { error: 'NAMA_TIDAK_VALID', detail: 'Nama minimal 3 karakter.' };

      var nis = String(d.nis || '').trim();
      if (!nis) {
        // NIS wajib unik; buat otomatis agar tidak bentrok
        nis = 'AUTO-' + Date.now().toString(36).toUpperCase();
      }

      var res = await window.__sb
        .from('students')
        .insert({
          nis: nis,
          nama: nama,
          kelas: String(d.kelas || '').trim(),
          jurusan: String(d.jurusan || '').trim(),
          jk: (d.jk === 'P') ? 'P' : 'L',
          telp: String(d.telp || '').trim(),
          alamat: String(d.alamat || '').trim(),
          aktif: true
        })
        .select('id, nama, nis, kelas')
        .single();

      if (res.error) return { error: 'GAGAL_TAMBAH_SISWA', detail: res.error.message };
      return { student: res.data };
    } catch (err) {
      console.error('[SB] tambahSiswa exception:', err);
      return { error: 'EXCEPTION', detail: err.message };
    }
  }

  /**
   * Ubah data siswa.
   */
  async function ubahSiswa(id, data) {
    if (!(await ready())) return { error: 'BACKEND_BELUM_KONFIGURASI' };
    try {
      var d = data || {};
      var patch = {};
      if (d.nama != null) patch.nama = String(d.nama).trim();
      if (d.kelas != null) patch.kelas = String(d.kelas).trim();
      if (d.jurusan != null) patch.jurusan = String(d.jurusan).trim();
      if (d.jk != null) patch.jk = (d.jk === 'P') ? 'P' : 'L';
      if (d.telp != null) patch.telp = String(d.telp).trim();
      if (d.alamat != null) patch.alamat = String(d.alamat).trim();
      if (d.nis != null && String(d.nis).trim() !== '') patch.nis = String(d.nis).trim();

      var res = await window.__sb
        .from('students')
        .update(patch)
        .eq('id', id)
        .select('id, nama, nis, kelas')
        .single();

      if (res.error) return { error: 'GAGAL_UBAH_SISWA', detail: res.error.message };
      return { student: res.data };
    } catch (err) {
      console.error('[SB] ubahSiswa exception:', err);
      return { error: 'EXCEPTION', detail: err.message };
    }
  }

  /**
   * Hapus siswa (menghapus juga catatan pagi terkait lewat ON DELETE CASCADE).
   */
  async function hapusSiswa(id) {
    if (!(await ready())) return { error: 'BACKEND_BELUM_KONFIGURASI' };
    try {
      var res = await window.__sb.from('students').delete().eq('id', id);
      if (res.error) return { error: 'GAGAL_HAPUS_SISWA', detail: res.error.message };
      return { success: true };
    } catch (err) {
      console.error('[SB] hapusSiswa exception:', err);
      return { error: 'EXCEPTION', detail: err.message };
    }
  }

  // --- APRESIASI "BERANGKAT PAGI" ---

  /**
   * Daftar siswa + total pagi + poin + sisa (dari server, bukan localStorage).
   * @returns {Promise<Object>} { items: Array, error }
   */
  async function listApresiasiSiswa() {
    if (!(await ready())) return { error: 'BACKEND_BELUM_KONFIGURASI', items: [] };
    try {
      var res = await window.__sb.rpc('list_apresiasi_siswa');
      if (res.error) {
        console.error('[SB] list_apresiasi_siswa error:', res.error);
        return { error: 'GAGAL_MUAT_APRESIASI', detail: res.error.message, items: [] };
      }
      return { items: res.data || [], error: null };
    } catch (err) {
      console.error('[SB] listApresiasiSiswa exception:', err);
      return { error: 'EXCEPTION', detail: err.message, items: [] };
    }
  }

  /**
   * Riwayat catatan "paling pagi".
   * @param {string} [dari] - 'YYYY-MM-DD'
   * @param {string} [sampai] - 'YYYY-MM-DD'
   */
  async function listMorningRecords(dari, sampai) {
    if (!(await ready())) return { error: 'BACKEND_BELUM_KONFIGURASI', items: [] };
    try {
      var res = await window.__sb.rpc('list_morning_records', {
        p_dari: dari || null,
        p_sampai: sampai || null
      });
      if (res.error) return { error: 'GAGAL_MUAT_RIWAYAT', detail: res.error.message, items: [] };
      return { items: res.data || [], error: null };
    } catch (err) {
      console.error('[SB] listMorningRecords exception:', err);
      return { error: 'EXCEPTION', detail: err.message, items: [] };
    }
  }

  /**
   * Catat "paling pagi" secara manual (untuk data lama / koreksi).
   * @param {string|number} identitas - id siswa ATAU nama siswa
   * @param {string} tanggal - 'YYYY-MM-DD'
   */
  async function tambahMorningManual(identitas, tanggal) {
    if (!(await ready())) return { error: 'BACKEND_BELUM_KONFIGURASI' };
    try {
      var res = await window.__sb.rpc('tambah_morning_manual', {
        p_identitas: String(identitas),
        p_tanggal: tanggal
      });
      if (res.error) return { error: 'GAGAL_SIMPAN', detail: res.error.message };
      if (res.data && res.data.error) return { error: res.data.error, detail: res.data.error };
      return { success: true, data: res.data };
    } catch (err) {
      console.error('[SB] tambahMorningManual exception:', err);
      return { error: 'EXCEPTION', detail: err.message };
    }
  }

  /**
   * Batalkan catatan "paling pagi".
   * @param {number|string} studentId
   * @param {string} tanggal - 'YYYY-MM-DD'
   */
  async function hapusMorningRecord(studentId, tanggal) {
    if (!(await ready())) return { error: 'BACKEND_BELUM_KONFIGURASI' };
    try {
      var res = await window.__sb.rpc('hapus_morning_record', {
        p_student_id: studentId,
        p_tanggal: tanggal
      });
      if (res.error) return { error: 'GAGAL_HAPUS', detail: res.error.message };
      if (res.data && res.data.error) return { error: res.data.error };
      return { success: true, data: res.data };
    } catch (err) {
      console.error('[SB] hapusMorningRecord exception:', err);
      return { error: 'EXCEPTION', detail: err.message };
    }
  }

  /**
   * Sinkronkan satu check-in ke apresiasi (biasanya dipanggil server saat
   * menyetujui pending; tersedia juga untuk keperluan koreksi manual).
   * @param {number|string} checkinId
   */
  async function syncMorningFromCheckin(checkinId) {
    if (!(await ready())) return { error: 'BACKEND_BELUM_KONFIGURASI' };
    try {
      var res = await window.__sb.rpc('sync_morning_from_checkin', { p_checkin_id: checkinId });
      if (res.error) return { error: 'GAGAL_SINKRON', detail: res.error.message };
      return { success: true, data: res.data };
    } catch (err) {
      console.error('[SB] syncMorningFromCheckin exception:', err);
      return { error: 'EXCEPTION', detail: err.message };
    }
  }

  /**
   * Reset SELURUH catatan "paling pagi" + poin (satu panggilan server).
   * @returns {Promise<Object>} { success, terhapus } | { error }
   */
  async function resetMorningAll() {
    if (!(await ready())) return { error: 'BACKEND_BELUM_KONFIGURASI' };
    try {
      var res = await window.__sb.rpc('reset_morning_all');
      if (res.error) return { error: 'GAGAL_RESET', detail: res.error.message };
      if (res.data && res.data.error) return { error: res.data.error };
      return { success: true, terhapus: (res.data && res.data.terhapus) || 0 };
    } catch (err) {
      console.error('[SB] resetMorningAll exception:', err);
      return { error: 'EXCEPTION', detail: err.message };
    }
  }

  // --- JADWAL PIKET (dihapus) ---
  // Fungsi jadwal piket OSIS dipindah ke program kerja "Jadwal Petugas Gerbang".
  // Wrapper listPiket/simpanPiket/hapusPiket dihapus dari halaman apresiasi.

  // --- EXPORTS ---

  var api = {
    init: init,
    ready: ready,
    getSessionStatus: getSessionStatus,
    getServerDate: getServerDate,
    listPendingStudents: listPendingStudents,
    approvePendingStudent: approvePendingStudent,
    rejectPendingStudent: rejectPendingStudent,
    setSessionInactive: setSessionInactive,
    setSessionActive: setSessionActive,
    setSchedule: setSchedule,
    uploadSelfie: uploadSelfie,
    submitCheckInManual: submitCheckInManual,
    getTodayCheckIns: getTodayCheckIns,
    getEarliestCheckInToday: getEarliestCheckInToday,
    getSelfieUrl: getSelfieUrl,
    getSelfieBlob: getSelfieBlob,
    revokeSelfieBlob: revokeSelfieBlob,
    countHistoryToDelete: countHistoryToDelete,
    deleteHistory: deleteHistory,
    tambahSiswa: tambahSiswa,
    ubahSiswa: ubahSiswa,
    hapusSiswa: hapusSiswa,
    listApresiasiSiswa: listApresiasiSiswa,
    listMorningRecords: listMorningRecords,
    tambahMorningManual: tambahMorningManual,
    hapusMorningRecord: hapusMorningRecord,
    syncMorningFromCheckin: syncMorningFromCheckin,
    resetMorningAll: resetMorningAll
  };

  // Daftarkan sebagai global (untuk <script> biasa)
  window.SBPag = window.SBPag || {};
  Object.keys(api).forEach(function (k) { window.SBPag[k] = api[k]; });

  return api;
})();
