# Siswa-Berangkat-Pagi

Program absensi sekolah menggunakan QR permanen + server-side validation.

## Arsitektur

| Komponen | Teknologi | Catatan |
|----------|-----------|---------|
| **Frontend** | HTML / CSS / Vanilla JS (GitHub Pages) | Semua file lama tetap bekerja tanpa perubahan |
| **Backend** | Supabase (free tier) | Postgres + Storage + API |
| **Database** | Postgres via Supabase | Tabel: sessions, students, check_ins, pending_students, morning_records |
| **Storage** | Supabase Storage bucket `selfies` | Privat, dilihat admin via signed URL singkat |
| **Routing** | `/checkin` → status & aksi | QR permanen di gerbang |

## Fitur Utama

- **QR Fisik Permanent**: URL `/checkin` selalu sama, status dicek dari server
- **Status AKTIF / NONAKTIF**: Ditentukan server, tidak bisa diubah localStorage
- **Auto Schedule**: Jam mulai/jam selesai diatur admin di Supabase
- **Check-in Input Manual**: Siswa mengetik **nama & kelas** sendiri → selfie → simpan
- **Data Pending**: Nama/kelas yang belum cocok dengan siswa terdaftar masuk `pending_students`, ditinjau admin
- **Berangkat Pagi**: Semua check-in sebelum jam tutup sesi (mis. 06:40) dicatat dan diperlakukan sama (1x = 1 poin)
- **Dashboard Admin**: Status + daftar check-in + status poin + lihat selfie + tinjau data pending

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
Konfirmasi → Simpan check-in (timestamp SERVER) → langsung tercatat berangkat pagi bila nama+kelas cocok dengan siswa aktif; nama baru masuk data pending
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
| Waktu server | `now_wib()` (WIB, `Asia/Jakarta`) dari Postgres, jam HP tidak berpengaruh |

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

Check-in dengan **nama + kelas yang belum cocok** dengan siswa aktif dicatat di
tabel `pending_students` dengan status `pending`. Siswa yang sudah terdaftar
langsung tercatat sebagai berangkat pagi dan langsung mendapat poin.

- Dashboard admin → kartu **Data Pending** → tombol **Setujui** / **Abai**
- **Setujui** → baris dipindahkan ke tabel `students` (kolom `nis` diisi otomatis
  `AUTO-<id>` karena constraint `UNIQUE NOT NULL`; NIS tidak dipakai aplikasi)
- **Abai** → status jadi `rejected`; check-in tetap tercatat
- Check-in siswa yang belum disetujui tetap tampil di daftar harian dengan label
  **"belum terdaftar"**
- Setelah **Setujui**, check-in ditautkan ke siswa dan catatan berangkat pagi
  (poin) dibuat otomatis

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
   - Untuk project lama, **jalankan ulang `setup.sql`**. Blok backfill akan
     menambahkan semua check-in lama yang sudah tertaut ke siswa dan menghitung
     ulang poin (1 catatan = 1 poin). Blok koreksi **12l** juga memberi **1 poin**
     kepada siswa yang masih 0 poin tetapi sudah pernah check-in (termasuk
     check-in manual lama yang belum tertaut, dicocokkan lewat nama + kelas).
     Hanya 1 catatan per siswa dan idempotent. **Backup data dulu.**
   - Sebelum backfill, cek apakah ada check-in setelah jam tutup:
     `select count(*) from check_ins where (checked_in_at at time zone 'Asia/Jakarta')::time >= '06:40';`
   - Koreksi khusus jam check-in **>= 06:40** tersedia terpisah di
     `supabase/fix-jam-0640.sql`. Jalankan **sekali** setelah backup; script
     ini tidak dijalankan otomatis oleh `setup.sql`.
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
- Anti-duplikat nama + kelas juga diterapkan untuk check-in manual pada hari yang sama.
- Jika sudah check-in, muncul pesan: **"Anda sudah melakukan absensi hari ini."**
- Validasi dilakukan di server (fungsi `submit_checkin_manual()`), bukan di browser.

