// --- file: src/commands/list-temp-roles.js
const {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require('discord.js');
const config = require('../../config.json');
const db = require('../utils/db');
const { toUnix } = require('../utils/helpers');

const PAGE_SIZE = 3;             // wichtig: max 3 Einträge pro Seite (ActionRow-Limit)
const DEFAULT_EXTEND_DAYS = 30;   // Standard-Verlängerung

module.exports = {
  data: new SlashCommandBuilder()
    .setName('list-temp-roles')
    .setDescription('Listet alle Nutzer mit Temprollen (mit Aktionen & Pagination)'),
  async execute(interaction) {
    if (!interaction.member.roles.cache.has(config.adminRoleId)) {
      return interaction.reply({ content: 'Nur Admins.', ephemeral: true });
    }

    const entries = db.listAll(process.env.GUILD_ID);
    const totalPages = Math.max(1, Math.ceil(entries.length / PAGE_SIZE));
    const page = 0;
    const start = page * PAGE_SIZE;
    const slice = entries.slice(start, start + PAGE_SIZE);

    const embed = new EmbedBuilder()
      .setTitle(`Temporäre Rollen – Seite ${page + 1}/${totalPages}`)
      .setColor(0x5865F2)
      .setTimestamp(new Date());

    const components = [];

    if (slice.length === 0) {
      embed.setDescription('Keine Einträge.');
    } else {
      for (const e of slice) {
        const roleName = interaction.guild.roles.cache.get(e.roleId)?.name || 'Unbekannte Rolle';
        const until = e.expiresAt ? `<t:${toUnix(e.expiresAt)}:R>` : '–';
        const display = interaction.guild.members.cache.get(e.userId)?.user?.tag
          ? `${interaction.guild.members.cache.get(e.userId).user.tag} (<@${e.userId}>)`
          : `<@${e.userId}>`;

        embed.addFields({
          name: display,
          value: `• Rolle: **${roleName}** (<@&${e.roleId}>)\n• läuft ab: ${until}`,
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
    }

    // Pagination Row
    components.push(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`troles|${interaction.guild.id}|nav|prev|${page}`)
          .setLabel('◀️ Zurück')
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(true),
        new ButtonBuilder()
          .setCustomId(`troles|${interaction.guild.id}|nav|next|${page}`)
          .setLabel('Weiter ▶️')
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(totalPages <= 1),
      )
    );

    await interaction.reply({ embeds: [embed], components, ephemeral: true });
  },
};
