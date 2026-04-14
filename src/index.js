require('dotenv').config();
const fs = require('fs');
const path = require('path');
const {
  AuditLogEvent,
  ChannelType,
  Client,
  GatewayIntentBits,
  OverwriteType,
  Partials,
  PermissionFlagsBits,
  SlashCommandBuilder,
} = require('discord.js');

const TOKEN = process.env.DISCORD_TOKEN;

if (!TOKEN) {
  console.error('❌ لم يتم العثور على DISCORD_TOKEN في ملف .env');
  process.exit(1);
}

const DATA_DIR = path.join(__dirname, '..', 'data');
const GUILDS_FILE = path.join(DATA_DIR, 'guilds.json');
const WARNINGS_FILE = path.join(DATA_DIR, 'warnings.json');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(GUILDS_FILE)) fs.writeFileSync(GUILDS_FILE, '{}', 'utf8');
if (!fs.existsSync(WARNINGS_FILE)) fs.writeFileSync(WARNINGS_FILE, '{}', 'utf8');

const antiSpamMap = new Map();
const antiNukeTracker = new Map();
const antiRaidTracker = new Map();

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildModeration,
  ],
  partials: [Partials.Channel],
});

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return {};
  }
}

function writeJson(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
}

function defaultGuildSettings() {
  return {
    enabled: true,
    antiSpam: true,
    antiLinks: true,
    antiMentions: true,
    antiNuke: true,
    antiRaid: true,
    logChannelId: null,
    securityChannelId: null,
    trustedRoleIds: [],
    trustedUserIds: [],
    spamLimit: 6,
    spamWindowMs: 8000,
    spamTimeoutMinutes: 10,
    warningMuteAt: 3,
    warningBanAt: 5,
    maxMentionsPerMessage: 4,
    joinRaidLimit: 6,
    joinRaidWindowMs: 20000,
    language: 'ar',
  };
}

function t(settings, key, params = {}) {
  const ar = {
    protectionEnabled: '✅ تم تفعيل الحماية.',
    protectionDisabled: '❌ تم تعطيل الحماية.',
    antiLinksEnabled: '✅ تم تفعيل منع الروابط.',
    antiLinksDisabled: '❌ تم تعطيل منع الروابط.',
    antiSpamEnabled: '✅ تم تفعيل مكافحة السبام.',
    antiSpamDisabled: '❌ تم تعطيل مكافحة السبام.',
    antiRaidEnabled: '✅ تم تفعيل مكافحة المداهمات.',
    antiRaidDisabled: '❌ تم تعطيل مكافحة المداهمات.',
    setupDone: '✅ تم إنشاء قنوات الأمان واللوق تلقائيًا.',
    linksBlocked: `❌ ${params.member || ''} الروابط ممنوعة في هذا السيرفر.`,
    noPerm: '❌ هذا الأمر للإدارة فقط.',
    done: '✅ تم التنفيذ.',
    badLang: '❌ استخدم ar أو en.',
  };

  const en = {
    protectionEnabled: '✅ Protection enabled.',
    protectionDisabled: '❌ Protection disabled.',
    antiLinksEnabled: '✅ Anti-links enabled.',
    antiLinksDisabled: '❌ Anti-links disabled.',
    antiSpamEnabled: '✅ Anti-spam enabled.',
    antiSpamDisabled: '❌ Anti-spam disabled.',
    antiRaidEnabled: '✅ Anti-raid enabled.',
    antiRaidDisabled: '❌ Anti-raid disabled.',
    setupDone: '✅ Security and log channels were auto-created.',
    linksBlocked: `❌ ${params.member || ''} Links are blocked in this server.`,
    noPerm: '❌ This command is for admins only.',
    done: '✅ Done.',
    badLang: '❌ Use ar or en.',
  };

  const table = settings.language === 'en' ? en : ar;
  return table[key] || ar[key] || key;
}

function getGuildSettings(guildId) {
  const all = readJson(GUILDS_FILE);
  if (!all[guildId]) {
    all[guildId] = defaultGuildSettings();
    writeJson(GUILDS_FILE, all);
  }
  return all[guildId];
}

function updateGuildSettings(guildId, patch) {
  const all = readJson(GUILDS_FILE);
  const current = all[guildId] || defaultGuildSettings();
  all[guildId] = { ...current, ...patch };
  writeJson(GUILDS_FILE, all);
  return all[guildId];
}

