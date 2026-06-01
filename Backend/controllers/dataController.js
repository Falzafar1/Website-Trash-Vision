const db    = require('../config/database');
const https = require('https');

// ── Helper: Reverse Geocoding via Nominatim ───────────────────────────────────
function reverseGeocode(lat, lng, callback) {
    const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=16&addressdetails=1`;
    const options = { headers: { 'User-Agent': 'TrashVisionMonitoring/1.0' } };

    https.get(url, options, (res) => {
        let body = '';
        res.on('data', chunk => body += chunk);
        res.on('end', () => {
            try {
                const data = JSON.parse(body);
                const addr = data.address || {};
                const nama =
                    addr.road    || addr.suburb  || addr.village ||
                    addr.town    || addr.county  || addr.city    ||
                    `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
                callback(null, nama);
            } catch (e) {
                callback(null, `${lat.toFixed(4)}, ${lng.toFixed(4)}`);
            }
        });
    }).on('error', () => {
        callback(null, `${lat.toFixed(4)}, ${lng.toFixed(4)}`);
    });
}

// ── POST /api/kirim-data ──────────────────────────────────────────────────────
// Dipanggil SEKALI di awal sesi dari Raspi.
// Jika koordinat GPS sudah ada (dalam radius ~55m), UPDATE row lama.
// Jika belum ada, INSERT row baru.
const LOKASI_THRESHOLD = 0.0005; // ~55 meter dalam derajat

const terimaDataRaspberry = (req, res) => {
    try {
        const fileGambar           = req.file;
        const koordinatGPS         = req.body.gps                  || '';
        const plastic_bottle_count = parseInt(req.body.plastic_bottle_count) || 0;
        const can_count            = parseInt(req.body.can_count)            || 0;
        const leaf_pile_area_m2    = parseFloat(req.body.leaf_pile_area_m2)  || 0;
        const mixed_waste_area_m2  = parseFloat(req.body.mixed_waste_area_m2)|| 0;
        const jumlah_objek         = parseInt(req.body.jumlah_objek)         ||
                                     (plastic_bottle_count + can_count);

        if (!fileGambar) {
            return res.status(400).json({ pesan: "Gambar gagal diterima!" });
        }

        const bagian    = koordinatGPS.split(',').map(s => parseFloat(s.trim()));
        const latitude  = isNaN(bagian[0]) ? 0 : bagian[0];
        const longitude = isNaN(bagian[1]) ? 0 : bagian[1];
        const namaGambar = fileGambar.filename;

        // ── Cek apakah lokasi yang sama sudah ada di database ──
        // Hanya lakukan lookup jika GPS valid (bukan 0,0)
        const cariLokasiSama = (latitude !== 0 || longitude !== 0)
            ? `SELECT id, location_name FROM tabel_deteksi
               WHERE latitude  != 0
                 AND longitude != 0
                 AND ABS(latitude  - ?) < ?
                 AND ABS(longitude - ?) < ?
               ORDER BY timestamp DESC LIMIT 1`
            : null;

        const lanjutkan = (existingRow) => {
            if (existingRow) {
                // ════════════════════════════════════════════════
                // KASUS: Lokasi sudah ada → UPDATE row yang lama
                // ════════════════════════════════════════════════
                const rowId = existingRow.id;
                console.log(`\nLokasi sama ditemukan (ID: ${rowId}), memperbarui data...`);

                db.run(
                    `UPDATE tabel_deteksi SET
                        nama_gambar          = ?,
                        plastic_bottle_count = plastic_bottle_count + ?,
                        can_count            = can_count            + ?,
                        leaf_pile_area_m2    = leaf_pile_area_m2    + ?,
                        mixed_waste_area_m2  = mixed_waste_area_m2  + ?,
                        jumlah_objek         = jumlah_objek         + ?,
                        timestamp            = datetime('now','localtime')
                     WHERE id = ?`,
                    [namaGambar, plastic_bottle_count, can_count,
                     leaf_pile_area_m2, mixed_waste_area_m2, jumlah_objek, rowId],
                    function(errUpdate) {
                        if (errUpdate) {
                            console.error("Error update deteksi:", errUpdate.message);
                            return res.status(500).json({ pesan: "Gagal memperbarui data lokasi" });
                        }

                        // Tambahkan frame pertama sesi baru ke session yang sudah ada
                        db.run(
                            `INSERT INTO tabel_frame (deteksi_id, nama_gambar) VALUES (?, ?)`,
                            [rowId, namaGambar],
                            (errFrame) => {
                                if (!errFrame) console.log(`  Frame pertama disimpan (sesi ${rowId})`);
                            }
                        );

                        res.status(200).json({
                            status    : "Sukses",
                            pesan     : "Data lokasi yang sama diperbarui",
                            id_record : rowId,
                            session_id: rowId
                        });
                    }
                );

            } else {
                // ════════════════════════════════════════════════
                // KASUS: Lokasi baru → INSERT row baru
                // ════════════════════════════════════════════════
                const querySQL = `
                    INSERT INTO tabel_deteksi
                        (nama_gambar, gps, latitude, longitude, location_name,
                         plastic_bottle_count, can_count, leaf_pile_area_m2,
                         mixed_waste_area_m2, jumlah_objek)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                `;

                db.run(querySQL,
                    [namaGambar, koordinatGPS, latitude, longitude, 'Memuat lokasi...',
                     plastic_bottle_count, can_count, leaf_pile_area_m2,
                     mixed_waste_area_m2, jumlah_objek],
                    function(err) {
                        if (err) {
                            console.error("Error Database:", err.message);
                            return res.status(500).json({ pesan: "Gagal menyimpan data" });
                        }

                        const rowId = this.lastID;
                        console.log(`\nSesi baru dibuat dengan ID: ${rowId}`);

                        // Simpan foto pertama ke tabel_frame
                        db.run(
                            `INSERT INTO tabel_frame (deteksi_id, nama_gambar) VALUES (?, ?)`,
                            [rowId, namaGambar],
                            (errFrame) => {
                                if (!errFrame) console.log(`  Frame pertama disimpan (sesi ${rowId})`);
                            }
                        );

                        res.status(200).json({
                            status    : "Sukses",
                            pesan     : "Sesi baru berhasil dibuat",
                            id_record : rowId,
                            session_id: rowId
                        });

                        // Reverse geocoding di background
                        if (latitude !== 0 || longitude !== 0) {
                            reverseGeocode(latitude, longitude, (errGeo, namaLokasi) => {
                                db.run(
                                    `UPDATE tabel_deteksi SET location_name = ? WHERE id = ?`,
                                    [namaLokasi, rowId],
                                    (errUpdate) => {
                                        if (!errUpdate) {
                                            console.log(`  Geocode selesai → "${namaLokasi}" (ID: ${rowId})`);
                                        }
                                    }
                                );
                            });
                        }
                    }
                );
            }
        };

        // Jalankan pencarian lokasi atau langsung insert jika GPS tidak valid
        if (cariLokasiSama) {
            db.get(cariLokasiSama,
                [latitude, LOKASI_THRESHOLD, longitude, LOKASI_THRESHOLD],
                (errCek, existingRow) => {
                    if (errCek) console.error("Error cek lokasi:", errCek.message);
                    lanjutkan(errCek ? null : existingRow);
                }
            );
        } else {
            lanjutkan(null); // GPS tidak valid → selalu insert baru
        }

    } catch (error) {
        console.error(error);
        res.status(500).json({ pesan: "Terjadi kesalahan pada server" });
    }
};

