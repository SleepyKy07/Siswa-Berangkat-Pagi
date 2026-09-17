# Siswa-Berangkat-Pagi

Program absensi sekolah menggunakan QR permanen + server-side validation.

## Arsitektur

| Komponen | Teknologi | Catatan |
|----------|-----------|---------|
| **Frontend** | HTML / CSS / Vanilla JS (GitHub Pages) | Semua file lama tetap bekerja tanpa perubahan |
| **Backend** | Supabase (free tier) | Postgres + Storage + API |
| **Database** | Postgres via Supabase | Tabel: sessions, students, check_ins, pending_students, morning_records, piket_schedule |
| **Storage** | Supabase Storage bucket `selfies` | Privat, dilihat admin via signed URL singkat |
| **Routing** | `/checkin` → status & aksi | QR permanen di gerbang |

## Fitur Utama

- **QR Fisik Permanent**: URL `/checkin` selalu sama, status dicek dari server
- **Status AKTIF / NONAKTIF**: Ditentukan server, tidak bisa diubah localStorage
- **Auto Schedule**: Jam mulai/jam selesai diatur admin di Supabase
- **Check-in Input Manual**: Siswa mengetik **nama & kelas** sendiri → selfie → simpan
- **Data Pending**: Data siswa manual masuk ke tabel `pending_students`, ditinjau admin
- **Siswa Paling Pagi**: Timestamp server terawal hari ini
- **Dashboard Admin**: Status + daftar check-in + lihat selfie + tinjau data pending

## Alur Scan QR

```
QR permanen di gerbang
   ↓
Halaman /checkin/ cek status ke server
   ↓
   ├─ AKTIF    → LANGSUNG pindah ke form pengisian nama
   ├─ NONAKTIF → tampil tulisan besar "ABSENSI TIDAK AKTIF" + jadwal (tanpa tombol)
   └─ ERROR    → pesan jelas + tombol "Coba Lagi"
   ↓ (bila aktif)
Isi nama & kelas (siswa mengetik sendiri)
   ↓
Ambil selfie (kamera browser: preview → ambil → foto ulang / gunakan foto)
   ↓
Konfirmasi → Simpan check-in (timestamp SERVER) + catat ke data pending
```

Identitas yang dipakai hanya: **nama**, **kelas**, **selfie**, **timestamp server**.
NIS **tidak diminta** dan **tidak pernah dikirim ke frontend**.

### Catatan tentang riwayat browser

Browser **tidak mengizinkan** situs menghapus riwayat pengguna — ini aturan keamanan
universal, bukan keterbatasan aplikasi. Karena QR bersifat **permanen**, siswa yang
pernah scan bisa membuka halaman lewat riwayat **tanpa scan ulang**.

Namun ini **tidak merugikan**, karena keabsahan absensi ditentukan server:

| Lapisan | Fungsi |
|---------|--------|
| Sesi harus AKTIF | `submit_checkin_manual()` menolak bila NONAKTIF / di luar jadwal |
| Anti-duplikat | 1 nama+kelas = 1 check-in per hari |
| Waktu server | `current_date` & `now()` dari Postgres, jam HP tidak berpengaruh |

Jadi: buka lewat riwayat **boleh**, tetapi **tidak bisa** absen di luar jam dan
**tidak bisa** dobel dalam satu hari.

> Kekhawatiran yang sah: riwayat tidak bisa mencegah absen "dari rumah". Bila itu
> jadi masalah, aktifkan kembali validasi lokasi GPS (`assets/js/location-check.js`,
> saat ini dimatikan lewat `SCHOOL_GATE = null`).

## Anti-Duplikat

Karena tidak ada ID unik, duplikat dicek dari **nama + kelas** (abaikan besar/kecil
huruf dan spasi berlebih) pada hari yang sama. Jika sama, check-in ditolak dengan
pesan **"Anda sudah melakukan absensi hari ini."**

> **Catatan**: bila siswa salah mengetik nama/kelas (mis. "Eky Sadewa" vs "Eky Sadewaa"),
> sistem menganggapnya orang berbeda. Untuk mengurangi risiko ini, siswa diarahkan
> menulis kelas lengkap dengan format seragam (mis. `XI TKJ 2`).

## Data Pending (Nama/Kelas Manual)

Setiap check-in manual dicatat di tabel `pending_students` dengan status `pending`.

- Dashboard admin → kartu **Data Pending** → tombol **Setujui** / **Abai**
- **Setujui** → baris dipindahkan ke tabel `students` (kolom `nis` diisi otomatis
  `AUTO-<id>` karena constraint `UNIQUE NOT NULL`; NIS tidak dipakai aplikasi)
- **Abai** → status jadi `rejected`; check-in tetap tercatat
- Check-in siswa yang belum disetujui tetap tampil di daftar harian dengan label
  **"belum terdaftar"**

