// src/utils/db.js
const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(process.cwd(), 'data', 'temproles.json');

function _empty() {
    return { guildId: process.env.GUILD_ID, members: {}, customRoles: {} };
}

function _load() {
    if (!fs.existsSync(DB_PATH)) return _empty();
    const raw = fs.readFileSync(DB_PATH, 'utf8');
    try {
        const parsed = JSON.parse(raw);
        if (!parsed.customRoles) parsed.customRoles = {};
        if (!parsed.members) parsed.members = {};

        // Backward compatible: sharedWith + createdAt
        for (const v of Object.values(parsed.customRoles)) {
            if (v && typeof v === 'object') {
                if (!Array.isArray(v.sharedWith)) v.sharedWith = [];
                if (!v.createdAt) v.createdAt = new Date().toISOString();
            }
        }

        return parsed;
    } catch {
        return _empty();
    }
}

let cache = _load();

function save() {
    const tmp = DB_PATH + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(cache, null, 2));
    fs.renameSync(tmp, DB_PATH);
}

module.exports = {
    get data() { return cache; },
    replace(obj) { cache = obj; save(); },

    // ... (deine bestehenden Temp-Role Methoden bleiben unverändert)

    // --- Custom roles ---
    getCustomRole(userId) {
        return cache.customRoles[userId] || null;
    },

    setCustomRole(userId, roleId, createdAtISO) {
        const prev = cache.customRoles[userId];
        cache.customRoles[userId] = {
            roleId,
            createdAt: createdAtISO,
            sharedWith: Array.isArray(prev?.sharedWith) ? prev.sharedWith : [],
        };
        save();
    },

    // --- Sharing ---
    addCustomRoleShare(ownerId, targetUserId) {
        const rec = cache.customRoles[ownerId];
        if (!rec) return { ok: false, reason: 'NO_CUSTOM_ROLE' };
        if (!Array.isArray(rec.sharedWith)) rec.sharedWith = [];
        if (rec.sharedWith.includes(targetUserId)) return { ok: false, reason: 'ALREADY_SHARED' };
        rec.sharedWith.push(targetUserId);
        save();
        return { ok: true };
    },

    removeCustomRoleShare(ownerId, targetUserId) {
        const rec = cache.customRoles[ownerId];
        if (!rec) return { ok: false, reason: 'NO_CUSTOM_ROLE' };
        if (!Array.isArray(rec.sharedWith)) rec.sharedWith = [];
        const idx = rec.sharedWith.indexOf(targetUserId);
        if (idx === -1) return { ok: false, reason: 'NOT_SHARED' };
        rec.sharedWith.splice(idx, 1);
        save();
        return { ok: true };
    },

    clearCustomRoleShares(ownerId) {
        const rec = cache.customRoles[ownerId];
        if (!rec) return [];
        const prev = Array.isArray(rec.sharedWith) ? [...rec.sharedWith] : [];
        rec.sharedWith = [];
        save();
        return prev;
    },

    setCustomRoleSharedWith(ownerId, nextSharedWith) {
        const rec = cache.customRoles[ownerId];
        if (!rec) return false;
        rec.sharedWith = Array.isArray(nextSharedWith) ? [...nextSharedWith] : [];
        save();
        return true;
    },

    removeCustomRole(userId) {
        const existed = !!cache.customRoles[userId];
        delete cache.customRoles[userId];
        save();
        return existed;
    },

    listCustomRoles() {
        return Object.entries(cache.customRoles).map(([userId, v]) => ({
            userId,
            ...v,
            sharedWith: Array.isArray(v?.sharedWith) ? v.sharedWith : [],
        }));
    },
    // --- TempRole Warn-Flags ---
    markWarned(userId, roleId) {
        const list = cache.members?.[userId];
        if (!Array.isArray(list)) return false;

        const entry = list.find(r => r.roleId === roleId);
        if (!entry) return false;

        entry.warned5d = true;
        save();
        return true;
    },
    // --- Temp roles ---
    removeEntry(guildId, userId, roleId) {
        const list = cache.members?.[userId];
        if (!Array.isArray(list)) return false;

        const before = list.length;
        cache.members[userId] = list.filter(r => r.roleId !== roleId);

        if (cache.members[userId].length === 0) {
            delete cache.members[userId];
        }

        if (before !== cache.members[userId]?.length) {
            save();
            return true;
        }

        return false;
    },
};
