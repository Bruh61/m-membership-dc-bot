// --- file: src/commands/list-temp-roles.js
const { SlashCommandBuilder: SDB4, EmbedBuilder: EB4, ActionRowBuilder: ARB4, ButtonBuilder: BB4, ButtonStyle: BS4 } = require('discord.js');
const config5 = require('../../config.json');
const db5 = require('../utils/db');
const { toUnix: tUnix4 } = require('../utils/helpers');

module.exports = {
  data: new SDB4()
    .setName('list-temp-roles')
    .setDescription('Listet alle Nutzer mit Temprollen (paginiert)')
    ,
  async execute(interaction) {
    if (!interaction.member.roles.cache.has(config5.adminRoleId)) {
      return interaction.reply({ content: 'Nur Admins.', ephemeral: true });
    }

    const entries = db5.listAll(process.env.GUILD_ID);
    const pageSize = 5;
    const maxPage = Math.max(0, Math.ceil(entries.length / pageSize) - 1);
    const page = 0;
    const slice = entries.slice(0, pageSize);

    const embed = new EB4()
      .setTitle('Temprollen — Übersicht')
      .setColor(0x2b2d31)
      .setFooter({ text: `Seite ${page + 1} / ${maxPage + 1}` })
      .setTimestamp(new Date());

    if (slice.length === 0) {
      embed.setDescription('Keine Einträge.');
    } else {
      embed.setDescription(slice.map((s, idx) => `**${idx + 1}.** <@${s.userId}> — **${(interaction.guild.roles.cache.get(s.roleId)?.name) || 'Unbekannte Rolle'}**\n• Start: <t:${tUnix4(s.grantedAt)}:f>\n• Ende: <t:${tUnix4(s.expiresAt)}:f> (<t:${tUnix4(s.expiresAt)}:R>)`).join('\n\n'));
    }

    const row = new ARB4().addComponents(
      new BB4().setCustomId(`temproles:prev:${page}:${interaction.user.id}`).setEmoji('◀️').setStyle(BS4.Secondary).setDisabled(true),
      new BB4().setCustomId(`temproles:next:${page}:${interaction.user.id}`).setEmoji('▶️').setStyle(BS4.Secondary).setDisabled(maxPage === 0)
    );

    await interaction.reply({ embeds: [embed], components: [row], ephemeral: true });
  }
};