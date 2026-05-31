const { createClient } = require('@libsql/client');
const path = require('path');

// Menggunakan environment variable jika ada (untuk Turso Cloud), 
// jika tidak ada akan otomatis membuat/menggunakan file SQLite lokal
const url = process.env.TURSO_DATABASE_URL || `file:${path.join(__dirname, '..', 'riwayat_sistem.db')}`;
const authToken = process.env.TURSO_AUTH_TOKEN || "";

console.log(`\n=== KONEKSI DATABASE ===`);
console.log(`Menggunakan URL: ${url}`);
if (authToken) {
    console.log(`Auth Token terdeteksi (Cloud Turso).`);
} else {
    console.log(`Menggunakan SQLite Lokal (Tanpa Token).`);
}
console.log(`========================\n`);

const client = createClient({
    url: url,
    authToken: authToken
});

// Antrean Promise agar query berjalan berurutan (serialize) layaknya SQLite single-threaded
let queue = Promise.resolve();

function enqueue(fn) {
    return new Promise((resolve, reject) => {
        queue = queue.then(async () => {
            try {
                const res = await fn();
                resolve(res);
            } catch (err) {
                reject(err);
            }
        });
    });
}

// Helper untuk mengubah format baris dari @libsql/client ke Plain JavaScript Object
function mapRows(resultSet) {
    const { columns, rows } = resultSet;
    return rows.map(row => {
        const rowObj = {};
        columns.forEach((col, idx) => {
            const val = row[idx];
            // Konversi BigInt ke number biasa agar tidak error saat serialisasi JSON ke frontend
            rowObj[col] = typeof val === 'bigint' ? Number(val) : val;
        });
        return rowObj;
    });
}

// Wrapper DB dengan callback API yang sama persis seperti library 'sqlite3'
const db = {
    run: function(sql, params, callback) {
        if (typeof params === 'function') {
            callback = params;
            params = [];
        }

        enqueue(() => {
            return client.execute({ sql, args: params })
                .then(result => {
                    if (callback) {
                        const ctx = {
                            lastID: result.lastInsertRowid !== undefined ? Number(result.lastInsertRowid) : null,
                            changes: result.rowsAffected
                        };
                        // sqlite3 memanggil callback dengan konteks 'this' berisi lastID
                        callback.call(ctx, null);
                    }
                })
                .catch(err => {
                    console.error("Database Error (run):", err.message);
                    if (callback) callback(err);
                });
        });
    },

    all: function(sql, params, callback) {
        if (typeof params === 'function') {
            callback = params;
            params = [];
        }

        enqueue(() => {
            return client.execute({ sql, args: params })
                .then(result => {
                    if (callback) {
                        const mapped = mapRows(result);
                        callback(null, mapped);
                    }
                })
                .catch(err => {
                    console.error("Database Error (all):", err.message);
                    if (callback) callback(err, null);
                });
        });
    },

    get: function(sql, params, callback) {
        if (typeof params === 'function') {
            callback = params;
            params = [];
        }

        enqueue(() => {
            return client.execute({ sql, args: params })
                .then(result => {
                    if (callback) {
                        const mapped = mapRows(result);
                        callback(null, mapped[0] || null);
                    }
                })
                .catch(err => {
                    console.error("Database Error (get):", err.message);
                    if (callback) callback(err, null);
                });
        });
    },

    serialize: function(callback) {
        // Karena kita sudah mengantrekan (enqueue) semua query,
        // eksekusi sudah otomatis serial. Panggil saja langsung callback-nya.
        if (callback) callback();
    },

    prepare: function(sql) {
        return {
            run: function(...args) {
                let callback = null;
                if (args.length > 0 && typeof args[args.length - 1] === 'function') {
                    callback = args.pop();
                }
                let params = args;
                if (args.length === 1 && Array.isArray(args[0])) {
                    params = args[0];
                }
                db.run(sql, params, callback);
            },
            finalize: function(callback) {
                if (typeof callback === 'function') {
                    // Tunggu antrean query selesai sebelum memanggil finalize callback
                    enqueue(() => {
                        callback();
                        return Promise.resolve();
                    });
                }
            }
        };
    },

    close: function(callback) {
        // Masukkan close ke antrean paling belakang agar menutup setelah query selesai
        enqueue(() => {
            if (client.close) {
                client.close();
            }
            if (callback) callback();
            return Promise.resolve();
        });
    }
};

// Inisialisasi tabel — menunggu hasil sebelum server mulai menerima request
const ready = (async () => {
    try {
        await client.execute(`
            CREATE TABLE IF NOT EXISTS tabel_deteksi (
                id                    INTEGER PRIMARY KEY AUTOINCREMENT,
                timestamp             DATETIME DEFAULT (datetime('now','localtime')),
                nama_gambar           TEXT,
                gps                   TEXT,
                latitude              REAL    DEFAULT 0,
                longitude             REAL    DEFAULT 0,
                location_name         TEXT    DEFAULT 'Memuat lokasi...',
                plastic_bottle_count  INTEGER DEFAULT 0,
                can_count             INTEGER DEFAULT 0,
                leaf_pile_area_m2     REAL    DEFAULT 0,
                mixed_waste_area_m2   REAL    DEFAULT 0,
                jumlah_objek          INTEGER DEFAULT 0
            )
        `);
        await client.execute(`
            CREATE TABLE IF NOT EXISTS tabel_frame (
                id           INTEGER PRIMARY KEY AUTOINCREMENT,
                deteksi_id   INTEGER NOT NULL,
                nama_gambar  TEXT    NOT NULL,
                timestamp    DATETIME DEFAULT (datetime('now','localtime')),
                FOREIGN KEY (deteksi_id) REFERENCES tabel_deteksi(id)
            )
        `);
        console.log('✅ Tabel berhasil diinisialisasi.');
    } catch (err) {
        console.error('❌ Gagal menginisialisasi tabel:', err.message);
        throw err;
    }
})();

module.exports = db;
module.exports.ready = ready;