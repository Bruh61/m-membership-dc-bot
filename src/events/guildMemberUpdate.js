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

            // nur reagieren, wenn allowed membership verloren wurde
            if (!hadAllowed || hasAllowed) return;

            const record = db.getCustomRole(newMember.id);
            if (!record?.roleId) return;

            const role = newMember.guild.roles.cache.get(record.roleId) || null;

            // Rolle entfernen
            if (role && newMember.roles.cache.has(role.id)) {
                await newMember.roles.remove(role, 'Allowed membership removed -> revoke custom role').catch(() => { });
            }

            // Rolle löschen (bestcase)
            if (role && config.customRole?.deleteRoleOnRevoke) {
                await role.delete('Allowed membership removed -> delete custom role').catch(() => { });
            }

            db.removeCustomRole(newMember.id);

            const ch = newMember.guild.channels.cache.get(config.logChannelId);
            if (ch && ch.isTextBased()) {
                ch.send(`🧹 Custom-Rolle entfernt: <@${newMember.id}> (Membership entfernt)`).catch(() => { });
            }
        } catch (e) {
            console.error('guildMemberUpdate revoke error:', e);
        }
    },
};
