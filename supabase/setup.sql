/* ================================================================
   SUPABASE DATABASE SETUP
   ================================================================
   1. Login ke https://supabase.com/dashboard
   2. Pilih project baru
   3. Buka tab "SQL Editor"
   4. Copy dan jalankan script di bawah ini
   5. Masukkan SUPABASE_CONFIG ke assets/js/supabase-config.js
   ================================================================ */

-- 1. Tabel sessions (setiap project punya 1 baris id=1)
create table if not exists sessions (
  id int primary key default 1 check (id = 1),
  manual_override text check (manual_override in ('AKTIF','NONAKTIF')) null,
  scheduled_starts_at time null,
  scheduled_ends_at time null,
  override_reason text default null,
  updated_at timestamptz default now()
);

-- Tambah kolom override_reason jika belum ada (untuk DB lama)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'sessions' AND column_name = 'override_reason') THEN
    ALTER TABLE sessions ADD COLUMN override_reason text default null;
  END IF;
END
$$;

-- Sisipkan baris default kalau belum ada (dengan jadwal 06:00–07:00 otomatis)
insert into sessions (id, scheduled_starts_at, scheduled_ends_at)
values (1, '06:00:00', '07:00:00')
on conflict (id) do nothing;

-- 2. Fungsi untuk mendapatkan status session (sumber kebenaran server)
-- Perbaikan: jika schedule NULL, hasil FALSE (bukan NULL) agar konsisten di frontend
create or replace function get_session_status()
returns jsonb
language sql
security definer
as $$
  select jsonb_build_object(
    'active',
    case
      when s.manual_override is not null then (s.manual_override = 'AKTIF')
      when s.scheduled_starts_at is null or s.scheduled_ends_at is null then false
      else (localtime >= s.scheduled_starts_at and localtime < s.scheduled_ends_at)
    end,
    'manual_override', s.manual_override,
    'scheduled_starts_at', to_char(s.scheduled_starts_at, 'HH24:MI'),
    'scheduled_ends_at', to_char(s.scheduled_ends_at, 'HH24:MI'),
    'server_time', to_char(localtimestamp, 'YYYY-MM-DD HH24:MI:SS')
  )
  from sessions s
  where s.id = 1
$$;

-- 3. Tabel students (identitas siswa — bisa diimport dari localStorage lama)
create table if not exists students (
  id bigint generated always as identity primary key,
  nis text not null unique,
  nama text not null,
  kelas text default '',
  jurusan text default '',
  jk text default 'L' check (jk in ('L','P')),
  created_at timestamptz default now()
);

-- Tambahkan kolom `aktif` pada students (untuk DB lama). Siswa nonaktif tidak
-- muncul di pencarian nama dan tidak boleh check-in.
alter table students add column if not exists aktif boolean not null default true;

-- 4. Tabel check_ins (rekam absensi server-validated)
create table if not exists check_ins (
  id bigint generated always as identity primary key,
  student_id bigint references students(id) on delete cascade not null,
  checkin_date date default current_date not null,
  checked_in_at timestamptz default now() not null,
  selfie_path text default null,
  location_lat double precision default null,
  location_lng double precision default null,
  location_accuracy real default null,
  location_within_radius boolean default null,
  location_state text default null,
  location_reason text default null,
  unique (student_id, checkin_date)
);

-- 5. Index untuk performa query check-in harian
create index if not exists idx_checkins_date on check_ins(checkin_date);
create index if not exists idx_checkins_student on check_ins(student_id);

-- 6. Bucket Storage untuk selfie (PRIVAT — tidak publik)
-- Selfie hanya boleh diakses admin via signed URL, bukan anon/public.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('selfies', 'selfies', false, 2097152, array['image/jpeg','image/png'])
on conflict (id) do nothing;

