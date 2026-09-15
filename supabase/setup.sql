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
-- Selfie hanya boleh diakses admin via service_role, bukan anon/public.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('selfies', 'selfies', false, 2097152, array['image/jpeg','image/png'])
on conflict (id) do nothing;

-- Policy: anon boleh upload ke bucket selfies
-- (Hanya data foto saja; tidak ada list/read publik kecuali oleh admin)
-- Gunakan DO block agar tidak error saat dijalankan berulang
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Selfie upload anon' AND schemaname = 'storage' AND tablename = 'objects') THEN
    CREATE POLICY "Selfie upload anon" ON storage.objects FOR INSERT WITH CHECK (bucket_id = 'selfies');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Selfie read anon' AND schemaname = 'storage' AND tablename = 'objects') THEN
    CREATE POLICY "Selfie read anon" ON storage.objects FOR SELECT USING (bucket_id = 'selfies');
  END IF;
END
$$;

-- 7. Contoh data siswa (opsional — isi jika ingin test sebelum QR)
-- Gunakan on conflict do nothing jika NIS sudah terdaftar sebelumnya
insert into students (nis, nama, kelas, jurusan, jk) values
('2026001', 'Andi Saputra', 'X RPL', 'RPL', 'L')
on conflict (nis) do nothing;
insert into students (nis, nama, kelas, jurusan, jk) values
('2026002', 'Budi Santoso', 'X TKJ', 'TKJ', 'L')
on conflict (nis) do nothing;
insert into students (nis, nama, kelas, jurusan, jk) values
('2026003', 'Citra Dewi', 'X AKL', 'AKL', 'P')
on conflict (nis) do nothing;