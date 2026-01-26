// src/commands/customrole.js
const { SlashCommandBuilder } = require('discord.js');
const config = require('../../config.json');
const db = require('../utils/db');

const {
    getAllowedCustomRoleIds,
    hasAnyMembershipRole,
    isValidHexColor,
    normalizeHexColor,
    placeRoleBelowAnchor,
    ensureManageable,
    backupAndSave,
    validateRoleName,
} = require('../utils/helpers');

function getExistingCustomRole(guild, userId) {
    const rec = db.getCustomRole(userId);
    if (!rec?.roleId) return null;
    return guild.roles.cache.get(rec.roleId) || null;
}

async function setRoleColors(role, color1, color2) {
    // - Mit color2: versuche Gradient (Enhanced Role Styles)
    // - Ohne color2: Solid
    if (color2) {
        try {
            await role.setColors({ primaryColor: color1, secondaryColor: color2 }, 'Set gradient colors');
            return { ok: true, note: ' (Farbverlauf aktiviert)' };
        } catch {
            // fallback, falls Feature/Perms nicht verfügbar
            await role.setColor(color1, 'Fallback to solid color').catch(() => { });
            return { ok: false, note: ' (Farbverlauf nicht verfügbar – nur farbe1 gesetzt)' };
        }
    }

    await role.setColor(color1, 'Set solid color');
    return { ok: true, note: '' };
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('customrole')
        .setDescription('Verwalte deine Custom-Rolle (Silver/Gold/Diamond)')
        .addSubcommand(sc =>
            sc
                .setName('add')
                .setDescription('Erstellt deine persönliche Custom-Rolle (nur 1x)')
                .addStringOption(o =>
                    o.setName('name').setDescription('Name der Rolle').setRequired(true)
                )
                .addStringOption(o =>
                    o.setName('farbe1').setDescription('Farbe 1 als Hex, z.B. #ff00aa').setRequired(true)
                )
                .addStringOption(o =>
                    o.setName('farbe2').setDescription('Farbe 2 als Hex (optional -> Farbverlauf)').setRequired(false)
                )
        )
        .addSubcommand(sc =>
            sc
                .setName('rename')
                .setDescription('Benennt deine Custom-Rolle um')
                .addStringOption(o =>
                    o.setName('name').setDescription('Neuer Name').setRequired(true)
                )
        )
        .addSubcommand(sc =>
            sc
                .setName('change-color')
                .setDescription('Ändert die Farbe(n) deiner Custom-Rolle')
                .addStringOption(o =>
                    o.setName('farbe1').setDescription('Farbe 1 als Hex, z.B. #ff00aa').setRequired(true)
                )
                .addStringOption(o =>
                    o.setName('farbe2').setDescription('Farbe 2 als Hex (optional -> Farbverlauf)').setRequired(false)
                )
        ),

    async execute(interaction) {
        const sub = interaction.options.getSubcommand();
        await interaction.deferReply({ ephemeral: true });

        const member = await interaction.guild.members.fetch(interaction.user.id);

        // ✅ gleiche Berechtigung für alle Subcommands (Silver/Gold/Diamond)
        const allowedIds = getAllowedCustomRoleIds(config);
        if (!hasAnyMembershipRole(member, allowedIds)) {
            return interaction.editReply('❌ Nur Silver/Gold/Diamond dürfen Custom-Rollen verwalten.');
        }

        // Optional extra banned words aus config
        const bannedExtra = Array.isArray(config?.customRole?.bannedWords) ? config.customRole.bannedWords : [];

        // -------------------------
        // /customrole add
        // -------------------------
        if (sub === 'add') {
            // ✅ nur 1x nutzbar
            const existing = db.getCustomRole(interaction.user.id);
            if (existing?.roleId) {
                return interaction.editReply('❌ Du hast bereits eine Custom-Rolle erstellt. (Nur 1x möglich)');
            }

            const nameRaw = interaction.options.getString('name', true);
            const color1Raw = interaction.options.getString('farbe1', true);
            const color2Raw = interaction.options.getString('farbe2', false);

            // ✅ Name validieren (Beleidigungen / Links / @everyone / Zeichen)
            const nameCheck = validateRoleName(nameRaw, { min: 2, max: 50, bannedWords: bannedExtra });
            if (!nameCheck.ok) return interaction.editReply(`❌ ${nameCheck.reason}`);

            // ✅ Farben validieren
            if (!isValidHexColor(color1Raw)) return interaction.editReply('❌ Ungültige farbe1. Beispiel: #ff00aa');
            if (color2Raw && !isValidHexColor(color2Raw)) return interaction.editReply('❌ Ungültige farbe2. Beispiel: #00aaff');

            const color1 = normalizeHexColor(color1Raw);
            const color2 = color2Raw ? normalizeHexColor(color2Raw) : null;

            const anchorRoleId = config.customRole?.anchorRoleId;
            if (!anchorRoleId) return interaction.editReply('❌ Server-Konfiguration: customRole.anchorRoleId fehlt.');

            const roleName = `${config.customRole?.namePrefix ?? ''}${nameCheck.name}`;

            try {
                // Rolle erstellen
                const role = await interaction.guild.roles.create({
                    name: roleName,
                    reason: `Custom role created for ${interaction.user.tag} (${interaction.user.id})`,
                    mentionable: false,
                    hoist: false,
                });

                // Positionieren
                await placeRoleBelowAnchor(interaction.guild, role, anchorRoleId);

                // Manageability
                await ensureManageable(interaction.guild, role, interaction);

                // Farben setzen (solid oder gradient)
                const { note } = await setRoleColors(role, color1, color2);

                // zuweisen
                await member.roles.add(role, 'Custom role granted (membership)');

                // DB speichern
                db.setCustomRole(interaction.user.id, role.id, new Date().toISOString());
                await backupAndSave();

                return interaction.editReply(`✅ Custom-Rolle erstellt & vergeben: <@&${role.id}>${note}`);
            } catch (err) {
                console.error('customrole add error:', err);
                return interaction.editReply(`❌ Fehler beim Erstellen der Rolle: ${err?.message ?? 'unbekannt'}`);
            }
        }

        // Ab hier: rename / change-color brauchen eine existierende Custom-Rolle
        const role = getExistingCustomRole(interaction.guild, interaction.user.id);
        if (!role) {
            return interaction.editReply('❌ Du hast noch keine Custom-Rolle. Nutze zuerst `/customrole add`.');
        }

        // Safety: wenn Rolle existiert, aber nicht mehr verwaltbar -> sauber melden
        try {
            await ensureManageable(interaction.guild, role, interaction);
        } catch {
            return interaction.editReply('❌ Ich kann deine Custom-Rolle aktuell nicht verwalten (Rollen-Hierarchie).');
        }

        // -------------------------
        // /customrole rename
        // -------------------------
        if (sub === 'rename') {
            const nameRaw = interaction.options.getString('name', true);

            const nameCheck = validateRoleName(nameRaw, { min: 2, max: 50, bannedWords: bannedExtra });
            if (!nameCheck.ok) return interaction.editReply(`❌ ${nameCheck.reason}`);

            const newName = `${config.customRole?.namePrefix ?? ''}${nameCheck.name}`;

            try {
                await role.setName(newName, `Custom role rename by ${interaction.user.id}`);
                return interaction.editReply(`✅ Custom-Rolle umbenannt zu: **${newName}**`);
            } catch (err) {
                console.error('customrole rename error:', err);
                return interaction.editReply(`❌ Fehler beim Umbenennen: ${err?.message ?? 'unbekannt'}`);
            }
        }

        // -------------------------
        // /customrole change-color
        // -------------------------
        if (sub === 'change-color') {
            const color1Raw = interaction.options.getString('farbe1', true);
            const color2Raw = interaction.options.getString('farbe2', false);

            if (!isValidHexColor(color1Raw)) return interaction.editReply('❌ Ungültige farbe1. Beispiel: #ff00aa');
            if (color2Raw && !isValidHexColor(color2Raw)) return interaction.editReply('❌ Ungültige farbe2. Beispiel: #00aaff');

            const color1 = normalizeHexColor(color1Raw);
            const color2 = color2Raw ? normalizeHexColor(color2Raw) : null;

            try {
                const { note } = await setRoleColors(role, color1, color2);
                return interaction.editReply(`✅ Farben aktualisiert.${note}`);
            } catch (err) {
                console.error('customrole change-color error:', err);
                return interaction.editReply(`❌ Fehler beim Ändern der Farben: ${err?.message ?? 'unbekannt'}`);
            }
        }

        // Fallback (sollte nie passieren)
        return interaction.editReply('❌ Unbekannter Subcommand.');
    },
};
