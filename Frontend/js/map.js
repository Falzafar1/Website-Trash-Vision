// Otomatis menyesuaikan URL backend:
// - Saat di Railway/production: pakai URL yang sama (karena backend serve frontend)
// - Saat di localhost (development): pakai port 3000
const API_BASE = (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
  ? 'http://localhost:3000'
  : window.location.origin;
const REFRESH_INTERVAL = 30000;

// ── Inisialisasi peta ──────────────────────────────────────────
const map = L.map("map").setView([-6.8936, 107.6107], 14);

L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  attribution: '© <a href="https://www.openstreetmap.org/">OpenStreetMap</a> contributors',
  maxZoom: 19
}).addTo(map);

// ── Marker pinpoint SVG ───────────────────────────────────────
function buatMarker() {
  return L.divIcon({
    className: '',
    html: `
      <div class="pin-wrap">
        <svg width="36" height="44" viewBox="0 0 36 44" fill="none">
          <path d="M18 42C18 42 4 26 4 16a14 14 0 0128 0C32 26 18 42 18 42Z"
            fill="#e8000d" stroke="#ffffff" stroke-width="2"/>
          <circle cx="18" cy="16" r="7" fill="#ffffff"/>
          <path d="M14 17l2.5 2.5 5-5"
            stroke="#e8000d" stroke-width="2"
            stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </div>
    `,
    iconSize: [36, 44],
    iconAnchor: [18, 44],
    popupAnchor: [0, -46]
  });
}

// ── Format tanggal ────────────────────────────────────────────
function formatTanggal(iso) {
  return new Date(iso).toLocaleString('id-ID', {
    day: 'numeric', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit'
  });
}

// ── Render pinpoint lokasi deteksi ───────────────────────────
let currentMarkers = [];

function renderPinpoints(detections) {
  currentMarkers.forEach(m => m.remove());
  currentMarkers = [];

  let totBottle = 0, totCan = 0, totLeaf = 0, totMixed = 0;

  detections.forEach(d => {
    // Gunakan field baru dari backend
    totBottle += (d.plastic_bottle_count || 0);
    totCan    += (d.can_count            || 0);
    totLeaf   += (d.leaf_pile_area_m2    || 0);
    totMixed  += (d.mixed_waste_area_m2  || 0);

    // Hanya pasang marker jika koordinat valid
    if (!d.latitude || !d.longitude) return;

    const marker = L.marker([d.latitude, d.longitude], { icon: buatMarker() }).addTo(map);

    marker.bindPopup(`
      <div class="popup-inner">
        <div class="popup-header">
          <div class="popup-loc-icon">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M7 13S2 8.5 2 5.5a5 5 0 0110 0C12 8.5 7 13 7 13Z" fill="#4ade80"/>
              <circle cx="7" cy="5.5" r="2" fill="#1a3a2a"/>
            </svg>
          </div>
          <h3>${d.location_name || 'Lokasi Tidak Diketahui'}</h3>
        </div>
        <p class="popup-waktu">🕐 ${formatTanggal(d.timestamp)}</p>
        <div class="popup-divider"></div>
        <div class="popup-grid">
          <div class="pg-item pg-bl">
            <span class="pgl">Botol Plastik</span>
            <span class="pgv">${d.plastic_bottle_count || 0} pcs</span>
          </div>
          <div class="pg-item pg-pu">
            <span class="pgl">Kaleng</span>
            <span class="pgv">${d.can_count || 0} pcs</span>
          </div>
          <div class="pg-item pg-gr">
            <span class="pgl">Tumpukan Daun</span>
            <span class="pgv">${(d.leaf_pile_area_m2 || 0).toFixed(1)} m²</span>
          </div>
          <div class="pg-item pg-am">
            <span class="pgl">Luas Sampah</span>
            <span class="pgv">${(d.mixed_waste_area_m2 || 0).toFixed(1)} m²</span>
          </div>
        </div>
        <a href="detail.html?id=${d.id}" class="btn-detail">Lihat Detail</a>
      </div>
    `, { maxWidth: 280 });

    currentMarkers.push(marker);
  });

  document.getElementById('total-locations').textContent = detections.length;
  document.getElementById('total-bottles').textContent   = totBottle;
  document.getElementById('total-cans').textContent      = totCan;
  document.getElementById('total-leaf').textContent      = totLeaf.toFixed(1) + ' m²';
  document.getElementById('total-mixed').textContent     = totMixed.toFixed(1) + ' m²';
}

// ── Render track drone ────────────────────────────────────────
let currentTracks = [];

function renderTrack(tracks) {
  currentTracks.forEach(t => t.remove());
  currentTracks = [];

  if (!tracks || tracks.length === 0) return;

  const sesi = {};
  tracks.forEach(t => {
    if (!sesi[t.session_id]) sesi[t.session_id] = [];
    sesi[t.session_id].push([t.latitude, t.longitude]);
  });

  const warnaTrack = ['#e8690a', '#4ade80', '#60a5fa', '#facc15', '#f87171'];
  let i = 0;

  Object.values(sesi).forEach(koordinat => {
    const warna = warnaTrack[i % warnaTrack.length];

    const garis = L.polyline(koordinat, {
      color: warna, weight: 2.5, opacity: 0.75, dashArray: '7, 6'
    }).addTo(map);
    currentTracks.push(garis);

    koordinat.forEach(([lat, lng]) => {
      const dot = L.circleMarker([lat, lng], {
        radius: 3.5, color: warna, fillColor: warna,
        fillOpacity: 0.65, weight: 1, interactive: false
      }).addTo(map);
      currentTracks.push(dot);
    });

    i++;
  });
}

// ── Fungsi utama ──────────────────────────────────────────────
async function loadAndRenderMap() {
  try {
    const [resD, resT] = await Promise.all([
      fetch(`${API_BASE}/api/detections`),
      fetch(`${API_BASE}/api/tracks`)
    ]);

    if (!resD.ok) throw new Error(`Detections: HTTP ${resD.status}`);
    if (!resT.ok) throw new Error(`Tracks: HTTP ${resT.status}`);

    const detections = await resD.json();
    const tracks     = await resT.json();

    renderPinpoints(detections);
    renderTrack(tracks);

    const badge = document.getElementById('status-badge');
    badge.textContent = '● Live';
    badge.className = 'badge-status badge-live';

  } catch (err) {
    console.warn("Backend belum tersedia:", err.message);

    const badge = document.getElementById('status-badge');
    badge.textContent = '● Offline';
    badge.className = 'badge-status badge-offline';

    ['total-locations','total-bottles','total-cans','total-leaf','total-mixed']
      .forEach(id => document.getElementById(id).textContent = '–');
  }
}

loadAndRenderMap();
setInterval(loadAndRenderMap, REFRESH_INTERVAL);
