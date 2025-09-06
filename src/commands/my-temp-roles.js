// --- file: src/commands/my-temp-roles.js
const { SlashCommandBuilder: SDB5, EmbedBuilder: EB5 } = require('discord.js');
const db6 = require('../utils/db');
const { toUnix: tUnix5 } = require('../utils/helpers');

module.exports = {
  data: new SDB5()
    .setName('my-temp-roles')
    .setDescription('Zeigt deine aktiven temporären Rollen (ephemeral)')
    ,
  async execute(interaction) {
    const userId = interaction.user.id;
    const entries = db6.getUser(process.env.GUILD_ID, userId);

    const embed = new EB5()
      .setTitle('Deine temporären Rollen')
      .setColor(0x5865F2)
      .setTimestamp(new Date());

    if (!entries || entries.length === 0) {
      embed.setDescription('Du hast aktuell keine temporären Rollen.');
    } else {
      embed.setDescription(entries.map(e => `• **${(interaction.guild.roles.cache.get(e.roleId)?.name) || 'Unbekannte Rolle'}** — Start: <t:${tUnix5(e.grantedAt)}:f> — Ende: <t:${tUnix5(e.expiresAt)}:f> (<t:${tUnix5(e.expiresAt)}:R>)`).join('\n'));
    }

    await interaction.reply({ embeds: [embed], ephemeral: true });
  }
};