function updateGuildList(guildId, field, value, mode = 'add') {
  const all = readJson(GUILDS_FILE);
  const current = all[guildId] || defaultGuildSettings();
  const list = new Set(current[field] || []);
  if (mode === 'add') list.add(value);
  if (mode === 'remove') list.delete(value);
  current[field] = [...list];
  all[guildId] = current;
  writeJson(GUILDS_FILE, all);
  return current;
}

function getWarnings(guildId, userId) {
  const all = readJson(WARNINGS_FILE);
  return all[guildId]?.[userId] || 0;
}

function setWarnings(guildId, userId, amount) {
  const all = readJson(WARNINGS_FILE);
  if (!all[guildId]) all[guildId] = {};
  all[guildId][userId] = amount;
  writeJson(WARNINGS_FILE, all);
}

function incrementWarnings(guildId, userId) {
  const current = getWarnings(guildId, userId);
  const next = current + 1;
  setWarnings(guildId, userId, next);
  return next;
}

function resetWarnings(guildId, userId) {
  const all = readJson(WARNINGS_FILE);
  if (!all[guildId]) return;
  all[guildId][userId] = 0;
  writeJson(WARNINGS_FILE, all);
}

function hasTrustedRole(member, settings) {
  return member.roles.cache.some((role) => settings.trustedRoleIds.includes(role.id));
}

function isProtected(member, settings) {
  if (!member) return true;
  if (member.id === member.guild.ownerId) return true;
  if (member.permissions.has(PermissionFlagsBits.Administrator)) return true;
  if (hasTrustedRole(member, settings)) return true;
  if (settings.trustedUserIds.includes(member.id)) return true;
  return false;
}

async function sendLog(guild, content) {
  const settings = getGuildSettings(guild.id);
  if (!settings.logChannelId) return;
  const channel = guild.channels.cache.get(settings.logChannelId);
  if (!channel?.isTextBased()) return;
  await channel.send(content).catch(() => null);
}

async function applyWarning(guild, member, reason) {
  const settings = getGuildSettings(guild.id);
  const warns = incrementWarnings(guild.id, member.id);

  await sendLog(
    guild,
    `⚠️ مخالفة جديدة على ${member} | السبب: ${reason} | التحذيرات: ${warns}`,
  );

  if (warns >= settings.warningBanAt) {
    await member.ban({ reason: `Falcon Guard: تجاوز ${settings.warningBanAt} تحذيرات` }).catch(() => null);
    await sendLog(guild, `⛔ تم حظر ${member.user.tag} بعد وصوله ${warns} تحذيرات.`);
    return 'ban';
  }

  if (warns >= settings.warningMuteAt) {
    const ms = settings.spamTimeoutMinutes * 60 * 1000;
    await member.timeout(ms, `Falcon Guard: ${warns} تحذيرات`).catch(() => null);
    await sendLog(guild, `🔇 تم كتم ${member.user.tag} لمدة ${settings.spamTimeoutMinutes} دقائق.`);
    return 'mute';
  }

  return 'warn';
}

async function punishNukeExecutor(guild, executorId, reason) {
  const settings = getGuildSettings(guild.id);
  const executor = await guild.members.fetch(executorId).catch(() => null);
  if (!executor || isProtected(executor, settings)) return;

  await executor.roles.set([]).catch(() => null);
  await executor.timeout(24 * 60 * 60 * 1000, `Falcon Guard Anti-Nuke: ${reason}`).catch(() => null);
  await sendLog(guild, `🚨 Anti-Nuke: تم تحييد ${executor.user.tag} | السبب: ${reason}`);
}

async function trackNuke(guild, executorId, action, limit = 3, windowMs = 15000) {
  const key = `${guild.id}:${executorId}:${action}`;
  const now = Date.now();
  const state = antiNukeTracker.get(key) || { count: 0, first: now };

  if (now - state.first > windowMs) {
    state.count = 0;
    state.first = now;
  }

  state.count += 1;
  antiNukeTracker.set(key, state);

  if (state.count >= limit) {
    await punishNukeExecutor(guild, executorId, `${action} x${state.count}`);
    antiNukeTracker.delete(key);
  }
}

