const express    = require('express');
const router     = express.Router();
const multer     = require('multer');
const path       = require('path');

const dataController = require('../controllers/dataController');

const penyimpananKustom = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, path.join(__dirname, '..', 'uploads'));
    },
    filename: function (req, file, cb) {
        const waktuUnik = Date.now();
        const ekstensi  = path.extname(file.originalname);
        cb(null, 'gambar-' + waktuUnik + ekstensi);
    }
});

const upload = multer({ storage: penyimpananKustom });

// Terima data sesi baru dari Raspi (sekali di awal)
router.post('/kirim-data',  upload.single('gambar'), dataController.terimaDataRaspberry);

// Terima frame foto setiap 3 detik dari Raspi
router.post('/kirim-frame', upload.single('gambar'), dataController.terimaFrame);

// Update counting di akhir sesi
router.put('/update-counting/:id', dataController.updateCounting);

// Endpoint untuk frontend
router.get('/detections',                dataController.ambilSemuaDeteksi);
router.get('/detections/:id',            dataController.ambilSatuDeteksi);
router.get('/tracks', (req, res) => res.status(200).json([]));
router.get('/frames/by-detection/:id',   dataController.ambilFramesByDeteksi);

router.get('/frames/image/:filename', (req, res) => {
    const safe     = path.basename(req.params.filename);
    const filePath = path.join(__dirname, '..', 'uploads', safe);
    res.sendFile(filePath, (err) => {
        if (err) res.status(404).json({ pesan: 'Gambar tidak ditemukan' });
    });
});

router.get('/data', dataController.ambilData);

module.exports = router;