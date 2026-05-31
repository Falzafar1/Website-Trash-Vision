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
// Membuat 1 row baru di tabel_deteksi, mengembalikan id sesi.
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

                // Simpan juga foto pertama ke tabel_frame
                db.run(
                    `INSERT INTO tabel_frame (deteksi_id, nama_gambar) VALUES (?, ?)`,
                    [rowId, namaGambar],
                    (errFrame) => {
                        if (!errFrame) {
                            console.log(`  Frame pertama disimpan (sesi ${rowId})`);
                        }
                    }
                );

                // Kirim respons dengan session_id agar Raspi bisa kirim frame berikutnya
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
// Dipanggil di akhir sesi untuk update data counting final.
const updateCounting = (req, res) => {
    const { id } = req.params;
    const plastic_bottle_count = parseInt(req.body.plastic_bottle_count) || 0;
    const can_count            = parseInt(req.body.can_count)            || 0;
    const jumlah_objek         = parseInt(req.body.jumlah_objek)         ||
                                 (plastic_bottle_count + can_count);

    db.run(
        `UPDATE tabel_deteksi
         SET plastic_bottle_count = ?,
             can_count = ?,
             jumlah_objek = ?
         WHERE id = ?`,
        [plastic_bottle_count, can_count, jumlah_objek, id],
        function(err) {
            if (err) {
                console.error("Error update counting:", err.message);
                return res.status(500).json({ pesan: "Gagal update counting" });
            }
            console.log(`\nCounting final diupdate (sesi ${id}): botol=${plastic_bottle_count} kaleng=${can_count}`);
            res.status(200).json({
                status: "Sukses",
                pesan : "Counting berhasil diupdate"
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

module.exports = {
    terimaDataRaspberry,
    terimaFrame,
    updateCounting,
    ambilSemuaDeteksi,
    ambilSatuDeteksi,
    ambilFramesByDeteksi,
    ambilData
};