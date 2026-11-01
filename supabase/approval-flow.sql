/* ================================================================
   MIGRASI: SEMUA SCAN WAJIB APPROVAL ADMIN
   ================================================================
   Jalankan di Supabase SQL Editor untuk project yang sudah berjalan.
   Aman dijalankan ulang karena hanya mengganti definisi fungsi; tidak
   ada perubahan tabel/schema dan tidak ada data lama yang diubah.

   Perubahan:
     - submit_checkin_manual(): semua check-in (termasuk siswa
       terdaftar) membuat baris pending_students dan TIDAK langsung
       memberi poin. check_ins.student_id tetap diisi untuk siswa
       terdaftar agar anti-duplikat 1x/hari bekerja.
     - list_today_checkins(): is_pending dihitung dari baris
       pending_students berstatus 'pending', bukan dari student_id.
     - approve_pending_student(): memakai student_id dari check_ins
       bila ada; fallback ke nama+kelas; bila tidak ada, membuat
       siswa baru. Poin baru dicatat setelah approval.

   Yang TIDAK diubah:
     - Tabel, constraint, RLS, data lama yang sudah auto-approve.
     - sessions, get_session_status(), jadwal sesi.
     - Fungsi delete/hapus riwayat.
     - sync_morning_from_checkin() (sudah ada di database).

   Catatan:
     - Backup database sebelum menjalankan migrasi.
     - Setelah migrasi, scan baru harus di-approve admin sebelum
       poin masuk. Scan lama yang sudah approved tidak diubah.
   ================================================================ */

begin;

-- 1. Semua check-in masuk pending; poin belum diberikan.
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
  --    Jika ketemu: check-in tetap ditautkan ke siswa untuk proteksi duplikat,
  --    tetapi poin TIDAK diberikan sampai admin menyetujui pending.
  --    Jika tidak: check-in tetap masuk pending sebagai siswa baru.
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

  -- 6. SEMUA check-in masuk pending. Siswa terdaftar tetap ditautkan ke
  --    student_id agar unique (student_id, checkin_date) mencegah scan ganda,
  --    tetapi poin baru dicatat setelah admin menyetujui.
  insert into pending_students (nama, kelas, checkin_id, selfie_path, status)
  values (v_nama, v_kelas, v_row.id, p_selfie_path, 'pending')
  returning id into v_pending_id;

  v_morning := jsonb_build_object('status', 'menunggu_approval');

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

-- 2. Status pending dihitung dari pending_students, bukan student_id.
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
    exists (
      select 1 from pending_students p
      where p.checkin_id = c.id and p.status = 'pending'
    ) as is_pending
  from check_ins c
  left join students s on s.id = c.student_id
  where c.checkin_date = now_wib()::date
  order by c.checked_in_at asc;
$$;

-- 3. Approve: tautkan/buat siswa, lalu catat poin.
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

  -- Prioritaskan siswa yang sudah tertaut di check-in (siswa terdaftar).
  if v_row.checkin_id is not null then
    select c.student_id into v_student_id
    from check_ins c
    where c.id = v_row.checkin_id;
  end if;

  -- Kalau belum tertaut, cari siswa dengan nama & kelas sama (hindari duplikat).
  if v_student_id is null then
    select s.id into v_student_id
    from students s
    where lower(trim(s.nama)) = lower(trim(v_row.nama))
      and lower(trim(coalesce(s.kelas, ''))) = lower(trim(v_row.kelas))
    limit 1;
  end if;

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

  -- Tautkan check-in ke siswa (jika belum tertaut).
  if v_row.checkin_id is not null and v_student_id is not null then
    update check_ins set student_id = v_student_id where id = v_row.checkin_id;
  end if;

  update pending_students
  set status = 'approved', reviewed_at = now()
  where id = p_id;

  -- Catat ke apresiasi "Berangkat Pagi" SETELAH disetujui.
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

commit;

/* ================================================================
   VERIFIKASI SETELAH MIGRASI (jalankan terpisah, read-only)
   ================================================================

-- Fungsi sudah terpasang?
select proname, pg_get_function_identity_arguments(oid) as args
from pg_proc
where proname in ('submit_checkin_manual', 'list_today_checkins', 'approve_pending_student')
order by proname;

-- Tidak boleh ada check-in baru yang langsung punya morning_records
-- tanpa approval. Query ini hanya melihat data hari ini.
select c.id, c.nama_manual, c.kelas_manual, c.student_id,
       exists (
         select 1 from pending_students p
         where p.checkin_id = c.id and p.status = 'pending'
       ) as is_pending,
       exists (
         select 1 from morning_records m
         where m.student_id = c.student_id and m.tanggal = c.checkin_date
       ) as sudah_dapat_poin
from check_ins c
where c.checkin_date = now_wib()::date
order by c.checked_in_at;

-- Total poin sebelum/sesudah migrasi tidak berubah.
select count(*) as total_morning, coalesce(sum(poin_apresiasi), 0) as total_poin
from students;
   ================================================================ */
