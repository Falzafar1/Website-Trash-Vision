/**
 * riwayat.js — Logic halaman Riwayat Deteksi
 * Fitur: filter tanggal+jam, tampilkan tabel, hapus massal
 */

const API_BASE = (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
  ? 'http://localhost:3000'
  : window.location.origin;

// ── State ──────────────────────────────────────────────────────────────────────
let dataRiwayat    = [];
let filterAktif    = {};

// ── Format Tanggal ke lokal ────────────────────────────────────────────────────
function formatWaktu(str) {
  if (!str) return '—';
  const d = new Date(str.replace(' ', 'T'));
  if (isNaN(d)) return str;
  return d.toLocaleString('id-ID', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit'
  });
}

// ── Render Tabel ───────────────────────────────────────────────────────────────
function renderTabel(data) {
  const tbody    = document.getElementById('riwayat-tbody');
  const tabel    = document.getElementById('riwayat-table');
  const empty    = document.getElementById('empty-state');
  const loading  = document.getElementById('loading-state');
  const statusEl = document.getElementById('status-count');
  const dotEl    = document.getElementById('status-dot');

  loading.style.display = 'none';

  if (!data || data.length === 0) {
    tabel.style.display = 'none';
    empty.style.display = 'flex';
    statusEl.textContent = 'Tidak ada data ditemukan';
    dotEl.className = 'status-dot dot-empty';
    return;
  }

  empty.style.display = 'none';
  tabel.style.display  = 'table';

  statusEl.textContent = `${data.length} data ditemukan`;
  dotEl.className = 'status-dot dot-ok';

  tbody.innerHTML = data.map((d, i) => `
    <tr class="riwayat-row" id="row-${d.id}">
      <td class="col-no">${i + 1}</td>
      <td class="col-waktu">
        <span class="waktu-primary">${formatWaktu(d.timestamp)}</span>
      </td>
      <td class="col-lokasi">
        <span class="lokasi-name">${d.location_name || '—'}</span>
        <span class="lokasi-gps">${d.gps || ''}</span>
      </td>
      <td class="col-num"><span class="badge-bl">${d.plastic_bottle_count || 0}</span></td>
      <td class="col-num"><span class="badge-pu">${d.can_count || 0}</span></td>
      <td class="col-num"><span class="badge-gr">${(d.leaf_pile_area_m2 || 0).toFixed(1)}</span></td>
      <td class="col-num"><span class="badge-am">${(d.mixed_waste_area_m2 || 0).toFixed(1)}</span></td>
      <td class="col-num"><strong>${d.jumlah_objek || 0}</strong></td>
      <td class="col-aksi">
        <a href="detail.html?id=${d.id}" class="btn-lihat">Detail</a>
      </td>
    </tr>
  `).join('');
}

// ── Ambil Data dari API ────────────────────────────────────────────────────────
async function ambilData(params = {}) {
  const loading  = document.getElementById('loading-state');
  const tabel    = document.getElementById('riwayat-table');
  const empty    = document.getElementById('empty-state');
  const statusEl = document.getElementById('status-count');

  loading.style.display = 'flex';
  tabel.style.display   = 'none';
  empty.style.display   = 'none';
  statusEl.textContent  = 'Mengambil data…';

  const query = new URLSearchParams(params).toString();
  const url   = `${API_BASE}/api/riwayat${query ? '?' + query : ''}`;

  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    dataRiwayat = await res.json();
    renderTabel(dataRiwayat);
  } catch (err) {
    loading.style.display = 'none';
    statusEl.textContent  = 'Gagal memuat data: ' + err.message;
    console.error('Gagal ambil riwayat:', err);
  }
}

