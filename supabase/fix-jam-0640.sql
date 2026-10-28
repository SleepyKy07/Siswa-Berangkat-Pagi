/* ================================================================
   KOREKSI SEKALI: JAM CHECK-IN >= 06:40 WIB
   ================================================================
   Tujuan:
     Mengubah jam check-in siswa yang >= 06:40 WIB menjadi rentang
     06:39:00–06:39:59 WIB, tanpa mengubah tanggal WIB.

   Cakupan:
     - check_ins.checked_in_at untuk check-in yang tertaut ke siswa
       (student_id is not null).
     - morning_records.checkin_at.
     - morning_records.recorded_at untuk catatan manual yang tidak
       punya checkin_at (jam ini yang tampil di riwayat).

   Tidak diubah:
     - check_ins tanpa student_id (pending/rejected).
     - checkin_date, tanggal, source, poin siswa.
     - sessions, get_session_status(), fungsi delete.
     - pending_students.created_at (waktu pengajuan/admin, bukan jam scan).

   Mapping:
     Semua jam unik >= 06:40 diurutkan, lalu dipetakan merata ke
     06:39:00–06:39:59. Jam asli yang sama menghasilkan jam baru yang
     sama di semua tanggal dan tabel. Urutan record tetap terjaga.

   Batas data:
     Hanya record sebelum 29 Okt 2026 00:00 WIB. Ini mencegah script
     ikut mengubah data baru jika dijalankan ulang di kemudian hari.

   PENTING:
     Script ini one-time. Backup dibuat di schema
     backup_20261028_0640. Jika dijalankan dua kali, pembuatan tabel
     backup akan gagal dan seluruh transaksi dibatalkan.
     Jalankan preview di bagian 0 terlebih dahulu.
   ================================================================ */

/* ================================================================
   0. PREVIEW (jalankan terpisah, read-only)
   ================================================================ */
/*
select 'check_ins.checked_in_at' as sumber, count(*) as jumlah,
       min((checked_in_at at time zone 'Asia/Jakarta')::time) as jam_awal,
       max((checked_in_at at time zone 'Asia/Jakarta')::time) as jam_akhir
from check_ins
where student_id is not null
  and checked_in_at < timestamptz '2026-10-29 00:00:00+07'
  and (checked_in_at at time zone 'Asia/Jakarta')::time >= time '06:40'
union all
select 'morning_records.checkin_at', count(*),
       min((checkin_at at time zone 'Asia/Jakarta')::time),
       max((checkin_at at time zone 'Asia/Jakarta')::time)
from morning_records
where checkin_at is not null
  and checkin_at < timestamptz '2026-10-29 00:00:00+07'
  and (checkin_at at time zone 'Asia/Jakarta')::time >= time '06:40'
union all
select 'morning_records.recorded_at (manual)', count(*),
       min((recorded_at at time zone 'Asia/Jakarta')::time),
       max((recorded_at at time zone 'Asia/Jakarta')::time)
from morning_records
where checkin_at is null
  and recorded_at is not null
  and recorded_at < timestamptz '2026-10-29 00:00:00+07'
  and (recorded_at at time zone 'Asia/Jakarta')::time >= time '06:40';

-- Record tanpa student_id (pending/rejected) sengaja tidak diubah.
select id, nama_manual, kelas_manual, checked_in_at
from check_ins
where student_id is null
  and checked_in_at < timestamptz '2026-10-29 00:00:00+07'
  and (checked_in_at at time zone 'Asia/Jakarta')::time >= time '06:40';
*/

/* ================================================================
   1. KOREKSI
   ================================================================ */
begin;

-- 1a. Backup penuh kedua tabel yang diubah.
create schema if not exists backup_20261028_0640;

create table backup_20261028_0640.check_ins as
select * from check_ins;

create table backup_20261028_0640.morning_records as
select * from morning_records;

-- 1b. Batas data yang boleh dikoreksi.
create temp table batas_0640 on commit drop as
select timestamptz '2026-10-29 00:00:00+07' as sampai;

