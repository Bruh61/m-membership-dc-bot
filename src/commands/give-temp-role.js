// --- file: src/commands/give-temp-role.js
const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const config = require('../../config.json');
const db = require('../utils/db');
const { toUnix, ensureManageable, backupAndSave, daysToMs } = require('../utils/helpers');

async function giveTempRole({ guild, userId, roleId, days, reason, moderator }) {
    const role = await guild.roles.fetch(roleId);
    await ensureManageable(guild, role, {
        reply: async () => { }, // Button-Kontext: wir werfen nur Errors durch
    });

    const member = await guild.members.fetch(userId).catch(() => null);
    if (!member) throw new Error('User nicht gefunden.');

    const existing = db.getEntry(process.env.GUILD_ID, userId, roleId);
    if (existing) throw new Error('Dieser Nutzer hat diese Temprolle bereits.');

    const now = new Date();
    const expiresAt = new Date(now.getTime() + daysToMs(days));

    await member.roles.add(role, reason ?? `Temprolle vergeben${moderator ? ` von ${moderator.tag}` : ''}`);

    db.addEntry(process.env.GUILD_ID, userId, roleId, now.toISOString(), expiresAt.toISOString());
    await backupAndSave();

    // Log
    const embed = new EmbedBuilder()
        .setTitle('Temprolle vergeben')
        .setColor(0x57F287)
        .addFields(
            { name: 'User', value: `<@${userId}>`, inline: true },
            { name: 'Rolle', value: role.name, inline: true },
            { name: 'Start', value: `<t:${toUnix(now)}:f>`, inline: true },
            { name: 'Ende', value: `<t:${toUnix(expiresAt)}:f> (<t:${toUnix(expiresAt)}:R>)` },
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
            return interaction.reply({ content: 'Nur Admins dürfen das.', ephemeral: true });
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
            await interaction.reply({ content: 'Temprolle vergeben.', ephemeral: true });
        } catch (err) {
            return interaction.reply({ content: err.message || 'Fehler beim Vergeben.', ephemeral: true });
        }
    },
    giveTempRole, // API für Buttons/Modal
};
