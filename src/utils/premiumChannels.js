const { ChannelType, PermissionFlagsBits } = require('discord.js');
const config = require('../../config.json');
const db = require('./db');

function buildChannelName(user) {
    const base = (config.premiumChannelNamePrefix || 'premium-') + user.username;
    return base
        .toLowerCase()
        .replace(/[^a-z0-9-_]/g, '-')   // safe slug
        .replace(/-+/g, '-')
        .slice(0, 90);
}

async function createPremiumChannel(guild, user) {
    const existing = db.getPremiumChannel(user.id);
    if (existing?.channelId) return { ok: false, reason: 'ALREADY_EXISTS', channelId: existing.channelId };

    const categoryId = config.premiumChannelCategoryId;
    if (!categoryId) return { ok: false, reason: 'NO_CATEGORY' };

    // Voice-permission overwrites
    const overwrites = [
        // @everyone: darf NICHT sehen + NICHT connecten
        {
            id: guild.roles.everyone.id,
            deny: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect],
        },
        // owner: darf sehen + joinen + sprechen + channel verwalten
        {
            id: user.id,
            allow: [
                PermissionFlagsBits.ViewChannel,
                PermissionFlagsBits.Connect,
                PermissionFlagsBits.Speak,
                PermissionFlagsBits.Stream,
                PermissionFlagsBits.UseVAD,
                PermissionFlagsBits.MoveMembers,
                PermissionFlagsBits.MuteMembers,
                PermissionFlagsBits.DeafenMembers,
                PermissionFlagsBits.ManageChannels,
                PermissionFlagsBits.ManageRoles,
            ],
        },
    ];

    // optional: Admin role access
    if (config.adminRoleId) {
        overwrites.push({
            id: config.adminRoleId,
            allow: [
                PermissionFlagsBits.ViewChannel,
                PermissionFlagsBits.Connect,
                PermissionFlagsBits.Speak,
                PermissionFlagsBits.ManageChannels,
                PermissionFlagsBits.MoveMembers,
            ],
        });
    }

    const ch = await guild.channels.create({
        name: buildChannelName(user),
        type: ChannelType.GuildVoice,          // ✅ VOICE
        parent: categoryId,                    // ✅ in deiner Kategorie
        permissionOverwrites: overwrites,
        // optional nice defaults:
        userLimit: 0,                          // 0 = unlimited
        bitrate: Math.min(guild.maximumBitrate, 96000), // oder weglassen
        reason: `Premium voice channel created for ${user.tag} (${user.id})`,
    });

    db.setPremiumChannel(user.id, ch.id);
    return { ok: true, channel: ch };
}

async function deletePremiumChannel(guild, userId, reason) {
    const rec = db.getPremiumChannel(userId);
    if (!rec?.channelId) return { ok: true, deleted: false };

    const channel = await guild.channels.fetch(rec.channelId).catch(() => null);
    if (channel) {
        await channel.delete(reason || `Premium channel removed for ${userId}`).catch(() => { });
    }

    db.removePremiumChannel(userId);
    return { ok: true, deleted: !!channel };
}

module.exports = { createPremiumChannel, deletePremiumChannel };
