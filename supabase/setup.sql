/* ================================================================
   SUPABASE DATABASE SETUP
   ================================================================
   1. Login ke https://supabase.com/dashboard
   2. Pilih project baru
   3. Buka tab "SQL Editor"
   4. Copy dan jalankan script di bawah ini
   5. Masukkan SUPABASE_CONFIG ke assets/js/supabase-config.js
   ================================================================ */

-- 0. HELPER WAKTU WIB (didefinisikan paling awal — dipakai tabel & fungsi).
-- Zona waktu database Supabase umumnya UTC — bukan WIB. Semua evaluasi
-- jadwal & tanggal HARUS memakai helper ini agar sesuai waktu Indonesia
-- (Asia/Jakarta) apa pun setting zona database-nya.
--   now_wib()        : timestamp WIB saat ini (tanpa zona)
--   now_wib()::date  : tanggal hari ini menurut WIB
--   now_wib()::time  : jam saat ini menurut WIB
create or replace function now_wib()
returns timestamp
language sql
stable
as $$
  select (now() at time zone 'Asia/Jakarta');
$$;

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
-- `override_reason` ikut dikirim agar bisa ditampilkan sebagai pesan custom
-- ketika admin menutup sesi (mis. "Absensi diliburkan karena kegiatan").
-- Jadwal (jam mulai/selesai) dievaluasi dalam WIB, bukan zona database (UTC).
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
      else (now_wib()::time >= s.scheduled_starts_at and now_wib()::time < s.scheduled_ends_at)
    end,
    'manual_override', s.manual_override,
    'override_reason', s.override_reason,
    'scheduled_starts_at', to_char(s.scheduled_starts_at, 'HH24:MI'),
    'scheduled_ends_at', to_char(s.scheduled_ends_at, 'HH24:MI'),
    'server_time', to_char(now_wib(), 'YYYY-MM-DD HH24:MI:SS')
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
-- checkin_date = tanggal menurut WIB (fungsi insert selalu mengisi eksplisit;
-- default diubah dari current_date ke now_wib() karena zona DB = UTC).
create table if not exists check_ins (
  id bigint generated always as identity primary key,
  student_id bigint references students(id) on delete cascade not null,
  checkin_date date default now_wib()::date not null,
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
-- Perbaiki default untuk tabel yang sudah ada (dari current_date/UTC ke WIB)
do $$
begin
  if exists (select 1 from information_schema.columns
             where table_name = 'check_ins' and column_name = 'checkin_date'
               and column_default like '%current_date%') then
    alter table check_ins alter column checkin_date set default now_wib()::date;
  end if;
end
$$;

-- 5. Index untuk performa query check-in harian
create index if not exists idx_checkins_date on check_ins(checkin_date);
create index if not exists idx_checkins_student on check_ins(student_id);

-- 5b. Dukungan INPUT MANUAL (siswa mengetik nama & kelas sendiri).
-- `student_id` dibuat nullable agar check-in bisa disimpan walau siswa belum
-- terdaftar di tabel students. Nama & kelas asli dari siswa disimpan di kolom
-- `nama_manual` / `kelas_manual`.
alter table check_ins alter column student_id drop not null;
alter table check_ins add column if not exists nama_manual text;
alter table check_ins add column if not exists kelas_manual text;

-- 5c. Tabel penampung data siswa yang diketik manual, menunggu ditinjau admin.
-- Setelah disetujui admin, barisnya dipindahkan ke tabel `students`.
create table if not exists pending_students (
  id bigint generated always as identity primary key,
  nama text not null,
  kelas text not null,
  checkin_id bigint references check_ins(id) on delete set null,
  selfie_path text default null,
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  created_at timestamptz default now(),
  reviewed_at timestamptz default null
);

create index if not exists idx_pending_status on pending_students(status);
create index if not exists idx_pending_created on pending_students(created_at);

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

  -- 3. Anti-duplikat: sudah check-in hari ini? (tanggal WIB)
  if exists (select 1 from check_ins c where c.student_id = p_student_id and c.checkin_date = now_wib()::date) then
    return jsonb_build_object('error', 'SUDAH_CHECKIN_HARI_INI');
  end if;

  -- 4. Simpan dengan tanggal & jam SERVER (tanggal dievaluasi WIB)
  begin
    insert into check_ins (student_id, checkin_date, checked_in_at, selfie_path)
    values (p_student_id, now_wib()::date, now(), p_selfie_path)
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

-- 8d. Tanggal server hari ini — selalu WIB (Asia/Jakarta), apa pun zona DB.
-- Dipakai dashboard & klien agar tidak bergantung jam device siswa.
create or replace function get_server_date()
returns text
language sql
security definer
as $$
  select to_char(now_wib()::date, 'YYYY-MM-DD');
$$;

-- 8e. (DIHAPUS) get_selfie_url()
-- Signed URL TIDAK dibuat dari SQL: tidak ada fungsi storage.create_signed_url.
-- Signed URL dibuat lewat Storage REST API (dipakai supabase-js createSignedUrl
-- di assets/js/supabase-client.js -> getSelfieUrl()).
-- Yang dibutuhkan hanyalah policy SELECT pada storage.objects (sudah dibuat di
-- bagian 6). Fungsi SQL ini sengaja di-drop bila sebelumnya pernah dibuat.
drop function if exists get_selfie_url(text, int);

/* ================================================================
   10. CHECK-IN DENGAN INPUT MANUAL (nama + kelas diketik siswa)
   ================================================================
   Siswa tidak lagi memilih dari daftar. Ia mengetik NAMA dan KELAS sendiri.
   Data disimpan di check_ins (nama_manual/kelas_manual) DAN dicatat di
   pending_students untuk ditinjau admin.
   ================================================================ */

-- 10a. Simpan check-in manual (server-validated).
-- - Sesi harus AKTIF
-- - Nama & kelas wajib (setelah dipangkas spasi)
-- - Siswa terdaftar (nama+kelas cocok, aktif) langsung tertaut & dapat poin
-- - Nama baru masuk pending_students untuk ditinjau admin
-- - Anti-duplikat: nama+kelas sama ATAU student_id sama pada hari yang sama
-- - Tanggal & jam memakai WAKTU SERVER
create or replace function submit_checkin_manual(
  p_nama text,
  p_kelas text,
  p_selfie_path text default null
)
returns jsonb
language plpgsql
security definer
as $$
declare
  v_status jsonb;
  v_nama text;
  v_kelas text;
  v_row check_ins;
  v_pending_id bigint;
  v_student_id bigint;
  v_morning jsonb;
begin
  -- 1. Sesi harus aktif
  v_status := get_session_status();
  if (v_status ->> 'active')::boolean is not true then
    return jsonb_build_object('error', 'ABSENSI_TIDAK_AKTIF');
  end if;

  -- 2. Bersihkan & validasi input
  v_nama := regexp_replace(coalesce(trim(p_nama), ''), '\s+', ' ', 'g');
  v_kelas := regexp_replace(coalesce(trim(p_kelas), ''), '\s+', ' ', 'g');

  if length(v_nama) < 3 then
    return jsonb_build_object('error', 'NAMA_TIDAK_VALID');
  end if;
  if length(v_nama) > 80 then
    return jsonb_build_object('error', 'NAMA_TERLALU_PANJANG');
  end if;
  if length(v_kelas) < 1 then
    return jsonb_build_object('error', 'KELAS_TIDAK_VALID');
  end if;
  if length(v_kelas) > 40 then
    return jsonb_build_object('error', 'KELAS_TERLALU_PANJANG');
  end if;

  -- 3. Cari siswa aktif dengan nama & kelas yang cocok.
  --    Jika ketemu: check-in langsung tertaut dan poin langsung diberikan.
  --    Jika tidak: check-in masuk pending_students.
  select s.id into v_student_id
  from students s
  where s.aktif = true
    and lower(trim(s.nama)) = lower(v_nama)
    and lower(trim(coalesce(s.kelas, ''))) = lower(v_kelas)
  order by s.id
  limit 1;

  -- 4a. Anti-duplikat nama + kelas sama hari ini (untuk semua, termasuk pending)
  if exists (
    select 1 from check_ins c
    where c.checkin_date = now_wib()::date
      and lower(trim(coalesce(c.nama_manual, ''))) = lower(v_nama)
      and lower(trim(coalesce(c.kelas_manual, ''))) = lower(v_kelas)
  ) then
    return jsonb_build_object('error', 'SUDAH_CHECKIN_HARI_INI');
  end if;

  -- 4b. Anti-duplikat berdasarkan student_id (mencegah bentrok unique
  --     bila nama/kelas diketik sedikit berbeda dari data master).
  if v_student_id is not null and exists (
    select 1 from check_ins c
    where c.student_id = v_student_id
      and c.checkin_date = now_wib()::date
  ) then
    return jsonb_build_object('error', 'SUDAH_CHECKIN_HARI_INI');
  end if;

  -- 5. Simpan check-in (tanggal dievaluasi WIB; checked_in_at tetap timestamp absolut)
  insert into check_ins (student_id, checkin_date, checked_in_at, selfie_path, nama_manual, kelas_manual)
  values (v_student_id, now_wib()::date, now(), p_selfie_path, v_nama, v_kelas)
  returning * into v_row;

  -- 6. Pending hanya untuk nama baru; siswa terdaftar langsung dapat poin.
  if v_student_id is null then
    insert into pending_students (nama, kelas, checkin_id, selfie_path, status)
    values (v_nama, v_kelas, v_row.id, p_selfie_path, 'pending')
    returning id into v_pending_id;

    v_morning := jsonb_build_object('status', 'menunggu_approval');
  else
    v_pending_id := null;
    v_morning := sync_morning_from_checkin(v_row.id);
  end if;

  return jsonb_build_object(
    'success', true,
    'checkin_id', v_row.id,
    'pending_id', v_pending_id,
    'student_id', v_student_id,
    'timestamp', v_row.checked_in_at,
    'nama', v_nama,
    'kelas', v_kelas,
    'selfie_path', v_row.selfie_path,
    'morning', v_morning
  );
end;
$$;

-- 10b. Daftar data siswa yang menunggu ditinjau admin.
create or replace function list_pending_students(p_status text default 'pending')
returns table (
  id bigint,
  nama text,
  kelas text,
  status text,
  selfie_path text,
  created_at timestamptz
)
language sql
security definer
as $$
  select p.id, p.nama, p.kelas, p.status, p.selfie_path, p.created_at
  from pending_students p
  where p.status = coalesce(nullif(trim(p_status), ''), 'pending')
  order by p.created_at desc
  limit 500;
$$;

-- 10c. Setujui data pending -> masukkan ke tabel students.
-- Kolom `nis` wajib & unik, jadi diisi otomatis dengan 'AUTO-<id>' (tidak
-- dipakai aplikasi maupun ditampilkan ke siswa).
create or replace function approve_pending_student(p_id bigint)
returns jsonb
language plpgsql
security definer
as $$
declare
  v_row pending_students;
  v_nis text;
  v_student_id bigint;
  v_morning jsonb;
begin
  select * into v_row from pending_students where id = p_id;
  if not found then
    return jsonb_build_object('error', 'PENDING_TIDAK_DITEMUKAN');
  end if;
  if v_row.status <> 'pending' then
    return jsonb_build_object('error', 'SUDAH_DITINJAU', 'status', v_row.status);
  end if;

  -- Cari siswa yang sudah ada dengan nama & kelas sama (hindari duplikat)
  select s.id into v_student_id
  from students s
  where lower(trim(s.nama)) = lower(trim(v_row.nama))
    and lower(trim(coalesce(s.kelas, ''))) = lower(trim(v_row.kelas))
  limit 1;

  if v_student_id is null then
    v_nis := 'AUTO-' || p_id::text;
    insert into students (nis, nama, kelas, aktif)
    values (v_nis, v_row.nama, v_row.kelas, true)
    on conflict (nis) do nothing
    returning id into v_student_id;

    -- Kalau bentrok nis (sudah ada), ambil baris yang ada
    if v_student_id is null then
      select s.id into v_student_id from students s where s.nis = v_nis;
    end if;
  end if;

  -- Tautkan check-in ke siswa hasil penyetujuan
  if v_row.checkin_id is not null and v_student_id is not null then
    update check_ins set student_id = v_student_id where id = v_row.checkin_id;
  end if;

  update pending_students
  set status = 'approved', reviewed_at = now()
  where id = p_id;

  -- Catat ke apresiasi "Berangkat Pagi" untuk check-in yang baru ditautkan.
  -- (Fungsi sync_morning_from_checkin dibuat di bagian 12.)
  if v_row.checkin_id is not null then
    v_morning := sync_morning_from_checkin(v_row.checkin_id);
  end if;

  return jsonb_build_object(
    'success', true,
    'student_id', v_student_id,
    'morning', v_morning
  );
end;
$$;

-- 10d. Abaikan data pending (tidak dimasukkan ke students).
create or replace function reject_pending_student(p_id bigint)
returns jsonb
language plpgsql
security definer
as $$
begin
  update pending_students
  set status = 'rejected', reviewed_at = now()
  where id = p_id and status = 'pending';

  if not found then
    return jsonb_build_object('error', 'TIDAK_BISA_DIABAIKAN');
  end if;
  return jsonb_build_object('success', true);
end;
$$;

-- 10e. Daftar check-in hari ini (mendukung siswa manual & terdaftar).
-- Untuk siswa terdaftar -> pakai nama/kelas dari tabel students.
-- Untuk siswa manual    -> pakai nama_manual/kelas_manual.
-- `student_id` dipakai dashboard untuk mencocokkan status poin dari
-- list_morning_records(). Jangan join ke morning_records di sini karena
-- fungsi ini didefinisikan sebelum tabel morning_records dibuat.
drop function if exists list_today_checkins();

create or replace function list_today_checkins()
returns table (
  id bigint,
  student_id bigint,
  nama text,
  kelas text,
  checked_in_at timestamptz,
  selfie_path text,
  is_pending boolean
)
language sql
security definer
as $$
  select
    c.id,
    c.student_id,
    coalesce(s.nama, c.nama_manual, '(tanpa nama)') as nama,
    coalesce(s.kelas, c.kelas_manual, '') as kelas,
    c.checked_in_at,
    c.selfie_path,
    (c.student_id is null) as is_pending
  from check_ins c
  left join students s on s.id = c.student_id
  where c.checkin_date = now_wib()::date
  order by c.checked_in_at asc;
$$;

/* ================================================================
   11. HAPUS RIWAYAT (khusus admin)
   ================================================================
   Menghapus riwayat check-in (bukan hari ini) + data pending yang sudah
   ditinjau. File selfie di Storage dihapus terpisah oleh klien memakai
   daftar path dari collect_selfie_paths().
   ================================================================ */

-- 11a. Kumpulkan path selfie yang akan ikut terhapus (dipanggil SEBELUM hapus).
-- p_mode:
--   'before' -> check-in sebelum p_before_date
--   'today'  -> check-in hari ini saja
--   'all_before' -> semua check-in sebelum hari ini (riwayat lama)
--   'all'    -> SEMUA check-in (termasuk hari ini)
create or replace function collect_selfie_paths(p_mode text, p_before_date date default null)
returns table (selfie_path text)
language sql
security definer
as $$
  select c.selfie_path
  from check_ins c
  where c.selfie_path is not null
    and (
      (p_mode = 'before' and p_before_date is not null and c.checkin_date < p_before_date)
      or (p_mode = 'today' and c.checkin_date = now_wib()::date)
      or (p_mode = 'all_before' and c.checkin_date < now_wib()::date)
      or (p_mode = 'all')
    );
$$;

-- 11b. Hitung berapa data yang akan terhapus (untuk konfirmasi admin).
create or replace function count_history_to_delete(p_mode text, p_before_date date default null)
returns jsonb
language sql
security definer
as $$
  select jsonb_build_object(
    'checkins', (
      select count(*) from check_ins c
      where
        (p_mode = 'before' and p_before_date is not null and c.checkin_date < p_before_date)
        or (p_mode = 'today' and c.checkin_date = now_wib()::date)
        or (p_mode = 'all_before' and c.checkin_date < now_wib()::date)
        or (p_mode = 'all')
    ),
    'pending', (
      select count(*) from pending_students p
      where p.status in ('approved', 'rejected')
        and (
          (p_mode = 'before' and p_before_date is not null and (p.created_at at time zone 'Asia/Jakarta')::date < p_before_date)
          or (p_mode = 'today' and (p.created_at at time zone 'Asia/Jakarta')::date = now_wib()::date)
          or p_mode in ('all_before', 'all')
        )
    )
  );
$$;

-- 11c. Hapus riwayat + data pending yang sudah ditinjau.
-- p_mode:
--   'before' -> sebelum p_before_date
--   'today'  -> hari ini saja
--   'all_before' -> semua sebelum hari ini
--   'all'    -> SEMUA (termasuk hari ini)
create or replace function delete_checkin_history(p_mode text, p_before_date date default null)
returns jsonb
language plpgsql
security definer
as $$
declare
  v_checkins int := 0;
  v_pending int := 0;
begin
  if p_mode not in ('before', 'today', 'all_before', 'all') then
    return jsonb_build_object('error', 'MODE_TIDAK_VALID');
  end if;
  if p_mode = 'before' and p_before_date is null then
    return jsonb_build_object('error', 'TANGGAL_WAJIB_DIISI');
  end if;

  -- Hapus pending yang sudah ditinjau
  delete from pending_students p
  where p.status in ('approved', 'rejected')
    and (
      (p_mode = 'before' and p_before_date is not null and (p.created_at at time zone 'Asia/Jakarta')::date < p_before_date)
      or (p_mode = 'today' and (p.created_at at time zone 'Asia/Jakarta')::date = now_wib()::date)
      or p_mode in ('all_before', 'all')
    );
  get diagnostics v_pending = row_count;

  -- Hapus check-in
  delete from check_ins c
  where
    (p_mode = 'before' and p_before_date is not null and c.checkin_date < p_before_date)
    or (p_mode = 'today' and c.checkin_date = now_wib()::date)
    or (p_mode = 'all_before' and c.checkin_date < now_wib()::date)
    or (p_mode = 'all');
  get diagnostics v_checkins = row_count;

  return jsonb_build_object(
    'success', true,
    'checkins_deleted', v_checkins,
    'pending_deleted', v_pending
  );
end;
$$;

/* ================================================================
   12. APRESIASI SISWA BERANGKAT PAGI (Supabase)
   ================================================================
   Menggantikan penyimpanan localStorage pada halaman berangkat-pagi.
   Data tersimpan di server sehingga bisa dibuka dari perangkat mana pun
   dan tidak hilang bila cache browser dibersihkan.

   Aturan: setiap check-in selama sesi QR aktif = 1 catatan = 1 poin.
   Banyak siswa boleh tercatat pada tanggal yang sama; 1 siswa maksimal 1x
   per tanggal. Semua check-in sebelum jam tutup sesi diperlakukan sama.
   ================================================================ */

-- 12a. Riwayat berangkat pagi per hari (banyak siswa per tanggal;
--      1 siswa hanya 1x per tanggal).
create table if not exists morning_records (
  id bigint generated always as identity primary key,
  student_id bigint references students(id) on delete cascade not null,
  tanggal date not null,
  nama text default '',
  kelas text default '',
  recorded_at timestamptz default now(),
  source text default 'checkin' check (source in ('checkin','manual')),
  unique (student_id, tanggal)
);

-- `checkin_at` = jam SERVER saat siswa mendaftar (dari check_ins.checked_in_at).
-- Tampil di halaman apresiasi sebagai "jam daftar" (jam:menit:detik WIB).
-- Null bila tidak ada check-in terkait (mis. catatan manual murni) —
-- tampilan memakai fallback `recorded_at` (jam saat admin mencatat).
alter table morning_records add column if not exists checkin_at timestamptz;

-- Isi ulang data lama: ambil jam check-in TERAWAL siswa pada tanggal yang sama.
-- Idempotent — hanya menimpa baris yang checkin_at-nya masih NULL.
update morning_records m
set checkin_at = sub.jam
from (
  select c.student_id, c.checkin_date, min(c.checked_in_at) as jam
  from check_ins c
  group by c.student_id, c.checkin_date
) sub
where m.student_id = sub.student_id
  and m.tanggal = sub.checkin_date
  and m.checkin_at is null;

create index if not exists idx_morning_tanggal on morning_records(tanggal);
create index if not exists idx_morning_student on morning_records(student_id);

-- 12b. Cache poin di tabel students (agar tampilan papan peringkat cepat).
-- Ditambah kolom `telp` & `alamat` (jurusan/jk sudah ada dari awal) supaya
-- form "Data Siswa" di halaman apresiasi tersimpan lengkap di server.
alter table students add column if not exists poin_apresiasi int not null default 0;
alter table students add column if not exists telp text default '';
alter table students add column if not exists alamat text default '';

-- 12c. Hitung ulang poin seorang siswa dari morning_records.
-- Rumus: 1 catatan berangkat pagi = 1 poin. Tidak ada sisa.
create or replace function hitung_poin_siswa(p_student_id bigint)
returns jsonb
language plpgsql
security definer
as $$
declare
  v_total int;
  v_poin int;
begin
  select count(*) into v_total from morning_records where student_id = p_student_id;
  v_poin := v_total;

  update students set poin_apresiasi = v_poin where id = p_student_id;

  return jsonb_build_object(
    'student_id', p_student_id,
    'total_pagi', v_total,
    'poin', v_poin,
    'sisa', 0
  );
end;
$$;

-- 12d. Catat "Berangkat Pagi" untuk sebuah check-in yang sudah tertaut.
-- Semua check-in selama sesi aktif dicatat (bukan hanya yang terawal).
-- Return: { status: 'tercatat'|'sudah_ada'|'tidak_ada', ... }
create or replace function sync_morning_from_checkin(p_checkin_id bigint)
returns jsonb
language plpgsql
security definer
as $$
declare
  v_ci check_ins;
  v_nama text;
  v_kelas text;
begin
  -- Ambil data check-in
  select * into v_ci from check_ins where id = p_checkin_id;
  if not found then
    return jsonb_build_object('status', 'tidak_ada');
  end if;
  if v_ci.student_id is null then
    return jsonb_build_object('status', 'tidak_ada', 'alasan', 'checkin belum ditautkan ke siswa');
  end if;

  -- Sudah tercatat untuk tanggal itu?
  if exists (select 1 from morning_records m
             where m.student_id = v_ci.student_id and m.tanggal = v_ci.checkin_date) then
    return jsonb_build_object('status', 'sudah_ada');
  end if;

  -- Ambil nama & kelas dari master siswa
  select s.nama, coalesce(s.kelas, '') into v_nama, v_kelas
  from students s where s.id = v_ci.student_id;

  insert into morning_records (student_id, tanggal, nama, kelas, source, checkin_at)
  values (v_ci.student_id, v_ci.checkin_date, coalesce(v_nama, ''), coalesce(v_kelas, ''), 'checkin', v_ci.checked_in_at)
  on conflict (student_id, tanggal) do nothing;

  return jsonb_build_object(
    'status', 'tercatat',
    'student_id', v_ci.student_id,
    'tanggal', v_ci.checkin_date,
    'jam_daftar', v_ci.checked_in_at,
    'ringkasan', hitung_poin_siswa(v_ci.student_id)
  );
end;
$$;

-- 12e. Daftar siswa + total pagi + poin (untuk halaman apresiasi).
-- 1 catatan berangkat pagi = 1 poin. `sisa` selalu 0 (dipertahankan agar
-- bentuk respons lama tetap kompatibel dengan frontend).
-- NOTE: drop dulu bila versi lama ada — CREATE OR REPLACE tidak boleh
-- mengubah tipe return (versi lama hanya 7 kolom, tanpa jurusan/jk/telp/alamat).
drop function if exists list_apresiasi_siswa();
create or replace function list_apresiasi_siswa()
returns table (
  id bigint,
  nama text,
  kelas text,
  nis text,
  jurusan text,
  jk text,
  telp text,
  alamat text,
  total_pagi bigint,
  poin bigint,
  sisa bigint
)
language sql
security definer
as $$
  select
    s.id,
    s.nama,
    coalesce(s.kelas, '') as kelas,
    coalesce(s.nis, '') as nis,
    coalesce(s.jurusan, '') as jurusan,
    coalesce(s.jk, 'L') as jk,
    coalesce(s.telp, '') as telp,
    coalesce(s.alamat, '') as alamat,
    count(m.id)::bigint as total_pagi,
    count(m.id)::bigint as poin,
    0::bigint as sisa
  from students s
  left join morning_records m on m.student_id = s.id
  group by s.id, s.nama, s.kelas, s.nis, s.jurusan, s.jk, s.telp, s.alamat
  order by count(m.id) desc, s.nama asc;
$$;

-- 12f. Riwayat catatan berangkat pagi (untuk tampilan per tanggal / rekap).
-- `source` membedakan catatan otomatis dari check-in vs manual (koreksi admin).
-- NOTE: drop dulu bila versi lama ada — CREATE OR REPLACE tidak boleh
-- mengubah tipe return (baris OUT lama tanpa kolom `checkin_at`/`source`).
drop function if exists list_morning_records(date, date);
create or replace function list_morning_records(p_dari date default null, p_sampai date default null)
returns table (
  id bigint,
  student_id bigint,
  tanggal date,
  nama text,
  kelas text,
  recorded_at timestamptz,
  checkin_at timestamptz,
  source text
)
language sql
security definer
as $$
  select
    m.id, m.student_id, m.tanggal, m.nama, m.kelas,
    m.recorded_at, m.checkin_at, m.source
  from morning_records m
  where (p_dari is null or m.tanggal >= p_dari)
    and (p_sampai is null or m.tanggal <= p_sampai)
  order by m.tanggal desc, m.checkin_at asc nulls last, m.recorded_at asc;
$$;

-- 12g. Catat berangkat pagi secara manual (untuk data lama / koreksi admin).
-- p_identitas boleh berupa id siswa (angka) atau NAMA siswa.
-- checkin_at diisi OTOMATIS bila siswa punya check-in pada tanggal itu
-- (jam daftar sebenarnya); bila tidak ada, dibiarkan null dan tampilan
-- memakai fallback recorded_at (jam saat admin mencatat).
create or replace function tambah_morning_manual(p_identitas text, p_tanggal date)
returns jsonb
language plpgsql
security definer
as $$
declare
  v_student students;
  v_id bigint;
  v_checkin_at timestamptz;
begin
  if p_tanggal is null then
    return jsonb_build_object('error', 'TANGGAL_WAJIB_DIISI');
  end if;

  -- Coba sebagai id numerik dulu
  begin
    v_id := p_identitas::bigint;
  exception when others then
    v_id := null;
  end;

  if v_id is not null then
    select * into v_student from students where id = v_id;
  end if;

  if v_student.id is null then
    select * into v_student
    from students
    where lower(trim(nama)) = lower(trim(coalesce(p_identitas, '')))
    limit 1;
  end if;

  if v_student.id is null then
    return jsonb_build_object('error', 'SISWA_TIDAK_DITEMUKAN');
  end if;

  -- Jam daftar dari check-in siswa pada tanggal tsb (bila ada)
  select min(c.checked_in_at) into v_checkin_at
  from check_ins c
  where c.student_id = v_student.id and c.checkin_date = p_tanggal;

  insert into morning_records (student_id, tanggal, nama, kelas, source, checkin_at)
  values (v_student.id, p_tanggal, v_student.nama, coalesce(v_student.kelas, ''), 'manual', v_checkin_at)
  on conflict (student_id, tanggal) do nothing;

  return jsonb_build_object(
    'success', true,
    'student_id', v_student.id,
    'nama', v_student.nama,
    'jam_daftar', v_checkin_at,
    'ringkasan', hitung_poin_siswa(v_student.id)
  );
end;
$$;

-- 12h. Batalkan catatan berangkat pagi (koreksi admin).
create or replace function hapus_morning_record(p_student_id bigint, p_tanggal date)
returns jsonb
language plpgsql
security definer
as $$
begin
  delete from morning_records
  where student_id = p_student_id and tanggal = p_tanggal;

  if not found then
    return jsonb_build_object('error', 'CATATAN_TIDAK_DITEMUKAN');
  end if;

  return jsonb_build_object(
    'success', true,
    'ringkasan', hitung_poin_siswa(p_student_id)
  );
end;
$$;

-- 12i. Reset SELURUH catatan berangkat pagi sekaligus (menggantikan hapus satu-per-satu
-- dari browser). Cache poin semua siswa ikut dinolkan dalam satu transaksi.
create or replace function reset_morning_all()
returns jsonb
language plpgsql
security definer
as $$
declare
  v_terhapus int;
begin
  delete from morning_records;
  get diagnostics v_terhapus = row_count;

  update students set poin_apresiasi = 0;

  return jsonb_build_object(
    'success', true,
    'terhapus', v_terhapus
  );
end;
$$;

/* ================================================================
   12j. KOREKSI DATA LAMA: tanggal yang tergeser karena zona UTC.
   ================================================================
   Sebelum fungsi now_wib() ada, checkin_date dievaluasi memakai zona
   database (UTC) — siswa yang check-in pagi (sebelum 07:00 WIB) tercatat
   dengan tanggal KEMARIN. Blok ini menggeser tanggal ke kalender WIB:
     check_ins.checkin_date   <- (checked_in_at at 'Asia/Jakarta')::date
     morning_records.tanggal  <- (checkin_at   at 'Asia/Jakarta')::date
                               (hanya bila checkin_at terisi)
   Idempotent. Bila pergeseran membuat baris bertabrakan pada constraint
   unik, baris dengan id lebih besar dihapus (sisakan satu per hari).
   Cache poin semua siswa dihitung ulang setelahnya.
   ================================================================ */

-- 1) check_ins: hapus duplikat hari-WIB (id lebih besar kalah).
--    Untuk siswa terdaftar (student_id terisi) cukup pakai student_id;
--    untuk check-in manual (student_id NULL) pakai nama+kelas ternormalisasi
--    agar tidak salah menghapus siswa berbeda.
delete from check_ins c
using check_ins x
where (c.checked_in_at at time zone 'Asia/Jakarta')::date
    = (x.checked_in_at at time zone 'Asia/Jakarta')::date
  and x.id < c.id
  and (
    (c.student_id is not null and c.student_id = x.student_id)
    or (
      c.student_id is null and x.student_id is null
      and coalesce(c.nama_manual, '') <> ''
      and lower(trim(coalesce(c.nama_manual, '')))  = lower(trim(coalesce(x.nama_manual, '')))
      and lower(trim(coalesce(c.kelas_manual, ''))) = lower(trim(coalesce(x.kelas_manual, '')))
    )
  );

