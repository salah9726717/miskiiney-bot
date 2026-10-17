const { InlineKeyboard, Keyboard } = require("grammy");
const config = require("./config");
const { pool, saveSession, getSession, clearSession, logEvent } = require("./database");
const { CATEGORIES, getMedia, upsertContent, findContentById, deactivateContent, updateTitle, contentStats } = require("./content");

function isAdmin(ctx) { return !!ctx.from && config.adminIds.includes(Number(ctx.from.id)); }
const mainKeyboard = () => new InlineKeyboard()
  .text("➕ Add Content", "admin:add").row()
  .text("🗂 Manage Content", "admin:manage").text("👥 Users", "admin:users").row()
  .text("📊 Statistics", "admin:stats").text("📢 Broadcast", "admin:broadcast").row()
  .text("🩺 System Health", "admin:health").text("❌ Close", "admin:close");
const categoryKeyboard = () => new InlineKeyboard()
  .text("🎬 Films", "addcat:films").text("📺 Series", "addcat:series").row()
  .text("📚 Books", "addcat:books").text("🎓 Curriculum", "addcat:curriculum").row()
  .text("↩️ Cancel", "admin:home");
async function showAdmin(ctx) {
  if (!isAdmin(ctx)) return ctx.reply("⛔ Amarkan waxaa isticmaali kara maamulka oo keliya.");
  await clearSession(ctx.from.id);
  await ctx.reply("🛡️ **MISKIINEY ADMIN PANEL**\n\nDooro adeegga aad rabto:", { parse_mode: "Markdown", reply_markup: mainKeyboard() });
}
async function handleCallback(ctx) {
  if (!String(ctx.callbackQuery?.data || "").startsWith("admin:") && !String(ctx.callbackQuery?.data || "").startsWith("addcat:") && !String(ctx.callbackQuery?.data || "").startsWith("manage:")) return false;
  if (!isAdmin(ctx)) { await ctx.answerCallbackQuery({ text: "Admin access only", show_alert: true }); return true; }
  const data = ctx.callbackQuery.data;
  await ctx.answerCallbackQuery();
  if (data === "admin:home") return showAdmin(ctx);
  if (data === "admin:close") { await clearSession(ctx.from.id); return ctx.editMessageText("Admin panel waa la xiray."); }
  if (data === "admin:add") return ctx.editMessageText("📂 Dooro qaybta aad ku dari rabto:", { reply_markup: categoryKeyboard() });
  if (data.startsWith("addcat:")) {
    const category = data.split(":")[1];
    if (!CATEGORIES[category]) return ctx.reply("Qaybtaas lama aqoonsan.");
    await saveSession(ctx.from.id, "await_media", { category });
    return ctx.reply(`📤 **${CATEGORIES[category].label}**\n\nHadda ii soo dir faylka (video, document, audio, photo ama animation). /cancel si aad u joojiso.`, { parse_mode: "Markdown" });
  }
  if (data === "admin:manage") {
    const r = await pool.query("SELECT id,title,category FROM content WHERE active=TRUE ORDER BY id DESC LIMIT 10");
    if (!r.rows.length) return ctx.editMessageText("Weli wax content ah laguma diiwaangelin.", { reply_markup: mainKeyboard() });
    const kb = new InlineKeyboard();
    for (const row of r.rows) kb.text(`${row.id}. ${row.title.slice(0,28)}`, `manage:view:${row.id}`).row();
    kb.text("↩️ Back", "admin:home");
    return ctx.editMessageText("🗂 **Manage Content**\nDooro item si aad u saxdo ama u damiso:", { parse_mode: "Markdown", reply_markup: kb });
  }
  if (data.startsWith("manage:view:")) {
    const id = data.split(":")[2], item = await findContentById(id);
    if (!item) return ctx.reply("Content lama helin.");
    const kb = new InlineKeyboard().text("✏️ Change title", `manage:rename:${id}`).text("🗑 Deactivate", `manage:delete:${id}`).row().text("↩️ Back", "admin:manage");
    return ctx.editMessageText(`🗂 #${item.id}\nQayb: ${item.category}\nMagac: ${item.title}\nFayl: ${item.media_type}\nChannel: ${item.channel_id}\nMessage ID: ${item.channel_message_id || "N/A"}`, { reply_markup: kb });
  }
  if (data.startsWith("manage:rename:")) {
    const id = data.split(":")[2];
    await saveSession(ctx.from.id, "await_rename", { id });
    return ctx.reply("✏️ Ii soo dir magaca cusub. /cancel si aad u joojiso.");
  }
  if (data.startsWith("manage:delete:")) {
    const id = data.split(":")[2], row = await deactivateContent(id);
    return ctx.editMessageText(row ? `🗑 Waa laga saaray raadinta: ${row.title}` : "Item lama helin.", { reply_markup: mainKeyboard() });
  }
  if (data === "admin:users") {
    const r = await pool.query("SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE last_seen_at > NOW()-INTERVAL '24 hours')::int AS active FROM users");
    return ctx.editMessageText(`👥 **Users**\n\nWadar: ${r.rows[0].total}\nFirfircoon 24 saac: ${r.rows[0].active}`, { parse_mode: "Markdown", reply_markup: mainKeyboard() });
  }
  if (data === "admin:stats") {
    const stats = await contentStats();
    const users = await pool.query("SELECT COUNT(*)::int AS total FROM users");
    const rows = Object.entries(CATEGORIES).map(([k,v]) => `${v.label}: ${stats[k] || 0}`).join("\n");
    return ctx.editMessageText(`📊 **MISKIINEY STATS**\n\nUsers: ${users.rows[0].total}\n${rows}`, { parse_mode: "Markdown", reply_markup: mainKeyboard() });
  }
  if (data === "admin:health") {
    const db = await pool.query("SELECT NOW() AS now");
    return ctx.editMessageText(`🩺 **SYSTEM HEALTH**\n\nBot: running\nDatabase: connected\nDB time: ${db.rows[0].now.toISOString()}\nStorage channels: ${Object.keys(CATEGORIES).length}`, { parse_mode: "Markdown", reply_markup: mainKeyboard() });
  }
  if (data === "admin:broadcast") {
    await saveSession(ctx.from.id, "await_broadcast", {});
    return ctx.reply("📢 Ii soo dir fariinta broadcast-ka. /cancel si aad u joojiso.");
  }
  return true;
}
async function handleAdminMessage(ctx) {
  if (!isAdmin(ctx) || !ctx.message) return false;
  const session = await getSession(ctx.from.id);
  if (!session) return false;
  const text = ctx.message.text || ctx.message.caption || "";
  if (text.trim() === "/cancel") {
    await clearSession(ctx.from.id);
    await ctx.reply("Waa la joojiyey.", { reply_markup: mainKeyboard() });
    return true;
  }
  if (session.state === "await_media") {
    const media = getMedia(ctx.message);
    if (!media.fileId) { await ctx.reply("Fadlan ii soo dir fayl ama media, ma aha qoraal keliya."); return true; }
    await saveSession(ctx.from.id, "await_title", {
      category: session.payload.category,
      media: { ...media },
      sourceMessageId: ctx.message.message_id,
      sourceChatId: ctx.chat.id,
      caption: ctx.message.caption || ""
    });
    await ctx.reply("✍️ Hadda ii soo dir magaca saxda ah ee faylka. (Qoraal keliya)");
    return true;
  }
  if (session.state === "await_title") {
    if (!ctx.message.text?.trim()) { await ctx.reply("Magaca qoraal ahaan ii soo dir."); return true; }
    await saveSession(ctx.from.id, "await_description", { ...session.payload, title: ctx.message.text.trim().slice(0,250) });
    await ctx.reply("📝 Faahfaahin dheeraad ah (ama qor - haddii aadan rabin). Manhajka: waxaad qori kartaa `8aad | Saynis` si fasalka iyo maadada loo kaydiyo.", { parse_mode: "Markdown" });
    return true;
  }
  if (session.state === "await_description") {
    const payload = session.payload;
    const description = text.trim() === "-" ? "" : text.trim();
    let grade = "", subject = "";
    if (payload.category === "curriculum" && description) {
      const parts = description.split(/[|,]/).map(x => x.trim());
      grade = parts[0] || "";
      subject = parts[1] || "";
    }
    try {
      const category = payload.category;
      const channelId = CATEGORIES[category].channel;
      const copied = await ctx.api.copyMessage(channelId, payload.sourceChatId, payload.sourceMessageId);
      const copyMsg = await ctx.api.getFile(payload.media.fileId).catch(() => null);
      const row = await upsertContent({
        category, title: payload.title, description, grade, subject,
        channelId, channelMessageId: copied.message_id,
        fileId: payload.media.fileId, fileUniqueId: payload.media.uniqueId,
        mediaType: payload.media.type, source: "admin", createdBy: ctx.from.id
      });
      await clearSession(ctx.from.id);
      await logEvent("admin_upload", true, { id: row.id, title: row.title });
      return ctx.reply(`✅ **Waa lagu daray kaydka!**\n\nQayb: ${CATEGORIES[category].label}\nMagac: ${row.title}\nContent ID: ${row.id}\nChannel message: ${copied.message_id}`, { parse_mode: "Markdown", reply_markup: mainKeyboard() });
    } catch (e) {
      console.error("Admin upload failed:", e);
      await logEvent("admin_upload", false, { error: e.message });
      return ctx.reply("❌ Kaydintu way fashilantay. Hubi in bot-ku admin ka yahay channel-ka oo uu wax ku diri karo, kadib isku day mar kale.");
    }
  }
  if (session.state === "await_rename") {
    if (!ctx.message.text?.trim()) { await ctx.reply("Magac qoraal ah soo dir."); return true; }
    const row = await updateTitle(session.payload.id, ctx.message.text.trim().slice(0,250));
    await clearSession(ctx.from.id);
    await ctx.reply(row ? `✅ Magaca waa la beddelay: ${row.title}` : "Item lama helin.", { reply_markup: mainKeyboard() });
    return true;
  }
  if (session.state === "await_broadcast") {
    await clearSession(ctx.from.id);
    const messageId = ctx.message.message_id, chatId = ctx.chat.id;
    const users = await pool.query("SELECT telegram_id FROM users WHERE is_blocked=FALSE");
    let sent = 0, failed = 0;
    await ctx.reply(`📢 Broadcast ayaa bilaabmaya. Users: ${users.rows.length}`);
    for (const u of users.rows) {
      try {
        await ctx.api.copyMessage(String(u.telegram_id), chatId, messageId);
        sent++;
      } catch (e) {
        failed++;
        if (String(e.description || e.message).includes("bot was blocked")) {
          await pool.query("UPDATE users SET is_blocked=TRUE WHERE telegram_id=$1", [u.telegram_id]);
        }
      }
      if (config.broadcastDelayMs) await new Promise(r => setTimeout(r, config.broadcastDelayMs));
    }
    await logEvent("broadcast", true, { sent, failed });
    await ctx.reply(`✅ Broadcast dhammaaday.\nLa diray: ${sent}\nFashilmay: ${failed}`, { reply_markup: mainKeyboard() });
    return true;
  }
  return false;
}
module.exports = { isAdmin, showAdmin, handleCallback, handleAdminMessage, mainKeyboard };
