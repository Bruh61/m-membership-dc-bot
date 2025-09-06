// --- file: src/utils/notify.js
const { EmbedBuilder } = require('discord.js');
const { toUnix } = require('./helpers');

// FIX: show plain role name in DMs (mentions are unknown outside guild)
function buildExpiryEmbed(user, role, entry) {
  const start = new Date(entry.grantedAt);
  const end = new Date(entry.expiresAt);
  return new EmbedBuilder()
    .setTitle('Deine temporäre Rolle — Ablauf')
    .setColor(0x5865F2)
    .setDescription(`Dir wurde die Rolle **${role.name}** zugewiesen.`)
    .addFields(
      { name: 'Rolle', value: role.name, inline: true },
      { name: 'Start', value: `<t:${toUnix(start)}:F>`, inline: true },
      { name: 'Ablauf', value: `<t:${toUnix(end)}:F> (<t:${toUnix(end)}:R>)` }
    )
    .setFooter({ text: `User: ${user.tag}` })
    .setTimestamp(new Date());
}

async function deliverDM(user, payload) {
  try {
    const dm = await user.createDM();
    await dm.send(payload);
    return true;
  } catch {
    return false;
  }
}

module.exports = { buildExpiryEmbed, deliverDM };