// ── POST /api/kirim-frame ─────────────────────────────────────────────────────
// Dipanggil setiap 3 detik dari Raspi.
// Menyimpan foto frame ke tabel_frame tanpa membuat pinpoint baru.
const terimaFrame = (req, res) => {
    try {
        const fileGambar = req.file;
        const session_id = parseInt(req.body.session_id);

        if (!fileGambar) {
            return res.status(400).json({ pesan: "Gambar gagal diterima!" });
        }
        if (!session_id || isNaN(session_id)) {
            return res.status(400).json({ pesan: "session_id tidak valid!" });
        }

        const namaGambar = fileGambar.filename;

        db.run(
            `INSERT INTO tabel_frame (deteksi_id, nama_gambar) VALUES (?, ?)`,
            [session_id, namaGambar],
            function(err) {
                if (err) {
                    console.error("Error simpan frame:", err.message);
                    return res.status(500).json({ pesan: "Gagal menyimpan frame" });
                }
                console.log(`  Frame ${this.lastID} disimpan (sesi ${session_id})`);
                res.status(200).json({
                    status  : "Sukses",
                    frame_id: this.lastID
                });
            }
        );
    } catch (error) {
        console.error(error);
        res.status(500).json({ pesan: "Terjadi kesalahan pada server" });
    }
};

// ── PUT /api/update-counting/:id ──────────────────────────────────────────────
// Dipanggil di akhir sesi untuk update data counting final (akumulasi).
const updateCounting = (req, res) => {
    const { id } = req.params;
    const plastic_bottle_count = parseInt(req.body.plastic_bottle_count) || 0;
    const can_count            = parseInt(req.body.can_count)            || 0;
    const jumlah_objek         = parseInt(req.body.jumlah_objek)         ||
                                 (plastic_bottle_count + can_count);

    db.run(
        `UPDATE tabel_deteksi
         SET plastic_bottle_count = plastic_bottle_count + ?,
             can_count            = can_count            + ?,
             jumlah_objek         = jumlah_objek         + ?
         WHERE id = ?`,
        [plastic_bottle_count, can_count, jumlah_objek, id],
        function(err) {
            if (err) {
                console.error("Error update counting:", err.message);
                return res.status(500).json({ pesan: "Gagal update counting" });
            }
            console.log(`\nCounting final diakumulasi (sesi ${id}): +botol=${plastic_bottle_count} +kaleng=${can_count}`);
            res.status(200).json({
                status: "Sukses",
                pesan : "Counting berhasil diperbarui"
            });
        }
    );
};