## Berangkat Pagi

- **Semua** check-in valid selama sesi QR aktif dicatat sebagai **"Berangkat Pagi"**.
- Setiap **1 catatan = 1 poin** apresiasi.
- Banyak siswa boleh tercatat pada tanggal yang sama; 1 siswa maksimal 1 catatan
  per tanggal (`unique(student_id, tanggal)`).
- Tidak ada lagi penanda siapa yang datang lebih dulu: semua siswa yang
  berhasil check-in sebelum jam tutup sesi mendapat perlakuan dan poin yang sama.
- Siswa terdaftar langsung mendapat poin saat check-in; siswa baru mendapat poin
  setelah admin menyetujui data pending.

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

- **Catatan berangkat pagi dan poin tidak ikut terhapus** saat riwayat check-in
  dihapus. Ini sengaja dipertahankan agar poin yang sudah diberikan tidak hilang.
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
- **Catatan berangkat pagi** → tabel `morning_records` (banyak siswa per tanggal;
  1 siswa maksimal 1x per tanggal), termasuk **jam daftar presisi**
  (`checkin_at` = jam server saat siswa check-in; fallback `recorded_at` bila
  catatan manual tanpa check-in)
- **Poin apresiasi**: setiap **1x berangkat pagi = 1 poin** (dihitung server
  lewat `hitung_poin_siswa`, di-cache di kolom `students.poin_apresiasi`)
- **Jam ditampilkan presisi** (jam:menit:detik) dan **selalu WIB** (`Asia/Jakarta`)
  di *Riwayat Berangkat Pagi* — tidak ikut zona waktu perangkat pembuka halaman
- **Import CSV** menulis langsung ke server; baris dengan NIS duplikat dilewati
- **Cadangkan** mengunduh data server lengkap (siswa + pagi) sebagai JSON
  (fitur *Pulihkan* dihapus — data master ada di server)
- **Reset Papan** menghapus seluruh catatan pagi + poin dalam satu panggilan
  (`reset_morning_all`)
- **Tombol Segarkan** (pojok kanan atas): memuat ulang data dari server. Poin di
  server memang otomatis terhitung saat admin menyetujui data pending, tapi
  halaman ini tidak memuat ulang sendiri — klik Segarkan untuk melihatnya.
  Bila ada siswa yang poinsnya bertambah sejak terakhir (mis. baru di-approve
  di dashboard), efek apresiasi (toast + konfeti) dimunculkan di sini juga.

Halaman ini **tidak memakai PIN** — langsung terbuka (tombol **Kunci/Keluar** dan
layar PIN dihapus). PIN hanya dipakai oleh dashboard admin (`checkin/dashboard.html`).

> **Penting**: pengaitan otomatis ke apresiasi terjadi saat check-in (siswa
> terdaftar) atau saat admin **menyetujui** data pending. `submit_checkin_manual()`
> dan `approve_pending_student()` memanggil `sync_morning_from_checkin()`, yang
> mencatat semua check-in yang sudah tertaut — bukan hanya yang terawal.
> Penambahan manual tidak lagi tersedia di UI; koreksi dilakukan lewat tombol
> **Batalkan** (`hapus_morning_record`). Fungsi `tambah_morning_manual()` tetap
> ada untuk kebutuhan SQL/API.

> **Peringatan CASCADE**: menghapus siswa dari halaman apresiasi juga menghapus
> seluruh riwayat check-in (`check_ins`) dan catatan pagi (`morning_records`)
> milik siswa tersebut (konstraint `ON DELETE CASCADE` di database).

## Fungsi Server (dijalankan oleh `supabase/setup.sql`)

