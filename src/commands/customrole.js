// src/commands/customrole.js
const { SlashCommandBuilder, PermissionsBitField, MessageFlags } = require('discord.js');
const config = require('../../config.json');
const db = require('../utils/db');
const helpers = require('../utils/helpers');
const { createPremiumChannel } = require('../utils/premiumChannels');

// ---------- helpers wrapper (best practice: robust, keine doppelten identifiers) ----------
function getAllowedCustomRoleIdsSafe(cfg) {
    if (typeof helpers.getAllowedCustomRoleIds === 'function') {
        return helpers.getAllowedCustomRoleIds(cfg);
    }
    // Fallback: explizit oder membershipRoleIds
    const explicit = cfg?.customRole?.allowedMembershipRoleIds;
    if (Array.isArray(explicit) && explicit.length) return explicit.filter(Boolean);

    const idsObj = cfg?.membershipRoleIds || {};
    return Object.values(idsObj).filter(Boolean);
}

function getMembershipTierSafe(member, membershipRoleIds) {
    if (typeof helpers.getMembershipTier === 'function') {
        return helpers.getMembershipTier(member, membershipRoleIds);
    }
    // Fallback
    const ids = membershipRoleIds || {};
    const order = ['diamond', 'gold', 'silver', 'bronze'];
    for (const tier of order) {
        const roleId = ids[tier];
        if (roleId && member.roles.cache.has(roleId)) return tier;
    }
    for (const [tier, roleId] of Object.entries(ids)) {
        if (roleId && member.roles.cache.has(roleId)) return tier;
    }
    return null;
}

function getCustomRoleShareLimitSafe(cfg, tier) {
    if (typeof helpers.getCustomRoleShareLimit === 'function') {
        return helpers.getCustomRoleShareLimit(cfg, tier);
    }
    // Fallback
    const a = cfg?.customRoleSharing?.limitsByTier?.[tier];
    const b = cfg?.customRoleSharing?.limits?.[tier];
    const c = cfg?.customRoleSharing?.shareLimitByTier?.[tier];
    const v = a ?? b ?? c;
    return Number.isFinite(v) ? v : 0;
}

// ---------- CustomRole record helpers ----------
function ensureCustomRoleRecord(userId, roleId) {
    const data = db.data;
    if (!data.customRoles) data.customRoles = {};
    if (!data.customRoles[userId]) {
        data.customRoles[userId] = { roleId, createdAt: new Date().toISOString(), sharedWith: [] };
    } else {
        if (!data.customRoles[userId].roleId) data.customRoles[userId].roleId = roleId;
        if (!data.customRoles[userId].createdAt) data.customRoles[userId].createdAt = new Date().toISOString();
        if (!Array.isArray(data.customRoles[userId].sharedWith)) data.customRoles[userId].sharedWith = [];
    }
    db.replace(db.data);
    return data.customRoles[userId];
}

function getCustomRoleRecord(userId) {
    const data = db.data;
    if (!data.customRoles) data.customRoles = {};
    const rec = data.customRoles[userId];
    if (!rec) return null;
    if (!Array.isArray(rec.sharedWith)) rec.sharedWith = [];
    return rec;
}

function addCustomRoleShare(ownerId, targetId) {
    const rec = getCustomRoleRecord(ownerId);
    if (!rec?.roleId) return { ok: false, reason: 'NO_CUSTOM_ROLE' };

    const set = new Set(rec.sharedWith || []);
    if (set.has(targetId)) return { ok: false, reason: 'ALREADY_SHARED' };
    set.add(targetId);
    rec.sharedWith = Array.from(set);
    db.replace(db.data);
    return { ok: true };
}

function removeCustomRoleShare(ownerId, targetId) {
    const rec = getCustomRoleRecord(ownerId);
    if (!rec?.roleId) return { ok: false, reason: 'NO_CUSTOM_ROLE' };

    rec.sharedWith = (rec.sharedWith || []).filter(id => id !== targetId);
    db.replace(db.data);
    return { ok: true };
}