-- 2) Geser checkin_date ke tanggal WIB sesuai checked_in_at.
--    Setelah langkah 1, tanggal WIB per siswa terdaftar dijamin unik.
update check_ins
set checkin_date = (checked_in_at at time zone 'Asia/Jakarta')::date
where checkin_date <> (checked_in_at at time zone 'Asia/Jakarta')::date;

-- 3) morning_records: tanggal dihitung dari checkin_at (timestamp absolut).
--    a) hapus duplikat hari-WIB (id lebih besar kalah) — memakai tanggal
--       tujuan (dari checkin_at bila ada, selain itu tanggal apa adanya).
with mapped as (
  select id,
         coalesce((checkin_at at time zone 'Asia/Jakarta')::date, tanggal) as tgl_final,
         row_number() over (
           partition by student_id,
             coalesce((checkin_at at time zone 'Asia/Jakarta')::date, tanggal)
           order by id
         ) as rn
  from morning_records
)
delete from morning_records m
using mapped
where m.id = mapped.id and mapped.rn > 1;

--    b) geser tanggal ke WIB (hanya baris yang punya checkin_at).
update morning_records
set tanggal = (checkin_at at time zone 'Asia/Jakarta')::date
where checkin_at is not null
  and tanggal <> (checkin_at at time zone 'Asia/Jakarta')::date;

