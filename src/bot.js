const { Bot, InlineKeyboard } = require("grammy");
const config = require("./config");
const { trackUser, logEvent } = require("./database");
const { CATEGORIES, CATEGORY_BY_CHANNEL, searchContent, searchCurriculum, normalize, indexChannelPost } = require("./content");
const { isAdmin, showAdmin, handleCallback, handleAdminMessage } = require("./admin");

const bot = new Bot(config.token);

const MESSAGES = {
  start: `💖 **KU SOO DHAWOW MISKIINEY BOT!** 🎬📚

🌸 Kaliya qor magaca waxa aad raadinayso, Miskiiney ayaana kaa caawinaysa!

✨ **Waxaad ka heli kartaa:**
🎬 Filimada Hindiga & American-ka
📺 Taxanayaasha
📚 Buugaagta aqoonta
🎓 Manhajka dowladda
🎁 Waxyaabo yaab leh ayaa soo socda!

💝 **Filim raadi, aqoon kororso, taxane ogow!**

👇 **Bilow raadintaada, walaal!** 😂❤️🌸`,
  film: `🎬❤️ **WALAAL, FILIMKEE LAGUU RAADIYAA?** 😂🍿

Ha wareegin Netflix oo dhan! 🤭💖

🔎 Kaliya qor magaca filimka aad rabto, Miskiiney ayaana kaa caawinaysa raadintiisa.

💌 **Magaca qor, walaal… aan kuu soo helnee!** 😍`,
  book: `📚💖 **WALAAL, AQOON MA RAADINAYSAA?** 🧠✨

Buug kasta wuxuu xambaarsan yahay aqoon cusub! 🌹

🔎 Noo qor magaca buugga aad rabto inaan kuu raadino.

💡 **Maskaxda quudi, aqoontana kobci!** ❤️📖`,
  curriculum: `🎓📚 **ARDAYYAHOW, MANHAJKAAGA HALKAN KA RAADI!** ❤️✨

🔎 Qor fasalka iyo maadada aad rabto.

📝 Tusaalooyin:
📗 8aad, Saynis
📘 9aad, Teknolaji
📙 7aad, Xisaab

⚠️ Haddii aadan helin buugga, hubi qoraalka ama isku day magac kale.

🛟 Caawimaad: @${config.supportUsername}

💪 **Aqoontu waa furaha mustaqbalkaaga!** 🌟`,
  invite: `💖 **WALAAL, MISKIINEY KELIGAA HA KU RAAXAYSAN!** 😂🌸

Saaxiibbadaa la wadaag madashan ay ka heli karaan 🎬 filimo, 📚 buugaag, 🎓 manhaj iyo waxyaabo kale oo xiiso leh!

🔗 https://t.me/${config.botUsername}

❤️ **Wanaagga la wadaag, saaxiibbadaadana nala keen!** 🫶✨`,
  support: `🛟❤️ **MISKIINEY SUPPORT**

Walaal, sideen kuu caawin karnaa? 🥹💖

🛟 **1. Caawimaad**

Dhibaato ma kaa haysataa isticmaalka bot-ka? Kala xiriir qofka ku caawinaya:

👤 @${config.supportUsername}

❤️ **2. Taageer System-ka**

Ma rabtaa inaad dhaqaale ku taageerto Miskiiney si uu u horumaro? Taageeradaadu wax weyn ayay noo taraysaa. 🤝💖

📞 ${config.systemSupportPhone}

🌹 **Mahadsanid walaal, taageeradaadu waa horumarkeenna!** ❤️`,
  group: `🌸💖 **HAA WALAAL, MISKIINEY WAA JOOGTAA!** 😂❤️

Ma wax baad iga rabtaa, mise waad ii xiistay? 🤭💕

✨ Waxaan ahay Miskiiney Bot, diyaar u ah caawimaad iyo jawi wanaagsan.

💌 **Igu soo dhowow, walaal!** 🫶🌸`
};

