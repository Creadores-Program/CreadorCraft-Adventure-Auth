const express = require('express');
const rateLimit = require('express-rate-limit');
const cors = require('cors');
const crypto = require('crypto');
const { Pool } = require('pg');
const { Client, GatewayIntentBits, ChannelType, ActionRowBuilder, ButtonBuilder, ButtonStyle, REST, Routes, SlashCommandBuilder } = require('discord.js');

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
    handler: (req, res) => {
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

app.post('/get-ticket', loginLimiter, express.raw({ type: 'application/octet-stream', limit: '1kb' }), async (req, res) => {
    const buffer = req.body;
    if (!buffer || buffer.length < 33) {
        return res.status(400).end();
    }
    const masterTokenBytes = buffer.slice(0, 32);
    const ipLength = buffer.readUInt8(32);
    if (buffer.length !== 33 + ipLength) {
        return res.status(400).end();
    }
    const serverIp = buffer.toString('utf8', 33, 33 + ipLength);
    if(serverIp.trim().length < 3){
        return res.status(400).end();
    }
    try {
        const query = `
            SELECT discord_id, username 
            FROM usuarios 
            WHERE master_token = $1 AND expires_at > NOW();
        `;
        const result = await pool.query(query, [masterTokenBytes]);

        if (result.rows.length === 0) {
            return res.status(401).end();
        }

        const { discord_id: discordId, username } = result.rows[0];

        const ticketBuffer = crypto.randomBytes(6);
        const ticketHex = ticketBuffer.toString('hex').toUpperCase();

        if (pendingTickets.has(ticketHex)) {
            clearTimeout(pendingTickets.get(ticketHex).timeout);
        }

        const timeout = setTimeout(() => {
            pendingTickets.delete(ticketHex);
        }, 12000);

        pendingTickets.set(ticketHex, {
            discordId: discordId.toString(),
            username,
            serverIp,
            timeout
        });

        res.status(200)
           .set('Content-Type', 'application/octet-stream')
           .send(ticketBuffer);

    } catch (dbErr) {
        console.error('❌ Error en base de datos al procesar get-ticket:', dbErr);
        return res.status(500).end();
    }
});

app.post('/verify-ticket', loginLimiter, express.raw({ type: 'application/octet-stream', limit: '1kb' }), (req, res) => {
    const buffer = req.body;

    if (!buffer || buffer.length < 7) {
        return res.status(401).end();
    }
    const ticketBuffer = buffer.slice(0, 6);
    const ticketHex = ticketBuffer.toString('hex').toUpperCase();
    const ipLength = buffer.readUInt8(6);

    if (buffer.length !== 7 + ipLength) {
        return res.status(401).end();
    }

    const serverIp = buffer.toString('utf8', 7, 7 + ipLength);
    const ticketData = pendingTickets.get(ticketHex);

    if (!ticketData || ticketData.serverIp !== serverIp) {
        return res.status(401).end();
    }

    clearTimeout(ticketData.timeout);
    pendingTickets.delete(ticketHex);

    const { discordId, username } = ticketData;
    const usernameBytes = Buffer.from(username, 'utf8');

    const responseBuffer = Buffer.alloc(8 + 1 + usernameBytes.length);

    let offset = 0;
    responseBuffer.writeBigUInt64BE(BigInt(discordId), offset);
    offset += 8;

    responseBuffer.writeUInt8(usernameBytes.length, offset);
    offset += 1;

    usernameBytes.copy(responseBuffer, offset);

    res.status(200)
       .set('Content-Type', 'application/octet-stream')
       .send(responseBuffer);
});

app.listen(PORT, () => {
    console.info(`🌐 Servidor Web API corriendo en puerto ${PORT}`);
});

const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.DirectMessages]
});

