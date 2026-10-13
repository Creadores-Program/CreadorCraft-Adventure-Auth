const express = require('express');
const rateLimit = require('express-rate-limit');
const cors = require('cors');
const crypto = require('crypto');
const { Pool } = require('pg');
const { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder } = require('discord.js');
const app = express();
app.set('trust proxy', 1);
app.use(cors());
const PORT = process.env.PORT || 3000;
const pendingTickets = new Map();
const pendingCodes = new Map();
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
    standardHeaders: true,
    legacyHeaders: true,
    header: (req, res, next, options) => {
        res.status(429).end();
    }
});

app.post('/wakeup', loginLimiter, express.raw({ type: 'application/octet-stream', limit: '1kb' }), (req, res) => {
    res.setHeader('Content-Type', 'application/octet-stream');
    res.status(200).send(Buffer.from([0x01]));
});

app.post('/login', loginLimiter, express.raw({ type: 'application/octet-stream', limit: '1kb' }), async (req, res) => {
    const buffer = req.body;

    if (!buffer || buffer.length !== 6) {
        return res.status(400).end();
    }
    const codeHex = buffer.toString('hex').toUpperCase();
    const sessionData = pendingCodes.get(codeHex);

    if (!sessionData) {
        return res.status(401).end();
    }
    clearTimeout(sessionData.timeout);
    pendingCodes.delete(codeHex);

    const { discordId, username } = sessionData;
    const masterTokenBytes = crypto.randomBytes(32);
    const expiresAt = new Date(Date.now() + (30 * 24 * 60 * 60 * 1000));
    try {
        const query = `
            INSERT INTO usuarios (discord_id, username, master_token, expires_at)
            VALUES ($1, $2, $3, $4)
            ON CONFLICT (discord_id)
            DO UPDATE SET username = $2, master_token = $3, expires_at = $4;
        `;
        await pool.query(query, [discordId, username, masterTokenBytes, expiresAt]);
    } catch (dbErr) {
        console.error('❌ Error atómico en base de datos:', dbErr);
        return res.status(500).end();
    }
    const usernameBytes = Buffer.from(username, 'utf8');
    const responseBuffer = Buffer.alloc(1 + usernameBytes.length + 32);
    let offset = 0;
    responseBuffer.writeUInt8(usernameBytes.length, offset);
    offset += 1;
    
    usernameBytes.copy(responseBuffer, offset);
    offset += usernameBytes.length;

    masterTokenBytes.copy(responseBuffer, offset);

    res.status(200)
       .set('Content-Type', 'application/octet-stream')
       .send(responseBuffer);
});

app.post('/get-ticket', loginLimiter, express.raw({ type: 'application/octet-stream', limit: '1kb' }), (req, res) => {});

app.post('/verify-ticket', loginLimiter, express.raw({ type: 'application/octet-stream', limit: '1kb' }), (req, res) => {});

app.listen(PORT, () => {
    console.info(`🌐 Servidor Web API corriendo en puerto ${PORT}`);
});

const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.DirectMessages]
});

client.once('ready', async () => {
    console.log(`🤖 Bot conectado como ${client.user.tag}`);

    const commands = [
        new SlashCommandBuilder()
            .setName('login')
            .setDescription('Genera tu código de verificación de 6 bytes para CreadorCraft Adventure')
    ].map(command => command.toJSON());

    const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_BOT_TOKEN);

    try {
        await rest.put(Routes.applicationCommands(client.user.id), { body: commands });
        console.log('✅ Comando /login registrado.');
    } catch (error) {
        console.error('❌ Error al registrar comandos:', error);
    }
});

client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) return;

    if (interaction.commandName === 'login') {
        if (interaction.channel.type !== ChannelType.DM) {
            return interaction.reply({
                content: '❌ **Seguridad:** El comando `/login` solo puede ejecutarse en **Mensaje Privado (Chat Directo)** con el bot.',
                ephemeral: true
            });
        }

        const discordId = interaction.user.id;
        const username = interaction.user.username;

        const codeBuffer = crypto.randomBytes(6);
        const codeHex = codeBuffer.toString('hex').toUpperCase();

        if (pendingCodes.has(discordId)) {
            clearTimeout(pendingCodes.get(discordId).timeout);
        }

        const timeout = setTimeout(() => {
            pendingCodes.delete(codeHex);
        }, 180000);

        pendingCodes.set(codeHex, { discordId, username, codeBuffer, timeout });

        const numericArrayText = Array.from(codeBuffer).join(', ');
        
        await interaction.reply({
            content: `🔑 **Código de Verificación CreadorCraft Adventure**\n\nTu código de 6 bytes es:\n\`\`\`[${numericArrayText}]\`\`\`\n*(Ingrésalo en tu cliente de juego antes de 3 minutos)*`,
            ephemeral: true
        });
    }
});

client.login(process.env.DISCORD_BOT_TOKEN);
