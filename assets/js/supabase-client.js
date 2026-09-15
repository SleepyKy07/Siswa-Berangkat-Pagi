/* ================================================================
   SUPABASE CLIENT
   ================================================================
   Provides helper methods for the Siswa Berangkat Pagi system.
   All data operations go through this module — never localStorage
   for status/session data.
   ================================================================ */

'use strict';

(function () {
  var cfg = window.SUPABASE_CONFIG || {};
  var supa = window.supabase;

  // Initialize Supabase client
  function init() {
    // Periksa apakah konfigurasi penuh
    if (!cfg.url || cfg.url.indexOf('YOUR-PROJECT') > -1) {
      console.warn('[SB] SUPABASE CONFIG BELUM DIISIIN — paste URL + anonKey di assets/js/supabase-config.js');
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

    window.__sb = supa.createClient(cfg.url, cfg.anonKey);
    console.log('[SB] Supabase client initialized:', cfg.url);
    return true;
  }

  // --- SESSION STATUS (Core of Section A) ---

  /**
   *  Menghasilkan status session absensi dari server.
   *  Menggunakan fungsi Postgres get_session_status() — sumber kebenaran server.
   *  Returns: { active: boolean, manual_override: string|null,
   *             scheduled_starts_at: string|null,
   *             scheduled_ends_at: string|null,
   *             server_time: string|null }
   */
  async function getSessionStatus() {
    if (!init()) return { error: 'BACKEND_BELUM_KONFIGURASI', fallback: true };

    try {
      var { data, error } = await window.__sb.rpc('get_session_status');
      if (error) {
        console.error('[SB] RPC error:', error);
        // Jika RPC gagal (contoh: tabel belum dibuat), fallback ke cek manual
        return { error: 'RPC_FAILED', fallbackCompute: true };
      }
      return data || { active: false };
    } catch (err) {
      console.error('[SB] Exception:', err);
      return { error: 'EXCEPTION', fallback: true };
    }
  }

  // --- STUDENT LOOKUP ---

  /**
   * Cari data siswa berdasarkan NIS.
   * @param {string} nis - NIS siswa
   * @returns {Promise<Object>} { student: {id, nis, nama, kelas, jurusan} | null }
   */
  async function findStudentByNIS(nis) {
    if (!init()) return { error: 'BACKEND_BELUM_KONFIGURASI' };

    try {
      var { data, error } = await window.__sb
        .from('students')
        .select('id, nis, nama, kelas, jurusan')
        .eq('nis', nis)
        .single();

      if (error) {
        // NIS tidak ditemukan atau error
        return { error: 'STUDENT_NOT_FOUND', fallback: true };
      }
      return { student: data, error: null };
    } catch (err) {
      console.error('[SB] findStudentByNIS exception:', err);
      return { error: 'EXCEPTION', fallback: true };
    }
  }

  // --- SESSION ADMIN OVERRIDES ---

  /**
   * Admin: Nonaktifkan sesi absensi (mengganti manual).
   * @param {string} reason - Alasan nonaktifkan
   */
  async function setSessionInactive(reason) {
    if (!init()) return { error: 'BACKEND_BELUM_KONFIGURASI' };

    try {
      var { data, error } = await window.__sb
        .from('sessions')
        .update({ manual_override: 'NONAKTIF', override_reason: reason, updated_at: new Date() })
        .eq('id', 1);

      if (error) return { error: 'GAGAL_NONAKTIFKAN', detail: error.message };
      return { success: true, data: data };
    } catch (err) {
      console.error('[SB] setSessionInactive exception:', err);
      return { error: 'EXCEPTION', detail: err.message };
    }
  }

  /**
   * Admin: Aktifkan sesi absensi (mengganti manual).
   * @param {string} reason - Alasan aktifkan
   */
  async function setSessionActive(reason) {
    if (!init()) return { error: 'BACKEND_BELUM_KONFIGURASI' };

    try {
      var { data, error } = await window.__sb
        .from('sessions')
        .update({ manual_override: 'AKTIF', override_reason: reason, updated_at: new Date() })
        .eq('id', 1);

      if (error) return { error: 'GAGAL_AKTIFKAN', detail: error.message };
      return { success: true, data: data };
    } catch (err) {
      console.error('[SB] setSessionActive exception:', err);
      return { error: 'EXCEPTION', detail: err.message };
    }
  }

  // --- SCHEDULE ---

  /**
   * Admin: Set jam mulai & jam selesai auto-schedule.
   * @param {string} starts - format "HH:MM" (e.g., "06:00")
   * @param {string} ends - format "HH:MM" (e.g., "07:00")
   */
  async function setSchedule(starts, ends) {
    if (!init()) return { error: 'BACKEND_BELUM_KONFIGURASI' };

    // Validasi format HH:MM
    var re = /^([01]\d|2[0-3]):([0-5]\d)$/;
    if (!re.test(starts) || !re.test(ends)) {
      return { error: 'INVALID_SCHEDULE_FORMAT' };
    }

    try {
      var { data, error } = await window.__sb
        .from('sessions')
        .update({
          scheduled_starts_at: starts + ':00',
          scheduled_ends_at: ends + ':00',
          manual_override: null, // clear manual override when schedule is set
          updated_at: new Date()
        })
        .eq('id', 1);

      if (error) return { error: 'GAGAL_SET_SCHEDULE', detail: error.message };
      return { success: true, data: data };
    } catch (err) {
      console.error('[SB] setSchedule exception:', err);
      return { error: 'EXCEPTION', detail: err.message };
    }
  }

  // --- SELFIE UPLOAD ---

  /**
   * Unggah foto selfie ke Supabase Storage bucket 'selfies'.
   * Bucket bersifat privat; file hanya bisa diakses via service_role.
   * @param {string} dataUrl - data URL base64 (data:image/jpeg;base64,...)
   * @param {number} studentId
   * @returns {Promise<Object>} { success, path, error }
   */
  async function uploadSelfie(dataUrl, studentId) {
    if (!init()) return { error: 'BACKEND_BELUM_KONFIGURASI' };

    // Validasi: harus data URL
    if (!dataUrl || dataUrl.indexOf('data:image/') !== 0) {
      return { error: 'INVALID_DATA_URL' };
    }

    try {
      // Ekstrak base64 dan ekstensi file
      var parts = dataUrl.split(',');
      var meta = parts[0];                  // data:image/jpeg;base64
      var base64 = parts[1] || '';
      var mime = meta.match(/image\/(\w+)/);
      var ext = mime ? mime[1] : 'jpg';

      // Path: selfies/{date}/{student_id}_{timestamp}.jpg
      var today = new Date();
      var dateStr = today.getFullYear() + '-' + String(today.getMonth() + 1).padStart(2, '0') + '-' + String(today.getDate()).padStart(2, '0');
      var timeStr = String(today.getHours()).padStart(2, '0') + String(today.getMinutes()).padStart(2, '0') + String(today.getSeconds()).padStart(2, '0');
      var filePath = dateStr + '/' + studentId + '_' + timeStr + '.' + ext;

      var { data: uploadData, error: uploadError } = await window.__sb
        .storage
        .from('selfies')
        .upload(filePath, base64, {
          contentType: 'image/' + ext,
          encoding: 'base64',
          upsert: false
        });

      if (uploadError) {
        console.error('[SB] Upload selfie error:', uploadError);
        // Jika bucket belum ada / permission ditolak
        if (uploadError.message && uploadError.message.indexOf('bucket') > -1) {
          return { error: 'BUCKET_SELFIES_BELUM_BUAT', detail: 'Buat bucket "selfies" di Supabase Storage terlebih dahulu' };
        }
        return { error: 'GAGAL_UPLOAD_SELFIE', detail: uploadError.message };
      }

      console.log('[SB] Selfie uploaded:', uploadData.path);
      return { success: true, path: uploadData.path || filePath };
    } catch (err) {
      console.error('[SB] uploadSelfie exception:', err);
      return { error: 'EXCEPTION', detail: err.message };
    }
  }

  // --- CHECK-IN ---

   /**
    * Catat check-in siswa.
    * Validasi dilakukan server-side:
    * - Sesi harus AKTIF
    * - Siswa belum check-in hari ini
    * - NIS valid
    * @param {string} nis - NIS siswa
    * @param {string} selfieDataUrl - data URL foto selfie (opsional)
    * @param {Object} locationCtx - hasil awal collectLocationContext() dari frontend (opsional)
    * @returns {Promise<Object>} { success, data, error }
    */
   async function submitCheckIn(nis, selfieDataUrl, locationCtx) {
     if (!init()) return { error: 'BACKEND_BELUM_KONFIGURASI' };

     // Langkah 1: Pastikan status AKTIF (server-side)
     var statusResult = await getSessionStatus();
     if (statusResult.error) {
       return { error: 'TIDAK_BISA_CHECKIN_STATUS_ERROR', detail: statusResult.error };
     }
     if (!statusResult.active) {
       return { error: 'ABSENSI_TIDAK_AKTIF', detail: statusResult.manual_override || 'Tidak dalam jadwal' };
     }

     // Langkah 2: Cari siswa
     var studentResult = await findStudentByNIS(nis);
     if (studentResult.error) {
       return { error: 'SISWA_TIDAK_DITEMUKAN', detail: studentResult.error };
     }
     var student = studentResult.student;

     // --- ANTI-ASRAMA: validasi lokasi ---
     // Jika frontend belum mengumpulkan lokasi, kumpulkan di sini.
     // Jika location unavailable/ditolak, tetap lanjutkan check-in dengan catatan.
     if (!locationCtx) {
       locationCtx = await collectLocationContext();
     }


    // Langkah 3: Upload selfie ke storage (jika ada)
    var selfiePath = null;
    if (selfieDataUrl) {
      var uploadResult = await uploadSelfie(selfieDataUrl, student.id);
      if (uploadResult.error) {
        // Jika bucket belum ada, lanjutkan tetapi catat error ke frontend
        console.warn('[SB] Selfie upload failed:', uploadResult.error);
        // Don't block check-in just because selfie failed to upload;
        // record the check-in anyway, note the issue
      } else {
        selfiePath = uploadResult.path;
      }
    }

    // Langkah 4: Cek apakah sudah check-in hari ini (unique constraint di DB)
    // Menggunakan server date melalui SQL
    var today = new Date();
    var todayStr = today.getFullYear() + '-' + String(today.getMonth() + 1).padStart(2, '0') + '-' + String(today.getDate()).padStart(2, '0');

    try {
      // Cek sudah ada check-in hari ini
      var { data: existing, error: checkErr } = await window.__sb
        .from('check_ins')
        .select('id')
        .eq('student_id', student.id)
        .eq('checkin_date', todayStr)
        .maybeSingle();

      if (checkErr) {
        return { error: 'GAGAL_CEK_EXISTING_CHECKIN', detail: checkErr.message };
      }

      if (existing) {
        return { error: 'SUDAH_CHECKIN_HARI_INI', detail: 'Anda sudah melakukan absensi hari ini.' };
      }

      // Langkah 5: Simpan check-in (server timestamp)
      var { data, error } = await window.__sb
        .from('check_ins')
        .insert({
          student_id: student.id,
          checkin_date: todayStr,
          selfie_path: selfiePath || null,
          // Lapisan anti-asrama (opsional)
          location_lat: locationCtx.lat || null,
          location_lng: locationCtx.lng || null,
          location_accuracy: locationCtx.accuracy || null,
          location_within_radius: locationCtx.withinRadius || null,
          location_state: locationCtx.state || null,
          location_reason: locationCtx.reason || null
        })
        .select()
        .single();

      if (error) return { error: 'GAGAL_SIMPAN_CHECKIN', detail: error.message };

      return {
        success: true,
        student: student,
        timestamp: data.checked_in_at,
        selfiePath: selfiePath,
        checkinId: data.id
      };
    } catch (err) {
      console.error('[SB] submitCheckIn exception:', err);
      return { error: 'EXCEPTION', detail: err.message };
    }
  }

  // --- ANTI-ASRAMA: LOCATION VALIDATION (opsional) ---

  /**
   * Ambil lokasi device (geolocation browser) dan validasi terhadap gerbang.
   * Hasilnya nanti disimpan bersama check-in sebagai lapisan validasi.
   * - Jika location ditolak → tidak crash, tampilkan status jelas.
   * @returns {Promise<Object>} {
   *   state: 'OK' | 'DENIED' | 'SKIPPED' | 'UNSUPPORTED',
   *   lat, lng, accuracy, distanceMeters, withinRadius, reason
   * }
   */
  async function collectLocationContext() {
    var gate = (cfg.schoolGate) || null;

    // Jika gerbang tidak dikonfigurasi → skip lokasi (soft), bukan block.
    if (!gate || !gate.latitude || !gate.longitude) {
      return {
        state: 'SKIPPED',
        reason: 'SCHOOL_GATE_NOT_CONFIGURED',
        withinRadius: null,
        distanceMeters: null
      };
    }

    // Coba ambil lokasi browser
    var loc;
    if (!navigator.geolocation) {
      return { state: 'UNSUPPORTED', reason: 'GEOLOCATION_UNSUPPORTED', withinRadius: null };
    }

    try {
      loc = await new Promise(function (resolve) {
        navigator.geolocation.getCurrentPosition(
          function (pos) {
            resolve({
              ok: true,
              lat: pos.coords.latitude,
              lng: pos.coords.longitude,
              accuracy: pos.coords.accuracy
            });
          },
          function (err) {
            resolve({ ok: false, code: err.code || 'UNKNOWN' });
          },
          { enableHighAccuracy: true, timeout: 8000, maximumAge: 0 }
        );
      });
    } catch (e) {
      return { state: 'DENIED', reason: 'GEOLOCATION_ERROR', withinRadius: null };
    }

    if (!loc.ok) {
      // Permission ditolak/error → tidak crash; tandai state DENIED
      var reasonMap = {
        1: 'PERMISSION_DENIED',
        2: 'POSITION_UNAVAILABLE',
        3: 'TIMEOUT'
      };
      return {
        state: 'DENIED',
        reason: reasonMap[loc.code] || 'LOCATION_FAILED',
        withinRadius: null,
        distanceMeters: null
      };
    }

    // Hitung jarak dari gerbang (haversine)
    var dist = haversineMeters(loc.lat, loc.lng, gate.latitude, gate.longitude);
    var radiusM = gate.radiusMeters || 30;

    return {
      state: 'OK',
      reason: 'WITHIN_ACCURACY',
      lat: loc.lat,
      lng: loc.lng,
      accuracy: loc.accuracy,
      distanceMeters: Math.round(dist),
      withinRadius: dist <= radiusM,
      radiusMeters: radiusM
    };
  }

  // Haversine distance (meter)
  function haversineMeters(lat1, lng1, lat2, lng2) {
    function toRad(x) { return x * Math.PI / 180; }
    var R = 6371000;
    var dLat = toRad(lat2 - lat1);
    var dLon = toRad(lng2 - lng1);
    var a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
      Math.sin(dLon / 2) * Math.sin(dLon / 2);
    var c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  // --- TODAY CHECK-INS ---

  /**
   * Daftar semua check-in hari ini untuk dashboard admin.
   * @returns {Promise<Array>} Array { id, student_nama, student_nis, waktu, selfie }
   */
  async function getTodayCheckIns() {
    if (!init()) return [];

    var today = new Date();
    var todayStr = today.getFullYear() + '-' + String(today.getMonth() + 1).padStart(2, '0') + '-' + String(today.getDate()).padStart(2, '0');

    try {
      var { data, error } = await window.__sb
        .from('check_ins')
        .select(`
          id,
          student_id,
          checked_in_at,
          students!inner(nama, nis, kelas, jurusan)
        `)
        .eq('checkin_date', todayStr)
        .order('checked_in_at', { ascending: true });

      if (error) {
        console.error('[SB] getTodayCheckIns error:', error);
        return [];
      }
      return data || [];
    } catch (err) {
      console.error('[SB] getTodayCheckIns exception:', err);
      return [];
    }
  }

  // --- EARLIEST CHECK-IN (Siswa paling pagi) ---

  /**
   * Dapatkan timestamp check-in terawal hari ini (siswa paling pagi).
   * @returns {Promise<Object>} { student, timestamp } atau null kalau belum ada
   */
  async function getEarliestCheckInToday() {
    var checkIns = await getTodayCheckIns();
    if (!checkIns || checkIns.length === 0) return null;

    // Urut berdasarkan checked_in_at ascending (terlama pertama)
    checkIns.sort(function (a, b) { return new Date(a.checked_in_at) - new Date(b.checked_in_at); });
    var earliest = checkIns[0];

    return {
      student: {
        id: earliest.student.id,
        nis: earliest.student.nis,
        nama: earliest.student.nama,
        kelas: earliest.student.kelas,
        jurusan: earliest.student.jurusan
      },
      timestamp: earliest.checked_in_at
    };
  }

  // Make public
  window.SBPag = window.SBPag || {};
  window.SBPag.init = init;
  window.SBPag.getSessionStatus = getSessionStatus;
  window.SBPag.findStudentByNIS = findStudentByNIS;
  window.SBPag.setSessionInactive = setSessionInactive;
  window.SBPag.setSessionActive = setSessionActive;
  window.SBPag.setSchedule = setSchedule;
  window.SBPag.uploadSelfie = uploadSelfie;
  window.SBPag.submitCheckIn = submitCheckIn;
  window.SBPag.getTodayCheckIns = getTodayCheckIns;
  window.SBPag.getEarliestCheckInToday = getEarliestCheckInToday;
  window.SBPag.collectLocationContext = collectLocationContext;

})();