async function ensureSecurityChannels(guild) {
  const settings = getGuildSettings(guild.id);
  let logChannel = settings.logChannelId ? guild.channels.cache.get(settings.logChannelId) : null;
  let secChannel = settings.securityChannelId ? guild.channels.cache.get(settings.securityChannelId) : null;

  if (!logChannel) {
    logChannel = await guild.channels.create({
      name: 'logs',
      type: ChannelType.GuildText,
    }).catch(() => null);
  }

  if (!secChannel) {
    secChannel = await guild.channels.create({
      name: 'security',
      type: ChannelType.GuildText,
      permissionOverwrites: [
        {
          id: guild.roles.everyone.id,
          deny: [PermissionFlagsBits.SendMessages],
          type: OverwriteType.Role,
        },
      ],
    }).catch(() => null);
  }

  const patch = {};
  if (logChannel?.id) patch.logChannelId = logChannel.id;
  if (secChannel?.id) patch.securityChannelId = secChannel.id;
  updateGuildSettings(guild.id, patch);
}

function buildSlashCommands() {
  return [
    new SlashCommandBuilder().setName('setup').setDescription('تهيئة تلقائية لقنوات الأمن واللوق'),
    new SlashCommandBuilder()
      .setName('protection')
      .setDescription('تفعيل/تعطيل الحماية العامة')
      .addStringOption((o) => o.setName('mode').setDescription('on أو off').setRequired(true)
        .addChoices({ name: 'on', value: 'on' }, { name: 'off', value: 'off' })),
    new SlashCommandBuilder()
      .setName('anti_links')
      .setDescription('تفعيل/تعطيل منع الروابط')
      .addStringOption((o) => o.setName('mode').setDescription('on أو off').setRequired(true)
        .addChoices({ name: 'on', value: 'on' }, { name: 'off', value: 'off' })),
    new SlashCommandBuilder()
      .setName('anti_spam')
      .setDescription('تفعيل/تعطيل مكافحة السبام')
      .addStringOption((o) => o.setName('mode').setDescription('on أو off').setRequired(true)
        .addChoices({ name: 'on', value: 'on' }, { name: 'off', value: 'off' })),
    new SlashCommandBuilder()
      .setName('anti_raid')
      .setDescription('تفعيل/تعطيل مكافحة المداهمات')
      .addStringOption((o) => o.setName('mode').setDescription('on أو off').setRequired(true)
        .addChoices({ name: 'on', value: 'on' }, { name: 'off', value: 'off' })),
    new SlashCommandBuilder()
      .setName('set_log')
      .setDescription('تعيين قناة اللوق')
      .addChannelOption((o) => o.setName('channel').setDescription('قناة اللوق').setRequired(true)),
    new SlashCommandBuilder()
      .setName('set_security')
      .setDescription('تعيين قناة الأمن')
      .addChannelOption((o) => o.setName('channel').setDescription('قناة الأمن').setRequired(true)),
    new SlashCommandBuilder()
      .setName('trusted_role')
      .setDescription('إدارة الرتب الموثوقة')
      .addStringOption((o) => o.setName('action').setDescription('add/remove').setRequired(true)
        .addChoices({ name: 'add', value: 'add' }, { name: 'remove', value: 'remove' }))
      .addRoleOption((o) => o.setName('role').setDescription('الرتبة').setRequired(true)),
    new SlashCommandBuilder()
      .setName('trusted_user')
      .setDescription('إدارة الأعضاء الموثوقين')
      .addStringOption((o) => o.setName('action').setDescription('add/remove').setRequired(true)
        .addChoices({ name: 'add', value: 'add' }, { name: 'remove', value: 'remove' }))
      .addUserOption((o) => o.setName('user').setDescription('المستخدم').setRequired(true)),
    new SlashCommandBuilder()
      .setName('language')
      .setDescription('تغيير لغة الردود')
      .addStringOption((o) => o.setName('value').setDescription('ar أو en').setRequired(true)
        .addChoices({ name: 'ar', value: 'ar' }, { name: 'en', value: 'en' })),
    new SlashCommandBuilder()
      .setName('warn')
      .setDescription('إعطاء تحذير لعضو')
      .addUserOption((o) => o.setName('user').setDescription('العضو').setRequired(true))
      .addStringOption((o) => o.setName('reason').setDescription('السبب').setRequired(false)),
    new SlashCommandBuilder()
      .setName('clear_warnings')
      .setDescription('تصفير تحذيرات عضو')
      .addUserOption((o) => o.setName('user').setDescription('العضو').setRequired(true)),
    new SlashCommandBuilder().setName('settings').setDescription('عرض إعدادات السيرفر'),
    new SlashCommandBuilder().setName('help').setDescription('عرض أوامر Falcon Guard'),
  ].map((c) => c.toJSON());
}