async function safeTrack(ctx) {
  try { if (ctx.from) await trackUser(ctx.from); } catch (e) { console.error("User tracking error:", e.message); }
}
function inviteKeyboard() {
  const share = `https://t.me/share/url?url=${encodeURIComponent(`https://t.me/${config.botUsername}`)}&text=${encodeURIComponent("Ku soo biir Miskiiney Bot! ❤️🎬📚")}`;
  return new InlineKeyboard().url("👥 La wadaag Saaxiibbada", share);
}
async function sendResult(ctx, item) {
  const caption = `💖 **${item.title}**${item.year ? ` (${item.year})` : ""}${item.grade ? `\n🎓 Fasalka: ${item.grade}` : ""}${item.subject ? `\n📚 Maadada: ${item.subject}` : ""}${item.description && item.description !== item.title ? `\n\n${item.description.slice(0,700)}` : ""}`;
  const opts = { caption, parse_mode: "Markdown" };
  const chatId = ctx.chat.id;
  if (item.file_id) {
    switch (item.media_type) {
      case "video": return ctx.api.sendVideo(chatId, item.file_id, opts);
      case "photo": return ctx.api.sendPhoto(chatId, item.file_id, opts);
      case "audio": return ctx.api.sendAudio(chatId, item.file_id, opts);
      case "animation": return ctx.api.sendAnimation(chatId, item.file_id, opts);
      case "voice": return ctx.api.sendVoice(chatId, item.file_id, opts);
      case "video_note": return ctx.api.sendVideoNote(chatId, item.file_id);
      default: return ctx.api.sendDocument(chatId, item.file_id, opts);
    }
  }
  if (item.channel_message_id) {
    return ctx.api.copyMessage(chatId, String(item.channel_id), Number(item.channel_message_id));
  }
  return ctx.reply("Waan helay diiwaanka, laakiin faylkiisa lama hayo. Fadlan la xiriir taageerada.");
}
async function answerSearch(ctx, query, category = null) {
  const cleaned = query.trim();
  if (!cleaned) return;
  try {
    let results;
    const curriculumMatch = cleaned.match(/^(\d{1,2}(?:aad)?)\s*[,|]\s*(.+)$/i);
    if (!category && curriculumMatch) {
      results = await searchCurriculum(curriculumMatch[1], curriculumMatch[2]);
    } else {
      results = await searchContent(cleaned, category);
    }
    if (!results.length) {
      const hint = category === "curriculum" || curriculumMatch
        ? "\n\nTusaale: 8aad, Saynis"
        : "\n\nHubi higgaadda ama isku day magaca oo dhan. Haddii aad weli u baahan tahay caawimaad, la xiriir @" + config.supportUsername;
      await ctx.reply(`😔 Walaal, wax ku habboon raadintaada lama helin.${hint}`);
      await logEvent("search", false, { query: cleaned, category });
      return;
    }
    await ctx.reply(`🔎 Waxaan helay ${results.length} natiijo. ❤️`);
    for (const item of results.slice(0, config.searchLimit)) {
      try { await sendResult(ctx, item); }
      catch (e) { console.error("Sending result failed:", e.message); }
    }
    await logEvent("search", true, { query: cleaned, category, count: results.length });
  } catch (e) {
    console.error("Search error:", e);
    await ctx.reply("⚠️ Walaal, cilad yar ayaa raadinta ka dhacday. Fadlan mar kale isku day.");
    await logEvent("search", false, { query: cleaned, error: e.message });
  }
}

bot.use(async (ctx, next) => { await safeTrack(ctx); await next(); });

bot.command("start", async ctx => {
  await ctx.reply(MESSAGES.start, { parse_mode: "Markdown" });
});
bot.command("film_baare", ctx => ctx.reply(MESSAGES.film, { parse_mode: "Markdown" }));
bot.command("buug_baare", ctx => ctx.reply(MESSAGES.book, { parse_mode: "Markdown" }));
bot.command("manhaj_ka_dowlada", ctx => ctx.reply(MESSAGES.curriculum, { parse_mode: "Markdown" }));
bot.command("Invitefriends", ctx => ctx.reply(MESSAGES.invite, { parse_mode: "Markdown", reply_markup: inviteKeyboard() }));
bot.command("invitefriends", ctx => ctx.reply(MESSAGES.invite, { parse_mode: "Markdown", reply_markup: inviteKeyboard() }));
bot.command("caawimad_taagero", ctx => ctx.reply(MESSAGES.support, { parse_mode: "Markdown" }));
bot.command("miskiiney", async ctx => {
  if (ctx.chat.type !== "private") return ctx.reply(MESSAGES.group, { parse_mode: "Markdown" });
  await ctx.reply(MESSAGES.group, { parse_mode: "Markdown" });
});
bot.command("admin", ctx => showAdmin(ctx));

bot.on("callback_query:data", async ctx => {
  try { await handleCallback(ctx); } catch (e) { console.error("Callback error:", e); }
});
bot.on("message", async ctx => {
  if (!ctx.message || ctx.message.chat.type === "channel") return;
  if (await handleAdminMessage(ctx)) return;
  const text = ctx.message.text?.trim();
  if (!text || text.startsWith("/")) return;
  if (ctx.chat.type !== "private") {
    if (config.groupChatId && String(ctx.chat.id) !== config.groupChatId) return;
    // Group search is only triggered by a direct bot mention or reply, to avoid responding to every message.
    const mention = new RegExp(`@${config.botUsername}\\b`, "i").test(text);
    const repliedToBot = ctx.message.reply_to_message?.from?.id === bot.botInfo?.id;
    if (!mention && !repliedToBot) return;
  }
  const curriculumMatch = text.match(/^(\d{1,2}(?:aad)?)\s*[,|]\s*(.+)$/i);
  if (curriculumMatch) return answerSearch(ctx, text, "curriculum");
  return answerSearch(ctx, text);
});

bot.on("channel_post", async ctx => {
  try {
    const category = CATEGORY_BY_CHANNEL[String(ctx.channelPost.chat.id)];
    if (!category) return;
    await indexChannelPost(ctx, category);
    console.log(`Indexed channel post ${ctx.channelPost.chat.id}/${ctx.channelPost.message_id} (${category})`);
  } catch (e) {
    console.error("Channel indexing failed:", e);
    await logEvent("channel_index", false, { error: e.message });
  }
});

bot.catch(err => {
  console.error("Bot error:", err.error || err);
});

module.exports = { bot, MESSAGES };
