// --- file: src/commands/remove-temp-role.js
const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const config = require('../../config.json');
const db = require('../utils/db');
const { ensureManageable, backupAndSave } = require('../utils/helpers');

async function removeTempRole({ guild, userId, roleId, reason, moderator }) {
  const role = await guild.roles.fetch(roleId);
  await ensureManageable(guild, role, {
    reply: async () => { },
  });

  const member = await guild.members.fetch(userId).catch(() => null);
  const existed = db.removeEntry(process.env.GUILD_ID, userId, roleId);

  if (member && member.roles.cache.has(roleId)) {
    await member.roles.remove(role, reason ?? `Temprolle entzogen${moderator ? ` von ${moderator.tag}` : ''}`).catch(() => { });
  }

  await backupAndSave();

  const embed = new EmbedBuilder()
    .setTitle('Temprolle entzogen')
    .setColor(0xed4245)
    .addFields(
      { name: 'User', value: `<@${userId}>`, inline: true },
      { name: 'Rolle', value: role.name, inline: true },
    )
    .setTimestamp(new Date());

  const logCh = await guild.channels.fetch(config.logChannelId).catch(() => null);
  if (logCh && logCh.isTextBased()) await logCh.send({ embeds: [embed] });

  return existed;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('remove-temp-role')
    .setDescription('Entzieht eine temporäre Rolle vorzeitig')
    .addUserOption(o => o.setName('user').setDescription('User').setRequired(true))
    .addRoleOption(o => o.setName('role').setDescription('Rolle').setRequired(true)),
  async execute(interaction) {
    if (!interaction.member.roles.cache.has(config.adminRoleId)) {
      return interaction.reply({ content: 'Nur Admins.', ephemeral: true });
    }

    const user = interaction.options.getUser('user', true);
    const role = interaction.options.getRole('role', true);

    try {
      const existed = await removeTempRole({
        guild: interaction.guild,
        userId: user.id,
        roleId: role.id,
        moderator: interaction.user,
        reason: `via /remove-temp-role by ${interaction.user.id}`,
      });

      await interaction.reply({
        content: existed ? 'Temprolle entzogen.' : 'Kein Eintrag vorhanden – Rolle (falls vorhanden) entfernt.',
        ephemeral: true,
      });
    } catch (err) {
      return interaction.reply({ content: err.message || 'Fehler beim Entziehen.', ephemeral: true });
    }
  },
  removeTempRole, // API für Buttons
};
