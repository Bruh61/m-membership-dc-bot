// --- file: src/commands/give-temp-role.js
const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const config2 = require('../../config.json');
const db2 = require('../utils/db');
const { toUnix, ensureManageable, backupAndSave, daysToMs } = require('../utils/helpers');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('give-temp-role')
        .setDescription('Vergibt eine temporäre Rolle an einen Nutzer')
        .addUserOption(o => o.setName('user').setDescription('User').setRequired(true))
        .addRoleOption(o => o.setName('role').setDescription('Rolle').setRequired(true))
        .addIntegerOption(o => o.setName('tage').setDescription('Dauer in Tagen (>=1)').setRequired(true).setMinValue(1))
    ,
    async execute(interaction) {
        if (!interaction.member.roles.cache.has(config2.adminRoleId)) {
            return interaction.reply({ content: 'Nur Admins dürfen das.', ephemeral: true });
        }

        const user = interaction.options.getUser('user', true);
        const role = interaction.options.getRole('role', true);
        const tage = interaction.options.getInteger('tage', true);

        const guild = interaction.guild;
        await ensureManageable(guild, role, interaction);

        const member = await guild.members.fetch(user.id).catch(() => null);
        if (!member) return interaction.reply({ content: 'User nicht gefunden.', ephemeral: true });

        const existing = db2.getEntry(process.env.GUILD_ID, user.id, role.id);
        if (existing) return interaction.reply({ content: 'Dieser Nutzer hat diese Temprolle bereits. Nutze /extend-temp-role.', ephemeral: true });

        const now = new Date();
        const expiresAt = new Date(now.getTime() + daysToMs(tage));

        await member.roles.add(role, `Temprolle vergeben von ${interaction.user.tag}`);

        db2.addEntry(process.env.GUILD_ID, user.id, role.id, now.toISOString(), expiresAt.toISOString());
        await backupAndSave();

        const embed = new EmbedBuilder()
            .setTitle('Temprolle vergeben')
            .setColor(0x57F287)
            .addFields(
                { name: 'User', value: `<@${user.id}>`, inline: true },
                { name: 'Rolle', value: role.name, inline: true },
                { name: 'Start', value: `<t:${toUnix(now)}:f>`, inline: true },
                { name: 'Ende', value: `<t:${toUnix(expiresAt)}:f> (<t:${toUnix(expiresAt)}:R>)` }
            )
            .setTimestamp(now);

        await interaction.reply({ content: 'Temprolle vergeben.', ephemeral: true });

        const logCh = await guild.channels.fetch(config2.logChannelId).catch(() => null);
        if (logCh && logCh.isTextBased()) await logCh.send({ embeds: [embed] });
    }
};
