/* ================================================================
   GERBANG CLIENT (Supabase Client untuk Jadwal Petugas Gerbang)
   ================================================================
   Modul komunikasi backend untuk modul "Jadwal Petugas Gerbang".
   Menggunakan konfigurasi dari assets/js/supabase-config.js.
   ================================================================ */

'use strict';

var Gerbang = (function () {
  var cfg = window.SUPABASE_CONFIG || {};
  var readyPromise = null;

  function loadLibrary() {
    return new Promise(function (resolve, reject) {
      if (window.supabase) { resolve(); return; }
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

  function createClientOnce() {
    cfg = window.SUPABASE_CONFIG || {};
    if (!cfg.url || cfg.url.indexOf('YOUR-PROJECT') > -1) return false;
    if (!window.supabase) return false;
    if (!window.__sbGerbang) {
      window.__sbGerbang = window.supabase.createClient(cfg.url, cfg.anonKey);
    }
    return true;
  }

  function ready() {
    if (!readyPromise) {
      cfg = window.SUPABASE_CONFIG || {};
      if (!cfg.url || cfg.url.indexOf('YOUR-PROJECT') > -1) {
        readyPromise = Promise.resolve(false);
      } else if (window.supabase) {
        readyPromise = Promise.resolve(createClientOnce());
      } else {
        readyPromise = loadLibrary()
          .then(function () { return createClientOnce(); })
          .catch(function (err) {
            console.error('[GERBANG] Gagal memuat library Supabase:', err);
            readyPromise = null;
            return false;
          });
      }
    }
    return readyPromise;
  }

  function getClient() {
    return window.__sbGerbang;
  }

  /**
   * Muat seluruh data jadwal gerbang dari server:
   * anggota, jadwal, berhalangan, brhlKet, hitung, setting
   */
  async function getState() {
    if (!(await ready())) return { error: 'BACKEND_BELUM_SIAP' };
    try {
      var res = await getClient().rpc('gerbang_get_state');
      if (res.error) {
        console.error('[GERBANG] getState error:', res.error);
        return { error: res.error.message };
      }
      return res.data || {};
    } catch (err) {
      console.error('[GERBANG] getState exception:', err);
      return { error: err.message };
    }
  }

  /**
   * Tambah atau perbarui satu anggota
   */
  async function simpanAnggota(data) {
    if (!(await ready())) return { error: 'BACKEND_BELUM_SIAP' };
    try {
      var res = await getClient().rpc('gerbang_simpan_anggota', {
        p_id: data.id ? Number(data.id) : null,
        p_nama: data.nama,
        p_jk: data.jk,
        p_kelas: data.kelas,
        p_no_hp: data.no_hp || ''
      });
      if (res.error) return { error: res.error.message };
      if (res.data && res.data.error) return { error: res.data.error };
      return { success: true, anggota: res.data && res.data.anggota };
    } catch (err) {
      return { error: err.message };
    }
  }

  /**
   * Bulk import anggota dari CSV
   */
  async function simpanAnggotaBatch(items) {
    if (!(await ready())) return { error: 'BACKEND_BELUM_SIAP' };
    try {
      var res = await getClient().rpc('gerbang_simpan_anggota_batch', { p_items: items });
      if (res.error) return { error: res.error.message };
      return res.data || { success: true };
    } catch (err) {
      return { error: err.message };
    }
  }

  /**
   * Hapus anggota
   */
  async function hapusAnggota(id) {
    if (!(await ready())) return { error: 'BACKEND_BELUM_SIAP' };
    try {
      var res = await getClient().rpc('gerbang_hapus_anggota', { p_id: Number(id) });
      if (res.error) return { error: res.error.message };
      return { success: true };
    } catch (err) {
      return { error: err.message };
    }
  }

  /**
   * Toggle status aktif anggota
   */
  async function toggleAnggota(id) {
    if (!(await ready())) return { error: 'BACKEND_BELUM_SIAP' };
    try {
      var res = await getClient().rpc('gerbang_toggle_anggota', { p_id: Number(id) });
      if (res.error) return { error: res.error.message };
      return res.data || { success: true };
    } catch (err) {
      return { error: err.message };
    }
  }

  /**
   * Simpan perubahan jadwal (bisa satu atau banyak tanggal).
   * Menerima array: [{ tanggal: 'YYYY-MM-DD', petugas: ['id1', 'id2', ...], status: 'belum' }]
   * atau map objek { 'YYYY-MM-DD': { petugas: [...], status: '...' } }
   */
  async function simpanJadwal(jadwalInput) {
    if (!(await ready())) return { error: 'BACKEND_BELUM_SIAP' };
    try {
      var list = [];
      if (Array.isArray(jadwalInput)) {
        list = jadwalInput;
      } else if (jadwalInput && typeof jadwalInput === 'object') {
        Object.keys(jadwalInput).forEach(function (k) {
          var item = jadwalInput[k];
          if (item && item.petugas) {
            list.push({
              tanggal: k,
              petugas: item.petugas.map(Number),
              status: item.status || 'belum'
            });
          }
        });
      }
      var res = await getClient().rpc('gerbang_simpan_jadwal', { p_items: list });
      if (res.error) return { error: res.error.message };
      return { success: true, count: res.data && res.data.count };
    } catch (err) {
      return { error: err.message };
    }
  }

  /**
   * Hapus seluruh data jadwal di server
   */
  async function hapusSemuaJadwal() {
    if (!(await ready())) return { error: 'BACKEND_BELUM_SIAP' };
    try {
      var res = await getClient().rpc('gerbang_hapus_semua_jadwal');
      if (res.error) return { error: res.error.message };
      return { success: true };
    } catch (err) {
      return { error: err.message };
    }
  }

  /**
   * Tambah periode berhalangan anggota
   */
  async function simpanBerhalangan(anggotaId, tglMulai, tglSelesai, keterangan) {
    if (!(await ready())) return { error: 'BACKEND_BELUM_SIAP' };
    try {
      var res = await getClient().rpc('gerbang_simpan_berhalangan', {
        p_anggota_id: Number(anggotaId),
        p_tgl_mulai: tglMulai,
        p_tgl_selesai: tglSelesai,
        p_keterangan: keterangan || ''
      });
      if (res.error) return { error: res.error.message };
      if (res.data && res.data.error) return { error: res.data.error };
      return { success: true, added: res.data && res.data.added };
    } catch (err) {
      return { error: err.message };
    }
  }

  /**
   * Hapus periode berhalangan anggota (semua atau spesifik tanggal)
   */
  async function hapusBerhalangan(anggotaId, tanggal) {
    if (!(await ready())) return { error: 'BACKEND_BELUM_SIAP' };
    try {
      var res = await getClient().rpc('gerbang_hapus_berhalangan', {
        p_anggota_id: Number(anggotaId),
        p_tanggal: tanggal || null
      });
      if (res.error) return { error: res.error.message };
      return { success: true };
    } catch (err) {
      return { error: err.message };
    }
  }

  /**
   * Simpan pengaturan jadwal gerbang
   */
  async function simpanSetting(s) {
    if (!(await ready())) return { error: 'BACKEND_BELUM_SIAP' };
    try {
      var res = await getClient().rpc('gerbang_simpan_setting', {
        p_tgl_mulai: s.tglMulai || '2026-10-07',
        p_per_hari: Number(s.perHari) || 4,
        p_jam_mulai: s.jamMulai || '06:30',
        p_jam_selesai: s.jamSelesai || '07:00',
        p_hari_aktif: s.hariAktif || [1, 2, 3, 4, 5],
        p_hari_libur: s.hariLibur || '',
        p_tpl_wa: s.tplWa || ''
      });
      if (res.error) return { error: res.error.message };
      return { success: true };
    } catch (err) {
      return { error: err.message };
    }
  }

  return {
    ready: ready,
    getState: getState,
    simpanAnggota: simpanAnggota,
    simpanAnggotaBatch: simpanAnggotaBatch,
    hapusAnggota: hapusAnggota,
    toggleAnggota: toggleAnggota,
    simpanJadwal: simpanJadwal,
    hapusSemuaJadwal: hapusSemuaJadwal,
    simpanBerhalangan: simpanBerhalangan,
    hapusBerhalangan: hapusBerhalangan,
    simpanSetting: simpanSetting
  };
})();