-- 4) Hitung ulang cache poin SEMUA siswa dari morning_records.
do $$
declare
  r record;
begin
  for r in select distinct student_id from morning_records loop
    perform hitung_poin_siswa(r.student_id);
  end loop;
end
$$;

/* ================================================================
   12k. BACKFILL: SEMUA CHECK-IN LAMA YANG SUDAH TERTAUT KE SISWA
   ================================================================
   Sebelum perubahan ini, hanya check-in TERAWAL per hari yang masuk ke
   morning_records. Blok ini menambahkan semua check-in lama yang sudah
   tertaut ke siswa, tanpa menghapus catatan yang sudah ada.
   Idempotent: on conflict (student_id, tanggal) do nothing.

   Sebelum menjalankan di database produksi, cek dulu apakah ada check-in
   setelah jam tutup (contoh 06:40):
     select count(*) as checkin_setelah_0640
     from check_ins
     where (checked_in_at at time zone 'Asia/Jakarta')::time >= '06:40';
   Jika hasilnya bukan 0, tinjau dulu apakah check-in tersebut ikut
   di-backfill atau perlu filter waktu.
   ================================================================ */

insert into morning_records
  (student_id, tanggal, nama, kelas, source, checkin_at)
select
  c.student_id,
  c.checkin_date,
  s.nama,
  coalesce(s.kelas, ''),
  'checkin',
  c.checked_in_at