| Fungsi | Kegunaan |
|--------|----------|
| `get_session_status()` | Status AKTIF/NONAKTIF + jadwal + waktu server |
| `submit_checkin_manual(p_nama, p_kelas, p_selfie_path)` | Simpan check-in (timestamp SERVER + anti-duplikat nama/kelas & student_id); siswa terdaftar langsung dapat poin |
| `list_pending_students(p_status)` | Daftar data siswa pending untuk admin |
| `approve_pending_student(p_id)` | Setujui → masukkan ke tabel `students` + catat berangkat pagi/poin |
| `reject_pending_student(p_id)` | Abaikan data pending |
| `list_today_checkins()` | Daftar check-in hari ini (termasuk `student_id` untuk status poin) |
| `collect_selfie_paths(p_mode, p_before_date)` | Kumpulkan path selfie yang akan dihapus |
| `count_history_to_delete(p_mode, p_before_date)` | Hitung jumlah data yang akan dihapus |
| `delete_checkin_history(p_mode, p_before_date)` | Hapus data check-in + pending yang ditinjau |
| `hitung_poin_siswa(p_student_id)` | Hitung ulang poin apresiasi (1 catatan = 1 poin) |
| `sync_morning_from_checkin(p_checkin_id)` | Catat semua check-in yang sudah tertaut sebagai berangkat pagi (bukan hanya terawal) |
| `list_apresiasi_siswa()` | Daftar siswa + total pagi + poin (halaman apresiasi) |
| `list_morning_records(p_dari, p_sampai)` | Riwayat catatan berangkat pagi + `source` (`checkin`/`manual`) |
| `tambah_morning_manual(p_identitas, p_tanggal)` | Catat berangkat pagi manual (koreksi/data lama) |
| `hapus_morning_record(p_student_id, p_tanggal)` | Batalkan satu catatan berangkat pagi |
| `reset_morning_all()` | Hapus SEMUA catatan berangkat pagi + nolkan poin (satu transaksi) |

Mode untuk ketiga fungsi di atas: `before` (sebelum tanggal), `today` (hari ini),
`all_before` (semua riwayat), `all` (semua termasuk hari ini).
| `get_server_date()` | Tanggal hari ini menurut server |
| `find_students(p_q)` / `get_student_public(p_id)` | Utilitas lama (tidak dipakai alur utama) |
| `submit_checkin(p_student_id, p_selfie_path)` | Alur lama berbasis id (tidak dipakai alur utama) |

## Maintenance & Tips

- **Jam server selalu WIB**: zona database Supabase umumnya **UTC**, jadi semua
  evaluasi waktu di SQL (jadwal sesi, tanggal check-in, "hari ini", hapus riwayat)
  memakai helper `now_wib()` = `now() at time zone 'Asia/Jakarta'`. Hasil konsisten
  WIB apa pun setting zona database-nya.
- **Jam server**: `checkin_date` dan `checked_in_at` diambil dari server Postgres.
  Device siswa **tidak** dipercaya untuk waktu check-in.
- **Backup data**: Supabase Dashboard → Export data JSON/SQL kapan saja.
- **Backup frontend**: Semua file lama (`index.html`, `berangkat-pagi/`, `jadwal-gerbang/`) tetap berjalan. `proker-2/` kini menjadi **halaman pengalihan** ke `checkin/dashboard.html`.

## Portal Program Kerja

Halaman depan (`index.html`) menampilkan kartu program:

- **Berangkat Pagi** → `berangkat-pagi/` (halaman apresiasi, tanpa PIN)
- **Jadwal Petugas Gerbang** → `jadwal-gerbang/`
- **Dashboard Absensi (Admin)** → `checkin/dashboard.html` (PIN) — tidak perlu
  lagi mengetik URL manual; slot `proker-2/` otomatis dialihkan ke sini.

Statistik **Siswa Terdata** & **Apresiasi Diberikan** diambil langsung dari
server (`list_apresiasi_siswa`) — tampil `-` bila backend belum dikonfigurasi
atau sedang offline.
- **Jika backend error**: halaman `/checkin` menampilkan pesan jelas tanpa crash.

## Pasang sebagai Aplikasi (PWA)

Portal (`index.html`) sudah bisa **dipasang sebagai aplikasi** di HP — icon di
layar utama, terbuka **fullscreen tanpa URL bar**, jadi tidak perlu lagi membuka
browser dan mengetik alamat.