## QR Permanen (untuk ditempel di gerbang)

QR sudah dibuat dan tersedia di:

- `assets/images/qr-checkin.png` — versi berwarna (teal, rounded)
- `assets/images/qr-checkin-bw.png` — versi hitam-putih (paling aman untuk dicetak)

Keduanya mengarah ke URL permanen:

```
https://sleepyky07.github.io/Siswa-Berangkat-Pagi/checkin/
```

### Halaman khusus menampilkan QR

Buka **`checkin/qr.html`** untuk menampilkan QR besar di layar (laptop/tablet/TV):

- Tombol **Layar Penuh** — hanya QR yang tampil, cocok ditaruh di gerbang/lobi
- Tombol **Cetak QR** — langsung bikin versi siap cetak (tombol & teks otomatis disembunyikan)
- Bisa juga dibuka dari dashboard admin: tombol **Tampilkan QR Absensi**

Cara pakai:

1. **Cetak** `qr-checkin-bw.png` (minimal 10×10 cm) untuk ditempel di gerbang, **atau**
2. Buka `checkin/qr.html` di layar lalu aktifkan Layar Penuh
3. QR **tidak perlu diganti** setiap hari — status dicek server saat discan

**Jika domain berubah** (mis. pindah host), QR harus dibuat ulang. Cara membuat ulang:

```bash
pip install "qrcode[pil]"
python -c "import qrcode; qrcode.make('URL_BARU').save('assets/images/qr-checkin-bw.png')"
```

## Kamera & HTTPS (penting)

Browser **hanya mengizinkan kamera** (`getUserMedia`) di *secure context*:

| Cara buka | Kamera |
|-----------|--------|
| `https://...` (mis. GitHub Pages) | ✅ jalan |
| `http://localhost:8080` / `http://127.0.0.1:8080` | ✅ jalan |
| `http://10.180.x.x:8080` (IP LAN) | ❌ diblokir browser |
| `file:///...` (buka file langsung) | ❌ diblokir browser |

Jika kamera ditolak, halaman selfie sekarang menampilkan **pesan spesifik**
(izin ditolak / tidak ada kamera / dipakai aplikasi lain / bukan HTTPS)
beserta tombol **Coba Lagi**.

### Uji di HP lewat LAN (butuh HTTPS)

```bash
python scripts/serve-https.py
```

Lalu buka (terima peringatan sertifikat self-signed):

- Laptop: `https://localhost:8443/checkin/`
- HP: `https://<IP-LAN>:8443/checkin/`

Sertifikat dev disimpan di `.certs/` dan **tidak di-commit** (berisi private key).

## Setup Backend (Supabase Gratis)

1. Daftar di https://supabase.com → buat project baru
2. Buka **SQL Editor** → jalankan script di `supabase/setup.sql`
3. **Jika selfie tidak bisa dilihat** (upload sukses tapi tampil "tidak ditemukan"),
   jalankan juga `supabase/fix-storage.sql` — ini menambah policy SELECT yang
   dibutuhkan untuk membuat signed URL.
4. Buka **Settings → API** → copy **Project URL** dan **anon public key**
5. Edit `assets/js/supabase-config.js` dengan URL + anonKey tersebut
6. Bucket `selfies` dibuat otomatis oleh script (privat)

## Cara Menambah Data Siswa Resmi (opsional)

Alur utama **tidak mewajibkan** data siswa ada di database — siswa mengetik nama &
kelas sendiri, lalu admin menyetujuinya lewat **Data Pending** di dashboard.

Kalau ingin menambah siswa resmi secara manual (agar `nis`-nya rapi):

1. Buka **Table Editor → students → Insert row**
2. Isi `nama`, `kelas`, `nis` (nilai unik apa saja, mis. `S001`), `aktif = true`
3. Atau lewat SQL:

```sql
insert into students (nis, nama, kelas, aktif) values
  ('S001', 'Eky Sadewa',   'XI TKJ 2', true),
  ('S002', 'Andi Saputra', 'XI TKJ 1', true)
on conflict (nis) do nothing;
```

> Siswa dengan `aktif = false` tidak dianggap aktif. Untuk siswa hasil penyetujuan
> pending, `nis` diisi otomatis `AUTO-<id>`.

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

## Hapus Data (Admin)

Dashboard admin → kartu **Hapus Riwayat**:

| Tombol | Yang dihapus |
|---|---|
| 🔍 **Cek Jumlah** | Menghitung dulu berapa data yang akan terhapus |
| 🗑 **Hapus Sebelum Tanggal** | Data sebelum tanggal yang dipilih |
| 🗑 **Hapus Hari Ini** | Semua check-in **hari ini** |
| ⚠ **Hapus Semua Riwayat** | Semua hari **kecuali hari ini** |
| ⚠️ **Hapus SEMUA (termasuk hari ini)** | **Seluruh** data check-in |