from check_ins c
join students s on s.id = c.student_id
where c.student_id is not null
on conflict (student_id, tanggal) do nothing;

-- Hitung ulang cache poin semua siswa (1 catatan = 1 poin).
update students s
set poin_apresiasi = coalesce((
  select count(*)
  from morning_records m
  where m.student_id = s.id
), 0);

/* ================================================================
   12l. KOREKSI: SISWA 0 POIN YANG SUDAH PERNAH CHECK-IN
   ================================================================
   Saat aturan lama masih berlaku, hanya check-in TERAWAL per hari yang
   masuk ke morning_records (dan 2 catatan baru dihitung 1 poin). Siswa
   yang pernah check-in tetapi tidak pernah menjadi yang terawal bisa
   tetap 0 poin.

   Blok ini memberi TEPAT 1 poin kepada setiap siswa yang:
     - saat ini masih 0 poin (belum punya morning_records), dan
     - punya minimal satu check-in (tertaut lewat student_id, atau
       check-in manual lama yang belum tertaut dan cocok lewat nama+kelas).

   Yang ditambahkan hanya SATU catatan per siswa, pada tanggal check-in
   paling awal, memakai jam check-in aslinya. Jadi siswa tersebut tidak
   langsung mendapat poin dari seluruh riwayat check-in-nya.

   Idempotent:
     - siswa yang sudah punya morning_records tidak diproses lagi;
     - on conflict (student_id, tanggal) do nothing.

   Catatan: blok 12k di atas sudah membackfill semua check-in tertaut.
   Blok ini adalah jaring pengaman untuk siswa yang masih 0 poin,
   terutama check-in manual lama yang belum tertaut ke tabel students.
   ================================================================ */

