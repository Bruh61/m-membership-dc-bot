// src/utils/scheduler.js
const config = require('../../config.json');
const db = require('./db');
const {
    getAllowedCustomRoleIds,
    hasAnyMembershipRole,
    getMembershipTier,
    getCustomRoleShareLimit,
    sleep,
    // NEW
    getTierRoleId,
    isGiftedSilverEnabled,
    getGiftedSilverLogChannelId,
    getGiftedSilverConfig,
} = require('./helpers');

/**
 * Robust: nutzt db.listAll falls vorhanden, sonst liest direkt aus db.data.members
 * Erwartetes Schema:
 * db.data.members = { [userId]: [ { roleId, expiresAt, warned5d? }, ... ] }
 */
function listTempEntriesFallback(guildId) {
    if (typeof db.listAll === 'function') return db.listAll(guildId);

    const members = db?.data?.members || {};
    const out = [];
    for (const [userId, roles] of Object.entries(members)) {
        if (!Array.isArray(roles)) continue;
        for (const r of roles) {
            if (!r || typeof r !== 'object') continue;
            out.push({ userId, ...r });
        }
    }
    out.sort((a, b) => new Date(a.expiresAt) - new Date(b.expiresAt));
    return out;
}

/**
 * NEW: Gifted Silver cleanup (Diamond credit system)
 * - Owner lost Diamond -> revoke gifted silver
 * - Owner left -> cleanup + revoke best effort
 * - Target left -> cleanup
 * - Optionally re-add Silver if gift exists but role missing
 */
async function revokeInvalidGiftedSilver(client) {
    if (!isGiftedSilverEnabled(config)) return;

    const guild = await client.guilds.fetch(process.env.GUILD_ID);
    const g = await guild.fetch();

    const cfg = getGiftedSilverConfig(config);
    const eligibleTier = cfg.eligibleTier || 'diamond';

    const diamondRoleId = getTierRoleId(config, eligibleTier);
    const silverRoleId = getTierRoleId(config, 'silver');

    // Wenn IDs fehlen, können wir nichts sauber enforce'n
    if (!diamondRoleId || !silverRoleId) return;

    const logId = getGiftedSilverLogChannelId(config);
    const logCh = logId ? g.channels.cache.get(logId) : g.channels.cache.get(config.logChannelId);

    const items = typeof db.listGiftedSilver === 'function' ? db.listGiftedSilver() : [];

    for (const it of items) {
        const ownerId = it?.ownerId;
        const targetId = it?.targetId;
        if (!ownerId || !targetId) continue;

        const owner = await g.members.fetch(ownerId).catch(() => null);
        const target = await g.members.fetch(targetId).catch(() => null);

        // Target weg -> cleanup
        if (!target) {
            db.removeGiftedSilver(ownerId);
            if (logCh && logCh.isTextBased()) {
                logCh.send(`🎁🧹 Gift-Silver DB bereinigt: Target weg (Owner <@${ownerId}>, Target <@${targetId}>)`).catch(() => { });
            }
            await sleep(120);
            continue;
        }

        // Owner weg -> best effort revoke + cleanup
        if (!owner) {
            if (target.roles.cache.has(silverRoleId)) {
                await target.roles.remove(silverRoleId, 'Gifted Silver cleanup: owner left').catch(() => { });
            }
            db.removeGiftedSilver(ownerId);

            if (logCh && logCh.isTextBased()) {
                logCh.send(`🎁❌ Gift-Silver revoked: Owner weg (Owner ${ownerId}, Target <@${targetId}>)`).catch(() => { });
            }
            await sleep(160);
            continue;
        }

        // Owner hat kein Diamond mehr -> revoke + cleanup
        const ownerHasEligible = owner.roles.cache.has(diamondRoleId);
        if (!ownerHasEligible) {
            if (target.roles.cache.has(silverRoleId)) {
                await target.roles.remove(silverRoleId, 'Gifted Silver revoked: owner lost Diamond').catch(() => { });
            }
            db.removeGiftedSilver(ownerId);

            if (logCh && logCh.isTextBased()) {
                logCh.send(`🎁❌ Gift-Silver revoked (Scheduler): <@${ownerId}> → <@${targetId}> (Owner ohne ${eligibleTier})`).catch(() => { });
            }
            await sleep(160);
            continue;
        }

        // Gift ist aktiv -> ensure Target hat Silver (stabilisieren)
        if (!target.roles.cache.has(silverRoleId)) {
            await target.roles.add(silverRoleId, `Gifted Silver active (Owner ${ownerId})`).catch(() => { });
            if (logCh && logCh.isTextBased()) {
                logCh.send(`🎁✅ Gift-Silver re-applied (Scheduler): <@${ownerId}> → <@${targetId}>`).catch(() => { });
            }
            await sleep(140);
            continue;
        }

        await sleep(80);
    }
}

