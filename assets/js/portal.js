/* ================================================================
   PORTAL PROGRAM KERJA OSIS — portal.js
   ================================================================
   Cara menambah program kerja baru:
   1. Tambah objek baru di PROGRAM (ikon, judul, deskripsi, target, warna)
   2. Dua warna: 'w1' (utama) & 'w2' (sekunder)
   ================================================================ */
(function () {
  'use strict';

  // Statistik lama (localStorage) tidak dipakai lagi — data apresiasi
  // tersimpan di Supabase. Angka diambil dari server (list_apresiasi_siswa);
  // bila backend belum dikonfigurasi/offline, tampil '-'.
  function muatStatistikServer() {
    var jmlS = document.getElementById('jml-siswa');
    var jmlA = document.getElementById('jml-apresiasi');
    if (!jmlS && !jmlA) return;
    if (!window.SBPag) { tandaiGagal(); return; }

    window.SBPag.init();
    window.SBPag.listApresiasiSiswa().then(function (res) {
      if (res && res.error) { tandaiGagal(); return; }
      var items = (res && res.items) || [];
      var totalPoin = items.reduce(function (a, s) { return a + (Number(s.poin) || 0); }, 0);
      if (jmlS) jmlS.textContent = items.length;
      if (jmlA) jmlA.textContent = totalPoin;
    }).catch(function () { tandaiGagal(); });

    function tandaiGagal() {
      if (jmlS) { jmlS.textContent = '-'; jmlS.title = 'Gagal memuat dari server'; }
      if (jmlA) { jmlA.textContent = '-'; jmlA.title = 'Gagal memuat dari server'; }
    }
  }

  var PROGRAM = [
    {
      ikon: "\u{1F305}",
      judul: "Berangkat Pagi",
      deskripsi: "Program apresiasi untuk siswa yang datang paling pagi. Setiap 2x berangkat paling pagi, siswa menerima apresiasi.",
      target: "./berangkat-pagi/",
      w1: "#4338ca",
      w2: "#6366f1",
      status: "Aktif"
    },
    {
      ikon: "\u{1F6D1}",
      judul: "Jadwal Petugas Gerbang",
      deskripsi: "Sistem rotasi adil untuk pengaturan jadwal petugas gerbang sekolah dengan algoritma load balancing.",
      target: "./jadwal-gerbang/",
      w1: "#ea580c",
      w2: "#fb923c",
      status: "Aktif"
    },
    {
      ikon: "\u{1F510}",
      judul: "Dashboard Absensi (Admin)",
      deskripsi: "Kelola sesi absensi berangkat pagi: aktif/nonaktif, data pending, riwayat check-in & selfie. Halaman siswa (QR) tetap di /checkin.",
      target: "./checkin/dashboard.html",
      w1: "#0f766e",
      w2: "#14b8a6",
      status: "Aktif"
    }
  ];

  document.addEventListener('DOMContentLoaded', function () {
    var grid = document.getElementById('grid-proker');
    var jmlP = document.getElementById('jml-proker');

    if (jmlP) jmlP.textContent = PROGRAM.filter(function (p) { return p.status === 'Aktif'; }).length;

    if (grid) {
      grid.innerHTML = PROGRAM.map(function (p) {
        return '' +
          '<a class="card-proker" href="' + p.target + '" style="--pk1:' + p.w1 + ';--pk2:' + p.w2 + ';--pk-bg:' + p.w1 + '1a">' +
            '<div class="ic-proker">' + p.ikon + '</div>' +
            '<h3>' + p.judul + '</h3>' +
            '<p>' + p.deskripsi + '</p>' +
            '<span class="btn-buka">Buka Program</span>' +
          '</a>';
      }).join('');
    }

    muatStatistikServer();
  });
})();