Yang terhapus: baris `check_ins`, `pending_students` yang sudah ditinjau
(`approved`/`rejected`), dan **file selfie** di Storage.

- Perlu konfirmasi dengan mengetik `HAPUS` (tidak bisa dibatalkan).
- Jika sebagian file selfie gagal dihapus, data tetap terhapus dan jumlah kegagalan dilaporkan.

## Menutup Sesi dengan Pesan Custom

Saat menutup absensi, admin bisa menulis **pesan khusus** yang muncul di HP siswa:

1. Dashboard admin → **Nonaktifkan Absensi**
2. Tulis **"Pesan untuk siswa"** (opsional, maks. 300 karakter), mis.
   > Absensi diliburkan karena class meeting. Dibuka kembali besok pagi.
3. Simpan

Di HP siswa (saat scan / buka halaman absensi) yang tampil:

```
              ⛔
      ABSENSI TIDAK AKTIF

   ┌─ KETERANGAN ─────────────┐
   │ Absensi diliburkan karena │
   │ class meeting. Dibuka     │
   │ kembali besok pagi.       │
   └───────────────────────────┘

   Sesi absensi Berangkat Pagi sedang ditutup.
   ─────────────────────────
   Jadwal Absensi: 06:00 – 07:00
```

Bila pesan **dikosongkan**, siswa melihat pesan bawaan:
*"Sesi absensi dinonaktifkan sementara oleh petugas."*

Pesan disimpan di kolom `sessions.override_reason` dan dikirim lewat
`get_session_status()` sebagai `override_reason`.

## Apresiasi "Berangkat Pagi" (`berangkat-pagi/`)

Halaman apresiasi kini **tersimpan di server** (bukan localStorage) sehingga bisa
dibuka dari perangkat mana pun dan tidak hilang bila cache dibersihkan:

- **Data siswa** (nama, NIS, kelas, jurusan, JK, telp, alamat) → tabel `students`
- **Catatan "paling pagi"** → tabel `morning_records` (1 siswa per tanggal)
- **Jadwal piket OSIS** → tabel `piket_schedule` (maks 2 petugas per tanggal)
- **Poin apresiasi**: setiap **2x tercatat paling pagi = 1 poin** (dihitung server
  lewat `hitung_poin_siswa`, di-cache di kolom `students.poin_apresiasi`)
- **Import CSV** menulis langsung ke server; baris dengan NIS duplikat dilewati
- **Cadangkan** mengunduh data server lengkap (siswa + pagi + jadwal) sebagai JSON
  (fitur *Pulihkan* dihapus — data master ada di server)
- **Reset Papan** menghapus seluruh catatan pagi + poin dalam satu panggilan
  (`reset_morning_all`)

Halaman ini dilindungi **PIN yang sama dengan dashboard admin** (diatur di
`assets/js/supabase-config.js` → `DASHBOARD_PIN`), dicek di browser. Sama seperti
dashboard: proteksi ringan, bukan keamanan sungguhan.

> **Penting**: pengaitan otomatis ke apresiasi terjadi saat admin **menyetujui**
> data pending — jika check-in siswa adalah yang terawal hari itu dan belum
> tercatat, `approve_pending_student()` memanggil `sync_morning_from_checkin()`.
> Catatan juga bisa ditambah manual dari halaman apresiasi (`tambah_morning_manual`).

> **Peringatan CASCADE**: menghapus siswa dari halaman apresiasi juga menghapus
> seluruh riwayat check-in (`check_ins`) dan catatan pagi (`morning_records`)
> milik siswa tersebut (konstraint `ON DELETE CASCADE` di database).

## Fungsi Server (dijalankan oleh `supabase/setup.sql`)

