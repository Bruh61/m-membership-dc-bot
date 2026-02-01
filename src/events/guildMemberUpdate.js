// src/events/guildMemberUpdate.js
const config = require('../../config.json');
const db = require('../utils/db');
const { getAllowedCustomRoleIds } = require('../utils/helpers');
const { deletePremiumChannel } = require('../utils/premiumChannels');

function toIdSet(member) {
    // oldMember kann “stale” sein – wir nehmen was da ist
    const ids = member?.roles?.cache ? [...member.roles.cache.keys()] : [];
    return new Set(ids);
}

module.exports = {
    name: 'guildMemberUpdate',

    async execute(oldMember, newMember) {
        try {
            // newMember fetchen => aktueller Zustand zuverlässig
            newMember = await newMember.fetch().catch(() => newMember);

            const logCh = newMember.guild.channels.cache.get(config.logChannelId);

            const oldSet = toIdSet(oldMember);
            const newSet = toIdSet(newMember);

            const removed = [...oldSet].filter(id => !newSet.has(id));

            // ----------------------------------------
            // (B) Diamond verloren -> Premium Voice löschen
            // ----------------------------------------
            const diamondId = config?.membershipRoleIds?.diamond;
            const removedDiamond = !!diamondId && removed.includes(diamondId);

            if (removedDiamond) {
                const res = await deletePremiumChannel(
                    newMember.guild,
                    newMember.id,
                    'Diamond removed -> delete premium voice channel'
                );

                if (logCh && logCh.isTextBased()) {
                    logCh.send(`🗑️ Premium-Voice gelöscht: <@${newMember.id}> (Diamond entfernt)`).catch(() => { });
                }

                console.log('[guildMemberUpdate] premiumVoice delete', { userId: newMember.id, deleted: res?.deleted });
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

            if (logCh && logCh.isTextBased()) {
                logCh.send(`🧹 Custom-Rolle entfernt: <@${newMember.id}> (Silver/Gold/Diamond komplett weg)`).catch(() => { });
            }
        } catch (e) {
            console.error('guildMemberUpdate error:', e);
        }
    },
};
