// src/events/guildMemberUpdate.js
const config = require('../../config.json');
const db = require('../utils/db');
const {
    getAllowedCustomRoleIds,
    getTierRoleId,
    isGiftedSilverEnabled,
    getGiftedSilverLogChannelId,
    getMembershipTier, // ✅ NEW
} = require('../utils/helpers');
const { deletePremiumChannel } = require('../utils/premiumChannels');

function toIdSet(member) {
    // oldMember kann “stale” sein – wir nehmen was da ist
    const ids = member?.roles?.cache ? [...member.roles.cache.keys()] : [];
    return new Set(ids);
}

function tierRank(tier) {
    const map = { bronze: 0, silver: 1, gold: 2, diamond: 3 };
    return map[tier] ?? 0;
}

function buildCommandsTextForTier(tier) {
    const lines = [];

    // Silver
    lines.push('**Ab Silver Tier:**');
    lines.push('• `/customrole add` — Erstellen deiner Customrolle');
    lines.push('• `/customrole rename` — Umbenennen deiner Customrolle');
    lines.push('• `/customrole change-color` — Farbe/Farbverlauf deiner Customrolle ändern');
    lines.push('• `/customrole my-membership` — Membership-Profil anzeigen');

    if (tierRank(tier) >= tierRank('gold')) {
        lines.push('');
        lines.push('**Ab Gold Tier:**');
        lines.push('• `/customrole give-customrole @User` — Teile deine Customrolle');
        lines.push('• `/customrole remove-customrole @User` — Entferne die geteilte Customrolle');
    }

    if (tierRank(tier) >= tierRank('diamond')) {
        lines.push('');
        lines.push('**Ab Diamond Tier:**');
        lines.push('• `/customrole give-silver-tier @User` — Verschenke Silver Tier (1 Credit) solange du Diamond bist');
        lines.push('• `/customrole remove-silver-tier @User` — Entziehe dein verschenktes Silver Tier (Credit frei)');
        lines.push('• `/customrole add-channel` — Erstelle deinen privaten Premium-Sprachkanal');
    }

    return lines.join('\n');
}

async function maybeSendMembershipCommandsDM(newMember, addedRoleIds, logCh) {
    const silverId = getTierRoleId(config, 'silver');
    const goldId = getTierRoleId(config, 'gold');
    const diamondId = getTierRoleId(config, 'diamond');

    const triggers = [silverId, goldId, diamondId].filter(Boolean);

    // Nur triggern wenn eine der drei Rollen neu dazu kam
    const triggerAdded = addedRoleIds.some(id => triggers.includes(id));
    if (!triggerAdded) return { sent: false, reason: 'NO_TRIGGER_ROLE_ADDED' };

    // aktuelles Tier bestimmen
    const tier = typeof getMembershipTier === 'function'
        ? getMembershipTier(newMember, config?.membershipRoleIds || {})
        : null;

    if (!tier || tierRank(tier) < tierRank('silver')) {
        return { sent: false, reason: 'TIER_NOT_ELIGIBLE' };
    }

    // Nur 1x pro "höchstem erreichten Tier"
    const prev = typeof db.getMembershipNoticeTier === 'function'
        ? db.getMembershipNoticeTier(newMember.id)
        : null;

    if (tierRank(tier) <= tierRank(prev)) {
        return { sent: false, reason: 'ALREADY_NOTIFIED', tier, prev };
    }

    const msg =
        `Hey ${newMember.user.username}! ✨\n` +
        `Du hast jetzt **${tier.toUpperCase()}** – hier sind deine zusätzlichen Commands:\n\n` +
        buildCommandsTextForTier(tier);

    try {
        await newMember.send({ content: msg });

        if (typeof db.setMembershipNoticeTier === 'function') {
            db.setMembershipNoticeTier(newMember.id, tier);
        }

        if (logCh && logCh.isTextBased()) {
            logCh.send(`📩 Membership-Commands per DM gesendet: <@${newMember.id}> (**${tier}**)`).catch(() => { });
        }

        return { sent: true, tier };
    } catch (e) {
        // DMs zu: trotzdem speichern -> kein Spam bei jedem Update
        if (typeof db.setMembershipNoticeTier === 'function') {
            db.setMembershipNoticeTier(newMember.id, tier);
        }

        if (logCh && logCh.isTextBased()) {
            logCh.send(`⚠️ Konnte DM nicht senden (DMs zu), aber gespeichert: <@${newMember.id}> (**${tier}**)`).catch(() => { });
        }

        return { sent: false, reason: 'DM_FAILED_BUT_RECORDED', tier };
    }
}

async function revokeGiftedSilverIfAny(guild, ownerId, reason, logCh) {
    const gift = db.getGiftedSilver(ownerId);
    if (!gift?.targetId) return { revoked: false };

    const silverRoleId = getTierRoleId(config, 'silver');
    const targetId = gift.targetId;

    // DB zuerst freigeben (damit wir nicht doppelt revoken, falls Role-Remove fehlschlägt)
    db.removeGiftedSilver(ownerId);

    if (!silverRoleId) {
        if (logCh && logCh.isTextBased()) {
            logCh.send(`⚠️ Gift-Silver konnte nicht entfernt werden: Silver RoleId fehlt in config. (Owner <@${ownerId}>, Target <@${targetId}>)`).catch(() => { });
        }
        return { revoked: true, roleRemoved: false };
    }

    const targetMember = await guild.members.fetch(targetId).catch(() => null);
    if (targetMember && targetMember.roles.cache.has(silverRoleId)) {
        await targetMember.roles.remove(silverRoleId, reason).catch(() => { });
    }

    if (logCh && logCh.isTextBased()) {
        logCh.send(`🎁❌ Gift-Silver revoked: <@${ownerId}> → <@${targetId}> (Diamond verloren)`).catch(() => { });
    }

    return { revoked: true, roleRemoved: !!targetMember };
}