async function registerSlashCommands(guild) {
  await guild.commands.set(buildSlashCommands());
}

client.once('ready', async () => {
  console.log(`✅ Falcon Guard is online as ${client.user.tag}`);
  for (const guild of client.guilds.cache.values()) {
    await registerSlashCommands(guild).catch(() => null);
  }
});

client.on('guildCreate', async (guild) => {
  await ensureSecurityChannels(guild).catch(() => null);
  await registerSlashCommands(guild).catch(() => null);
  await sendLog(guild, '🦅 Falcon Guard انضم للسيرفر وتم تفعيل الحماية الافتراضية.');
});

client.on('messageCreate', async (message) => {
  if (!message.guild || message.author.bot) return;

  const settings = getGuildSettings(message.guild.id);
  const member = message.member;
  const protectedMember = isProtected(member, settings);

  if (settings.enabled && !protectedMember) {
    if (settings.antiLinks) {
      const linkRegex = /(https?:\/\/|discord\.gg\/|www\.)/i;
      if (linkRegex.test(message.content)) {
        await message.delete().catch(() => null);
        await applyWarning(message.guild, member, 'إرسال رابط غير مسموح').catch(() => null);
        await message.channel.send(t(settings, 'linksBlocked', { member }))
          .then((m) => setTimeout(() => m.delete().catch(() => null), 5000))
          .catch(() => null);
        return;
      }
    }

    if (settings.antiMentions) {
      const everyoneSpam = message.mentions.everyone;
      const mentionsCount = message.mentions.users.size + message.mentions.roles.size;
      if (everyoneSpam || mentionsCount >= settings.maxMentionsPerMessage) {
        await message.delete().catch(() => null);
        await applyWarning(message.guild, member, 'سبام منشنات').catch(() => null);
        return;
      }
    }

    if (settings.antiSpam) {
      const key = `${message.guild.id}:${message.author.id}`;
      const now = Date.now();
      const state = antiSpamMap.get(key) || { count: 0, first: now };

      if (now - state.first > settings.spamWindowMs) {
        state.count = 0;
        state.first = now;
      }

      state.count += 1;
      antiSpamMap.set(key, state);

      if (state.count >= settings.spamLimit) {
        const action = await applyWarning(message.guild, member, 'سبام رسائل سريع');
        if (action === 'mute') {
          await message.channel.send(`🔇 ${member} تم كتمك بسبب السبام.`).catch(() => null);
        }
        antiSpamMap.delete(key);
      }
    }
  }
});

