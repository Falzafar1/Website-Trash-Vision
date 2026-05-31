require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const apiRoutes = require('./routes/api');

const app = express();
// Railway menyediakan PORT secara otomatis lewat environment variable
const PORT = process.env.PORT || 3000;

// Middleware standar
app.use(cors());
app.use(express.json());

// Membuka akses folder 'uploads' agar gambarnya bisa diakses frontend
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Menyajikan file Frontend (HTML, CSS, JS) sebagai static files
// Folder Frontend berada satu level di atas Backend
app.use(express.static(path.join(__dirname, '..', 'Frontend')));

// Menyambungkan file routing modular kita
// Semua rute akan diawali dengan '/api'
app.use('/api', apiRoutes);

// Fallback: semua rute non-API diarahkan ke index.html
app.get('/{*splat}', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'Frontend', 'index.html'));
});

// Jalankan server
app.listen(PORT, () => {
    console.log(`Server berjalan di port ${PORT}`);
});