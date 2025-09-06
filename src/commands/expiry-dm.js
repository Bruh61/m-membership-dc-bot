// src/commands/expiry-dm.js
const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const config = require('../../config.json');
const db = require('../utils/db');
const { buildExpiryEmbed, deliverDM } = require('../utils/notify');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('expiry-dm')
    .setDescription('Schickt einem User per DM die Ablaufdaten einer temporären Rolle (nur Admin)')
    .addUserOption(o => o.setName('user').setDescription('User').setRequired(true))
    .addRoleOption(o => o.setName('role').setDescription('Rolle').setRequired(true)),

  async execute(interaction) {
    // schnelle Early-exit Antwort (hier noch KEIN defer nötig)
    if (!interaction.member?.roles?.cache?.has(config.adminRoleId)) {
      return interaction.reply({ content: 'Nur Admins.', flags: MessageFlags.Ephemeral });
    }

    // Ab hier kann es dauern -> direkt defer (ephemeral)
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    try {
      const user = interaction.options.getUser('user', true);
      const role = interaction.options.getRole('role', true);

      const entry = db.getEntry(process.env.GUILD_ID, user.id, role.id);
      if (!entry) {
        return interaction.editReply('Keine Temprolle für diesen User & diese Rolle gefunden.');
      }

      const embed = buildExpiryEmbed(user, role, entry);
      const ok = await deliverDM(user, { embeds: [embed] });

      await interaction.editReply(ok
        ? 'DM verschickt.'
        : 'DM konnte nicht zugestellt werden (vermutlich deaktiviert).'
      );
    } catch (err) {
      console.error('expiry-dm error:', err);
      // Falls schon deferred, hier editReply benutzen
      await interaction.editReply('Unerwarteter Fehler beim Senden der DM.');
    }
  }
};