module.exports = {
    name: 'guildMemberUpdate',

    async execute(oldMember, newMember) {
        try {
            // newMember fetchen => aktueller Zustand zuverlässig
            newMember = await newMember.fetch().catch(() => newMember);

            const oldSet = toIdSet(oldMember);
            const newSet = toIdSet(newMember);

            const removed = [...oldSet].filter(id => !newSet.has(id));
            const added = [...newSet].filter(id => !oldSet.has(id)); // ✅ NEW

            // Logging Channel (global + optional override fürs gifted feature)
            const globalLogCh = newMember.guild.channels.cache.get(config.logChannelId);
            const giftedLogId = getGiftedSilverLogChannelId(config);
            const giftedLogCh = giftedLogId
                ? newMember.guild.channels.cache.get(giftedLogId)
                : globalLogCh;

            // ✅ NEW: Membership Commands DM Trigger (Silver/Gold/Diamond)
            await maybeSendMembershipCommandsDM(newMember, added, globalLogCh);

            // ----------------------------------------
            // (B) Diamond verloren -> Premium Voice löschen
            // + Gift-Silver revoke (NEW)
            // ----------------------------------------
            const diamondId = getTierRoleId(config, 'diamond');
            const removedDiamond = !!diamondId && removed.includes(diamondId);

            if (removedDiamond) {
                // Premium Voice cleanup
                const res = await deletePremiumChannel(
                    newMember.guild,
                    newMember.id,
                    'Diamond removed -> delete premium voice channel'
                );

                if (globalLogCh && globalLogCh.isTextBased()) {
                    globalLogCh.send(`🗑️ Premium-Voice gelöscht: <@${newMember.id}> (Diamond entfernt)`).catch(() => { });
                }

                console.log('[guildMemberUpdate] premiumVoice delete', { userId: newMember.id, deleted: res?.deleted });

                // Gift-Silver revoke, wenn Feature aktiv
                if (isGiftedSilverEnabled(config)) {
                    const r = await revokeGiftedSilverIfAny(
                        newMember.guild,
                        newMember.id,
                        'Owner lost Diamond -> revoke gifted Silver',
                        giftedLogCh
                    );

                    console.log('[guildMemberUpdate] giftedSilver revoke', {
                        ownerId: newMember.id,
                        revoked: r?.revoked,
                        roleRemoved: r?.roleRemoved,
                    });
                }
            }

            // ----------------------------------------
            // (A) Custom role nur löschen, wenn silver/gold/diamond komplett weg
            // -> also: vorher hatte er min. eine davon, jetzt hat er keine mehr
            // ----------------------------------------
            const allowedObj = getAllowedCustomRoleIds(config); // {silver, gold, diamond} (bronze nicht)
            const allowedIds = Object.values(allowedObj || {}).filter(Boolean);

            const hadAnyAllowed = allowedIds.some(id => oldSet.has(id));
            const hasAnyAllowed = allowedIds.some(id => newSet.has(id));
            const removedAnyAllowed = removed.some(id => allowedIds.includes(id));

            console.log('[guildMemberUpdate] customRole check', {
                userId: newMember.id,
                removed,
                allowedIds,
                hadAnyAllowed,
                hasAnyAllowed,
                removedAnyAllowed,
            });

            // Nur reagieren wenn tatsächlich eine allowed-role entfernt wurde
            if (!removedAnyAllowed) return;

            // Nur löschen, wenn vorher allowed vorhanden war UND jetzt keine allowed mehr vorhanden ist
            if (!hadAnyAllowed || hasAnyAllowed) return;

            // ---- Cleanup Custom Role ----
            const record = db.getCustomRole(newMember.id);
            if (!record?.roleId) return;

            const sharedWith = Array.isArray(record.sharedWith) ? [...record.sharedWith] : [];
            const role = newMember.guild.roles.cache.get(record.roleId) || null;

            if (role && newMember.roles.cache.has(role.id)) {
                await newMember.roles.remove(role, 'Allowed membership removed -> revoke custom role').catch(() => { });
            }

            if (role && sharedWith.length) {
                for (const uid of sharedWith) {
                    const m = await newMember.guild.members.fetch(uid).catch(() => null);
                    if (m && m.roles.cache.has(role.id)) {
                        await m.roles.remove(role, `Owner lost membership -> revoke share (${newMember.id})`).catch(() => { });
                    }
                }
            }

            if (role && config.customRole?.deleteRoleOnRevoke) {
                await role.delete('Allowed membership removed -> delete custom role').catch(() => { });
            }

            db.clearCustomRoleShares(newMember.id);
            db.removeCustomRole(newMember.id);

            if (globalLogCh && globalLogCh.isTextBased()) {
                globalLogCh.send(`🧹 Custom-Rolle entfernt: <@${newMember.id}> (Silver/Gold/Diamond komplett weg)`).catch(() => { });
            }
        } catch (e) {
            console.error('guildMemberUpdate error:', e);
        }
    },
};