**Cara pasang (Android / Chrome):**

1. Buka `https://sleepyky07.github.io/Siswa-Berangkat-Pagi/` di Chrome.
2. Muncul bilah **"Pasang"** di bawah — ketuk. (Bila tidak muncul: menu **⋮**
   → **Add to Home screen** / **Install app**.)
3. Icon **Portal OSIS** muncul di layar utama. Buka dari situ.

Setiap kali repo di-`push`, aplikasi **otomatis memakai versi terbaru** — tidak
perlu pasang ulang.

**Cara kerjanya:**

- `manifest.webmanifest` — mendefinisikan nama, icon (`logo-osis.png`), warna,
  dan `start_url` → portal.
- `sw.js` — service worker: menyimpan app-shell agar bisa dibuka cepat & tetap
  tampil saat koneksi buruk. Permintaan ke Supabase **tidak** di-cache, jadi data
  absensi selalu real-time.
- Diubah `CACHE_VERSION` pada `sw.js` untuk memaksa semua perangkat mengambil
  aset terbaru (mis. setelah mengganti CSS/JS besar).

> **Catatan**: PWA butuh **HTTPS** (GitHub Pages sudah HTTPS). Di iOS, pasang
> lewat Safari → **Add to Home Screen** (tanpa bilah "Pasang" otomatis).
> Alur siswa **tidak berubah** — tetap cukup **scan QR** untuk check-in.

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
11. **Migrasi apresiasi "Berangkat Pagi" ke server**: data siswa, catatan pagi kini
    disimpan di Supabase (tabel `morning_records`, kolom lengkap di `students`),
    tidak lagi di localStorage.
    Halaman apresiasi dilindungi PIN (sama dengan dashboard admin), import CSV
    menulis ke server, fitur *Pulihkan* diganti *Cadangkan* saja, dan *Reset
    Papan* menjadi satu panggilan server (`reset_morning_all`).
    **Jalankan ulang `supabase/setup.sql`** di SQL Editor untuk project yang
    sudah berjalan (semua perubahan bersifat idempotent).
    *(PIN halaman apresiasi kemudian dihapus — lihat changelog #14.)*
12. **Semua waktu dipaksa WIB (`Asia/Jakarta`)**: helper baru `now_wib()` menggantikan
    `localtime`/`current_date`/`localtimestamp` di seluruh fungsi & default kolom
    (`check_ins.checkin_date`, `morning_records.tanggal`). Berguna karena zona DB
    Supabase default UTC — jadwal sesi, tanggal check-in, dan hapus riwayat kini
    selalu mengikuti WIB. `setup.sql` juga mengoreksi data lama (tanggal check-in &
    catatan pagi) lalu menghitung ulang poin. **Jalankan ulang `setup.sql`**.
13. **Jadwal piket di halaman apresiasi dihapus**: karena jadwal petugas gerbang
    sudah lengkap di program kerja terpisah, bagian jadwal piket (tombol 📅 Jadwal,
    kalender, editor petugas, dan kotak "Petugas piket hari ini" di halaman apresiasi)
    dihapus dari `berangkat-pagi/index.html`. Tabel `piket_schedule` + fungsi
    `simpan_piket_tanggal`/`hapus_piket_tanggal`/`list_piket` beserta wrapper
    kliennya dibuang. **Jalankan ulang `setup.sql`** — bagian 13 kini berupa blok
    `drop` idempotent yang membersihkan tabel & fungsi lama.
14. **PIN halaman apresiasi dihapus**: halaman `berangkat-pagi/` kini **tanpa PIN** —
    layar PIN, tombol "Kunci/Keluar", dan logikanya dibuang. PIN tetap dipakai
    dashboard admin saja. Selain itu, **progress "Menuju apresiasi"** di halaman
    apresiasi, CSV, dan papan peringkat kini menampilkan **sisa (0/2–1/2)** — bukan total
    mentah, sehingga tidak lagi melebihi batas (mis. "3/2"). Saat mencapai 2 catatan
    (genap), progress **kembali 0/2** sementara **poin tetap bertambah**.
15. **Semua check-in selama sesi = 1 poin**: aturan lama yang hanya memberi poin
    ke satu siswa diganti. Setiap check-in yang berhasil selama QR aktif (mis.
    06:00–06:40, diatur admin) dicatat sebagai berangkat pagi dan mendapat 1 poin.
    Banyak siswa boleh tercatat pada tanggal yang sama; 1 siswa maksimal 1x per
    tanggal. Siswa terdaftar langsung mendapat poin saat check-in; nama baru
    mendapat poin setelah disetujui. `sync_morning_from_checkin()` tidak lagi
    mensyaratkan check-in terawal, `submit_checkin_manual()` langsung menautkan
    siswa terdaftar, `hitung_poin_siswa()`/`list_apresiasi_siswa()` memakai
    1 catatan = 1 poin, `list_today_checkins()` mengembalikan `student_id`, dan
    `list_morning_records()` mengembalikan `source`. Halaman apresiasi kini
    menampilkan banyak siswa per tanggal, tanpa penanda siapa yang datang lebih
    dulu. **Jalankan ulang `setup.sql`** untuk backfill check-in lama
    (backup dulu; cek check-in setelah 06:40).
16. **Tab Catat Pagi dihapus**: halaman `berangkat-pagi/` kini hanya punya tab
    **Data Siswa** dan **Papan Apresiasi**. Input tanggal, statistik harian,
    daftar "Tercatat pada Tanggal Ini", tombol Batalkan per siswa, dan Reset
    Catatan per tanggal dihapus. Waktu scan tetap terlihat di **Riwayat Berangkat
    Pagi** (nama, kelas, tanggal, jam WIB). Koreksi massal tetap lewat
    **Reset Papan**.
17. **Koreksi siswa 0 poin**: blok `12l` di `setup.sql` memberi **1 poin**
    kepada siswa yang masih 0 poin tetapi punya minimal satu check-in — termasuk
    check-in manual lama yang belum tertaut ke `students` (dicocokkan lewat
    nama + kelas ternormalisasi). Yang ditambahkan blok ini hanya satu
    `morning_records` pada tanggal check-in paling awal, memakai jam check-in
    aslinya — bukan seluruh riwayat check-in siswa tersebut. Idempotent: siswa
    yang sudah punya catatan dilewati dan `on conflict` mencegah duplikat.
    **Jalankan ulang `setup.sql`** (backup dulu). Query verifikasi ada di
    komentar blok `12l`.
18. **Badge "manual" di riwayat dihapus**: label `manual` pada *Riwayat
    Berangkat Pagi* dihapus agar tidak membingungkan. Data
    `morning_records.source` tetap disimpan di server, tetapi tidak lagi
    ditampilkan di UI.
19. **Koreksi jam check-in >= 06:40**: script terpisah
    `supabase/fix-jam-0640.sql` mengubah jam check-in siswa yang >= 06:40 WIB
    ke rentang 06:39:00–06:39:59 WIB tanpa mengubah tanggal. Mapping dilakukan
    berurutan agar urutan record tetap terjaga; `morning_records.recorded_at`
    untuk catatan manual tanpa `checkin_at` ikut dikoreksi. Script membuat
    backup dan memverifikasi hasil. Record `check_ins` tanpa `student_id`
    (pending/rejected) tidak diubah; poin tidak dihitung ulang. Jalankan
    **sekali**, bukan bagian dari `setup.sql`.

## Cara Menjalankan Secara Lokal (untuk testing)

1. Serve folder repo lewat HTTPS (kamera butuh secure context):

   ```bash
   python scripts/serve-https.py
   ```

   Buka `https://localhost:8443/` (terima peringatan sertifikat self-signed).

2. **Pastikan `supabase/setup.sql` terbaru sudah dijalankan** di SQL Editor
   Supabase (bagian 10–13 diperlukan halaman apresiasi & check-in).

3. PIN default: `1234` (ganti di `assets/js/supabase-config.js`).
