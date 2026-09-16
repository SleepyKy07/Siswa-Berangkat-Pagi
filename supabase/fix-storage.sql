-- ============================================================
-- PERBAIKAN CEPAT: POLICY STORAGE SELFIE
-- Jalankan ini di Supabase SQL Editor.
-- ============================================================
-- Masalah: upload selfie berhasil (200) tapi file "tidak ditemukan"
-- saat dibuat signed URL. Penyebab: tidak ada policy SELECT pada
-- storage.objects untuk bucket 'selfies', sehingga file tidak terlihat.
-- Solusi: tambah policy SELECT (untuk sign) + DELETE (untuk bersihkan).
-- ============================================================

-- Pastikan bucket privat sudah ada
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('selfies', 'selfies', false, 2097152, array['image/jpeg','image/png'])
on conflict (id) do nothing;

-- Upload (sudah ada, buat jaga-jaga)
drop policy if exists "Selfie upload anon" on storage.objects;
create policy "Selfie upload anon" on storage.objects
  for insert to anon, authenticated
  with check (bucket_id = 'selfies');

-- SELECT: wajib agar signed URL bisa dibuat
drop policy if exists "Selfie sign selfies" on storage.objects;
create policy "Selfie sign selfies" on storage.objects
  for select to anon, authenticated
  using (bucket_id = 'selfies');

-- DELETE: untuk pembersihan selfie lama oleh admin
drop policy if exists "Selfie delete selfies" on storage.objects;
create policy "Selfie delete selfies" on storage.objects
  for delete to anon, authenticated
  using (bucket_id = 'selfies');

-- Hapus fungsi lama yang salah (memakai storage.create_signed_url yang tidak ada)
drop function if exists get_selfie_url(text, int);
