# Falcon Guard 🦅🛡️

بوت حماية **عالمي** لديسكورد (Arabic-first + English optional) بدون موقع؛ كل التحكم من داخل السيرفر عبر **أوامر /**.

## لماذا يعتبر Global؟

- يعمل مباشرة على أي سيرفر يدخل له.
- يدعم أكثر من لغة (`ar`/`en`) لكل سيرفر.
- إعدادات مستقلة لكل سيرفر (Multi-Guild).
- تهيئة تلقائية لقنوات `#logs` و `#security`.

## المميزات الأمنية

- Anti-Spam (تحذير ⟶ كتم ⟶ باند)
- Anti-Links
- Anti-Mentions (`@everyone` + spam mentions)
- نظام تحذيرات تلقائي
- Anti-Raid (كشف دخول جماعي سريع)
- Anti-Nuke عبر Audit Logs:
  - حذف رومات متكرر
  - باند جماعي
  - إعطاء رتب بشكل جماعي
- نظام Trusted Users / Trusted Roles

## المتطلبات

- Node.js 18+
- صلاحيات البوت:
  - Manage Messages
  - Moderate Members
  - Ban Members
  - View Audit Log
  - Manage Roles
  - Manage Channels
  - Use Application Commands

## التثبيت

```bash
npm install
cp .env.example .env
```

ضع التوكن:

```env
DISCORD_TOKEN=YOUR_TOKEN
```

تشغيل:

```bash
npm start
```

## أوامر Slash

- `/setup`
- `/protection mode:on|off`
- `/anti_links mode:on|off`
- `/anti_spam mode:on|off`
- `/anti_raid mode:on|off`
- `/set_log channel:#logs`
- `/set_security channel:#security`
- `/trusted_role action:add|remove role:@role`
- `/trusted_user action:add|remove user:@user`
- `/language value:ar|en`
- `/warn user:@user reason:...`
- `/clear_warnings user:@user`
- `/settings`
- `/help`

## تشغيل Termux 24/7

```bash
pkg update && pkg upgrade -y
pkg install nodejs git -y
npm install
npm start
```

للتشغيل الدائم استخدم `tmux` أو `pm2`.

## التخزين

- `data/guilds.json`: إعدادات كل سيرفر.
- `data/warnings.json`: التحذيرات لكل عضو بكل سيرفر.