// ── Terapkan Filter ────────────────────────────────────────────────────────────
function terapkanFilter() {
  const dateFrom = document.getElementById('date-from').value;
  const dateTo   = document.getElementById('date-to').value;
  const timeFrom = document.getElementById('time-from').value;
  const timeTo   = document.getElementById('time-to').value;

  const params = {};
  if (dateFrom) params.date_from = dateFrom;
  if (dateTo)   params.date_to   = dateTo;
  if (timeFrom) params.time_from = timeFrom;
  if (timeTo)   params.time_to   = timeTo;

  filterAktif = params;
  ambilData(params);
}

// ── Reset Filter ───────────────────────────────────────────────────────────────
function resetFilter() {
  document.getElementById('date-from').value = '';
  document.getElementById('date-to').value   = '';
  document.getElementById('time-from').value = '00:00';
  document.getElementById('time-to').value   = '23:59';
  filterAktif = {};
  ambilData();
}

// ── Konfirmasi Hapus ───────────────────────────────────────────────────────────
function konfirmasiHapus() {
  const dateFrom = document.getElementById('date-from').value;
  const dateTo   = document.getElementById('date-to').value;

  if (!dateFrom || !dateTo) {
    alert('⚠️ Pilih Tanggal Mulai dan Tanggal Selesai terlebih dahulu sebelum menghapus data.');
    return;
  }

  const timeFrom = document.getElementById('time-from').value || '00:00';
  const timeTo   = document.getElementById('time-to').value   || '23:59';

  const desc = document.getElementById('modal-desc');
  desc.innerHTML = `Anda akan menghapus <strong>semua data</strong> pada rentang:<br>
    <code>${dateFrom} ${timeFrom}</code> sampai <code>${dateTo} ${timeTo}</code>.<br><br>
    Tindakan ini <strong>tidak dapat dibatalkan</strong>.`;

  document.getElementById('modal-hapus').style.display = 'flex';
}

function tutupModal() {
  document.getElementById('modal-hapus').style.display = 'none';
}

// ── Jalankan Hapus ─────────────────────────────────────────────────────────────
async function jalankanHapus() {
  const dateFrom = document.getElementById('date-from').value;
  const dateTo   = document.getElementById('date-to').value;
  const timeFrom = document.getElementById('time-from').value || '00:00';
  const timeTo   = document.getElementById('time-to').value   || '23:59';

  const btnHapus = document.getElementById('btn-konfirmasi-hapus');
  btnHapus.disabled     = true;
  btnHapus.textContent  = 'Menghapus…';

  const params = new URLSearchParams({ date_from: dateFrom, date_to: dateTo, time_from: timeFrom, time_to: timeTo });
  const url    = `${API_BASE}/api/riwayat?${params.toString()}`;

  try {
    const res  = await fetch(url, { method: 'DELETE' });
    const json = await res.json();

    tutupModal();

    if (res.ok) {
      // Tampilkan notifikasi sukses
      tampilkanNotif(`✅ ${json.pesan}`, 'notif-sukses');
      // Refresh tabel
      terapkanFilter();
    } else {
      tampilkanNotif(`❌ ${json.pesan}`, 'notif-error');
    }
  } catch (err) {
    tutupModal();
    tampilkanNotif('❌ Gagal menghapus: ' + err.message, 'notif-error');
  } finally {
    btnHapus.disabled    = false;
    btnHapus.textContent = 'Ya, Hapus';
  }
}

// ── Notifikasi Toast ───────────────────────────────────────────────────────────
function tampilkanNotif(pesan, kelas) {
  const notif = document.createElement('div');
  notif.className = `notif-toast ${kelas}`;
  notif.textContent = pesan;
  document.body.appendChild(notif);

  // Animasi masuk
  requestAnimationFrame(() => notif.classList.add('notif-show'));

  setTimeout(() => {
    notif.classList.remove('notif-show');
    setTimeout(() => notif.remove(), 300);
  }, 3500);
}

// ── Tutup modal jika klik di luar ─────────────────────────────────────────────
document.getElementById('modal-hapus').addEventListener('click', function(e) {
  if (e.target === this) tutupModal();
});

// ── Load awal: semua data tanpa filter ────────────────────────────────────────
ambilData();
