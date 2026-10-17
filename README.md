# Miskiiney Bot — v1.0.0

A fresh Node.js Telegram bot system using **Telegram storage channels + PostgreSQL search index + Telegram admin panel**. This project does not depend on an older ZIP.

## Included

- User commands and exact approved Somali message text:
  - `/start`
  - `/film_baare`
  - `/buug_baare`
  - `/manhaj_ka_dowlada`
  - `/Invitefriends`
  - `/caawimad_taagero`
  - `/miskiiney` for groups
- Free-text film, series, book and curriculum search.
- PostgreSQL persistent storage and automatic channel post indexing.
- Telegram-only admin panel: add content, search/manage content, users, stats, broadcast, system status.
- Upload through admin panel: admin sends a file, gives title/details, bot copies it to the selected storage channel and indexes it.
- Direct channel upload indexing: channel post text/caption is indexed automatically.
- Optional OpenRouter AI integration (`AI_ENABLED=true`).
- Optional group welcome/config via `GROUP_CHAT_ID`.
- Health endpoint for deployment.

## Important setup

1. Create a Telegram bot with BotFather.
2. Create a PostgreSQL database.
3. Copy `.env.example` to `.env` and fill `BOT_TOKEN`, `DATABASE_URL`, and `ADMIN_IDS`.
4. Add the bot as **administrator** in all four storage channels. It needs permission to post messages and read channel posts. Telegram channel updates are delivered only after it is an admin.
5. Confirm channel IDs in `.env`; defaults are the four IDs previously selected for this project.
6. Install Node.js 20+ and run:
   ```bash
   npm install
   npm run check
   npm start
   ```
7. For Render, create a PostgreSQL database and web service from this repository. Set all environment variables in the dashboard. `WEBHOOK_URL` must be the public HTTPS URL of the service, e.g. `https://your-service.onrender.com`. `WEBHOOK_SECRET` must be a random secret.
8. Add `GROUP_CHAT_ID` only if you want group-specific behavior. The same code can be connected to a group later by changing the environment variable and redeploying/restarting.

## How the storage flow works

### Upload via Admin Panel
`/admin` → Add Content → choose category → send media → enter title → optional metadata → bot copies the file to the selected channel → database stores the channel message ID and file ID.

### Upload directly to a channel
Post the file to one of the storage channels with a useful caption, ideally:
`Title: 3 Idiots | Year: 2009 | Type: Comedy`
The bot indexes the post caption and file ID automatically. Direct channel uploads cannot always infer the exact title perfectly, so admin can use **Manage Content** to correct the title.

### Search
Users can send a film/book/series title directly. Curriculum format examples:
- `8aad, Saynis`
- `9aad, Teknolaji`
- `7aad, Xisaab`

The bot searches the PostgreSQL index and sends the stored Telegram file. If no match is found, it returns a friendly no-results message.

## Environment variables

See `.env.example`. `ADMIN_IDS` is a comma-separated list of Telegram numeric user IDs. Do not use usernames for authorization.

## Notes / operational requirements

- Telegram bots cannot read old channel history on their own. Direct channel uploads are indexed when posted **after** the bot is added as a channel administrator. To index old content, re-post it, or add it via the Admin Panel.
- The `file_id` saved in PostgreSQL allows the bot to resend the media without downloading and uploading it again.
- For groups, set `GROUP_CHAT_ID` to the numeric chat ID (usually negative for supergroups). The bot must be a member of that group. The `/miskiiney` command responds in groups.
- Broadcast is restricted to configured admins and includes pacing to reduce Telegram rate limits.
- Use a persistent PostgreSQL service; do not rely on ephemeral local storage.
- Before public launch, verify that you have rights to distribute all uploaded media.
