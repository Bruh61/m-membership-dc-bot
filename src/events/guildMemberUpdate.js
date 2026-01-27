// src/events/guildMemberUpdate.js
const config = require('../../config.json');
const db = require('../utils/db');
const { getAllowedCustomRoleIds, hasAnyMembershipRole } = require('../utils/helpers');

module.exports = {
    name: 'guildMemberUpdate',

    /**
     * @param {import('discord.js').GuildMember} oldMember
     * @param {import('discord.js').GuildMember} newMember
     */
    async execute(oldMember, newMember) {
        try {
            const allowedIds = getAllowedCustomRoleIds(config);

            const hadAllowed = hasAnyMembershipRole(oldMember, allowedIds);
            const hasAllowed = hasAnyMembershipRole(newMember, allowedIds);

            // Nur reagieren, wenn allowed membership verloren wurde
            if (!hadAllowed || hasAllowed) return;

            const record = db.getCustomRole(newMember.id);
            if (!record?.roleId) return;

            const sharedWith = Array.isArray(record.sharedWith) ? [...record.sharedWith] : [];
            const role = newMember.guild.roles.cache.get(record.roleId) || null;

            // 1) Rolle beim Owner entfernen (best effort)
            if (role && newMember.roles.cache.has(role.id)) {
                await newMember.roles
                    .remove(role, 'Allowed membership removed -> revoke custom role')
                    .catch(() => { });
            }

            // 2) Shares revoken (best effort)
            if (role && sharedWith.length) {
                for (const uid of sharedWith) {
                    const m = await newMember.guild.members.fetch(uid).catch(() => null);
                    if (m && m.roles.cache.has(role.id)) {
                        await m.roles
                            .remove(role, `Owner membership removed -> revoke shared custom role (${newMember.id})`)
                            .catch(() => { });
                    }
                }
            }

            // 3) Rolle löschen (optional)
            if (role && config.customRole?.deleteRoleOnRevoke) {
                await role.delete('Allowed membership removed -> delete custom role').catch(() => { });
            }

            // 4) DB cleanup
            db.clearCustomRoleShares(newMember.id);
            db.removeCustomRole(newMember.id);

            // 5) Log
            const ch = newMember.guild.channels.cache.get(config.logChannelId);
            if (ch && ch.isTextBased()) {
                ch.send(`🧹 Custom-Rolle entfernt: <@${newMember.id}> (Membership entfernt)`).catch(() => { });
            }
        } catch (e) {
            console.error('guildMemberUpdate revoke error:', e);
        }
    },
};
