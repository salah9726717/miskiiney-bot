
const { Bot, InlineKeyboard } = require("grammy");
const config = require("./config");
const { trackUser, logEvent } = require("./database");

const {
  CATEGORY_BY_CHANNEL,
  searchContent,
  searchSeries,
  getSeriesSeasons,
  getSeriesParts,
  findContentById,
  searchCurriculum,
  indexChannelPost
} = require("./content");

const {
  showAdmin,
  handleCallback,
  handleAdminMessage
} = require("./admin");

const bot = new Bot(config.token);

const MESSAGES = {
  start: `💖 **KU SOO DHAWOW MISKIINEY BOT!** 🎬📚

🌸 Kaliya qor magaca waxa aad raadinayso, Miskiiney ayaana kaa caawinaysa!

✨ **Waxaad ka heli kartaa:**
🎬 Filimada Hindiga & American-ka
📺 Taxanayaasha
📚 Buugaagta aqoonta
🎓 Manhajka dowladda

💝 **Filim raadi, aqoon kororso, taxane ogow!**

👇 **Bilow raadintaada, walaal!** 😂❤️🌸`,

  film: `🎬❤️ **WALAAL, FILIMKEE LAGUU RAADIYAA?** 😂🍿

🔎 Kaliya qor magaca filimka aad rabto.`,

  book: `📚💖 **WALAAL, AQOON MA RAADINAYSAA?** 🧠✨

🔎 Noo qor magaca buugga aad rabto inaan kuu raadino.`,

  curriculum: `🎓📚 **ARDAYYAHOW, MANHAJKAAGA HALKAN KA RAADI!** ❤️✨

🔎 Qor fasalka iyo maadada aad rabto.

📝 Tusaale: 8aad, Saynis

🛟 Caawimaad: @${config.supportUsername}`,

  invite: `💖 **WALAAL, MISKIINEY KELIGAA HA KU RAAXAYSAN!** 😂🌸

Saaxiibbadaa la wadaag bot-ka:

🔗 https://t.me/${config.botUsername}`,

  support: `🛟❤️ **MISKIINEY SUPPORT**

Caawimaad: @${config.supportUsername}

Taageerada system-ka: ${config.systemSupportPhone}`,

  group: `🌸💖 Haa walaal, Miskiiney waa joogtaa! ❤️`
};

async function safeTrack(ctx) {
  try {
    if (ctx.from) await trackUser(ctx.from);
  } catch (error) {
    console.error("User tracking error:", error.message);
  }
}