/*
  KEBIJAKAN STORAGE (bucket `selfies`)

  Yang dibutuhkan agar alur bekerja:
    - UPLOAD (INSERT) : siswa upload selfie        -> butuh policy INSERT
    - SIGN (SELECT)   : admin membuat signed URL   -> butuh policy SELECT
      (Signed URL dibuat Supabase dari baris di storage.objects, jadi tanpa
       policy SELECT, endpoint sign akan menjawab "Object not found".)

  CATATAN PRIVASI PENTING:
    Dengan policy SELECT di bawah, siapa pun yang memiliki anon key secara
    TEKNIS dapat membuat signed URL bila ia tahu path file. Ini konsekuensi
    dari arsitektur "anon key di frontend + dashboard tanpa login".
    Mitigasi yang dipakai:
      - Bucket tetap privat (public=false), jadi tanpa signed URL file tidak
        bisa diakses langsung.
      - URL yang dihasilkan berumur pendek (60 detik).
      - Path file memakai tanggal + id + jam + random, sulit ditebak.
    Untuk keamanan penuh, tambahkan Supabase Auth pada dashboard admin lalu
    batasi policy SELECT hanya untuk user yang login (lihat komentar di bawah).
*/

-- Bersihkan policy lama
drop policy if exists "Selfie read anon" on storage.objects;

-- Upload: anon boleh INSERT ke bucket selfies
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Selfie upload anon' AND schemaname = 'storage' AND tablename = 'objects') THEN
    CREATE POLICY "Selfie upload anon" ON storage.objects
      FOR INSERT TO anon, authenticated
      WITH CHECK (bucket_id = 'selfies');
  END IF;
END
$$;

-- Baca/sign: izinkan SELECT pada bucket selfies agar signed URL bisa dibuat.
-- (Tanpa ini, upload sukses tapi file "tidak ditemukan" saat di-sign.)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Selfie sign selfies' AND schemaname = 'storage' AND tablename = 'objects') THEN
    CREATE POLICY "Selfie sign selfies" ON storage.objects
      FOR SELECT TO anon, authenticated
      USING (bucket_id = 'selfies');
  END IF;
END
$$;

-- Hapus: izinkan admin menghapus selfie (mis. pembersihan berkala)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Selfie delete selfies' AND schemaname = 'storage' AND tablename = 'objects') THEN
    CREATE POLICY "Selfie delete selfies" ON storage.objects
      FOR DELETE TO anon, authenticated
      USING (bucket_id = 'selfies');
  END IF;
END
$$;


/* ================================================================
   8. FUNGSI CHECK-IN TANPA NIS (revisi alur absensi)
   ================================================================
   Identitas yang dipakai hanya: nama, kelas, selfie, timestamp server.
   Frontend TIDAK pernah menerima / mengirim NIS.
   ================================================================ */

-- 8a. Cari siswa berdasarkan NAMA (case-insensitive), hanya yang aktif.
-- Mengembalikan id, nama, kelas — tanpa NIS.
create or replace function find_students(p_q text)
returns table (id bigint, nama text, kelas text)
language sql
security definer
as $$
  select s.id, s.nama, coalesce(s.kelas, '') as kelas
  from students s
  where s.aktif = true
    and (p_q is null or trim(p_q) = '' or s.nama ilike '%' || trim(p_q) || '%')
  order by s.nama asc
  limit 25;
$$;

-- 8b. Ambil identitas publik siswa (nama + kelas) berdasarkan id internal.
-- Dipakai untuk menampilkan kelas otomatis setelah nama dipilih.
create or replace function get_student_public(p_id bigint)
returns jsonb
language sql
security definer
as $$
  select jsonb_build_object(
    'id', s.id,
    'nama', s.nama,
    'kelas', coalesce(s.kelas, '')
  )
  from students s
  where s.id = p_id and s.aktif = true;
$$;

-- 8c. Simpan check-in (server-validated).
-- - Sesi harus AKTIF (memakai get_session_status())
-- - Siswa harus ada & aktif
-- - checkin_date & checked_in_at memakai WAKTU SERVER (bukan jam device siswa)
-- - Satu siswa hanya boleh 1 check-in valid per hari (unique constraint)
create or replace function submit_checkin(p_student_id bigint, p_selfie_path text default null)
returns jsonb
language plpgsql
security definer
as $$
declare
  v_status jsonb;
  v_student students;
  v_row check_ins;
