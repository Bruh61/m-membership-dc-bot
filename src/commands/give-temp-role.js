// --- file: src/commands/give-temp-role.js
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

function addEntryFallback(guildId, userId, roleId, grantedAtISO, expiresAtISO) {
    if (typeof db.addEntry === 'function') return db.addEntry(guildId, userId, roleId, grantedAtISO, expiresAtISO);

    if (!db.data) db.data = {};
    if (!db.data.members) db.data.members = {};
    if (!Array.isArray(db.data.members[userId])) db.data.members[userId] = [];

    db.data.members[userId].push({
        roleId,
        grantedAt: grantedAtISO,
        expiresAt: expiresAtISO,
    });
}

async function giveTempRole({ guild, userId, roleId, days, reason, moderator }) {
    const role = await guild.roles.fetch(roleId);
    await ensureManageable(guild, role, { reply: async () => { } });

    const member = await guild.members.fetch(userId).catch(() => null);
    if (!member) throw new Error('User nicht gefunden.');

    const existing = getEntryFallback(process.env.GUILD_ID, userId, roleId);
    if (existing) throw new Error('Dieser Nutzer hat diese Temprolle bereits.');

    const now = new Date();
    const expiresAt = new Date(now.getTime() + daysToMs(days));

    await member.roles.add(role, reason ?? `Temprolle vergeben${moderator ? ` von ${moderator.tag}` : ''}`);

    addEntryFallback(process.env.GUILD_ID, userId, roleId, now.toISOString(), expiresAt.toISOString());
    await backupAndSave();

    const embed = new EmbedBuilder()
        .setTitle('Temprolle vergeben')
        .setColor(0x57F287)
        .addFields(
            { name: 'User', value: `<@${userId}>`, inline: true },
            { name: 'Rolle', value: role.name, inline: true },
            { name: 'Start', value: `<t:${toUnix(now)}:f>`, inline: true },
            { name: 'Ende', value: `<t:${toUnix(expiresAt)}:f> (<t:${toUnix(expiresAt)}:R>)` }
        )
        .setTimestamp(now);

    const logCh = await guild.channels.fetch(config.logChannelId).catch(() => null);
    if (logCh && logCh.isTextBased()) await logCh.send({ embeds: [embed] });
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('give-temp-role')
        .setDescription('Vergibt eine temporäre Rolle an einen Nutzer')
        .addUserOption(o => o.setName('user').setDescription('User').setRequired(true))
        .addRoleOption(o => o.setName('role').setDescription('Rolle').setRequired(true))
        .addIntegerOption(o => o.setName('tage').setDescription('Dauer in Tagen (>=1)').setRequired(true).setMinValue(1)),
    async execute(interaction) {
        if (!interaction.member.roles.cache.has(config.adminRoleId)) {
            return interaction.reply({ content: 'Nur Admins dürfen das.', flags: MessageFlags.Ephemeral });
        }

        const user = interaction.options.getUser('user', true);
        const role = interaction.options.getRole('role', true);
        const tage = interaction.options.getInteger('tage', true);

        try {
            await giveTempRole({
                guild: interaction.guild,
                userId: user.id,
                roleId: role.id,
                days: tage,
                moderator: interaction.user,
                reason: `via /give-temp-role by ${interaction.user.id}`,
            });
            await interaction.reply({ content: 'Temprolle vergeben.', flags: MessageFlags.Ephemeral });
        } catch (err) {
            return interaction.reply({ content: err?.message || 'Fehler beim Vergeben.', flags: MessageFlags.Ephemeral });
        }
    },
    giveTempRole,
};
