# Siswa-Berangkat-Pagi

Program absensi sekolah menggunakan QR permanen + server-side validation.

## Arsitektur

| Komponen | Teknologi | Catatan |
|----------|-----------|---------|
| **Frontend** | HTML / CSS / Vanilla JS (GitHub Pages) | Semua file lama tetap bekerja tanpa perubahan |
| **Backend** | Supabase (free tier) | Postgres + Storage + API |
| **Database** | Postgres via Supabase | Tabel: sessions, students, check_ins |
| **Storage** | Supabase Storage bucket `selfies` | Simpan foto selfie tanpa publik |
| **Routing** | `/checkin` → status & aksi | QR permanen di gerbang |

## Fitur Utama

- **QR Fisik Permanent**: URL `/checkin` selalu sama, status dicek dari server
- **Status AKTIF / NONAKTIF**: Ditenang server, tidak bisa diubah lokalStorage
- **Auto Schedule**: Jam mulai/jam selesai diatur admin di Supabase
- **Check-in Server-Validated**: NIS → verifikasi identitas → selfie → simpan absensi
- **Siswa Paling Pagi**: Timestamp server terawal hari ini
- **Dashboard Admin**: Status + daftar check-in + jumlah hari ini

## Setup Backend (Supabase Gratis)

1. Daftar di https://supabase.com → buat project baru
2. Buka **SQL Editor** → jalankan script di `supabase/setup.sql`
3. Buka **Settings → API** → copy **Project URL** dan **anon public key**
4. Edit `assets/js/supabase-config.js` dengan URL + anonKey tersebut
5. (Opsional) Bucket `selfies` di Storage untuk menyimpan foto

## Alur Scan QR

1. Siswa scan QR fisik di gerbang → menuju `/checkin`
2. Halaman `/checkin` meminta status sesi ke **backend Supabase** (`get_session_status()`)
3. Jika **NONAKTIF**: tampilkan "Absensi Berangkat Pagi sedang tidak aktif"
4. Jika **AKTIF**: tampilkan halaman login/selfie flow
5. Admin dapat override status manual via dashboard atau API `POST /admin/toggle-session`

## Perubahan File (Section A)

```
checkin/                  # NEW - QR scan entry point
├── index.html           # Halaman /checkin - cek status, tunjuk aktif/mati
└── login.html           # Identifikasi siswa via NIS
└── selfie.html          # Browser camera selfie capture
└── success.html         # Hasil check-in berhasil

assets/js/
├── supabase-config.js   # Konfigurasi URL + anon key Supabase (edit di sini)
├── supabase-client.js   # Klien backend: getSessionStatus, submitCheckIn, findStudentByNIS, dll
└── checkin.js           # Logika halaman /checkin
└── (file lama tetap berjalan)

supabase/
├── setup.sql            # SQL schema untuk Supabase (jalankan di SQL Editor)
└── setup-guide.html     # Panduan langkah demi langkah setup

README.md                # Diperbarkan dengan dokumentasi di atas
```

## Maintenance & Tips

- **Jam server**: Disimpan di Postgres server (WIB/Asia/Jakarta timezone). Device siswa **tidak** dipercaya untuk waktu check-in.
- **Selfie**: Simpan di Supabase Storage bucket `selfies`. Batas akses hanya pihak berwenang. Jangan buat galeri publik.
- **Backup data**: Di Supabase Dashboard → Export data JSON/SQL kapan saja.
- **Backup frontend**: Semua file lama (`index.html`, `berangkat-pagi/`, `jadwal-gerbang/`, `proker-2/`) tetap bisa diakses tanpa settingan backend.
- **Jika backend error**: Halaman `/checkin` menampilkan pesan "Backend belum dikonfigurasi" tanpa crash.