/**
 * Entfernt CustomRoles, wenn Membership weg ist + enforced Sharing-Regeln.
 * - Owner left -> cleanup + revoke shares + optional role delete
 * - Allowed membership missing -> revoke owner + shares + optional role delete + db cleanup
 * - Sharing enforcement:
 *    - ungültige targets entfernen (user left)
 *    - wenn Tier nicht share-berechtigt -> alle shares revoken
 *    - wenn shares > limit -> extras revoken
 */
async function revokeInvalidCustomRoles(client) {
    const guild = await client.guilds.fetch(process.env.GUILD_ID);
    const g = await guild.fetch();

    const allowedIds = getAllowedCustomRoleIds(config);
    const items = db.listCustomRoles();

    const shareEligibleTiers = Array.isArray(config?.customRoleSharing?.eligibleTiers)
        ? config.customRoleSharing.eligibleTiers
        : ['gold', 'diamond'];

    for (const it of items) {
        const member = await g.members.fetch(it.userId).catch(() => null);
        const role = it.roleId ? g.roles.cache.get(it.roleId) : null;

        const sharedWithRaw = Array.isArray(it.sharedWith) ? it.sharedWith : [];
        const sharedWith = Array.from(new Set(sharedWithRaw)).filter(Boolean);

        // Member weg -> cleanup (best effort)
        if (!member) {
            if (role && sharedWith.length) {
                for (const uid of sharedWith) {
                    const m = await g.members.fetch(uid).catch(() => null);
                    if (m && m.roles.cache.has(role.id)) {
                        await m.roles
                            .remove(role, `Owner left -> revoke shared custom role (${it.userId})`)
                            .catch(() => { });
                    }
                    await sleep(80);
                }
            }

            // optional role delete
            if (role && config.customRole?.deleteRoleOnRevoke) {
                await role.delete('Custom role cleanup (member left)').catch(() => { });
            }

            db.clearCustomRoleShares(it.userId);
            db.removeCustomRole(it.userId);
            await sleep(150);
            continue;
        }

        // Allowed membership fehlt -> revoke owner + shares + cleanup
        const ok = hasAnyMembershipRole(member, allowedIds);
        if (!ok) {
            if (role && sharedWith.length) {
                for (const uid of sharedWith) {
                    const m = await g.members.fetch(uid).catch(() => null);
                    if (m && m.roles.cache.has(role.id)) {
                        await m.roles
                            .remove(role, `Owner membership missing -> revoke shared custom role (${it.userId})`)
                            .catch(() => { });
                    }
                    await sleep(80);
                }
            }

            if (role && member.roles.cache.has(role.id)) {
                await member.roles.remove(role, 'Allowed membership missing -> revoke custom role').catch(() => { });
            }

            if (role && config.customRole?.deleteRoleOnRevoke) {
                await role.delete('Allowed membership missing -> delete custom role').catch(() => { });
            }

            db.clearCustomRoleShares(it.userId);
            db.removeCustomRole(it.userId);

            const ch = g.channels.cache.get(config.logChannelId);
            if (ch && ch.isTextBased()) {
                ch.send(`🧹 Custom-Rolle entfernt (Scheduler): <@${it.userId}>`).catch(() => { });
            }

            await sleep(200);
            continue;
        }

        // --- Sharing enforcement ---

        // 1) targets bereinigen (user left)
        const validShared = [];
        for (const uid of sharedWith) {
            const m = await g.members.fetch(uid).catch(() => null);
            if (!m) continue;
            validShared.push(uid);
        }

        // 2) Tier + Limit bestimmen
        const tier = getMembershipTier(member, config.membershipRoleIds || {});
        const shareLimit = getCustomRoleShareLimit(config, tier);
        const canShare = shareEligibleTiers.includes(tier) && shareLimit > 0;

        // Wenn keine role existiert, DB trotzdem bereinigen (shares sind sonst “tote” Einträge)
        if (!role) {
            if (validShared.length !== sharedWith.length) db.setCustomRoleSharedWith(it.userId, validShared);
            await sleep(100);
            continue;
        }

        // 3) Wenn Sharing nicht erlaubt -> alles entfernen
        if (!canShare && validShared.length) {
            for (const uid of validShared) {
                const m = await g.members.fetch(uid).catch(() => null);
                if (m && m.roles.cache.has(role.id)) {
                    await m.roles
                        .remove(role, `Sharing not allowed for tier ${tier ?? 'unknown'} -> revoke`)
                        .catch(() => { });
                }
                await sleep(80);
            }
            db.setCustomRoleSharedWith(it.userId, []);
            await sleep(150);
            continue;
        }

        // 4) Wenn über Limit -> extras entfernen
        if (canShare && validShared.length > shareLimit) {
            const keep = validShared.slice(0, shareLimit);
            const remove = validShared.slice(shareLimit);

            for (const uid of remove) {
                const m = await g.members.fetch(uid).catch(() => null);
                if (m && m.roles.cache.has(role.id)) {
                    await m.roles.remove(role, `Share limit reduced (${shareLimit}) -> revoke`).catch(() => { });
                }
                await sleep(80);
            }

            db.setCustomRoleSharedWith(it.userId, keep);
            await sleep(120);
            continue;
        }

        // 5) Falls nur Bereinigung nötig (z.B. duplicates/left users)
        if (validShared.length !== sharedWith.length) {
            db.setCustomRoleSharedWith(it.userId, validShared);
        }

        await sleep(80);
    }
}