function inviteKeyboard() {
  const share =
    `https://t.me/share/url?url=${encodeURIComponent(
      `https://t.me/${config.botUsername}`
    )}&text=${encodeURIComponent("Ku soo biir Miskiiney Bot! ❤️🎬📚")}`;

  return new InlineKeyboard().url("👥 La wadaag Saaxiibbada", share);
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

async function sendResult(ctx, item) {
  const title = escapeHtml(item.title || "Content");
  const description =
    item.description &&
    item.description.trim() !== item.title
      ? `\n\n${escapeHtml(item.description.slice(0, 700))}`
      : "";

  const grade = item.grade
    ? `\n🎓 Fasalka: ${escapeHtml(item.grade)}`
    : "";

  const subject = item.subject
    ? `\n📚 Maadada: ${escapeHtml(item.subject)}`
    : "";

  const caption =
    `💖 <b>${title}</b>${grade}${subject}${description}`;

  const options = {
    caption,
    parse_mode: "HTML"
  };

  const chatId = ctx.chat.id;

  if (item.file_id) {
    switch (item.media_type) {
      case "video":
        return ctx.api.sendVideo(chatId, item.file_id, options);

      case "photo":
        return ctx.api.sendPhoto(chatId, item.file_id, options);

      case "audio":
        return ctx.api.sendAudio(chatId, item.file_id, options);

      case "animation":
        return ctx.api.sendAnimation(chatId, item.file_id, options);

      case "voice":
        return ctx.api.sendVoice(chatId, item.file_id, options);

      case "video_note":
        return ctx.api.sendVideoNote(chatId, item.file_id);

      case "sticker":
        return ctx.api.sendSticker(chatId, item.file_id);

      default:
        return ctx.api.sendDocument(chatId, item.file_id, options);
    }
  }

  if (item.channel_message_id && item.channel_id) {
    return ctx.api.copyMessage(
      chatId,
      String(item.channel_id),
      Number(item.channel_message_id)
    );
  }

  throw new Error(`No usable file for content ${item.id}`);
}

async function makeSeasonKeyboard(seriesItem) {
  const seasons = await getSeriesSeasons(seriesItem.normalized_title);
  const keyboard = new InlineKeyboard();

  for (const season of seasons) {
    keyboard.text(
      `Season ${season.season_number} (${season.part_count})`,
      `series:season:${seriesItem.id}:${season.season_number}`
    );

    if (keyboard.inline_keyboard[keyboard.inline_keyboard.length - 1].length >= 2) {
      keyboard.row();
    }
  }

  if (keyboard.inline_keyboard.length) {
    keyboard.row();
  }

  keyboard.text("🔄 Raadis kale", "series:search_help");

  return { seasons, keyboard };
}

async function showSeries(ctx, seriesItem) {
  const { seasons, keyboard } = await makeSeasonKeyboard(seriesItem);

  const description = seriesItem.description
    ? `\n\n${escapeHtml(seriesItem.description.slice(0, 500))}`
    : "";

  if (!seasons.length) {
    return ctx.reply(
      `📺 <b>${escapeHtml(seriesItem.title)}</b>${description}\n\n` +
      `⚠️ Taxanahan weli looma diiwaangelin Seasons iyo Parts sax ah.\n` +
      `Maamulka: ku qor caption-ka file kasta magaca taxanaha, Season iyo Part.`,
      { parse_mode: "HTML" }
    );
  }

  return ctx.reply(
    `📺 <b>${escapeHtml(seriesItem.title)}</b>${description}\n\n` +
    `Dooro Season-ka aad rabto:`,
    {
      parse_mode: "HTML",
      reply_markup: keyboard
    }
  );
}

async function answerSearch(ctx, query, category = null) {
  const cleaned = String(query || "").trim();
  if (!cleaned) return;

  try {
    const curriculumMatch = cleaned.match(
      /^(\d{1,2}(?:aad)?)\s*[,|]\s*(.+)$/i
    );

    if (!category && curriculumMatch) {
      const curriculum = await searchCurriculum(
        curriculumMatch[1],
        curriculumMatch[2]
      );

      if (!curriculum.length) {
        await ctx.reply("😔 Manhaj ku habboon lama helin. Tusaale: 8aad, Saynis");
        return;
      }

      for (const item of curriculum.slice(0, config.searchLimit)) {
        try {
          await sendResult(ctx, item);
        } catch (error) {
          console.error("Curriculum send failed:", error.message);
        }
      }
      return;
    }

    let seriesResults = [];

    if (!category || category === "series") {
      seriesResults = await searchSeries(cleaned);
    }

    let otherResults = await searchContent(cleaned, category);

    // Series are represented by one result each and opened through Season buttons.
    otherResults = otherResults.filter(item => item.category !== "series");

    if (category === "series") {
      otherResults = [];
    }

    if (!seriesResults.length && !otherResults.length) {
      await ctx.reply(
        "😔 Walaal, wax ku habboon raadintaada lama helin.\n\n" +
        "Hubi higgaadda ama isku day magaca oo dhan."
      );

      await logEvent("search", false, { query: cleaned, category });
      return;
    }

    if (seriesResults.length) {
      await ctx.reply(
        `📺 Waxaan helay ${seriesResults.length} taxane oo ku habboon raadintaada.`
      );

      for (const item of seriesResults.slice(0, config.searchLimit)) {
        try {
          await showSeries(ctx, item);
        } catch (error) {
          console.error("Showing series failed:", error.message);
        }
      }
    }

    let sent = 0;

    for (const item of otherResults.slice(0, config.searchLimit)) {
      try {
        await sendResult(ctx, item);
        sent++;
      } catch (error) {
        console.error("Sending result failed:", {
          title: item.title,
          id: item.id,
          message: error.message
        });
      }
    }

    await logEvent(
      "search",
      seriesResults.length > 0 || sent > 0,
      {
        query: cleaned,
        category,
        seriesCount: seriesResults.length,
        otherCount: sent
      }
    );
  } catch (error) {
    console.error("Search error:", error);

    await ctx.reply(
      "⚠️ Walaal, cilad yar ayaa raadinta ka dhacday. Fadlan mar kale isku day."
    );

    await logEvent("search", false, {
      query: cleaned,
      category,
      error: error.message
    });
  }
}

async function handleSeriesCallback(ctx) {
  const data = String(ctx.callbackQuery?.data || "");

  if (!data.startsWith("series:")) return false;

  await ctx.answerCallbackQuery();

  if (data === "series:search_help") {
    await ctx.reply("🔎 Fadlan dib u qor magaca taxanaha aad rabto.");
    return true;
  }

  const seasonMatch = data.match(/^series:season:(\d+):(\d+)$/);

  if (seasonMatch) {
    const seriesId = seasonMatch[1];
    const seasonNumber = Number(seasonMatch[2]);

    const seriesItem = await findContentById(seriesId);

    if (!seriesItem || seriesItem.category !== "series") {
      await ctx.reply("Taxanahan lama helin. Fadlan magaca mar kale raadi.");
      return true;
    }

    const parts = await getSeriesParts(
      seriesItem.normalized_title,
      seasonNumber
    );

    if (!parts.length) {
      await ctx.reply(`Season ${seasonNumber} weli qaybo laguma hayo.`);
      return true;
    }

    const keyboard = new InlineKeyboard();

    for (const part of parts) {
      keyboard.text(
        `Part ${part.part_number}`,
        `series:part:${part.id}`
      );

      if (
        keyboard.inline_keyboard[keyboard.inline_keyboard.length - 1].length >= 3
      ) {
        keyboard.row();
      }
    }

    keyboard.row().text("↩️ Seasons-ka", `series:open:${seriesItem.id}`);

    await ctx.reply(
      `📺 <b>${escapeHtml(seriesItem.title)}</b>\n` +
      `<b>Season ${seasonNumber}</b>\n\n` +
      `Dooro qaybta aad rabto:`,
      {
        parse_mode: "HTML",
        reply_markup: keyboard
      }
    );

    return true;
  }

  const openMatch = data.match(/^series:open:(\d+)$/);

  if (openMatch) {
    const item = await findContentById(openMatch[1]);

    if (!item || item.category !== "series") {
      await ctx.reply("Taxanahan lama helin.");
      return true;
    }

    await showSeries(ctx, item);
    return true;
  }

  const partMatch = data.match(/^series:part:(\d+)$/);

  if (partMatch) {
    const item = await findContentById(partMatch[1]);

    if (!item || item.category !== "series" || !item.active) {
      await ctx.reply("Qaybtan lama helin ama hadda lama heli karo.");
      return true;
    }

    try {
      await sendResult(ctx, item);
    } catch (error) {
      console.error("Sending selected series part failed:", error);
      await ctx.reply(
        "⚠️ Qaybtan waa la helay laakiin diristeedu way fashilantay."
      );
    }

    return true;
  }

  return true;
}

bot.use(async (ctx, next) => {
  await safeTrack(ctx);
  await next();
});

bot.command("start", ctx =>
  ctx.reply(MESSAGES.start, { parse_mode: "Markdown" })
);

bot.command("film_baare", ctx =>
  ctx.reply(MESSAGES.film, { parse_mode: "Markdown" })
);

bot.command("buug_baare", ctx =>
  ctx.reply(MESSAGES.book, { parse_mode: "Markdown" })
);

bot.command("manhaj_ka_dowlada", ctx =>
  ctx.reply(MESSAGES.curriculum, { parse_mode: "Markdown" })
);

bot.command(["Invitefriends", "invitefriends"], ctx =>
  ctx.reply(MESSAGES.invite, {
    parse_mode: "Markdown",
    reply_markup: inviteKeyboard()
  })
);

bot.command("caawimad_taagero", ctx =>
  ctx.reply(MESSAGES.support, { parse_mode: "Markdown" })
);

bot.command("miskiiney", ctx =>
  ctx.reply(MESSAGES.group, { parse_mode: "Markdown" })
);

bot.command("admin", ctx => showAdmin(ctx));

bot.on("callback_query:data", async ctx => {
  try {
    if (await handleSeriesCallback(ctx)) return;
    await handleCallback(ctx);
  } catch (error) {
    console.error("Callback error:", error);

    try {
      await ctx.answerCallbackQuery({
        text: "Cilad ayaa dhacday. Mar kale isku day."
      });
    } catch (_) {}
  }
});

bot.on("message", async ctx => {
  if (!ctx.message || ctx.message.chat.type === "channel") return;

  if (await handleAdminMessage(ctx)) return;

  const text = ctx.message.text?.trim();
  if (!text || text.startsWith("/")) return;

  if (ctx.chat.type !== "private") {
    if (
      config.groupChatId &&
      String(ctx.chat.id) !== String(config.groupChatId)
    ) {
      return;
    }

    const mention = new RegExp(
      `@${config.botUsername}\\b`,
      "i"
    ).test(text);

    const repliedToBot =
      ctx.message.reply_to_message?.from?.id === bot.botInfo?.id;

    if (!mention && !repliedToBot) return;
  }

  const curriculumMatch = text.match(
    /^(\d{1,2}(?:aad)?)\s*[,|]\s*(.+)$/i
  );

  if (curriculumMatch) {
    return answerSearch(ctx, text, "curriculum");
  }

  return answerSearch(ctx, text);
});

async function handleChannelPost(ctx) {
  try {
    const post = ctx.channelPost || ctx.editedChannelPost;
    if (!post) return;

    const category = CATEGORY_BY_CHANNEL[String(post.chat.id)];
    if (!category) {
      console.log(`Ignored post from unconfigured channel ${post.chat.id}`);
      return;
    }

    await indexChannelPost(ctx, category);

    console.log(
      `Indexed channel post ${post.chat.id}/${post.message_id} (${category})`
    );
  } catch (error) {
    console.error("Channel indexing failed:", error);

    await logEvent("channel_index", false, {
      channelId: ctx.channelPost?.chat?.id || ctx.editedChannelPost?.chat?.id,
      messageId: ctx.channelPost?.message_id || ctx.editedChannelPost?.message_id,
      error: error.message
    });
  }
}

bot.on("channel_post", handleChannelPost);
bot.on("edited_channel_post", handleChannelPost);

bot.catch(error => {
  console.error("Bot error:", error.error || error);
});

module.exports = {
  bot,
  MESSAGES
};