client.once('clientReady', async () => {
    console.log(`🤖 Bot conectado como ${client.user.tag}`);

    const commands = [
        new SlashCommandBuilder()
            .setName('login')
            .setDescription('Genera tu código de verificación de 6 bytes para CreadorCraft Adventure'),
        new SlashCommandBuilder()
            .setName('deletelogin')
            .setDescription('Elimina permanentemente tu cuenta y datos del sistema central')
    ].map(command => command.toJSON());

    const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_BOT_TOKEN);

    try {
        await rest.put(Routes.applicationCommands(client.user.id), { body: commands });
        console.log('✅ Comandos registrados exitosamente.');
    } catch (error) {
        console.error('❌ Error al registrar comandos:', error);
    }
    const statuses = [
        { name: 'CreadorCraft Adventure ⚔️', type: ActivityType.Playing },
        { name: '¿Saldrá antes que GTA 6? 💀', type: ActivityType.Watching },
        { name: 'Usa /login en DM 🔑', type: ActivityType.Competing },
        { name: 'Próximamente...', type: ActivityType.Streaming, url: 'https://twitch.tv/trollhunters501' }
    ];
    let index = 0;
    setInterval(() => {
        const currentStatus = statuses[index];
        client.user.setActivity(currentStatus.name, { type: currentStatus.type, url: currentStatus.url });
        index = (index + 1) % statuses.length;
    }, 10000);
});

client.on('interactionCreate', async interaction => {
    if (interaction.isChatInputCommand()) {
        if (interaction.channel.type !== ChannelType.DM) {
            return interaction.reply({
                content: '❌ **Seguridad:** Este comando solo puede ejecutarse en **Mensaje Privado (Chat Directo)** con el bot.',
                ephemeral: true
            });
        }

        const discordId = interaction.user.id;

        if (interaction.commandName === 'login') {
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
        
        else if (interaction.commandName === 'deletelogin') {
            const row = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder()
                        .setCustomId('confirm_delete')
                        .setLabel('Sí, eliminar permanentemente')
                        .setStyle(ButtonStyle.Danger),
                    new ButtonBuilder()
                        .setCustomId('cancel_delete')
                        .setLabel('Cancelar')
                        .setStyle(ButtonStyle.Secondary)
                );

            await interaction.reply({
                content: '⚠️ **ADVERTENCIA DE ELIMINACIÓN DE CUENTA** ⚠️\n\n' +
                         'Estás a punto de borrar **permanentemente** tu cuenta y tu MasterToken de CreadorCraft Adventure.\n\n' +
                         '• **Esta acción NO es reversible.**\n' +
                         '• Si deseas borrar tus datos guardados en servidores de terceros o en el servidor principal, **debes solicitar la eliminación directamente en cada uno de esos servidores antes de continuar**.\n\n' +
                         '¿Estás totalmente seguro de que deseas proceder?',
                components: [row],
                ephemeral: true
            });
        }
    }

    else if (interaction.isButton()) {
        if (interaction.channel.type !== ChannelType.DM) return;

        const discordId = interaction.user.id;

        if (interaction.customId === 'cancel_delete') {
            await interaction.update({
                content: '✅ Operación cancelada. Tus datos están seguros.',
                components: []
            });
        } 
        
        else if (interaction.customId === 'confirm_delete') {
            try {
                const deleteQuery = `DELETE FROM usuarios WHERE discord_id = $1;`;
                const result = await pool.query(deleteQuery, [discordId]);

                if (result.rowCount > 0) {
                    await interaction.update({
                        content: '🗑️ **Cuenta eliminada con éxito.** Tus datos centralizados han sido borrados de la base de datos principal.',
                        components: []
                    });
                } else {
                    await interaction.update({
                        content: 'ℹ️ No se encontró ninguna cuenta asociada a tu usuario de Discord en el sistema central.',
                        components: []
                    });
                }
            } catch (dbErr) {
                console.error('❌ Error al eliminar cuenta en la base de datos:', dbErr);
                await interaction.update({
                    content: '❌ Ocurrió un error en el servidor al intentar procesar la eliminación. Inténtalo más tarde.',
                    components: []
                });
            }
        }
    }
});

client.login(process.env.DISCORD_BOT_TOKEN);
