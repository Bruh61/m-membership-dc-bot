// --- file: src/commands/extend-temp-role.js
const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const config = require('../../config.json');
const db = require('../utils/db');
const { toUnix, ensureManageable, backupAndSave, daysToMs } = require('../utils/helpers');

async function extendTempRole({ guild, userId, roleId, days, reason, moderator }) {
    const role = await guild.roles.fetch(roleId);
    await ensureManageable(guild, role, {
        reply: async () => { },
    });

    const entry = db.getEntry(process.env.GUILD_ID, userId, roleId);
    if (!entry) throw new Error('Keine bestehende Temprolle gefunden.');

    const newExpiry = new Date(new Date(entry.expiresAt).getTime() + daysToMs(days));
    db.updateExpiry(process.env.GUILD_ID, userId, roleId, newExpiry.toISOString(), { resetWarn: true });
    await backupAndSave();

    const embed = new EmbedBuilder()
        .setTitle('Temprolle verlängert')
        .setColor(0xfee75c)
        .addFields(
            { name: 'User', value: `<@${userId}>`, inline: true },
            { name: 'Rolle', value: role.name, inline: true },
            { name: 'Neues Ende', value: `<t:${toUnix(newExpiry)}:f> (<t:${toUnix(newExpiry)}:R>)`, inline: true },
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
            return interaction.reply({ content: 'Nur Admins dürfen das.', ephemeral: true });
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
            await interaction.reply({ content: 'Verlängert.', ephemeral: true });
        } catch (err) {
            return interaction.reply({ content: err.message || 'Fehler beim Verlängern.', ephemeral: true });
        }
    },
    extendTempRole, // API für Buttons
};
