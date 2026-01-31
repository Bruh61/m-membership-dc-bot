// --- file: src/utils/helpers.js
const fs = require('fs');
const path = require('path');
const { PermissionFlagsBits } = require('discord.js');
const config = require('../../config.json');

const BACKUP_DIR = path.join(process.cwd(), 'backups');
const DATA_DIR = path.join(process.cwd(), 'data');

// Best practice: aus config ziehen, fallback wenn nicht vorhanden
const MAX_BACKUPS = Number.isFinite(config?.backupRetention)
    ? Math.max(1, config.backupRetention)
    : 3;

const DEFAULT_BANNED_WORDS = [
    'hurensohn', 'huso', 'wichser', 'fotze', 'f*otze', 'arschloch',
    'nazi', 'hitler', 'kys', 'verrecke', 'spast', 'spasti',
    'bastard', 'missgeburt', 'schlampe'
];

function normalizeForFilter(s) {
    return String(s || '')
        .toLowerCase()
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')       // accents
        .replace(/[^a-z0-9]/g, '');           // remove separators/specials
}

function containsBannedWord(name, extraBannedWords = []) {
    const clean = normalizeForFilter(name);
    const list = [...DEFAULT_BANNED_WORDS, ...extraBannedWords].map(normalizeForFilter);
    return list.some(w => w && clean.includes(w));
}

// Zusätzliche „Missbrauch“-Checks: mentions, links, zu viele Sonderzeichen
function validateRoleName(rawName, { min = 2, max = 50, bannedWords = [] } = {}) {
    const name = String(rawName || '').trim();

    if (name.length < min || name.length > max) {
        return { ok: false, reason: `Name muss ${min}–${max} Zeichen lang sein.` };
    }

    const lower = name.toLowerCase();

    if (lower.includes('@everyone') || lower.includes('@here')) {
        return { ok: false, reason: 'Name darf keine Mass-Mentions enthalten (@everyone/@here).' };
    }

    // simple link detection
    if (/(https?:\/\/|www\.)/i.test(name)) {
        return { ok: false, reason: 'Name darf keine Links enthalten.' };
    }

    // optional: nur bestimmte Zeichen erlauben (lockerer Ansatz)
    // erlaubt Buchstaben/Zahlen/Leerzeichen sowie ._-•| und ein paar Emoji
    if (!/^[\p{L}\p{N}\p{Zs}._\-•|#&()]+$/u.test(name)) {
        return { ok: false, reason: 'Name enthält unzulässige Zeichen.' };
    }

    if (containsBannedWord(name, bannedWords)) {
        return { ok: false, reason: 'Name enthält unzulässige/beleidigende Begriffe.' };
    }

    return { ok: true, name };
}

function ensureDirs() {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });
}

function toUnix(dateLike) { return Math.floor(new Date(dateLike).getTime() / 1000); }
function daysToMs(d) { return d * 24 * 60 * 60 * 1000; }
function sleep(ms) { return new Promise(res => setTimeout(res, ms)); }

