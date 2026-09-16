# Siswa-Berangkat-Pagi

Program absensi sekolah menggunakan QR permanen + server-side validation.

## Arsitektur

| Komponen | Teknologi | Catatan |
|----------|-----------|---------|
| **Frontend** | HTML / CSS / Vanilla JS (GitHub Pages) | Semua file lama tetap bekerja tanpa perubahan |
| **Backend** | Supabase (free tier) | Postgres + Storage + API |
| **Database** | Postgres via Supabase | Tabel: sessions, students, check_ins |
| **Storage** | Supabase Storage bucket `selfies` | Privat, dilihat admin via signed URL singkat |
| **Routing** | `/checkin` → status & aksi | QR permanen di gerbang |

## Fitur Utama

- **QR Fisik Permanent**: URL `/checkin` selalu sama, status dicek dari server
- **Status AKTIF / NONAKTIF**: Ditentukan server, tidak bisa diubah localStorage
- **Auto Schedule**: Jam mulai/jam selesai diatur admin di Supabase
- **Check-in Tanpa NIS**: Pilih nama dari daftar → kelas otomatis dari database → selfie → simpan
- **Siswa Paling Pagi**: Timestamp server terawal hari ini
- **Dashboard Admin**: Status + daftar check-in + lihat selfie + jumlah hari ini

## Alur Scan QR (revisi — tanpa NIS)

```
QR permanen di gerbang
   ↓
Cek status sesi (server)  → NONAKTIF? tampilkan "Absensi sedang tidak aktif"
   ↓ AKTIF
Pilih nama siswa (kotak pencarian dari database, bukan input bebas)
   ↓
Kelas otomatis mengikuti data siswa (tidak bisa diketik ulang)
   ↓
Ambil selfie (kamera browser: preview → ambil → foto ulang / gunakan foto)
   ↓
Konfirmasi → Simpan check-in (timestamp SERVER)
```

Identitas yang dipakai hanya: **nama**, **kelas**, **selfie**, **timestamp server**.
NIS **tidak diminta** dan **tidak pernah dikirim ke frontend**.

## QR Permanen (untuk ditempel di gerbang)

QR sudah dibuat dan tersedia di:

- `assets/images/qr-checkin.png` — versi berwarna (teal, rounded)
- `assets/images/qr-checkin-bw.png` — versi hitam-putih (paling aman untuk dicetak)

Keduanya mengarah ke URL permanen:

```
https://sleepyky07.github.io/Siswa-Berangkat-Pagi/checkin/
```

Cara pakai:

1. Cetak `qr-checkin-bw.png` (ukuran disarankan minimal 10×10 cm agar mudah discan).
2. Tempel di gerbang/pintu masuk sekolah.
3. QR **tidak perlu diganti** setiap hari — status AKTIF/NONAKTIF dicek dari server
   setiap kali discan.
4. Halaman `/checkin/` juga menampilkan QR ini, jadi siswa bisa memindainya
   langsung dari layar bila perlu.

**Jika domain berubah** (mis. pindah host), QR harus dibuat ulang. Cara membuat ulang:

```bash
pip install "qrcode[pil]"
python -c "import qrcode; qrcode.make('URL_BARU').save('assets/images/qr-checkin-bw.png')"
```

## Setup Backend (Supabase Gratis)

1. Daftar di https://supabase.com → buat project baru
2. Buka **SQL Editor** → jalankan script di `supabase/setup.sql`
3. **Jika selfie tidak bisa dilihat** (upload sukses tapi tampil "tidak ditemukan"),
   jalankan juga `supabase/fix-storage.sql` — ini menambah policy SELECT yang
   dibutuhkan untuk membuat signed URL.
4. Buka **Settings → API** → copy **Project URL** dan **anon public key**
5. Edit `assets/js/supabase-config.js` dengan URL + anonKey tersebut
6. Bucket `selfies` dibuat otomatis oleh script (privat)

## Cara Mengisi Data Siswa (tanpa NIS)

Aplikasi **tidak memakai NIS**, tetapi tabel `students` memiliki kolom `nis`
yang `not null unique` (warisan skema lama). Karena itu:

**Cara 1 — Supabase Dashboard (paling mudah)**

1. Buka **Table Editor → students**
2. **Insert row**, isi:
   - `nama` = nama siswa (mis. `Eky Sadewa`)
   - `kelas` = kelas (mis. `XI TKJ 2`)
   - `nis` = nilai unik apa saja (mis. `S001`, `S002`, …) — tidak dipakai aplikasi, hanya syarat kolom
   - `aktif` = `true` (biarkan default)
   - Kolom `jurusan` / `jk` boleh dikosongkan
3. Ulangi untuk setiap siswa

**Cara 2 — SQL Editor**

```sql
insert into students (nis, nama, kelas, aktif) values
  ('S001', 'Eky Sadewa',   'XI TKJ 2', true),
  ('S002', 'Andi Saputra', 'XI TKJ 1', true),
  ('S003', 'Citra Dewi',   'X TKJ 1',  true)
on conflict (nis) do nothing;
```

**Cara 3 — Import CSV**

