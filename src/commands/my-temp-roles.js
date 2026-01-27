// --- file: src/commands/my-temp-roles.js
const {
  SlashCommandBuilder,
  EmbedBuilder,
  MessageFlags,
} = require('discord.js');

const db = require('../utils/db');
const { toUnix } = require('../utils/helpers');

function getUserEntriesFallback(guildId, userId) {
  // bevorzugt: db.getUser falls vorhanden
  if (typeof db.getUser === 'function') return db.getUser(guildId, userId) || [];

  // fallback: direkt aus db.data.members lesen
  const members = db?.data?.members || {};
  const entries = members[userId];
  return Array.isArray(entries) ? entries : [];
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('my-temp-roles')
    .setDescription('Zeigt deine aktiven temporären Rollen (ephemeral)'),
  async execute(interaction) {
    const userId = interaction.user.id;

    // hol Einträge robust
    const allEntries = getUserEntriesFallback(process.env.GUILD_ID, userId);

    // optional: nur aktive Rollen anzeigen
    const now = Date.now();
    const entries = (allEntries || []).filter(e => {
      if (!e?.expiresAt) return true; // wenn kein expiry vorhanden, trotzdem anzeigen
      const t = new Date(e.expiresAt).getTime();
      return Number.isFinite(t) ? t > now : true;
    });

    const embed = new EmbedBuilder()
      .setTitle('Deine temporären Rollen')
      .setColor(0x5865F2)
      .setTimestamp(new Date());

    if (!entries || entries.length === 0) {
      embed.setDescription('Du hast aktuell keine temporären Rollen.');
    } else {
      embed.setDescription(
        entries
          .map(e => {
            const roleName =
              interaction.guild.roles.cache.get(e.roleId)?.name || 'Unbekannte Rolle';

            const start = e.grantedAt ? `<t:${toUnix(e.grantedAt)}:f>` : '–';
            const endAbs = e.expiresAt ? `<t:${toUnix(e.expiresAt)}:f>` : '–';
            const endRel = e.expiresAt ? ` (<t:${toUnix(e.expiresAt)}:R>)` : '';

            return `• **${roleName}** — Start: ${start} — Ende: ${endAbs}${endRel}`;
          })
          .join('\n')
      );
    }

    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  },
};