-- 1c. Mapping jam: semua jam unik >= 06:40 -> 06:39:00..06:39:59.
create temp table map_jam_0640 on commit drop as
with waktu_unik as (
  select distinct (c.checked_in_at at time zone 'Asia/Jakarta')::time as waktu
  from check_ins c, batas_0640 b
  where c.student_id is not null
    and c.checked_in_at < b.sampai
    and (c.checked_in_at at time zone 'Asia/Jakarta')::time >= time '06:40'

  union

  select distinct (m.checkin_at at time zone 'Asia/Jakarta')::time
  from morning_records m, batas_0640 b
  where m.checkin_at is not null
    and m.checkin_at < b.sampai
    and (m.checkin_at at time zone 'Asia/Jakarta')::time >= time '06:40'

  union

  select distinct (m.recorded_at at time zone 'Asia/Jakarta')::time
  from morning_records m, batas_0640 b
  where m.checkin_at is null
    and m.recorded_at is not null
    and m.recorded_at < b.sampai
    and (m.recorded_at at time zone 'Asia/Jakarta')::time >= time '06:40'
),
ranked as (
  select waktu,
         row_number() over (order by waktu) as rn,
         count(*) over () as total
  from waktu_unik
)
select
  waktu,
  case
    when total = 1 then time '06:39:59'
    else (
      time '06:39:00'
      + make_interval(
          secs => floor(
            (rn - 1)::numeric * 59
            / greatest(total - 1, 1)
          )::double precision
        )
    )::time
  end as waktu_baru
from ranked;

-- 1d. check_ins: jam scan siswa.
update check_ins c
set checked_in_at = (
  (
    (c.checked_in_at at time zone 'Asia/Jakarta')::date
    + m.waktu_baru
  ) at time zone 'Asia/Jakarta'
)
from map_jam_0640 m, batas_0640 b
where c.student_id is not null
  and c.checked_in_at < b.sampai
  and (c.checked_in_at at time zone 'Asia/Jakarta')::time = m.waktu;

-- 1e. morning_records: jam yang tampil di riwayat.
update morning_records r
set checkin_at = (
  (
    (r.checkin_at at time zone 'Asia/Jakarta')::date
    + m.waktu_baru
  ) at time zone 'Asia/Jakarta'
)
from map_jam_0640 m, batas_0640 b
where r.checkin_at is not null
  and r.checkin_at < b.sampai
  and (r.checkin_at at time zone 'Asia/Jakarta')::time = m.waktu;

-- 1f. morning_records manual: recorded_at hanya bila checkin_at null.
update morning_records r
set recorded_at = (
  (
    (r.recorded_at at time zone 'Asia/Jakarta')::date
    + m.waktu_baru
  ) at time zone 'Asia/Jakarta'
)
from map_jam_0640 m, batas_0640 b
where r.checkin_at is null
  and r.recorded_at is not null
  and r.recorded_at < b.sampai
  and (r.recorded_at at time zone 'Asia/Jakarta')::time = m.waktu;

-- 1g. Verifikasi: tidak boleh ada sisa jam >= 06:40 pada cakupan ini.
do $$
declare
  v_checkins int;
  v_morning int;
  v_recorded int;
begin
  select count(*) into v_checkins
  from check_ins
  where student_id is not null
    and checked_in_at < timestamptz '2026-10-29 00:00:00+07'
    and (checked_in_at at time zone 'Asia/Jakarta')::time >= time '06:40';

  select count(*) into v_morning
  from morning_records
  where checkin_at is not null
    and checkin_at < timestamptz '2026-10-29 00:00:00+07'
    and (checkin_at at time zone 'Asia/Jakarta')::time >= time '06:40';

  select count(*) into v_recorded
  from morning_records
  where checkin_at is null
    and recorded_at is not null
    and recorded_at < timestamptz '2026-10-29 00:00:00+07'
    and (recorded_at at time zone 'Asia/Jakarta')::time >= time '06:40';

  if v_checkins <> 0 or v_morning <> 0 or v_recorded <> 0 then
    raise exception
      'Verifikasi gagal: check_ins=%, morning=%, recorded=%',
      v_checkins, v_morning, v_recorded;
  end if;
end
$$;

-- 1h. Verifikasi: jumlah baris tidak berubah.
do $$
declare
  v_ci_before int;
  v_mr_before int;
  v_ci_after int;
  v_mr_after int;
begin
  select count(*) into v_ci_before from backup_20261028_0640.check_ins;
  select count(*) into v_mr_before from backup_20261028_0640.morning_records;
  select count(*) into v_ci_after from check_ins;
  select count(*) into v_mr_after from morning_records;

  if v_ci_before <> v_ci_after or v_mr_before <> v_mr_after then
    raise exception
      'Jumlah baris berubah: check_ins % -> %, morning_records % -> %',
      v_ci_before, v_ci_after, v_mr_before, v_mr_after;
  end if;
end
$$;

commit;

/* ================================================================
   2. ROLLBACK (bila diperlukan)
   ================================================================
   Jalankan hanya jika hasil koreksi perlu dikembalikan. Backup harus
   berasal dari sebelum koreksi dijalankan.

begin;
update check_ins c
set checked_in_at = b.checked_in_at
from backup_20261028_0640.check_ins b
where c.id = b.id;

update morning_records m
set checkin_at = b.checkin_at,
    recorded_at = b.recorded_at
from backup_20261028_0640.morning_records b
where m.id = b.id;
commit;
   ================================================================ */
