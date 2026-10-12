const express = require('express');
const rateLimit = require('express-rate-limit');
const crypto = require('crypto');
const { Pool } = require('pg');
const { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder } = require('discord.js');
const app = express();
app.set('trust proxy', 1);
const PORT = process.env.PORT || 3000;
const pendingTickets = new Map();
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

pool.connect((err, client, release) => {
    if (err) {
        return console.error('❌ Error al conectar a la base de datos SQL:', err.stack);
    }
    console.info('✅ Conectado exitosamente a la base de datos SQL');
    release();
});

const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    message: { error: "Demasiados intentos desde esta IP, intenta más tarde." },
    standardHeaders: true,
    legacyHeaders: true,
});

app.post('/wakeup', loginLimiter, (req, res) => {
    res.setHeader('Content-Type', 'application/octet-stream');
    res.status(200).send(Buffer.from([0x01]));
});

app.listen(PORT, () => {
    console.info(`🌐 Servidor Web API corriendo en puerto ${PORT}`);
});