client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand() || !interaction.guild) return;

  const settings = getGuildSettings(interaction.guild.id);
  const hasAdmin = interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)
    || interaction.user.id === interaction.guild.ownerId;

  const adminCommands = [
    'setup', 'protection', 'anti_links', 'anti_spam', 'anti_raid',
    'set_log', 'set_security', 'trusted_role', 'trusted_user',
    'language', 'warn', 'clear_warnings',
  ];

  if (adminCommands.includes(interaction.commandName) && !hasAdmin) {
    return interaction.reply({ content: t(settings, 'noPerm'), ephemeral: true });
  }

  if (interaction.commandName === 'setup') {
    await ensureSecurityChannels(interaction.guild);
    return interaction.reply({ content: t(settings, 'setupDone'), ephemeral: true });
  }

  if (interaction.commandName === 'protection') {
    const mode = interaction.options.getString('mode', true);
    updateGuildSettings(interaction.guild.id, { enabled: mode === 'on' });
    return interaction.reply({
      content: mode === 'on' ? t(settings, 'protectionEnabled') : t(settings, 'protectionDisabled'),
      ephemeral: true,
    });
  }

  if (interaction.commandName === 'anti_links') {
    const mode = interaction.options.getString('mode', true);
    updateGuildSettings(interaction.guild.id, { antiLinks: mode === 'on' });
    return interaction.reply({
      content: mode === 'on' ? t(settings, 'antiLinksEnabled') : t(settings, 'antiLinksDisabled'),
      ephemeral: true,
    });
  }

  if (interaction.commandName === 'anti_spam') {
    const mode = interaction.options.getString('mode', true);
    updateGuildSettings(interaction.guild.id, { antiSpam: mode === 'on' });
    return interaction.reply({
      content: mode === 'on' ? t(settings, 'antiSpamEnabled') : t(settings, 'antiSpamDisabled'),
      ephemeral: true,
    });
  }

  if (interaction.commandName === 'anti_raid') {
    const mode = interaction.options.getString('mode', true);
    updateGuildSettings(interaction.guild.id, { antiRaid: mode === 'on' });
    return interaction.reply({
      content: mode === 'on' ? t(settings, 'antiRaidEnabled') : t(settings, 'antiRaidDisabled'),
      ephemeral: true,
    });
  }

  if (interaction.commandName === 'set_log') {
    const channel = interaction.options.getChannel('channel', true);
    updateGuildSettings(interaction.guild.id, { logChannelId: channel.id });
    return interaction.reply({ content: `✅ تم تعيين روم اللوق: ${channel}`, ephemeral: true });
  }

  if (interaction.commandName === 'set_security') {
    const channel = interaction.options.getChannel('channel', true);
    updateGuildSettings(interaction.guild.id, { securityChannelId: channel.id });
    return interaction.reply({ content: `✅ تم تعيين روم الأمان: ${channel}`, ephemeral: true });
  }

  if (interaction.commandName === 'trusted_role') {
    const action = interaction.options.getString('action', true);
    const role = interaction.options.getRole('role', true);
    updateGuildList(interaction.guild.id, 'trustedRoleIds', role.id, action === 'add' ? 'add' : 'remove');
    return interaction.reply({
      content: action === 'add'
        ? `✅ تمت إضافة الرتبة الموثوقة: ${role.name}`
        : `✅ تمت إزالة الرتبة الموثوقة: ${role.name}`,
      ephemeral: true,
    });
  }

  if (interaction.commandName === 'trusted_user') {
    const action = interaction.options.getString('action', true);
    const user = interaction.options.getUser('user', true);
    updateGuildList(interaction.guild.id, 'trustedUserIds', user.id, action === 'add' ? 'add' : 'remove');
    return interaction.reply({
      content: action === 'add'
        ? `✅ تمت إضافة عضو موثوق: ${user.tag}`
        : `✅ تمت إزالة العضو الموثوق: ${user.tag}`,
      ephemeral: true,
    });
  }

  if (interaction.commandName === 'language') {
    const value = interaction.options.getString('value', true);
    if (!['ar', 'en'].includes(value)) {
      return interaction.reply({ content: t(settings, 'badLang'), ephemeral: true });
    }
    updateGuildSettings(interaction.guild.id, { language: value });
    return interaction.reply({ content: `✅ تم تغيير اللغة إلى: ${value}`, ephemeral: true });
  }

  if (interaction.commandName === 'warn') {
    const user = interaction.options.getUser('user', true);
    const reason = interaction.options.getString('reason') || 'بدون سبب';
    const target = await interaction.guild.members.fetch(user.id).catch(() => null);
    if (!target) return interaction.reply({ content: '❌ العضو غير موجود.', ephemeral: true });

    const warns = incrementWarnings(interaction.guild.id, target.id);
    await sendLog(interaction.guild, `⚠️ تحذير إداري: ${target.user.tag} | بواسطة ${interaction.user.tag} | السبب: ${reason}`);
    return interaction.reply({ content: `⚠️ تم تحذير ${target}. عدد التحذيرات: ${warns}`, ephemeral: true });
  }

  if (interaction.commandName === 'clear_warnings') {
    const user = interaction.options.getUser('user', true);
    resetWarnings(interaction.guild.id, user.id);
    return interaction.reply({ content: `✅ تم تصفير تحذيرات ${user.tag}.`, ephemeral: true });
  }

  if (interaction.commandName === 'settings') {
    const s = getGuildSettings(interaction.guild.id);
    return interaction.reply({
      content: [
        '🛡️ **إعدادات Falcon Guard**',
        `الحماية العامة: ${s.enabled ? '✅' : '❌'}`,
        `مكافحة السبام: ${s.antiSpam ? '✅' : '❌'}`,
        `منع الروابط: ${s.antiLinks ? '✅' : '❌'}`,
        `منع المنشنات: ${s.antiMentions ? '✅' : '❌'}`,
        `Anti-Nuke: ${s.antiNuke ? '✅' : '❌'}`,
        `Anti-Raid: ${s.antiRaid ? '✅' : '❌'}`,
        `اللغة: ${s.language}`,
        `موثوقين (أعضاء): ${s.trustedUserIds.length}`,
        `موثوقين (رتب): ${s.trustedRoleIds.length}`,
      ].join('\n'),
      ephemeral: true,
    });
  }

  if (interaction.commandName === 'help') {
    return interaction.reply({
      content: [
        '📚 **Slash Commands**',
        '`/setup`',
        '`/protection mode:on|off`',
        '`/anti_links mode:on|off`',
        '`/anti_spam mode:on|off`',
        '`/anti_raid mode:on|off`',
        '`/set_log channel:#logs`',
        '`/set_security channel:#security`',
        '`/trusted_role action:add|remove role:@role`',
        '`/trusted_user action:add|remove user:@user`',
        '`/language value:ar|en`',
        '`/warn user:@user reason:...`',
        '`/clear_warnings user:@user`',
        '`/settings`',
      ].join('\n'),
      ephemeral: true,
    });
  }

  return interaction.reply({ content: t(settings, 'done'), ephemeral: true });
});

