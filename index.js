// --- file: index.js
const fs = require('fs');
const path = require('path');

// .env explizit laden (neben index.js)
const ENV_PATH = path.join(__dirname, '.env');
if (!fs.existsSync(ENV_PATH)) {
    console.error('❌ .env nicht gefunden unter:', ENV_PATH);
} else {
    require('dotenv').config({ path: ENV_PATH });
}

let token = process.env.BOT_TOKEN || '';
// Token "säubern": Trim, Zero-Width, BOM, evtl. "Bot " entfernen, Anführungszeichen
token = token
    .trim()
    .replace(/\u200B|\u200C|\u200D|\uFEFF/g, '')
    .replace(/^Bot\s+/i, '')
    .replace(/^["']|["']$/g, '');

console.log('[ENV] .env Pfad:', ENV_PATH);
console.log('[ENV] BOT_TOKEN Länge nach Cleanup:', token ? token.length : 0);
if (!token) {
    console.error('❌ BOT_TOKEN ist nicht gesetzt. Prüfe .env im Projektroot.');
    process.exit(1);
}
if (token.split('.').length !== 3) {
    console.error('❌ BOT_TOKEN Format wirkt fehlerhaft (erwartet 3 Teile mit Punkten).');
    process.exit(1);
}

const {
    Client,
    GatewayIntentBits,
    Partials,
    Collection,
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    PermissionFlagsBits,
} = require('discord.js');

const config = require('./config.json');
const db = require('./src/utils/db');
const { ensureDirs, toUnix, ensureManageable } = require('./src/utils/helpers');
const { revokeExpiredRoles, sendFiveDayWarnings, revokeInvalidCustomRoles } = require('./src/utils/scheduler');

// Commands, die wir programmatic aufrufen (Buttons/Modal)
const giveCmd = require('./src/commands/give-temp-role');
const extendCmd = require('./src/commands/extend-temp-role');
const removeCmd = require('./src/commands/remove-temp-role');

ensureDirs();

const DEFAULT_EXTEND_DAYS = 30;   // Standard-Verlängerung

const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers],
    partials: [Partials.GuildMember],
});

client.commands = new Collection();

// --------------------
// Event Loader (src/events/*.js)
// --------------------
function loadEvents(clientInstance) {
    const eventsPath = path.join(__dirname, 'src', 'events');
    if (!fs.existsSync(eventsPath)) {
        console.log('[EVENTS] Kein src/events Ordner gefunden – überspringe Event-Loading.');
        return;
    }

    const files = fs.readdirSync(eventsPath).filter(f => f.endsWith('.js'));
    for (const file of files) {
        const event = require(path.join(eventsPath, file));
        if (!event?.name || typeof event.execute !== 'function') {
            console.warn(`[EVENTS] Ungültiges Event-File übersprungen: ${file}`);
            continue;
        }

        // optional: event.once support
        if (event.once) {
            clientInstance.once(event.name, (...args) => event.execute(...args, clientInstance));
        } else {
            clientInstance.on(event.name, (...args) => event.execute(...args, clientInstance));
        }

        console.log(`[EVENTS] Loaded: ${event.name} (${file})`);
    }
}
loadEvents(client);

// --------------------
// Commands Loader (src/commands/*.js)
// --------------------
const commandsPath = path.join(__dirname, 'src', 'commands');
for (const file of fs.readdirSync(commandsPath)) {
    if (!file.endsWith('.js')) continue;
    const command = require(path.join(commandsPath, file));
    if (!command?.data?.name || typeof command.execute !== 'function') {
        console.warn(`[CMDS] Ungültiges Command-File übersprungen: ${file}`);
        continue;
    }
    client.commands.set(command.data.name, command);
}

client.once('ready', async () => {
    console.log(`Logged in as ${client.user.tag}`);

    // 1) Direkt beim Start ausführen
    await revokeExpiredRoles(client).catch(console.error);
    await sendFiveDayWarnings(client).catch(console.error);
    await revokeInvalidCustomRoles(client).catch(console.error);

    // 2) Regelmäßig ausführen (Fallback)
    const ms = config.checkIntervalMinutes * 60 * 1000;
    setInterval(() => revokeExpiredRoles(client).catch(console.error), ms);
    setInterval(() => revokeInvalidCustomRoles(client).catch(console.error), ms);
    setInterval(() => sendFiveDayWarnings(client).catch(console.error), 60 * 60 * 1000);
});

// Hilfsfunktion: Einträge für Pagination (Fallback wenn wir keine buildPage-Utility brauchen)
function loadEntriesFromJson() {
    const file = path.join(process.cwd(), 'data', 'temproles.json');
    if (!fs.existsSync(file)) return [];
    let json;
    try { json = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return []; }
    if (!json || typeof json !== 'object' || !json.members) return [];
    const entries = [];
    for (const [userId, list] of Object.entries(json.members)) {
        if (!Array.isArray(list)) continue;
        for (const e of list) {
            if (!e || typeof e.roleId !== 'string') continue;
            entries.push({ userId, roleId: e.roleId, grantedAt: e.grantedAt, expiresAt: e.expiresAt });
        }
    }
    entries.sort((a, b) => new Date(a.expiresAt) - new Date(b.expiresAt));
    return entries;
}

