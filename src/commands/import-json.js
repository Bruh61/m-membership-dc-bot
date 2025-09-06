// --- file: src/commands/import-json.js
const { SlashCommandBuilder: SDB9 } = require('discord.js');
const config9 = require('../../config.json');
const db9 = require('../utils/db');
const { backupAndSaveFromRaw, validateSchema } = require('../utils/helpers');

module.exports = {
  data: new SDB9()
    .setName('import-json')
    .setDescription('Importiert eine JSON-Datenbank (nur Admin)')
    .addAttachmentOption(o => o.setName('file').setDescription('JSON-Datei').setRequired(true))
    ,
  async execute(interaction) {
    if (!interaction.member.roles.cache.has(config9.adminRoleId)) {
      return interaction.reply({ content: 'Nur Admins.', ephemeral: true });
    }

    await interaction.deferReply({ ephemeral: true });
    const att = interaction.options.getAttachment('file', true);
    if (!att.contentType || !att.contentType.includes('application/json')) {
      return interaction.editReply('Die Datei scheint keine JSON zu sein.');
    }

    const res = await fetch(att.url);
    const text = await res.text();
    let json;
    try { json = JSON.parse(text); } catch { return interaction.editReply('Ungültiges JSON.'); }

    const ok = validateSchema(json);
    if (!ok) return interaction.editReply('Schema ungültig.');

    db9.replace(json);
    await backupAndSaveFromRaw(JSON.stringify(json, null, 2));

    await interaction.editReply('Import erfolgreich.');
  }
};