client.on('guildMemberAdd', async (member) => {
  const settings = getGuildSettings(member.guild.id);
  if (!settings.enabled || !settings.antiRaid) return;

  const key = member.guild.id;
  const now = Date.now();
  const state = antiRaidTracker.get(key) || { count: 0, first: now };

  if (now - state.first > settings.joinRaidWindowMs) {
    state.count = 0;
    state.first = now;
  }

  state.count += 1;
  antiRaidTracker.set(key, state);

  if (state.count >= settings.joinRaidLimit) {
    await member.timeout(30 * 60 * 1000, 'Falcon Guard Anti-Raid').catch(() => null);
    await sendLog(member.guild, `🚨 Anti-Raid: تم رصد دخول جماعي (${state.count}) خلال ثوانٍ قليلة.`);
  }
});

client.on('channelDelete', async (channel) => {
  if (!channel.guild) return;
  const settings = getGuildSettings(channel.guild.id);
  if (!settings.enabled || !settings.antiNuke) return;

  const guild = channel.guild;
  const fetched = await guild.fetchAuditLogs({ type: AuditLogEvent.ChannelDelete, limit: 1 }).catch(() => null);
  const entry = fetched?.entries.first();
  if (!entry?.executor || entry.executor.id === client.user.id) return;

  await trackNuke(guild, entry.executor.id, 'channelDelete', 2, 12000);

  if (channel.type === ChannelType.GuildText || channel.type === ChannelType.GuildVoice) {
    await guild.channels.create({
      name: `${channel.name}-restored`,
      type: channel.type,
      parent: channel.parentId || undefined,
    }).catch(() => null);
    await sendLog(guild, `🧱 تم استرجاع روم بديل للروم المحذوف: ${channel.name}`);
  }
});

client.on('guildBanAdd', async (ban) => {
  const guild = ban.guild;
  const settings = getGuildSettings(guild.id);
  if (!settings.enabled || !settings.antiNuke) return;

  const fetched = await guild.fetchAuditLogs({ type: AuditLogEvent.MemberBanAdd, limit: 1 }).catch(() => null);
  const entry = fetched?.entries.first();
  if (!entry?.executor || entry.executor.id === client.user.id) return;

  await trackNuke(guild, entry.executor.id, 'massBan', 3, 15000);
});

client.on('guildMemberUpdate', async (oldMember, newMember) => {
  const guild = newMember.guild;
  const settings = getGuildSettings(guild.id);
  if (!settings.enabled || !settings.antiNuke) return;

  if (newMember.roles.cache.size <= oldMember.roles.cache.size + 2) return;

  const fetched = await guild.fetchAuditLogs({ type: AuditLogEvent.MemberRoleUpdate, limit: 1 }).catch(() => null);
  const entry = fetched?.entries.first();
  if (!entry?.executor || entry.executor.id === client.user.id) return;

  await trackNuke(guild, entry.executor.id, 'massRoleGive', 3, 12000);
});

client.login(TOKEN);
