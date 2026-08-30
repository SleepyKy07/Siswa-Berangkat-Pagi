/* ================================================================
   PORTAL PROGRAM KERJA OSIS — portal.js
   ================================================================
   Cara menambah program kerja baru:
   1. Isi PATH_TAMBALAN = <nama folder program>, contoh "proker-3"
   2. Pilih ikon/emoji bebas untuk 'ikon'
   3. Isi 'judul', 'deskripsi'
   4. Dua warna: 'w1' (utama) & 'w2' (sekunder)
   ================================================================ */
(function () {
  'use strict';

  function ambilBagian(k, def) {
    try {
      var d = JSON.parse(localStorage.getItem('apresiasiSiswaPagiV1'));
      return (d && d[k]) ? d[k] : def;
    } catch (e) { return def; }
  }

  function ambilSiswa() {
    var arr = ambilBagian('students', []);
    return Array.isArray(arr) ? arr.length : 0;
  }

  function kunciApresiasi() {
    var poin = ambilBagian('poin', {});
    var n = 0;
    for (var k in poin) if (poin[k]) n++;
    return n;
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
      ikon: "\u{1F4CC}",
      judul: "Program Kerja 2",
      deskripsi: "Deskripsi sementara. Silakan ganti dengan tujuan dan kegiatan program kerja yang sebenarnya.",
      target: "./proker-2/",
      w1: "#0ea5e9",
      w2: "#22d3ee",
      status: "Segera"
    }
  ];

  document.addEventListener('DOMContentLoaded', function () {
    var grid = document.getElementById('grid-proker');
    var jmlS = document.getElementById('jml-siswa');
    var jmlA = document.getElementById('jml-apresiasi');
    var jmlP = document.getElementById('jml-proker');

    if (jmlS) jmlS.textContent = ambilSiswa();
    if (jmlA) jmlA.textContent = kunciApresiasi();
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
  });
})();