// ── GET /api/detections ───────────────────────────────────────────────────────
const ambilSemuaDeteksi = (req, res) => {
    db.all(
        `SELECT * FROM tabel_deteksi ORDER BY timestamp DESC`,
        [],
        (err, rows) => {
            if (err) {
                console.error("Error Database:", err.message);
                return res.status(500).json({ pesan: "Gagal mengambil data" });
            }
            res.status(200).json(rows);
        }
    );
};

// ── GET /api/detections/:id ───────────────────────────────────────────────────
const ambilSatuDeteksi = (req, res) => {
    const { id } = req.params;
    db.get(
        `SELECT * FROM tabel_deteksi WHERE id = ?`,
        [id],
        (err, row) => {
            if (err) {
                console.error("Error Database:", err.message);
                return res.status(500).json({ pesan: "Gagal mengambil data" });
            }
            if (!row) {
                return res.status(404).json({ pesan: "Data tidak ditemukan" });
            }
            res.status(200).json(row);
        }
    );
};

// ── GET /api/frames/by-detection/:id ─────────────────────────────────────────
// Ambil semua frame dari tabel_frame untuk satu sesi.
const ambilFramesByDeteksi = (req, res) => {
    const { id } = req.params;
    db.all(
        `SELECT id, nama_gambar AS image_path, timestamp
         FROM tabel_frame
         WHERE deteksi_id = ?
         ORDER BY timestamp ASC`,
        [id],
        (err, rows) => {
            if (err) {
                console.error("Error Database:", err.message);
                return res.status(500).json({ pesan: "Gagal mengambil frame" });
            }
            res.status(200).json(rows || []);
        }
    );
};

// ── GET /api/data (alias lama) ────────────────────────────────────────────────
const ambilData = (req, res) => ambilSemuaDeteksi(req, res);

// ── GET /api/riwayat ──────────────────────────────────────────────────────────
// Query parameter opsional: date_from, date_to, time_from, time_to
// Format: date_from=2026-01-01, time_from=08:00
const ambilRiwayat = (req, res) => {
    const { date_from, date_to, time_from, time_to } = req.query;

    // Bangun kondisi WHERE secara dinamis
    const conditions = [];
    const params     = [];

    if (date_from) {
        const tf = time_from || '00:00';
        conditions.push(`timestamp >= ?`);
        params.push(`${date_from} ${tf}:00`);
    }
    if (date_to) {
        const tt = time_to || '23:59';
        conditions.push(`timestamp <= ?`);
        params.push(`${date_to} ${tt}:59`);
    }

    const whereClause = conditions.length > 0
        ? `WHERE ${conditions.join(' AND ')}`
        : '';

    db.all(
        `SELECT * FROM tabel_deteksi ${whereClause} ORDER BY timestamp DESC`,
        params,
        (err, rows) => {
            if (err) {
                console.error('Error ambilRiwayat:', err.message);
                return res.status(500).json({ pesan: 'Gagal mengambil riwayat' });
            }
            res.status(200).json(rows);
        }
    );
};

// ── DELETE /api/riwayat ───────────────────────────────────────────────────────
// Hapus semua data dalam rentang tanggal+jam yang ditentukan
const hapusRiwayat = (req, res) => {
    const { date_from, date_to, time_from, time_to } = req.query;

    if (!date_from || !date_to) {
        return res.status(400).json({ pesan: 'Parameter date_from dan date_to wajib diisi' });
    }

    const tf = time_from || '00:00';
    const tt = time_to   || '23:59';
    const dtFrom = `${date_from} ${tf}:00`;
    const dtTo   = `${date_to} ${tt}:59`;

    // Hapus frame dulu (FK constraint), baru deteksi
    db.run(
        `DELETE FROM tabel_frame WHERE deteksi_id IN (
            SELECT id FROM tabel_deteksi WHERE timestamp >= ? AND timestamp <= ?
        )`,
        [dtFrom, dtTo],
        (errFrame) => {
            if (errFrame) {
                console.error('Error hapus frame:', errFrame.message);
                return res.status(500).json({ pesan: 'Gagal menghapus frame' });
            }

            db.run(
                `DELETE FROM tabel_deteksi WHERE timestamp >= ? AND timestamp <= ?`,
                [dtFrom, dtTo],
                function(errDet) {
                    if (errDet) {
                        console.error('Error hapus deteksi:', errDet.message);
                        return res.status(500).json({ pesan: 'Gagal menghapus data deteksi' });
                    }
                    console.log(`Hapus riwayat: ${this.changes} baris dihapus (${dtFrom} s/d ${dtTo})`);
                    res.status(200).json({
                        status : 'Sukses',
                        dihapus: this.changes,
                        pesan  : `${this.changes} data berhasil dihapus`
                    });
                }
            );
        }
    );
};

module.exports = {
    terimaDataRaspberry,
    terimaFrame,
    updateCounting,
    ambilSemuaDeteksi,
    ambilSatuDeteksi,
    ambilFramesByDeteksi,
    ambilData,
    ambilRiwayat,
    hapusRiwayat
};