do $$
declare
  r record;
  v_diberi int := 0;
  v_rows int;
begin
  for r in
    select distinct on (s.id)
      s.id as student_id,
      s.nama,
      coalesce(s.kelas, '') as kelas,
      c.checkin_date as tanggal,
      c.checked_in_at
    from students s
    join check_ins c on (
      c.student_id = s.id
      or (
        c.student_id is null
        and regexp_replace(lower(trim(coalesce(c.nama_manual, ''))), '\s+', ' ', 'g')
          = regexp_replace(lower(trim(s.nama)), '\s+', ' ', 'g')
        and regexp_replace(lower(trim(coalesce(c.kelas_manual, ''))), '\s+', ' ', 'g')
          = regexp_replace(lower(trim(coalesce(s.kelas, ''))), '\s+', ' ', 'g')
      )
    )
    where s.poin_apresiasi = 0
      and not exists (
        select 1 from morning_records m where m.student_id = s.id
      )
    order by s.id, c.checked_in_at asc, c.id asc
  loop
    insert into morning_records
      (student_id, tanggal, nama, kelas, source, checkin_at)
    values
      (r.student_id, r.tanggal, r.nama, r.kelas, 'checkin', r.checked_in_at)
    on conflict (student_id, tanggal) do nothing;

    get diagnostics v_rows = row_count;
    if v_rows > 0 then
      v_diberi := v_diberi + 1;
      raise notice 'Poin 1 diberikan: % (%) - %', r.nama, r.kelas, r.tanggal;
    end if;
  end loop;

  raise notice 'Total siswa 0 poin yang diberi 1 poin: %', v_diberi;
