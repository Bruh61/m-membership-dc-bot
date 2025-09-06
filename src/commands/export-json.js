// --- file: src/commands/export-json.js
const { SlashCommandBuilder: SDB8, AttachmentBuilder } = require('discord.js');
const config8 = require('../../config.json');
const path8 = require('path');
const fs8 = require('fs');

module.exports = {
  data: new SDB8()
    .setName('export-json')
    .setDescription('Exportiert die JSON-Datenbank (nur Admin)')
    ,
  async execute(interaction) {
    if (!interaction.member.roles.cache.has(config8.adminRoleId)) {
      return interaction.reply({ content: 'Nur Admins.', ephemeral: true });
    }
    const filePath = path8.join(process.cwd(), 'data', 'temproles.json');
    if (!fs8.existsSync(filePath)) return interaction.reply({ content: 'Keine DB gefunden.', ephemeral: true });
    const attachment = new AttachmentBuilder(filePath, { name: `temproles-export-${Date.now()}.json` });
    await interaction.reply({ content: 'Hier ist der Export.', files: [attachment], ephemeral: true });
  }
};