| Fungsi | Kegunaan |
|--------|----------|
| `get_session_status()` | Status AKTIF/NONAKTIF + jadwal + waktu server |
| `submit_checkin_manual(p_nama, p_kelas, p_selfie_path)` | Simpan check-in manual (timestamp SERVER + anti-duplikat nama/kelas) |
| `list_pending_students(p_status)` | Daftar data siswa pending untuk admin |
| `approve_pending_student(p_id)` | Setujui → masukkan ke tabel `students` |
| `reject_pending_student(p_id)` | Abaikan data pending |
| `list_today_checkins()` | Daftar check-in hari ini (siswa terdaftar & manual) |
| `collect_selfie_paths(p_mode, p_before_date)` | Kumpulkan path selfie yang akan dihapus |
| `count_history_to_delete(p_mode, p_before_date)` | Hitung jumlah data yang akan dihapus |
| `delete_checkin_history(p_mode, p_before_date)` | Hapus data check-in + pending yang ditinjau |
| `hitung_poin_siswa(p_student_id)` | Hitung ulang poin apresiasi seorang siswa |
| `sync_morning_from_checkin(p_checkin_id)` | Catat "paling pagi" bila check-in terawal hari itu |
| `list_apresiasi_siswa()` | Daftar siswa + total pagi + poin + sisa (halaman apresiasi) |
| `list_morning_records(p_dari, p_sampai)` | Riwayat catatan "paling pagi" |
| `tambah_morning_manual(p_identitas, p_tanggal)` | Catat "paling pagi" manual (koreksi/data lama) |
| `hapus_morning_record(p_student_id, p_tanggal)` | Batalkan satu catatan pagi |
| `reset_morning_all()` | Hapus SEMUA catatan pagi + nolkan poin (satu transaksi) |
| `simpan_piket_tanggal(p_tanggal, p_ids)` | Simpan petugas piket per tanggal (maks 2) |
| `hapus_piket_tanggal(p_tanggal)` | Hapus jadwal petugas satu tanggal |
| `list_piket()` | Seluruh jadwal piket |

Mode untuk ketiga fungsi di atas: `before` (sebelum tanggal), `today` (hari ini),
`all_before` (semua riwayat), `all` (semua termasuk hari ini).
| `get_server_date()` | Tanggal hari ini menurut server |
| `find_students(p_q)` / `get_student_public(p_id)` | Utilitas lama (tidak dipakai alur utama) |
| `submit_checkin(p_student_id, p_selfie_path)` | Alur lama berbasis id (tidak dipakai alur utama) |

## Maintenance & Tips

- **Jam server**: `checkin_date` dan `checked_in_at` diambil dari server Postgres.
  Device siswa **tidak** dipercaya untuk waktu check-in.
- **Backup data**: Supabase Dashboard → Export data JSON/SQL kapan saja.
- **Backup frontend**: Semua file lama (`index.html`, `berangkat-pagi/`, `jadwal-gerbang/`, `proker-2/`) tetap berjalan.
- **Jika backend error**: halaman `/checkin` menampilkan pesan jelas tanpa crash.

## Perubahan dari Versi Sebelumnya

1. **Input manual**: siswa mengetik nama & kelas sendiri (bukan pilih dari daftar).
2. **Tabel `pending_students`** + tinjauan admin (Setujui / Abai) di dashboard.
3. **Anti-duplikat baru**: berdasarkan nama + kelas pada hari yang sama.
4. `supabase/setup.sql`: kolom `nama_manual`/`kelas_manual`, `student_id` nullable,
   fungsi `submit_checkin_manual`, `list_pending_students`, `approve_pending_student`,
   `reject_pending_student`, `list_today_checkins`.
5. **Perbaikan selfie**: unggah byte biner (bukan teks base64) + toleransi file lama,
   unduh sebagai blob (hindari ORB), token 1 jam.
6. `checkin/login.html`: dari dropdown → form input nama + kelas.
7. `checkin/dashboard.html`: kartu **Data Pending** + label "belum terdaftar".
8. `checkin/selfie.html` & `success.html`: memakai nama+kelas manual.
 9. **Hapus riwayat** di dashboard admin (sebelum tanggal / semua, termasuk file selfie).
10. Geolocation/anti-asrama tetap **dinonaktifkan** (kolom lokasi tetap ada di DB,
    tidak dipakai). Bisa diaktifkan kembali bila diperlukan.
11. **Migrasi apresiasi "Berangkat Pagi" ke server**: data siswa, catatan pagi,
    dan jadwal piket OSIS kini disimpan di Supabase (tabel `morning_records`,
    `piket_schedule`, kolom lengkap di `students`), tidak lagi di localStorage.
    Halaman apresiasi dilindungi PIN (sama dengan dashboard admin), import CSV
    menulis ke server, fitur *Pulihkan* diganti *Cadangkan* saja, dan *Reset
    Papan* menjadi satu panggilan server (`reset_morning_all`).
    **Jalankan ulang `supabase/setup.sql`** di SQL Editor untuk project yang
    sudah berjalan (semua perubahan bersifat idempotent).

## Cara Menjalankan Secara Lokal (untuk testing)

1. Serve folder repo lewat HTTPS (kamera butuh secure context):

   ```bash
   python scripts/serve-https.py
   ```

   Buka `https://localhost:8443/` (terima peringatan sertifikat self-signed).

2. **Pastikan `supabase/setup.sql` terbaru sudah dijalankan** di SQL Editor
   Supabase (bagian 12–13 diperlukan halaman apresiasi).

3. PIN default: `1234` (ganti di `assets/js/supabase-config.js`).
