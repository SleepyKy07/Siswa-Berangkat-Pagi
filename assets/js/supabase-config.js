/* ================================================================
   SUPABASE CONFIGURATION
   ================================================================
   1. Create a free project at https://supabase.com
   2. Go to Settings → API → copy Project URL and anon/public key
   3. Paste them below
   4. Run the SQL in supabase/setup.sql in Supabase SQL Editor
   ================================================================ */

/*
   LOKASI GERBANG SEKOLAH (untuk validasi anti-asrama) — SAAT INI DINONAKTIFKAN
   - QR permanen ditempel di gerbang sekolah
   - Jika siswa scan dari asrama (jauh dari gerbang), cek lokasi
   - Radius maksimal dari gerbang (meter) untuk dianggap "di gerbang"
   - Untuk mengaktifkan: isi latitude/longitude/radius, lalu ubah menjadi object
   - Untuk menonaktifkan: biarkan null
*/
var SCHOOL_GATE = null; // NULL = validasi lokasi dimatikan (tidak minta izin lokasi)

/* Contoh jika ingin diaktifkan kembali:
var SCHOOL_GATE = {
  latitude:  -6.200000,  // koordinat gerbang sekolah
  longitude: 106.800000, // koordinat gerbang sekolah
  radiusMeters: 30       // toleransi radius (meter)
};
*/

/*
   PIN DASHBOARD ADMIN — proteksi ringan.
   - Ganti nilainya dengan PIN pilihanmu.
   - PIN ini dicek di browser (bukan server), jadi hanya untuk mencegah orang
     iseng membuka dashboard — BUKAN keamanan sungguhan.
   - Untuk keamanan nyata: pakai Supabase Auth (lihat README).
*/
var DASHBOARD_PIN = '1234';

window.SUPABASE_CONFIG = {
  url: 'https://uccqvftgboflrpmlfawb.supabase.co',
  anonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVjY3F2ZnRnYm9mbHJwbWxmYXdiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODk0ODc3OTEsImV4cCI6MjEwNTA2Mzc5MX0.sL8N_dcGGhIitrLFT2fTM0hfhQedwRXoBWb43aBCRHQ',
  // PIN dashboard admin (proteksi ringan)
  dashboardPin: typeof DASHBOARD_PIN !== 'undefined' ? DASHBOARD_PIN : '1234',
  // school gate untuk validasi lokasi (opsional — null = dimatikan)
  schoolGate: typeof SCHOOL_GATE !== 'undefined' ? SCHOOL_GATE : null
};