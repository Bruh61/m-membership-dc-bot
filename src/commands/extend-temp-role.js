// --- file: src/commands/extend-temp-role.js
const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');
const config = require('../../config.json');
const db = require('../utils/db');
const { toUnix, ensureManageable, backupAndSave, daysToMs } = require('../utils/helpers');

// ---- DB Fallback Layer ----
function getEntryFallback(guildId, userId, roleId) {
    if (typeof db.getEntry === 'function') return db.getEntry(guildId, userId, roleId);

    const roles = db?.data?.members?.[userId];
    if (!Array.isArray(roles)) return null;
    return roles.find(r => r?.roleId === roleId) || null;
}

function updateExpiryFallback(guildId, userId, roleId, newExpiryISO, opts = {}) {
    if (typeof db.updateExpiry === 'function') return db.updateExpiry(guildId, userId, roleId, newExpiryISO, opts);

    if (!db?.data?.members?.[userId] || !Array.isArray(db.data.members[userId])) return false;
    const entry = db.data.members[userId].find(r => r?.roleId === roleId);
    if (!entry) return false;

    entry.expiresAt = newExpiryISO;
    if (opts.resetWarn) delete entry.warned5d;
    return true;
}

async function extendTempRole({ guild, userId, roleId, days, reason, moderator }) {
    const role = await guild.roles.fetch(roleId);
    await ensureManageable(guild, role, { reply: async () => { } });

    const entry = getEntryFallback(process.env.GUILD_ID, userId, roleId);
    if (!entry) throw new Error('Keine bestehende Temprolle gefunden.');

    const base = new Date(entry.expiresAt);
    const baseMs = base.getTime();
    if (!Number.isFinite(baseMs)) throw new Error('Ungültiges Ablaufdatum in DB.');

    const newExpiry = new Date(baseMs + daysToMs(days));

    const ok = updateExpiryFallback(process.env.GUILD_ID, userId, roleId, newExpiry.toISOString(), { resetWarn: true });
    if (!ok) throw new Error('Konnte Ablaufdatum nicht aktualisieren (DB).');

    await backupAndSave();

    const embed = new EmbedBuilder()
        .setTitle('Temprolle verlängert')
        .setColor(0xfee75c)
        .addFields(
            { name: 'User', value: `<@${userId}>`, inline: true },
            { name: 'Rolle', value: role.name, inline: true },
            { name: 'Neues Ende', value: `<t:${toUnix(newExpiry)}:f> (<t:${toUnix(newExpiry)}:R>)`, inline: true }
        )
        .setTimestamp(new Date());

    const logCh = await guild.channels.fetch(config.logChannelId).catch(() => null);
    if (logCh && logCh.isTextBased()) await logCh.send({ embeds: [embed] });
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('extend-temp-role')
        .setDescription('Verlängert eine bestehende temporäre Rolle')
        .addUserOption(o => o.setName('user').setDescription('User').setRequired(true))
        .addRoleOption(o => o.setName('role').setDescription('Rolle').setRequired(true))
        .addIntegerOption(o => o.setName('tage').setDescription('Tage, um die verlängert wird (>=1)').setRequired(true).setMinValue(1)),
    async execute(interaction) {
        if (!interaction.member.roles.cache.has(config.adminRoleId)) {
            return interaction.reply({ content: 'Nur Admins dürfen das.', flags: MessageFlags.Ephemeral });
        }

        const user = interaction.options.getUser('user', true);
        const role = interaction.options.getRole('role', true);
        const tage = interaction.options.getInteger('tage', true);

        try {
            await extendTempRole({
                guild: interaction.guild,
                userId: user.id,
                roleId: role.id,
                days: tage,
                moderator: interaction.user,
                reason: `via /extend-temp-role by ${interaction.user.id}`,
            });
            await interaction.reply({ content: 'Verlängert.', flags: MessageFlags.Ephemeral });
        } catch (err) {
            return interaction.reply({ content: err?.message || 'Fehler beim Verlängern.', flags: MessageFlags.Ephemeral });
        }
    },
    extendTempRole,
};