begin
  -- 1. Sesi harus aktif
  v_status := get_session_status();
  if (v_status ->> 'active')::boolean is not true then
    return jsonb_build_object('error', 'ABSENSI_TIDAK_AKTIF');
  end if;

  -- 2. Siswa harus ada & aktif
  select * into v_student from students where id = p_student_id and aktif = true;
  if not found then
    return jsonb_build_object('error', 'SISWA_TIDAK_DITEMUKAN');
  end if;

  -- 3. Anti-duplikat: sudah check-in hari ini?
  if exists (select 1 from check_ins c where c.student_id = p_student_id and c.checkin_date = current_date) then
    return jsonb_build_object('error', 'SUDAH_CHECKIN_HARI_INI');
  end if;

  -- 4. Simpan dengan tanggal & jam SERVER
  begin
    insert into check_ins (student_id, checkin_date, checked_in_at, selfie_path)
    values (p_student_id, current_date, now(), p_selfie_path)
    returning * into v_row;
  exception when unique_violation then
    -- Balapan dua permintaan bersamaan
    return jsonb_build_object('error', 'SUDAH_CHECKIN_HARI_INI');
  end;

  return jsonb_build_object(
    'success', true,
    'checkin_id', v_row.id,
    'timestamp', v_row.checked_in_at,
    'nama', v_student.nama,
    'kelas', coalesce(v_student.kelas, ''),
    'selfie_path', v_row.selfie_path
  );
end;
$$;

-- 8d. Tanggal server hari ini (WIB/Asia/Jakarta sesuai zona DB).
-- Dipakai dashboard & klien agar tidak bergantung jam device siswa.
create or replace function get_server_date()
returns text
language sql
security definer
as $$
  select to_char(current_date, 'YYYY-MM-DD');
$$;

-- 8e. (DIHAPUS) get_selfie_url()
-- Signed URL TIDAK dibuat dari SQL: tidak ada fungsi storage.create_signed_url.
-- Signed URL dibuat lewat Storage REST API (dipakai supabase-js createSignedUrl
-- di assets/js/supabase-client.js -> getSelfieUrl()).
-- Yang dibutuhkan hanyalah policy SELECT pada storage.objects (sudah dibuat di
-- bagian 6). Fungsi SQL ini sengaja di-drop bila sebelumnya pernah dibuat.
drop function if exists get_selfie_url(text, int);

/* ================================================================
   9. CONTOH / CARA MENGISI DATA SISWA (tanpa NIS)
   ================================================================
   Cara termudah: Supabase Dashboard -> Table Editor -> students ->
   Insert row, isi kolom `nama` dan `kelas` (kolom `nis` boleh dikosongkan
   HANYA jika constraint unique mengizinkan; karena `nis` not null unik,
   isi saja dengan nilai unik apa pun, mis. 'S001', 'S002' — tidak dipakai
   oleh aplikasi).
   Atau lewat SQL seperti contoh berikut:
*/
/*
insert into students (nis, nama, kelas, aktif) values
  ('S001', 'Eky Sadewa',  'XI TKJ 2', true),
  ('S002', 'Andi Saputra', 'XI TKJ 1', true),
  ('S003', 'Citra Dewi',  'X TKJ 1',  true)
on conflict (nis) do nothing;
*/

-- Contoh data lama (opsional, tetap dipertahankan)
insert into students (nis, nama, kelas, jurusan, jk) values
('2026001', 'Andi Saputra', 'X RPL', 'RPL', 'L')
on conflict (nis) do nothing;
insert into students (nis, nama, kelas, jurusan, jk) values
('2026002', 'Budi Santoso', 'X TKJ', 'TKJ', 'L')
on conflict (nis) do nothing;
insert into students (nis, nama, kelas, jurusan, jk) values
('2026003', 'Citra Dewi', 'X AKL', 'AKL', 'P')
on conflict (nis) do nothing;