end
$$;

-- Hitung ulang cache poin semua siswa setelah koreksi.
update students s
set poin_apresiasi = coalesce((
  select count(*)
  from morning_records m
  where m.student_id = s.id
), 0);

-- Verifikasi: query ini harus mengembalikan 0 baris setelah blok 12l.
-- select s.id, s.nama, s.kelas, s.poin_apresiasi
-- from students s
-- where s.poin_apresiasi = 0
--   and exists (
--     select 1 from check_ins c
--     where c.student_id = s.id
--        or (
--          c.student_id is null
--          and regexp_replace(lower(trim(coalesce(c.nama_manual, ''))), '\s+', ' ', 'g')
--            = regexp_replace(lower(trim(s.nama)), '\s+', ' ', 'g')
--          and regexp_replace(lower(trim(coalesce(c.kelas_manual, ''))), '\s+', ' ', 'g')
--            = regexp_replace(lower(trim(coalesce(s.kelas, ''))), '\s+', ' ', 'g')
--        )
--   )
-- order by s.nama;

/* ================================================================
   13. JADWAL PIKET — DIHAPUS
   ================================================================
   Jadwal petugas kini lengkap di program kerja "Jadwal Petugas
   Gerbang" (jadwal-gerbang/). Bagian jadwal piket di halaman apresiasi
   "Berangkat Pagi" dihapus, jadi tabel & fungsinya dibuang dari DB.

   Blok drop ini idempotent — aman dijalankan berkali-kali, baik pada
   project baru (belum pernah ada) maupun project lama yang sudah punya
   tabel `piket_schedule`.
   ================================================================ */

drop function if exists list_piket();
drop function if exists hapus_piket_tanggal(date);
drop function if exists simpan_piket_tanggal(date, bigint[]);
drop table if exists piket_schedule;

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