function backup() {
    ensureDirs();

    const src = path.join(DATA_DIR, 'temproles.json');
    if (!fs.existsSync(src)) return;

    // neues Backup anlegen
    const ts = new Date();
    const stamp = ts.toISOString().replace(/[-:]/g, '').split('.')[0]; // YYYYMMDDTHHMMSS
    const dst = path.join(BACKUP_DIR, `temproles-${stamp}.json`);
    fs.copyFileSync(src, dst);

    // nur temproles-*.json zählen und nach Name sortieren (älteste zuerst)
    const files = fs.readdirSync(BACKUP_DIR)
        .filter(f => f.startsWith('temproles-') && f.endsWith('.json'))
        .sort();

    // auf MAX_BACKUPS heruntertrimmen (älteste löschen)
    while (files.length > MAX_BACKUPS) {
        const f = files.shift();
        try { fs.unlinkSync(path.join(BACKUP_DIR, f)); } catch { /* ignore */ }
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

/**
 * Prüft ob der Bot die Rolle verwalten kann (ManageRoles + Hierarchie).
 */
async function ensureManageable(guild, role, interaction) {
    const me = guild.members.me || await guild.members.fetchMe();

    if (!me.permissions.has(PermissionFlagsBits.ManageRoles)) {
        throw new Error('Bot benötigt ManageRoles.');
    }

    if (me.roles.highest.comparePositionTo(role) <= 0) {
        if (interaction?.reply) {
            await interaction.reply({
                content: 'Ich kann diese Rolle nicht verwalten (Rollen-Hierarchie).',
                ephemeral: true
            }).catch(() => { });
        }
        throw new Error('Role not manageable');
    }
}

/**
 * Prüft ob ein Member irgendeine Rolle aus roleIds besitzt.
 * roleIds Format: { key: "roleId", ... }
 */
function hasAnyMembershipRole(member, roleIds) {
    if (!member?.roles?.cache || !roleIds || typeof roleIds !== 'object') return false;
    const ids = Object.values(roleIds).filter(Boolean);
    return ids.some(id => member.roles.cache.has(id));
}

/**
 * Wählt nur bestimmte Tiers aus einem membershipRoleIds-Objekt
 * Beispiel: pickRoleIdsByTier(allIds, ['silver','gold','diamond'])
 */
function pickRoleIdsByTier(allRoleIds, allowedTiers) {
    const out = {};
    for (const tier of allowedTiers || []) {
        const id = allRoleIds?.[tier];
        if (id) out[tier] = id;
    }
    return out;
}

/**
 * Liefert exakt die erlaubten Role-IDs für Custom-Roles, basierend auf config:
 * - config.membershipRoleIds (enthält auch bronze)
 * - config.customRoleAllowedTiers (z.B. ['silver','gold','diamond'])
 */
function getAllowedCustomRoleIds(cfg) {
    const allowedTiers = Array.isArray(cfg?.customRoleAllowedTiers)
        ? cfg.customRoleAllowedTiers
        : ['silver', 'gold', 'diamond'];

    return pickRoleIdsByTier(cfg?.membershipRoleIds || {}, allowedTiers);
}

function getAllowedCustomRoleIdsLocal(cfg) {
    // Erwartet: cfg.customRole.allowedMembershipRoleIds (Array)
    // Fallback: cfg.membershipRoleIds (Object mit tier->roleId)
    const a = cfg?.customRole?.allowedMembershipRoleIds;
    if (Array.isArray(a) && a.length) return a.filter(Boolean);

    const idsObj = cfg?.membershipRoleIds || {};
    return Object.values(idsObj).filter(Boolean);
}

/**
 * Validiert #RRGGBB oder RRGGBB
 */
function isValidHexColor(input) {
    if (typeof input !== 'string') return false;
    return /^#?[0-9A-Fa-f]{6}$/.test(input.trim());
}

/**
 * Normalisiert zu #RRGGBB
 */
function normalizeHexColor(input) {
    const v = String(input).trim();
    return v.startsWith('#') ? v : `#${v}`;
}

/**
 * Platziert eine Rolle direkt unter der Anchor-Rolle (also niedrigere Position).
 */
async function placeRoleBelowAnchor(guild, role, anchorRoleId) {
    if (!anchorRoleId) throw new Error('anchorRoleId fehlt.');
    const anchor = await guild.roles.fetch(anchorRoleId).catch(() => null);
    if (!anchor) throw new Error('Anchor-Rolle nicht gefunden.');

    const me = guild.members.me || await guild.members.fetchMe();

    // Ziel: 1 unter Anchor, aber NIEMALS über dem Bot
    const desired = Math.max(1, anchor.position - 1);
    const maxAllowed = Math.max(1, me.roles.highest.position - 1);
    const targetPos = Math.min(desired, maxAllowed);

    await role.setPosition(targetPos, { reason: 'Place custom role below anchor (clamped)' });
}

/**
 * Schema-Check für temproles.json (backward compatible: customRoles optional)
 */
function validateSchema(obj) {
    if (!obj || typeof obj !== 'object') return false;
    if (!obj.members || typeof obj.members !== 'object') return false;

    for (const [uid, list] of Object.entries(obj.members)) {
        if (typeof uid !== 'string') return false;
        if (!Array.isArray(list)) return false;

        for (const entry of list) {
            if (!entry || typeof entry !== 'object') return false;
            if (typeof entry.roleId !== 'string') return false;
            if (!entry.grantedAt || !entry.expiresAt) return false;
        }
    }

    if (obj.customRoles && typeof obj.customRoles !== 'object') return false;
    return true;
}
function getMembershipTier(member, roleIds) {
    if (!member?.roles?.cache || !roleIds || typeof roleIds !== 'object') return null;
    const order = ['diamond', 'gold', 'silver', 'bronze'];
    for (const t of order) {
        const id = roleIds?.[t];
        if (id && member.roles.cache.has(id)) return t;
    }
    return null;
}

function getCustomRoleShareLimit(cfg, tier) {
    const map = cfg?.customRoleSharing?.maxSharesByTier;
    const n = map?.[tier];
    const limit = Number.isFinite(n) ? n : 0;
    return Math.max(0, limit);
}


module.exports = {
    ensureDirs,
    toUnix,
    daysToMs,
    backupAndSave,
    backupAndSaveFromRaw,
    ensureManageable,
    validateSchema,
    sleep,

    hasAnyMembershipRole,
    pickRoleIdsByTier,
    getAllowedCustomRoleIds,

    isValidHexColor,
    normalizeHexColor,
    placeRoleBelowAnchor,

    containsBannedWord,
    validateRoleName,

    getMembershipTier,
    getCustomRoleShareLimit,
    getAllowedCustomRoleIdsLocal,
};
