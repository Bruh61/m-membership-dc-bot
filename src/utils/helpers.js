// --- file: src/utils/helpers.js
const fs = require('fs');
const path = require('path');

const BACKUP_DIR = path.join(process.cwd(), 'backups');
const DATA_DIR = path.join(process.cwd(), 'data');

function ensureDirs() {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });
}

function toUnix(dateLike) { return Math.floor(new Date(dateLike).getTime() / 1000); }
function daysToMs(d) { return d * 24 * 60 * 60 * 1000; }
function sleep(ms) { return new Promise(res => setTimeout(res, ms)); }

function backup() {
    const src = path.join(DATA_DIR, 'temproles.json');
    const ts = new Date();
    const stamp = ts.toISOString().replace(/[-:]/g, '').split('.')[0];
    const dst = path.join(BACKUP_DIR, `temproles-${stamp}.json`);
    if (fs.existsSync(src)) fs.copyFileSync(src, dst);
    const files = fs.readdirSync(BACKUP_DIR).filter(f => f.startsWith('temproles-')).sort();
    const max = require('../../config.json').backupRetention || 20;
    while (files.length > max) {
        const f = files.shift();
        try { fs.unlinkSync(path.join(BACKUP_DIR, f)); } catch { }
    }
}

function backupAndSave() { backup(); }

function backupAndSaveFromRaw(raw) {
    backup();
    const file = path.join(DATA_DIR, 'temproles.json');
    const tmp = file + '.tmp';
    fs.writeFileSync(tmp, raw);
    fs.renameSync(tmp, file);
}

async function ensureManageable(guild, role, interaction) {
    const me = guild.members.me || await guild.members.fetchMe();
    if (!me.permissions.has('ManageRoles')) throw new Error('Bot benötigt ManageRoles.');
    if (me.roles.highest.comparePositionTo(role) <= 0) {
        await interaction.reply({ content: 'Ich kann diese Rolle nicht verwalten (Rollen-Hierarchie).', ephemeral: true });
        throw new Error('Role not manageable');
    }
}

function validateSchema(obj) {
    if (!obj || typeof obj !== 'object') return false;
    if (!obj.members || typeof obj.members !== 'object') return false;
    for (const [uid, list] of Object.entries(obj.members)) {
        if (!Array.isArray(list)) return false;
        for (const entry of list) {
            if (typeof entry.roleId !== 'string') return false;
            if (!entry.grantedAt || !entry.expiresAt) return false;
        }
    }
    return true;
}

module.exports = { ensureDirs, toUnix, daysToMs, backupAndSave, backupAndSaveFromRaw, ensureManageable, validateSchema, sleep };