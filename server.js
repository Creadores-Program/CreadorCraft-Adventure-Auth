const express = require('express');
const crypto = require('crypto');
const { Pool } = require('pg');
const { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder } = require('discord.js');
const app = express();
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

app.get('/wakeup', (req, res) => {
    res.setHeader('Content-Type', 'application/octet-stream');
    res.status(200).send(Buffer.from([0x01]));
});

app.listen(PORT, () => {
    console.info(`🌐 Servidor Web API corriendo en puerto ${PORT}`);
});
