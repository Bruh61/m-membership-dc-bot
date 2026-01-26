// src/utils/scheduler.js (ERGÄNZEN)
const config = require('../../config.json');
const db = require('./db');
const { getAllowedCustomRoleIds, hasAnyMembershipRole, sleep } = require('./helpers');

async function revokeInvalidCustomRoles(client) {
    const guild = await client.guilds.fetch(process.env.GUILD_ID);
    const g = await guild.fetch();

    const allowedIds = getAllowedCustomRoleIds(config);
    const items = db.listCustomRoles();

    for (const it of items) {
        const member = await g.members.fetch(it.userId).catch(() => null);
        const role = it.roleId ? g.roles.cache.get(it.roleId) : null;

        // Member weg -> cleanup
        if (!member) {
            if (role && config.customRole?.deleteRoleOnRevoke) {
                await role.delete('Custom role cleanup (member left)').catch(() => { });
            }
            db.removeCustomRole(it.userId);
            continue;
        }

        // allowed membership fehlt -> revoke
        const ok = hasAnyMembershipRole(member, allowedIds);
        if (!ok) {
            if (role && member.roles.cache.has(role.id)) {
                await member.roles.remove(role, 'Allowed membership missing -> revoke custom role').catch(() => { });
            }
            if (role && config.customRole?.deleteRoleOnRevoke) {
                await role.delete('Allowed membership missing -> delete custom role').catch(() => { });
            }
            db.removeCustomRole(it.userId);

            const ch = g.channels.cache.get(config.logChannelId);
            if (ch && ch.isTextBased()) {
                ch.send(`🧹 Custom-Rolle entfernt (Scheduler): <@${it.userId}>`).catch(() => { });
            }

            await sleep(200);
        }
    }
}

async function revokeExpiredRoles(client) {
    const guild = await client.guilds.fetch(process.env.GUILD_ID);
    const g = await guild.fetch();
    const entries = db.listAll(process.env.GUILD_ID);
    const now = Date.now();
    for (const e of entries) {
        if (new Date(e.expiresAt).getTime() <= now) {
            const member = await g.members.fetch(e.userId).catch(() => null);
            if (!member) { db.removeEntry(process.env.GUILD_ID, e.userId, e.roleId); continue; }
            const role = g.roles.cache.get(e.roleId);
            if (!role) { db.removeEntry(process.env.GUILD_ID, e.userId, e.roleId); continue; }
            if (member.roles.cache.has(e.roleId)) {
                await member.roles.remove(role, 'Temprolle abgelaufen').catch(() => { });
            }
            db.removeEntry(process.env.GUILD_ID, e.userId, e.roleId);
            const ch = g.channels.cache.get(config.logChannelId);
            if (ch && ch.isTextBased()) { ch.send(`⏳ Temprolle abgelaufen: <@${e.userId}> — **${role.name}**`); }
            await sleep(500);
        }
    }
}

async function sendFiveDayWarnings(client) {
    const guild = await client.guilds.fetch(process.env.GUILD_ID);
    const g = await guild.fetch();
    const ch = g.channels.cache.get(config.logChannelId);
    const entries = db.listAll(process.env.GUILD_ID);
    const now = Date.now();
    const threshold = config.warnThresholdDays * 86400000;
    for (const e of entries) {
        if (e.warned5d) continue;
        const remaining = new Date(e.expiresAt).getTime() - now;
        if (remaining <= threshold && remaining > 0) {
            if (ch && ch.isTextBased()) {
                const roleName = g.roles.cache.get(e.roleId)?.name || 'Unbekannte Rolle';
                ch.send(`⚠️ Hinweis: <@${e.userId}> hat für **${roleName}** nur noch <t:${Math.floor((now + remaining) / 1000)}:R> Restzeit.`);
            }
            db.markWarned(e.userId, e.roleId);
            await sleep(300);
        }
    }
}

module.exports = { revokeExpiredRoles, sendFiveDayWarnings, revokeInvalidCustomRoles };
