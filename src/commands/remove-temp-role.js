// --- file: src/commands/remove-temp-role.js
const { SlashCommandBuilder: SDB3, EmbedBuilder: EB3 } = require('discord.js');
const config4 = require('../../config.json');
const db4 = require('../utils/db');
const { ensureManageable: ensure3, backupAndSave: bns3 } = require('../utils/helpers');

module.exports = {
  data: new SDB3()
    .setName('remove-temp-role')
    .setDescription('Entzieht eine temporäre Rolle vorzeitig')
    .addUserOption(o => o.setName('user').setDescription('User').setRequired(true))
    .addRoleOption(o => o.setName('role').setDescription('Rolle').setRequired(true))
    ,
  async execute(interaction) {
    if (!interaction.member.roles.cache.has(config4.adminRoleId)) {
      return interaction.reply({ content: 'Nur Admins.', ephemeral: true });
    }

    const user = interaction.options.getUser('user', true);
    const role = interaction.options.getRole('role', true);

    const guild = interaction.guild;
    await ensure3(guild, role, interaction);

    const member = await guild.members.fetch(user.id).catch(() => null);
    if (!member) return interaction.reply({ content: 'User nicht gefunden.', ephemeral: true });

    const existed = db4.removeEntry(process.env.GUILD_ID, user.id, role.id);

    if (member.roles.cache.has(role.id)) {
      await member.roles.remove(role, `Temprolle entzogen von ${interaction.user.tag}`).catch(() => {});
    }

    await bns3();

    await interaction.reply({ content: existed ? 'Temprolle entzogen.' : 'Kein Eintrag vorhanden – Rolle (falls vorhanden) entfernt.', ephemeral: true });

    const embed = new EB3()
      .setTitle('Temprolle entzogen')
      .setColor(0xed4245)
      .addFields(
        { name: 'User', value: `<@${user.id}>`, inline: true },
        { name: 'Rolle', value: role.name, inline: true }
      )
      .setTimestamp(new Date());

    const logCh = await guild.channels.fetch(config4.logChannelId).catch(() => null);
    if (logCh && logCh.isTextBased()) await logCh.send({ embeds: [embed] });
  }
};