/**
 * Entfernt abgelaufene Temp-Rollen
 */
async function revokeExpiredRoles(client) {
    const guild = await client.guilds.fetch(process.env.GUILD_ID);
    const g = await guild.fetch();

    const entries = listTempEntriesFallback(process.env.GUILD_ID);
    const now = Date.now();

    for (const e of entries) {
        if (!e?.expiresAt || !e?.roleId || !e?.userId) continue;

        if (new Date(e.expiresAt).getTime() <= now) {
            const member = await g.members.fetch(e.userId).catch(() => null);
            if (!member) {
                // remove from DB even if member missing
                if (typeof db.removeEntry === 'function') {
                    db.removeEntry(process.env.GUILD_ID, e.userId, e.roleId);
                }
                continue;
            }

            const role = g.roles.cache.get(e.roleId);
            if (!role) {
                if (typeof db.removeEntry === 'function') {
                    db.removeEntry(process.env.GUILD_ID, e.userId, e.roleId);
                }
                continue;
            }

            if (member.roles.cache.has(e.roleId)) {
                await member.roles.remove(role, 'Temprolle abgelaufen').catch(() => { });
            }

            if (typeof db.removeEntry === 'function') {
                db.removeEntry(process.env.GUILD_ID, e.userId, e.roleId);
            }

            const ch = g.channels.cache.get(config.logChannelId);
            if (ch && ch.isTextBased()) {
                ch.send(`⏳ Temprolle abgelaufen: <@${e.userId}> — **${role.name}**`).catch(() => { });
            }

            await sleep(250);
        }
    }
}

/**
 * 5-Tage Warnung
 */
async function sendFiveDayWarnings(client) {
    const guild = await client.guilds.fetch(process.env.GUILD_ID);
    const g = await guild.fetch();
    const ch = g.channels.cache.get(config.logChannelId);

    const entries = listTempEntriesFallback(process.env.GUILD_ID);
    const now = Date.now();
    const threshold = (config.warnThresholdDays || 5) * 86400000;

    for (const e of entries) {
        if (!e?.expiresAt || !e?.roleId || !e?.userId) continue;
        if (e.warned5d) continue;

        const remaining = new Date(e.expiresAt).getTime() - now;
        if (remaining <= threshold && remaining > 0) {
            if (ch && ch.isTextBased()) {
                const roleName = g.roles.cache.get(e.roleId)?.name || 'Unbekannte Rolle';
                ch
                    .send(
                        `⚠️ Hinweis: <@${e.userId}> hat für **${roleName}** nur noch <t:${Math.floor(
                            (now + remaining) / 1000
                        )}:R> Restzeit.`
                    )
                    .catch(() => { });
            }

            if (typeof db.markWarned === 'function') {
                db.markWarned(e.userId, e.roleId);
            }

            await sleep(200);
        }
    }
}

module.exports = {
    revokeExpiredRoles,
    sendFiveDayWarnings,
    revokeInvalidCustomRoles,
    // NEW export
    revokeInvalidGiftedSilver,
};
