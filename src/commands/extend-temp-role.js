// --- file: src/commands/extend-temp-role.js
const { SlashCommandBuilder: SDB2, EmbedBuilder: EB2 } = require('discord.js');
const config3 = require('../../config.json');
const db3 = require('../utils/db');
const { toUnix: tUnix2, ensureManageable: ensure2, backupAndSave: bns2, daysToMs: dms2 } = require('../utils/helpers');

module.exports = {
    data: new SDB2()
        .setName('extend-temp-role')
        .setDescription('Verlängert eine bestehende temporäre Rolle')
        .addUserOption(o => o.setName('user').setDescription('User').setRequired(true))
        .addRoleOption(o => o.setName('role').setDescription('Rolle').setRequired(true))
        .addIntegerOption(o => o.setName('tage').setDescription('Tage, um die verlängert wird (>=1)').setRequired(true).setMinValue(1))
    ,
    async execute(interaction) {
        if (!interaction.member.roles.cache.has(config3.adminRoleId)) {
            return interaction.reply({ content: 'Nur Admins dürfen das.', ephemeral: true });
        }

        const user = interaction.options.getUser('user', true);
        const role = interaction.options.getRole('role', true);
        const tage = interaction.options.getInteger('tage', true);

        const guild = interaction.guild;
        await ensure2(guild, role, interaction);

        const entry = db3.getEntry(process.env.GUILD_ID, user.id, role.id);
        if (!entry) return interaction.reply({ content: 'Keine bestehende Temprolle gefunden. Nutze /give-temp-role.', ephemeral: true });

        const newExpiry = new Date(new Date(entry.expiresAt).getTime() + dms2(tage));
        db3.updateExpiry(process.env.GUILD_ID, user.id, role.id, newExpiry.toISOString(), { resetWarn: true });
        await bns2();

        const embed = new EB2()
            .setTitle('Temprolle verlängert')
            .setColor(0xfee75c)
            .addFields(
                { name: 'User', value: `<@${user.id}>`, inline: true },
                { name: 'Rolle', value: role.name, inline: true },
                { name: 'Neues Ende', value: `<t:${tUnix2(newExpiry)}:f> (<t:${tUnix2(newExpiry)}:R>)`, inline: true }
            )
            .setTimestamp(new Date());

        await interaction.reply({ content: 'Verlängert.', ephemeral: true });

        const logCh = await guild.channels.fetch(config3.logChannelId).catch(() => null);
        if (logCh && logCh.isTextBased()) await logCh.send({ embeds: [embed] });
    }
};