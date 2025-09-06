// --- file: register-commands.js
require('dotenv').config();
const { REST, Routes } = require('discord.js');
const fs = require('fs');
const path = require('path');

(async () => {
    try {
        const commandsPath = path.join(__dirname, 'src', 'commands');
        const files = fs.readdirSync(commandsPath).filter(f => f.endsWith('.js'));
        const bodies = [];
        for (const f of files) {
            const cmd = require(path.join(commandsPath, f));
            bodies.push(cmd.data.toJSON());
        }

        const rest = new REST({ version: '10' }).setToken(process.env.BOT_TOKEN);
        await rest.put(
            Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID),
            { body: bodies }
        );

        console.log('✅ Slash Commands erfolgreich registriert/aktualisiert.');
    } catch (err) {
        console.error('❌ Fehler beim Registrieren der Slash Commands:', err);
    }
})();
