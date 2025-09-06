// --- file: src/utils/db.js
const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(process.cwd(), 'data', 'temproles.json');

function _load() {
    if (!fs.existsSync(DB_PATH)) return { guildId: process.env.GUILD_ID, members: {} };
    const raw = fs.readFileSync(DB_PATH, 'utf8');
    try { return JSON.parse(raw); } catch { return { guildId: process.env.GUILD_ID, members: {} }; }
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
    addEntry(guildId, userId, roleId, grantedAt, expiresAt) {
        if (!cache.members[userId]) cache.members[userId] = [];
        cache.members[userId].push({ roleId, grantedAt, expiresAt, warned5d: false });
        save();
    },
    getUser(guildId, userId) { return cache.members[userId] || []; },
    getEntry(guildId, userId, roleId) {
        return (cache.members[userId] || []).find(e => e.roleId === roleId);
    },
    updateExpiry(guildId, userId, roleId, newExpiryISO, { resetWarn } = {}) {
        const arr = cache.members[userId] || [];
        const item = arr.find(e => e.roleId === roleId);
        if (!item) return false;
        item.expiresAt = newExpiryISO;
        if (resetWarn) item.warned5d = false;
        save();
        return true;
    },
    markWarned(userId, roleId) {
        const arr = cache.members[userId] || [];
        const item = arr.find(e => e.roleId === roleId);
        if (!item) return false;
        item.warned5d = true;
        save();
        return true;
    },
    removeEntry(guildId, userId, roleId) {
        const arr = cache.members[userId] || [];
        const idx = arr.findIndex(e => e.roleId === roleId);
        if (idx === -1) return false;
        arr.splice(idx, 1);
        if (arr.length === 0) delete cache.members[userId];
        save();
        return true;
    },
    listAll(guildId) {
        const out = [];
        for (const [userId, roles] of Object.entries(cache.members)) {
            for (const r of roles) out.push({ userId, ...r });
        }
        out.sort((a, b) => new Date(a.expiresAt) - new Date(b.expiresAt));
        return out;
    }
};