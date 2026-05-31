/**
 * seeder.js — Isi database dengan data dummy untuk testing frontend
 * Jalankan sekali: node seeder.js
 */

require('dotenv').config();
const db = require('./config/database');

// ── Gambar yang tersedia di folder uploads/ ───────────────────
const gambar = [
    'Jembatan.png',
    'Jembatan2.png',
    'Jembatan3.jpg',
    'Basement_inf.jpg',
];

// ── Data dummy — 6 titik deteksi di sekitar Bandung ──────────
// Koordinat sengaja dibuat bervariasi agar marker menyebar di peta
const dataDeteksi = [
    {
        gps: '-6.8915490510531665, 107.61061738279982',
        latitude: -6.8915490510531665,
        longitude: 107.61061738279982,
        location_name: 'Lapcin, ITB',
        plastic_bottle_count: 11,
        can_count: 10,
        leaf_pile_area_m2: 0,
        mixed_waste_area_m2: 0,
        nama_gambar: gambar[0],
        timestamp: '2026-05-21 08:15:00',
    },
    {
        gps: '-6.890087658153114, 107.61119808828244',
        latitude: -6.890087658153114,
        longitude: 107.61119808828244,
        location_name: 'Basement, ITB',
        plastic_bottle_count: 10,
        can_count: 14,
        leaf_pile_area_m2: 0.0,
        mixed_waste_area_m2: 0,
        nama_gambar: gambar[3],
        timestamp: '2026-05-21 08:42:00',
    },
];

// ── Insert ke database ────────────────────────────────────────
const querySQL = `
    INSERT INTO tabel_deteksi
        (timestamp, gps, latitude, longitude, location_name,
         plastic_bottle_count, can_count, leaf_pile_area_m2,
         mixed_waste_area_m2, nama_gambar, jumlah_objek)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`;

db.serialize(() => {
    // Hapus semua data lama dulu agar tidak menumpuk (tabel_frame dulu baru tabel_deteksi karena relasi FK)
    db.run(`DELETE FROM tabel_frame`);
    db.run(`DELETE FROM tabel_deteksi`, (err) => {
        if (err) console.error('Gagal hapus data lama:', err.message);
        else console.log('Data lama berhasil dihapus.\n');
    });

    // Reset auto-increment ID agar mulai dari 1 lagi
    db.run(`DELETE FROM sqlite_sequence WHERE name = 'tabel_deteksi'`);

    const stmt = db.prepare(querySQL);

    dataDeteksi.forEach((d, i) => {
        const jumlah_objek = d.plastic_bottle_count + d.can_count;
        stmt.run(
            d.timestamp,
            d.gps,
            d.latitude,
            d.longitude,
            d.location_name,
            d.plastic_bottle_count,
            d.can_count,
            d.leaf_pile_area_m2,
            d.mixed_waste_area_m2,
            d.nama_gambar,
            jumlah_objek,
            function (err) {
                if (err) {
                    console.error(`  ✗ Row ${i + 1} gagal:`, err.message);
                } else {
                    console.log(`  ✓ Row ${i + 1} tersimpan — ID ${this.lastID}: ${d.location_name}`);
                }
            }
        );
    });

    stmt.finalize(() => {
        console.log('\nSeeder selesai! Semua data dummy berhasil dimasukkan.');
        db.close();
    });
});
