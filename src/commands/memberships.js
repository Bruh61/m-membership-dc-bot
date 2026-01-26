// src/commands/memberships.js
const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const config = require('../../config.json');

const FALLBACK_ROLE_IDS = {
    bronze: '1354721641921511444',
    silver: '1354723294636671226',
    gold: '1354723681959673917',
    diamond: '1354723814184976419',
};

function getRoleIds() {
    const fromConfig = config?.membershipRoleIds;
    if (fromConfig && typeof fromConfig === 'object') {
        return { ...FALLBACK_ROLE_IDS, ...fromConfig };
    }
    return FALLBACK_ROLE_IDS;
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('memberships')
        .setDescription('Zeigt die Membership-Rollen und ihre Vorteile'),
    async execute(interaction) {
        const r = getRoleIds();

        const roleLine = (id, fallbackName) => {
            const role = interaction.guild.roles.cache.get(id);
            const name = role?.name || fallbackName;
            return `<@&${id}> | ${name}`;
        };

        const embeds = [];

        embeds.push(
            new EmbedBuilder()
                .setTitle('❤️ Unterstützung & Hinweise')
                .setColor(0xED4245)
                .setDescription(
                    `**Vielen Dank für deine Unterstützung!** Deine Mitgliedschaft hilft dabei, unseren Discord-Server weiter zu verbessern und neue Features zu ermöglichen.

**Server-Regeln gelten für alle Mitglieder, unabhängig vom Abo-Modell:**
• Respektvolles Verhalten gegenüber anderen Mitgliedern.
• Keine Belästigungen, Hassrede oder toxisches Verhalten.
• Kein Spam oder Werben ohne Zustimmung.
• Einhaltung der Discord Community-Richtlinien.
• Verstöße gegen die Regeln können zum Verlust von Abonnement-Vorteilen führen.`
                )
        );

        embeds.push(
            new EmbedBuilder()
                .setTitle('🥉 Bronze Tier – Supporter')
                .setColor(0xCD7F32)
                .setDescription(
                    `${roleLine(r.bronze, 'Bronze Tier – Supporter')}

**Vorteile**
• Exklusiver Bronze-Supporter Rang
• Freischaltung des Discord Soundboard
• Unlimited Coaching-Anfragen
• Double EXP auf RLG
• Zugang zu VIP Text- & Voice-Channel (du kannst auch Nicht-Unterstützer reinziehen)
• Zugang zu Farbrollen`
                )
        );

        embeds.push(
            new EmbedBuilder()
                .setTitle('🥈 Silver Tier – Enthusiast')
                .setColor(0xC0C0C0)
                .setDescription(
                    `${roleLine(r.silver, 'Silver Tier – Enthusiast')}

**Vorteile**
• Exklusiver Silver-Support Rang
• Freischaltung des Discord Soundboard
• Unlimited Coaching-Anfragen
• Double EXP auf RLG
• Zugang zu VIP Text- & Voice-Channel (du kannst auch Nicht-Membershipper reinziehen)
• Zugang zu Farbrollen
• Custom Rolle nur für dich
• Eigene Rollenfarbe`
                )
        );

        embeds.push(
            new EmbedBuilder()
                .setTitle('🥇 Gold Tier – VIP Member')
                .setColor(0xFFD700)
                .setDescription(
                    `${roleLine(r.gold, 'Gold Tier – VIP Member')}

**Vorteile**
• Alle Vorteile aus dem Silver Tier
• Exklusiver Gold-Support Rang
• Teile deine Custom-Rolle mit bis zu **3** weiteren Nutzern
• Promotion für E-Sports-Clans, Orgas & Unternehmen ab Gold-Tier möglich`
                )
        );

        embeds.push(
            new EmbedBuilder()
                .setTitle('💎 Diamond Tier – Ultimate Supporter')
                .setColor(0x00FFFF)
                .setDescription(
                    `${roleLine(r.diamond, 'Diamond Tier – Ultimate Supporter')}

**Vorteile**
• Alle Vorteile aus dem Gold Tier
• Exklusiver Supreme-Sponsor Rang
• Quadruple EXP auf RLG
• **Schenke** einem deiner Freunde das **Silver Tier** (monatlich)
• Teile deine Custom-Rolle mit bis zu **4** weiteren Nutzern
• Deine Custom-Rolle kann mit einem Custom Rollenicon versehen werden
• Deine Custom-Rolle wird auf dem Server aufgelistet und priorisiert
• Du wirst in einer **Ehrenliste** auf dem Server angezeigt – mit Custom-Rolle und deinem Namen als Dank`
                )
        );

        await interaction.reply({ embeds, ephemeral: true });
    }
};