Siapkan CSV dengan kolom `nis,nama,kelas` lalu gunakan
**Table Editor → Import data from CSV**.

> Siswa dengan `aktif = false` tidak muncul di pencarian nama dan tidak bisa check-in.
> Gunakan ini untuk menonaktifkan siswa tanpa menghapus datanya.

## Privasi & Selfie

- Bucket `selfies` bersifat **privat** (`public = false`).
- **Penting**: agar signed URL bisa dibuat, bucket butuh policy **SELECT**
  pada `storage.objects` (lihat `supabase/fix-storage.sql`). Tanpa policy ini,
  upload berhasil tapi foto tidak bisa dibuka ("Object not found").
- Karena dashboard admin **tanpa login**, siapa pun yang tahu URL dashboard
  bisa melihat selfie. Mitigasi: URL signed hanya berlaku **60 detik**, nama file
  memakai tanggal + id + jam + random sehingga sulit ditebak, dan bucket tetap privat.
- **Tidak ada face recognition / face matching.** Selfie hanya bukti visual kehadiran.
- Selfie disimpan sebagai file di Storage; database hanya menyimpan `selfie_path`.
- **Catatan penting**: untuk keamanan penuh, tambahkan Supabase Auth pada dashboard
  lalu persempit policy SELECT hanya untuk user yang login.

## PIN Dashboard Admin

Dashboard dilindungi **PIN sederhana** (dicek di browser):

- Atur PIN di `assets/js/supabase-config.js` → `DASHBOARD_PIN` (default `1234`).
- Status "sudah dibuka" disimpan di `sessionStorage`, jadi tidak diminta berulang
  selama tab masih terbuka. Tombol **Keluar** untuk mengunci lagi.
- **Ini proteksi ringan, bukan keamanan sungguhan** — karena semua kode berjalan
  di browser, orang teknis tetap bisa membaca PIN dari source. Tujuannya hanya
  mencegah siswa/umum iseng mengaktifkan sesi atau melihat selfie.
- Untuk keamanan nyata, gunakan Supabase Auth (login admin) lalu batasi policy
  sesuai `auth.uid()`.

## Pencegahan Duplikat

- Satu siswa hanya boleh 1 check-in valid per hari (`unique(student_id, checkin_date)`).
- Jika sudah check-in, muncul pesan: **"Anda sudah melakukan absensi hari ini."**
- Validasi dilakukan di server (fungsi `submit_checkin()`), bukan di browser.

## Siswa Paling Pagi

- **Semua** check-in valid tetap disimpan.
- Sistem menandai siswa dengan `checked_in_at` (timestamp server) paling awal
  sebagai **"Siswa Paling Pagi"** — ditampilkan di kartu khusus dashboard dan
  label pada baris pertama tabel.

## Fungsi Server (dijalankan oleh `supabase/setup.sql`)

| Fungsi | Kegunaan |
|--------|----------|
| `get_session_status()` | Status AKTIF/NONAKTIF + jadwal + waktu server |
| `find_students(p_q)` | Cari siswa by nama (aktif saja), hasil: id, nama, kelas |
| `get_student_public(p_id)` | Ambil nama + kelas by id (validasi aktif) |
| `submit_checkin(p_student_id, p_selfie_path)` | Simpan check-in dengan tanggal/jam SERVER + anti-duplikat |
| `get_server_date()` | Tanggal hari ini menurut server |
| `get_selfie_url(p_path)` | Signed URL sementara (60 detik) untuk admin |

## Maintenance & Tips

- **Jam server**: `checkin_date` dan `checked_in_at` diambil dari server Postgres.
  Device siswa **tidak** dipercaya untuk waktu check-in.
- **Backup data**: Supabase Dashboard → Export data JSON/SQL kapan saja.
- **Backup frontend**: Semua file lama (`index.html`, `berangkat-pagi/`, `jadwal-gerbang/`, `proker-2/`) tetap berjalan.
- **Jika backend error**: halaman `/checkin` menampilkan pesan jelas tanpa crash.

## Perubahan dari Versi Sebelumnya

1. Alur check-in **tanpa NIS** — memakai pencarian & pilih nama.
2. `supabase/setup.sql`: tambah kolom `aktif`, 5 fungsi baru, **hapus policy baca selfie publik**.
3. `assets/js/supabase-client.js`: buang `findStudentByNIS`, tambah `findStudentsByName`,
   `getStudentPublic`, `getServerDate`, `getSelfieUrl`; `submitCheckIn` kini memakai RPC
   server-side; ditambah `export default` agar dashboard & halaman sukses tidak error.
4. `checkin/login.html`: dari input NIS → pencarian & pilih nama.
5. `checkin/selfie.html` & `checkin/success.html`: pakai id internal, buang blok lokasi,
   perbaiki bug import module.
6. `checkin/dashboard.html`: perbaiki import module, kolom NIS → Kelas, tombol **Lihat Selfie**,
   perbaiki bug pengurutan tanggal.
7. Geolocation/anti-asrama **dinonaktifkan** dari alur (kolom lokasi tetap ada di DB,
   tidak dipakai). Bisa diaktifkan kembali bila diperlukan.
