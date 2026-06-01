// Otomatis menyesuaikan URL backend:
// - Saat di Railway/production: pakai URL yang sama (karena backend serve frontend)
// - Saat di localhost (development): pakai port 3000
const API_BASE = (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
  ? 'http://localhost:3000'
  : window.location.origin;
const FRAMES_PER_BATCH   = 12;

const params      = new URLSearchParams(window.location.search);
const detectionId = params.get("id");
if (!detectionId) window.location.href = "index.html";

// ── Format tanggal ────────────────────────────────────────────
function formatTanggal(iso) {
  return new Date(iso).toLocaleString('id-ID', {
    weekday: 'long', day: 'numeric', month: 'long',
    year: 'numeric', hour: '2-digit', minute: '2-digit'
  });
}

function formatTanggalPendek(iso) {
  return new Date(iso).toLocaleString('id-ID', {
    day: 'numeric', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit'
  });
}

// ── Fetch ─────────────────────────────────────────────────────
async function fetchDetection(id) {
  const res = await fetch(`${API_BASE}/api/detections/${id}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return await res.json();
}

async function fetchFrames(id) {
  const res = await fetch(`${API_BASE}/api/frames/by-detection/${id}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return await res.json();
}

// ── Render info lokasi ────────────────────────────────────────
function renderLocationInfo(det) {
  const latStr = (det.latitude  != null) ? det.latitude.toFixed(6)  : '–';
  const lngStr = (det.longitude != null) ? det.longitude.toFixed(6) : '–';

  document.getElementById('location-info').innerHTML = `
    <div class="card-accent" style="background:linear-gradient(to bottom,#ea580c,#f97316)"></div>
    <div class="card-inner">
      <div class="card-title" style="color:#ea580c">
        <svg width="15" height="15" viewBox="0 0 15 15" fill="none">
          <path d="M7.5 13.5S2 8.8 2 5.5a5.5 5.5 0 0111 0C13 8.8 7.5 13.5 7.5 13.5Z"
            stroke="#ea580c" stroke-width="1.4"/>
          <circle cx="7.5" cy="5.5" r="2" stroke="#ea580c" stroke-width="1.4"/>
        </svg>
        Informasi Lokasi
      </div>
      <p class="loc-name">${det.location_name || 'Lokasi Tidak Diketahui'}</p>
      <div class="loc-meta">
        <div class="loc-meta-item">🕐 ${formatTanggal(det.timestamp)}</div>
        <div class="loc-meta-item">🌐 ${latStr}, ${lngStr}</div>
      </div>
    </div>
  `;
}

// ── Render data sampah ────────────────────────────────────────
function renderWasteSummary(det) {
  document.getElementById('count-bottles').textContent = det.plastic_bottle_count ?? 0;
  document.getElementById('count-cans').textContent    = det.can_count            ?? 0;
  document.getElementById('area-leaf').textContent     = (det.leaf_pile_area_m2   ?? 0).toFixed(2);
  document.getElementById('area-mixed').textContent    = (det.mixed_waste_area_m2 ?? 0).toFixed(2);
  document.getElementById('waste-summary').style.display = 'block';
}

// ── Render frame — infinite scroll ───────────────────────────
let semuaFrames   = [];
let frameRendered = 0;
let isLoading     = false;
let scrollObserver = null;

function renderFrameBatch() {
  if (isLoading) return;
  if (frameRendered >= semuaFrames.length) return;

  isLoading = true;

  const container = document.getElementById('frames-container');
  const indicator = document.getElementById('scroll-indicator');
  const scrollTxt = document.getElementById('scroll-text');

  indicator.style.display = 'flex';

  const batch = semuaFrames.slice(frameRendered, frameRendered + FRAMES_PER_BATCH);

  setTimeout(() => {
    batch.forEach((frame, i) => {
      const nomor = frameRendered + i + 1;

      // URL gambar: gunakan path /uploads/ yang sudah di-serve oleh express
      const imgSrc = `${API_BASE}/uploads/${frame.image_path}`;

      const card = document.createElement('div');
      card.className = 'frame-card';
      card.innerHTML = `
        <div class="frame-wrapper">
          <img
            class="frame-img"
            src="${imgSrc}"
            alt="Frame ${nomor}"
            loading="lazy"
          >
          <span class="frame-zoom-hint">Perbesar</span>
        </div>
        <p class="frame-label">Frame ${nomor} &nbsp;|&nbsp; ${formatTanggalPendek(frame.timestamp)}</p>
      `;

      card.addEventListener('click', () => {
        bukaLightbox(imgSrc, nomor, formatTanggalPendek(frame.timestamp));
      });

      container.appendChild(card);
    });

    frameRendered += batch.length;
    isLoading = false;

    const tersisa = semuaFrames.length - frameRendered;
    if (tersisa > 0) {
      scrollTxt.textContent = `Scroll ke bawah untuk memuat lebih banyak (${tersisa} frame tersisa)`;
    } else {
      indicator.style.display = 'none';
    }
  }, 300);
}

// ── Infinite scroll observer ──────────────────────────────────
function setupInfiniteScroll() {
  const indicator = document.getElementById('scroll-indicator');

  // Disconnect observer lama sebelum membuat yang baru
  if (scrollObserver) {
    scrollObserver.disconnect();
  }

  scrollObserver = new IntersectionObserver((entries) => {
    if (entries[0].isIntersecting) {
      renderFrameBatch();
    }
  }, { rootMargin: '200px' });

  scrollObserver.observe(indicator);
}

// ── Lightbox ──────────────────────────────────────────────────
let lightboxFrameIndex = 0;

function bukaLightbox(src, nomor, waktu) {
  lightboxFrameIndex = nomor - 1;
  updateLightbox();
  document.getElementById('lightbox').classList.add('active');
}

function updateLightbox() {
  const frame  = semuaFrames[lightboxFrameIndex];
  const nomor  = lightboxFrameIndex + 1;
  const imgSrc = `${API_BASE}/uploads/${frame.image_path}`;

  document.getElementById('lightbox-img').src     = imgSrc;
  document.getElementById('lightbox-caption').textContent =
    `Frame ${nomor} · ${formatTanggalPendek(frame.timestamp)}`;
  document.getElementById('nav-counter').textContent =
    `${nomor} / ${semuaFrames.length}`;

  document.getElementById('btn-prev').disabled = lightboxFrameIndex === 0;
  document.getElementById('btn-next').disabled = lightboxFrameIndex === semuaFrames.length - 1;
}

function tutupLightbox() {
  document.getElementById('lightbox').classList.remove('active');
  document.getElementById('lightbox-img').src = '';
}

document.getElementById('lightbox-close').addEventListener('click', tutupLightbox);
document.getElementById('lightbox').addEventListener('click', function(e) {
  if (e.target === this) tutupLightbox();
});
document.getElementById('btn-prev').addEventListener('click', () => {
  if (lightboxFrameIndex > 0) { lightboxFrameIndex--; updateLightbox(); }
});
document.getElementById('btn-next').addEventListener('click', () => {
  if (lightboxFrameIndex < semuaFrames.length - 1) { lightboxFrameIndex++; updateLightbox(); }
});
document.addEventListener('keydown', e => {
  if (!document.getElementById('lightbox').classList.contains('active')) return;
  if (e.key === 'Escape') tutupLightbox();
  if (e.key === 'ArrowLeft'  && lightboxFrameIndex > 0)                      { lightboxFrameIndex--; updateLightbox(); }
  if (e.key === 'ArrowRight' && lightboxFrameIndex < semuaFrames.length - 1) { lightboxFrameIndex++; updateLightbox(); }
});

// ── Main ──────────────────────────────────────────────────────────────────────
async function initPage() {
  try {
    const [detection, frames] = await Promise.all([
      fetchDetection(detectionId),
      fetchFrames(detectionId)
    ]);

    document.title = `${detection.location_name || 'Detail'} — Trash Vision`;
    semuaFrames = frames;

    renderLocationInfo(detection);
    renderWasteSummary(detection);

    const section = document.getElementById('frames-section');
    section.style.display = 'block';

    const badge = document.getElementById('frame-count-badge');
    badge.textContent = `${frames.length} frame`;

    if (frames.length === 0) {
      document.getElementById('frames-container').innerHTML =
        '<p class="loading-msg" style="grid-column:1/-1">Belum ada frame untuk lokasi ini.</p>';
    } else {
      renderFrameBatch();
      setupInfiniteScroll();
    }

  } catch (err) {
    console.error(err);
    document.getElementById('location-info').innerHTML = `
      <div class="card-accent" style="background:#dc2626"></div>
      <div class="card-inner">
        <div class="error-msg">
          <strong>Gagal memuat data.</strong><br>
          Backend belum tersedia atau ID tidak ditemukan.<br><br>
          <a href="index.html" style="color:#dc2626;font-weight:700">Kembali ke Peta</a>
        </div>
      </div>
    `;
  }
}

initPage();