function getExistingCustomRole(guild, userId) {
    const rec = db.getCustomRole(userId);
    if (!rec?.roleId) return null;
    return guild.roles.cache.get(rec.roleId) || null;
}

function hexToInt(hex) {
    const h = String(hex).trim().replace('#', '');
    return parseInt(h, 16);
}

async function setRoleColors(role, color1, color2) {
    if (color2) {
        try {
            await role.setColors({ primaryColor: color1, secondaryColor: color2 }, 'Set gradient colors');
            return { ok: true, note: ' (Farbverlauf aktiviert)' };
        } catch (err) {
            console.error('[customrole] setColors failed:', err?.code, err?.status, err?.message);

            // Fallback SOLID – aber Fehler ebenfalls loggen, falls auch das 403 ist
            try {
                await role.setColor(color1, 'Fallback to solid color');
            } catch (e2) {
                console.error('[customrole] setColor fallback failed:', e2?.code, e2?.status, e2?.message);
            }

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
                .addStringOption(o => o.setName('name').setDescription('Name der Rolle').setRequired(true))
                .addStringOption(o => o.setName('farbe1').setDescription('Farbe 1 als Hex, z.B. #ff00aa').setRequired(true))
                .addStringOption(o => o.setName('farbe2').setDescription('Farbe 2 als Hex (optional -> Farbverlauf)').setRequired(false))
        )
        .addSubcommand(sc =>
            sc
                .setName('rename')
                .setDescription('Benennt deine Custom-Rolle um')
                .addStringOption(o => o.setName('name').setDescription('Neuer Name').setRequired(true))
        )
        .addSubcommand(sc =>
            sc
                .setName('change-color')
                .setDescription('Ändert die Farbe(n) deiner Custom-Rolle')
                .addStringOption(o => o.setName('farbe1').setDescription('Farbe 1 als Hex, z.B. #ff00aa').setRequired(true))
                .addStringOption(o => o.setName('farbe2').setDescription('Farbe 2 als Hex (optional -> Farbverlauf)').setRequired(false))
        )
        .addSubcommand(sc => sc.setName('my-membership').setDescription('Zeigt deine Custom-Rolle und ggf. geteilte User'))
        .addSubcommand(sc =>
            sc
                .setName('give-customrole')
                .setDescription('Teilt deine Custom-Rolle mit einem User (nur Gold/Diamond)')
                .addUserOption(o => o.setName('user').setDescription('User der deine Custom-Rolle bekommen soll').setRequired(true))
        )
        .addSubcommand(sc =>
            sc
                .setName('remove-customrole')
                .setDescription('Entfernt deine geteilte Custom-Rolle bei einem User')
                .addUserOption(o => o.setName('user').setDescription('User bei dem die Rolle entfernt wird').setRequired(true))
        )
        .addSubcommand(sc =>
            sc
                .setName('add-channel')
                .setDescription('Erstellt deinen Premium-Channel (nur Diamond, 1x)')
        ),

    async execute(interaction) {
        const sub = interaction.options.getSubcommand();
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        const member = await interaction.guild.members.fetch(interaction.user.id);

        // Berechtigung (Silver/Gold/Diamond)
        const allowedIds = getAllowedCustomRoleIdsSafe(config);
        if (typeof helpers.hasAnyMembershipRole !== 'function') {
            return interaction.editReply('❌ Interner Fehler: helpers.hasAnyMembershipRole fehlt.');
        }
        if (!helpers.hasAnyMembershipRole(member, allowedIds)) {
            return interaction.editReply('❌ Nur Silver/Gold/Diamond dürfen Custom-Rollen verwalten.');
        }

        const bannedExtra = Array.isArray(config?.customRole?.bannedWords) ? config.customRole.bannedWords : [];

        // -------------------------
        // /customrole add
        // -------------------------
        if (sub === 'add') {
            const existing = db.getCustomRole(interaction.user.id);
            if (existing?.roleId) {
                return interaction.editReply('❌ Du hast bereits eine Custom-Rolle erstellt. (Nur 1x möglich)');
            }

            const nameRaw = interaction.options.getString('name', true);
            const color1Raw = interaction.options.getString('farbe1', true);
            const color2Raw = interaction.options.getString('farbe2', false);

            if (typeof helpers.validateRoleName !== 'function') {
                return interaction.editReply('❌ Interner Fehler: helpers.validateRoleName fehlt.');
            }
            const nameCheck = helpers.validateRoleName(nameRaw, { min: 2, max: 50, bannedWords: bannedExtra });
            if (!nameCheck.ok) return interaction.editReply(`❌ ${nameCheck.reason}`);

            if (typeof helpers.isValidHexColor !== 'function' || typeof helpers.normalizeHexColor !== 'function') {
                return interaction.editReply('❌ Interner Fehler: Color-Helpers fehlen.');
            }
            if (!helpers.isValidHexColor(color1Raw)) return interaction.editReply('❌ Ungültige farbe1. Beispiel: #ff00aa');
            if (color2Raw && !helpers.isValidHexColor(color2Raw)) return interaction.editReply('❌ Ungültige farbe2. Beispiel: #00aaff');

            const color1 = helpers.normalizeHexColor(color1Raw);
            const color2 = color2Raw ? helpers.normalizeHexColor(color2Raw) : null;

            const tier = getMembershipTierSafe(member, config.membershipRoleIds || {});
            const anchorRoleId =
                config.customRole?.anchorRoleIdsByTier?.[tier] ??
                config.customRole?.anchorRoleId;

            if (!anchorRoleId) {
                return interaction.editReply('❌ Server-Konfiguration: customRole.anchorRoleIdsByTier (oder anchorRoleId) fehlt.');
            }

            const roleName = `${config.customRole?.namePrefix ?? ''}${nameCheck.name}`;

            try {
                const role = await interaction.guild.roles.create({
                    name: roleName,
                    permissions: [
                        PermissionsBitField.Flags.Connect,
                        PermissionsBitField.Flags.Speak,
                    ],
                    reason: `Custom role created for ${interaction.user.tag} (${interaction.user.id})`,
                    mentionable: false,
                    hoist: false,
                });

                if (typeof helpers.placeRoleBelowAnchor !== 'function') {
                    return interaction.editReply('❌ Interner Fehler: helpers.placeRoleBelowAnchor fehlt.');
                }
                await helpers.placeRoleBelowAnchor(interaction.guild, role, anchorRoleId);

                if (typeof helpers.ensureManageable !== 'function') {
                    return interaction.editReply('❌ Interner Fehler: helpers.ensureManageable fehlt.');
                }
                await helpers.ensureManageable(interaction.guild, role, interaction);

                const { note } = await setRoleColors(role, color1, color2, interaction.guild);

                await member.roles.add(role, 'Custom role granted (membership)');

                // db.js kann setCustomRole – danach local record für sharedWith
                db.setCustomRole(interaction.user.id, role.id, new Date().toISOString());
                ensureCustomRoleRecord(interaction.user.id, role.id);

                if (typeof helpers.backupAndSave === 'function') {
                    await helpers.backupAndSave();
                } else {
                    await db.save?.(); // fallback, falls vorhanden
                }

                return interaction.editReply(`✅ Custom-Rolle erstellt & vergeben: <@&${role.id}>${note}`);
            } catch (err) {
                console.error('customrole add error:', err);
                return interaction.editReply(`❌ Fehler beim Erstellen der Rolle: ${err?.message ?? 'unbekannt'}`);
            }
        }

        // Ab hier: braucht existierende Custom-Rolle
        const role = getExistingCustomRole(interaction.guild, interaction.user.id);
        if (!role) return interaction.editReply('❌ Du hast noch keine Custom-Rolle. Nutze zuerst `/customrole add`.');

        try {
            if (typeof helpers.ensureManageable === 'function') {
                await helpers.ensureManageable(interaction.guild, role, interaction);
            }
        } catch {
            return interaction.editReply('❌ Ich kann deine Custom-Rolle aktuell nicht verwalten (Rollen-Hierarchie).');
        }

        ensureCustomRoleRecord(interaction.user.id, role.id);

        // -------------------------
        // /customrole rename
        // -------------------------
        if (sub === 'rename') {
            const nameRaw = interaction.options.getString('name', true);
            const nameCheck = helpers.validateRoleName(nameRaw, { min: 2, max: 50, bannedWords: bannedExtra });
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

            if (!helpers.isValidHexColor(color1Raw)) return interaction.editReply('❌ Ungültige farbe1. Beispiel: #ff00aa');
            if (color2Raw && !helpers.isValidHexColor(color2Raw)) return interaction.editReply('❌ Ungültige farbe2. Beispiel: #00aaff');

            const color1 = helpers.normalizeHexColor(color1Raw);
            const color2 = color2Raw ? helpers.normalizeHexColor(color2Raw) : null;

            try {
                const { note } = await setRoleColors(role, color1, color2, interaction.guild);
                return interaction.editReply(`✅ Farben aktualisiert.${note}`);
            } catch (err) {
                console.error('customrole change-color error:', err);
                return interaction.editReply(`❌ Fehler beim Ändern der Farben: ${err?.message ?? 'unbekannt'}`);
            }
        }

        // -------------------------
        // /customrole my-membership
        // -------------------------
        if (sub === 'my-membership') {
            const tier = getMembershipTierSafe(member, config.membershipRoleIds || {});
            const rec = getCustomRoleRecord(interaction.user.id) || db.getCustomRole(interaction.user.id);
            const sharedWith = Array.isArray(rec?.sharedWith) ? rec.sharedWith : [];

            const shareEligibleTiers = Array.isArray(config?.customRoleSharing?.eligibleTiers)
                ? config.customRoleSharing.eligibleTiers
                : ['gold', 'diamond'];

            const shareLimit = getCustomRoleShareLimitSafe(config, tier);
            const canShare = shareEligibleTiers.includes(tier) && shareLimit > 0;

            const sharedText = sharedWith.length ? sharedWith.map(id => `<@${id}>`).join(', ') : '—';

            return interaction.editReply(
                `👤 **Deine Membership:** ${tier ?? 'unbekannt'}\n` +
                `🎭 **Deine Custom-Rolle:** <@&${role.id}>\n` +
                `🤝 **Sharing:** ${canShare ? `aktiv (${sharedWith.length}/${shareLimit})` : 'nicht verfügbar'}\n` +
                `📌 **Geteilt mit:** ${sharedText}`
            );
        }

        // -------------------------
        // /customrole give-customrole
        // -------------------------
        if (sub === 'give-customrole') {
            const target = interaction.options.getUser('user', true);
            if (target.id === interaction.user.id) return interaction.editReply('❌ Du kannst deine Rolle nicht mit dir selbst teilen.');
            if (target.bot) return interaction.editReply('❌ Du kannst keine Rollen an Bots teilen.');

            const tier = getMembershipTierSafe(member, config.membershipRoleIds || {});
            const shareEligibleTiers = Array.isArray(config?.customRoleSharing?.eligibleTiers)
                ? config.customRoleSharing.eligibleTiers
                : ['gold', 'diamond'];

            const shareLimit = getCustomRoleShareLimitSafe(config, tier);
            const canShare = shareEligibleTiers.includes(tier) && shareLimit > 0;
            if (!canShare) return interaction.editReply('❌ Sharing ist nur für die erlaubten Tier-Rollen verfügbar (z.B. Gold/Diamond).');

            const before = getCustomRoleRecord(interaction.user.id) || db.getCustomRole(interaction.user.id);
            const beforeShared = Array.isArray(before?.sharedWith) ? Array.from(new Set(before.sharedWith)) : [];

            if (beforeShared.includes(target.id)) return interaction.editReply(`ℹ️ <@${target.id}> hat deine Custom-Rolle bereits.`);
            if (beforeShared.length >= shareLimit) return interaction.editReply(`❌ Du hast dein Sharing-Limit erreicht (${beforeShared.length}/${shareLimit}).`);

            const targetMember = await interaction.guild.members.fetch(target.id).catch(() => null);
            if (!targetMember) return interaction.editReply('❌ User nicht gefunden (evtl. nicht auf dem Server).');

            const addRes = addCustomRoleShare(interaction.user.id, target.id);
            if (!addRes.ok) {
                if (addRes.reason === 'ALREADY_SHARED') return interaction.editReply(`ℹ️ <@${target.id}> hat deine Custom-Rolle bereits.`);
                if (addRes.reason === 'NO_CUSTOM_ROLE') return interaction.editReply('❌ Du hast noch keine Custom-Rolle. Nutze zuerst `/customrole add`.');
                return interaction.editReply('❌ Konnte Sharing nicht speichern.');
            }

            try {
                await targetMember.roles.add(role, `Shared custom role from ${interaction.user.id}`);
            } catch (err) {
                removeCustomRoleShare(interaction.user.id, target.id);
                throw err;
            }

            const after = getCustomRoleRecord(interaction.user.id) || db.getCustomRole(interaction.user.id);
            const afterShared = Array.isArray(after?.sharedWith) ? Array.from(new Set(after.sharedWith)) : [];
            return interaction.editReply(`✅ Custom-Rolle <@&${role.id}> wurde mit <@${target.id}> geteilt. (${afterShared.length}/${shareLimit})`);
        }

        // -------------------------
        // /customrole remove-customrole
        // -------------------------
        if (sub === 'remove-customrole') {
            const target = interaction.options.getUser('user', true);

            const rec = getCustomRoleRecord(interaction.user.id) || db.getCustomRole(interaction.user.id);
            const sharedWith = Array.isArray(rec?.sharedWith) ? rec.sharedWith : [];

            if (!sharedWith.includes(target.id)) {
                return interaction.editReply(`ℹ️ <@${target.id}> hat deine Custom-Rolle nicht (oder ist nicht mehr geteilt).`);
            }

            const targetMember = await interaction.guild.members.fetch(target.id).catch(() => null);
            if (targetMember && targetMember.roles.cache.has(role.id)) {
                await targetMember.roles.remove(role, `Unshared custom role from ${interaction.user.id}`).catch(() => { });
            }

            removeCustomRoleShare(interaction.user.id, target.id);
            return interaction.editReply(`✅ Sharing entfernt: <@${target.id}> hat die Rolle <@&${role.id}> nicht mehr.`);
        }

        if (sub === 'add-channel') {
            const tier = getMembershipTierSafe(member, config.membershipRoleIds || {});
            if (tier !== 'diamond') {
                return interaction.editReply('❌ Nur Diamond Tier kann einen Premium-Channel erstellen.');
            }

            const res = await createPremiumChannel(interaction.guild, interaction.user);
            if (!res.ok) {
                if (res.reason === 'ALREADY_EXISTS') {
                    return interaction.editReply(`ℹ️ Du hast bereits einen Premium-Channel: <#${res.channelId}>`);
                }
                if (res.reason === 'NO_CATEGORY') {
                    return interaction.editReply('❌ Server-Konfiguration fehlt: premiumChannelCategoryId');
                }
                return interaction.editReply('❌ Konnte Premium-Channel nicht erstellen.');
            }

            return interaction.editReply(`✅ Premium-Voicechannel erstellt: <#${res.channel.id}>`);
        }

        return interaction.editReply('❌ Unbekannter Subcommand.');
    },
};