client.on('interactionCreate', async (interaction) => {
    try {
        // Slash Commands
        if (interaction.isChatInputCommand()) {
            const command = client.commands.get(interaction.commandName);
            if (!command) return;
            await command.execute(interaction, client);
            return;
        }

        // Buttons
        if (interaction.isButton()) {
            const parts = interaction.customId.split('|');

            // Alt: Pagination aus /list-temp-roles (temproles:prev/next:page:userId)
            // Bleibt für Abwärtskompatibilität intakt.
            if (interaction.customId.includes(':')) {
                const [ns, action, pageStr, userId] = interaction.customId.split(':');
                if (ns === 'temproles' && (action === 'prev' || action === 'next')) {
                    if (userId && interaction.user.id !== userId) {
                        return interaction.reply({ content: 'Nur der ursprüngliche Admin darf damit interagieren.', ephemeral: true });
                    }
                    const page = parseInt(pageStr, 10) || 0;
                    const dir = action === 'next' ? 1 : -1;
                    const entries = db.listAll(process.env.GUILD_ID); // nutzt DB
                    const pageSize = 5;
                    const maxPage = Math.max(0, Math.ceil(entries.length / pageSize) - 1);
                    const newPage = Math.min(maxPage, Math.max(0, page + dir));
                    const slice = entries.slice(newPage * pageSize, newPage * pageSize + pageSize);

                    const embed = new EmbedBuilder()
                        .setTitle('Temprollen — Übersicht')
                        .setColor(0x2b2d31)
                        .setFooter({ text: `Seite ${newPage + 1} / ${maxPage + 1}` })
                        .setTimestamp(new Date());

                    if (slice.length === 0) {
                        embed.setDescription('Keine Einträge.');
                    } else {
                        embed.setDescription(
                            slice.map((s, idx) =>
                                `**${newPage * pageSize + idx + 1}.** <@${s.userId}> — **${(interaction.guild.roles.cache.get(s.roleId)?.name) || 'Unbekannte Rolle'}**\n` +
                                `• Start: <t:${toUnix(s.grantedAt)}:f>\n` +
                                `• Ende: <t:${toUnix(s.expiresAt)}:f> (<t:${toUnix(s.expiresAt)}:R>)`
                            ).join('\n\n')
                        );
                    }

                    const row = new ActionRowBuilder().addComponents(
                        new ButtonBuilder().setCustomId(`temproles:prev:${newPage}:${interaction.user.id}`).setEmoji('◀️').setStyle(ButtonStyle.Secondary).setDisabled(newPage === 0),
                        new ButtonBuilder().setCustomId(`temproles:next:${newPage}:${interaction.user.id}`).setEmoji('▶️').setStyle(ButtonStyle.Secondary).setDisabled(newPage === maxPage)
                    );

                    return interaction.update({ embeds: [embed], components: [row] });
                }
            }

            // Neu: Aktions-Buttons in der erweiterten Liste (Schema: troles|<guildId>|<userId>|<roleId>|remove|? / extend|<days> / add)
            if (parts[0] === 'troles') {
                // Navigation der neuen Variante: troles|<guildId>|nav|prev|<page> / ...|next|<page>
                if (parts[2] === 'nav') {
                    const dir = parts[3];
                    const page = Number(parts[4]);
                    const newPage = dir === 'prev' ? page - 1 : page + 1;

                    const entries = loadEntriesFromJson();
                    const PAGE_SIZE = 3;
                    const totalPages = Math.max(1, Math.ceil(entries.length / PAGE_SIZE));
                    const clamped = Math.min(Math.max(newPage, 0), totalPages - 1);

                    const start = clamped * PAGE_SIZE;
                    const items = entries.slice(start, start + PAGE_SIZE);

                    const embed = new EmbedBuilder()
                        .setTitle(`Temporäre Rollen – Seite ${clamped + 1}/${totalPages}`)
                        .setColor(0x5865F2);

                    const components = [];

                    for (const e of items) {
                        const until = e.expiresAt ? `<t:${Math.floor(new Date(e.expiresAt).getTime() / 1000)}:R>` : '–';
                        const member = interaction.guild.members.cache.get(e.userId);
                        const display = member?.user?.tag ? `${member.user.tag} (<@${e.userId}>)` : `<@${e.userId}>`;

                        embed.addFields({
                            name: display,
                            value: `• Rolle: <@&${e.roleId}>\n• läuft ab: ${until}`,
                        });

                        components.push(
                            new ActionRowBuilder().addComponents(
                                new ButtonBuilder()
                                    .setCustomId(`troles|${interaction.guild.id}|${e.userId}|${e.roleId}|remove`)
                                    .setLabel('Entfernen')
                                    .setStyle(ButtonStyle.Danger),
                                new ButtonBuilder()
                                    .setCustomId(`troles|${interaction.guild.id}|${e.userId}|${e.roleId}|extend|${DEFAULT_EXTEND_DAYS}`)
                                    .setLabel(`+${DEFAULT_EXTEND_DAYS} Tage`)
                                    .setStyle(ButtonStyle.Primary),
                                new ButtonBuilder()
                                    .setCustomId(`troles|${interaction.guild.id}|${e.userId}|add|${e.roleId}`)
                                    .setLabel('Hinzufügen')
                                    .setStyle(ButtonStyle.Secondary),
                            )
                        );
                    }

                    components.push(
                        new ActionRowBuilder().addComponents(
                            new ButtonBuilder()
                                .setCustomId(`troles|${interaction.guild.id}|nav|prev|${clamped}`)
                                .setLabel('◀️ Zurück')
                                .setStyle(ButtonStyle.Secondary)
                                .setDisabled(clamped === 0),
                            new ButtonBuilder()
                                .setCustomId(`troles|${interaction.guild.id}|nav|next|${clamped}`)
                                .setLabel('Weiter ▶️')
                                .setStyle(ButtonStyle.Secondary)
                                .setDisabled(clamped >= totalPages - 1),
                        )
                    );

                    return interaction.update({ embeds: [embed], components });
                }

                // Aktionen
                const guildId = parts[1];
                const userId = parts[2];

                // Hinzufügen → Modal
                if (parts[3] === 'add') {
                    const modal = new ModalBuilder()
                        .setCustomId(`troles:add:${guildId}:${userId}`)
                        .setTitle('Temporäre Rolle hinzufügen');

                    const roleIdInput = new TextInputBuilder()
                        .setCustomId('roleId')
                        .setLabel('Rollen-ID')
                        .setRequired(true)
                        .setStyle(TextInputStyle.Short);

                    const daysInput = new TextInputBuilder()
                        .setCustomId('days')
                        .setLabel('Anzahl Tage')
                        .setRequired(true)
                        .setStyle(TextInputStyle.Short)
                        .setValue('7');

                    await interaction.showModal(
                        modal.addComponents(
                            new ActionRowBuilder().addComponents(roleIdInput),
                            new ActionRowBuilder().addComponents(daysInput),
                        )
                    );
                    return;
                }

                // Entfernen / Verlängern
                const roleId = parts[3];
                const action = parts[4];

                if (action === 'remove') {
                    const role = await interaction.guild.roles.fetch(roleId);
                    await ensureManageable(interaction.guild, role, interaction);

                    if (removeCmd.removeTempRole) {
                        await removeCmd.removeTempRole({
                            guild: interaction.guild,
                            userId,
                            roleId,
                            moderator: interaction.user,
                            reason: `via /list-temp-roles Button by ${interaction.user.id}`,
                        });
                    }
                    return interaction.reply({ content: `✅ Rolle <@&${roleId}> bei <@${userId}> entfernt.`, ephemeral: true });
                }

                if (action === 'extend') {
                    const days = Number(parts[5] || '7');

                    const role = await interaction.guild.roles.fetch(roleId);
                    await ensureManageable(interaction.guild, role, interaction);

                    if (extendCmd.extendTempRole) {
                        await extendCmd.extendTempRole({
                            guild: interaction.guild,
                            userId,
                            roleId,
                            days,
                            moderator: interaction.user,
                            reason: `via /list-temp-roles Button by ${interaction.user.id}`,
                        });
                    }
                    return interaction.reply({ content: `⏩ Rolle <@&${roleId}> bei <@${userId}> um ${days} Tage verlängert.`, ephemeral: true });
                }
            }
        }

        // Modal Submit
        if (interaction.isModalSubmit() && interaction.customId.startsWith('troles:add:')) {
            const [, , guildId, userId] = interaction.customId.split(':');
            const roleId = interaction.fields.getTextInputValue('roleId').trim();
            const days = Number(interaction.fields.getTextInputValue('days'));

            if (!/^\d+$/.test(roleId)) {
                return interaction.reply({ content: 'Bitte eine gültige Rollen-ID eingeben.', ephemeral: true });
            }
            if (!Number.isFinite(days) || days <= 0) {
                return interaction.reply({ content: 'Bitte eine positive Anzahl Tage angeben.', ephemeral: true });
            }

            const role = await interaction.guild.roles.fetch(roleId);
            await ensureManageable(interaction.guild, role, interaction);

            if (giveCmd.giveTempRole) {
                await giveCmd.giveTempRole({
                    guild: interaction.guild,
                    userId,
                    roleId,
                    days,
                    moderator: interaction.user,
                    reason: `via /list-temp-roles Modal by ${interaction.user.id}`,
                });
            }
            return interaction.reply({ content: `➕ Rolle <@&${roleId}> für ${days} Tage an <@${userId}> vergeben.`, ephemeral: true });
        }
    } catch (err) {
        console.error(err);
        if (interaction.isRepliable()) {
            if (interaction.deferred || interaction.replied) {
                await interaction.followUp({ content: 'Es ist ein Fehler aufgetreten.', ephemeral: true }).catch(() => { });
            } else {
                await interaction.reply({ content: 'Es ist ein Fehler aufgetreten.', ephemeral: true }).catch(() => { });
            }
        }
    }
});

client.login(token);
