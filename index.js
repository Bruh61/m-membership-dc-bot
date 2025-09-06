// --- file: index.js
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const {
    Client,
    GatewayIntentBits,
    Partials,
    Collection,
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
} = require('discord.js');

const config = require('./config.json');
const db = require('./src/utils/db');
const { ensureDirs, toUnix } = require('./src/utils/helpers');
const { revokeExpiredRoles, sendFiveDayWarnings } = require('./src/utils/scheduler');

ensureDirs();

const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers],
    partials: [Partials.GuildMember]
});

client.commands = new Collection();

// Load commands dynamically
const commandsPath = path.join(__dirname, 'src', 'commands');
for (const file of fs.readdirSync(commandsPath)) {
    if (!file.endsWith('.js')) continue;
    const command = require(path.join(commandsPath, file));
    client.commands.set(command.data.name, command);
}

client.once('ready', async () => {
    console.log(`Logged in as ${client.user.tag}`);
    await revokeExpiredRoles(client);
    await sendFiveDayWarnings(client);

    const ms = config.checkIntervalMinutes * 60 * 1000;
    setInterval(() => revokeExpiredRoles(client).catch(console.error), ms);
    setInterval(() => sendFiveDayWarnings(client).catch(console.error), 60 * 60 * 1000);
});

client.on('interactionCreate', async (interaction) => {
    try {
        if (interaction.isChatInputCommand()) {
            const command = client.commands.get(interaction.commandName);
            if (!command) return;
            await command.execute(interaction, client);
            return;
        }

        if (interaction.isButton()) {
            const [ns, action, pageStr, userId] = interaction.customId.split(':');
            if (ns !== 'temproles') return;
            if (userId && interaction.user.id !== userId) {
                return interaction.reply({ content: 'Nur der ursprüngliche Admin darf damit interagieren.', ephemeral: true });
            }

            const page = parseInt(pageStr, 10) || 0;
            const dir = action === 'next' ? 1 : -1;
            const entries = db.listAll(process.env.GUILD_ID);
            const pageSize = 5;
            const maxPage = Math.max(0, Math.ceil(entries.length / pageSize) - 1);
            const newPage = Math.min(maxPage, Math.max(0, page + dir));

            const slice = entries.slice(newPage * pageSize, newPage * pageSize + pageSize);
            const embed = new EmbedBuilder()
                .setTitle('Temprollen — Übersicht')
                .setColor(0x2b2d31)
                .setFooter({ text: `Seite ${newPage + 1} / ${maxPage + 1}` })
                .setTimestamp(new Date());

            if (slice.length === 0) {
                embed.setDescription('Keine Einträge.');
            } else {
                embed.setDescription(slice.map((s, idx) => `**${newPage * pageSize + idx + 1}.** <@${s.userId}> — **${(interaction.guild.roles.cache.get(s.roleId)?.name) || 'Unbekannte Rolle'}**\n• Start: <t:${toUnix(s.grantedAt)}:f>\n• Ende: <t:${toUnix(s.expiresAt)}:f> (<t:${toUnix(s.expiresAt)}:R>)`).join('\n\n'));
            }

            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId(`temproles:prev:${newPage}:${interaction.user.id}`).setEmoji('◀️').setStyle(ButtonStyle.Secondary).setDisabled(newPage === 0),
                new ButtonBuilder().setCustomId(`temproles:next:${newPage}:${interaction.user.id}`).setEmoji('▶️').setStyle(ButtonStyle.Secondary).setDisabled(newPage === maxPage)
            );

            await interaction.update({ embeds: [embed], components: [row] });
        }
    } catch (err) {
        console.error(err);
        if (interaction.isRepliable()) {
            if (interaction.deferred || interaction.replied) {
                await interaction.followUp({ content: 'Es ist ein Fehler aufgetreten.', ephemeral: true }).catch(() => { });
            } else {
                await interaction.reply({ content: 'Es ist ein Fehler aufgetreten.', ephemeral: true }).catch(() => { });
            }
        }
    }
});

client.login(process.env.BOT_TOKEN);