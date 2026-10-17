require("dotenv").config();

function required(name) {
  const value = process.env[name];
  if (!value || !value.trim()) throw new Error(`Missing required environment variable: ${name}`);
  return value.trim();
}
function channelId(name) {
  const value = process.env[name];
  if (!value || !value.trim()) throw new Error(`Missing required environment variable: ${name}`);
  if (!/^-?\d+$/.test(value.trim())) throw new Error(`${name} must be a numeric Telegram chat ID`);
  return value.trim();
}
const adminIds = (process.env.ADMIN_IDS || "")
  .split(",").map(x => x.trim()).filter(Boolean).map(Number).filter(Number.isSafeInteger);

module.exports = {
  token: required("BOT_TOKEN"),
  databaseUrl: required("DATABASE_URL"),
  adminIds,
  port: Number(process.env.PORT || 3000),
  webhookUrl: (process.env.WEBHOOK_URL || "").trim().replace(/\/+$/, ""),
  webhookSecret: process.env.WEBHOOK_SECRET || "change-this-secret",
  nodeEnv: process.env.NODE_ENV || "development",
  channels: {
    films: channelId("FILMS_CHANNEL_ID"),
    series: channelId("SERIES_CHANNEL_ID"),
    books: channelId("BOOKS_CHANNEL_ID"),
    curriculum: channelId("CURRICULUM_CHANNEL_ID")
  },
  groupChatId: (process.env.GROUP_CHAT_ID || "").trim(),
  groupWelcomeEnabled: (process.env.GROUP_WELCOME_ENABLED || "true").toLowerCase() === "true",
  botUsername: (process.env.BOT_USERNAME || "Miskiineybot").replace(/^@/, ""),
  supportUsername: (process.env.SUPPORT_USERNAME || "Desing_La_KingS99").replace(/^@/, ""),
  systemSupportPhone: process.env.SYSTEM_SUPPORT_PHONE || "252687768306",
  openRouterKey: (process.env.OPENROUTER_API_KEY || "").trim(),
  openRouterModel: process.env.OPENROUTER_MODEL || "openai/gpt-4o-mini",
  openRouterBaseUrl: (process.env.OPENROUTER_BASE_URL || "https://openrouter.ai/api/v1").replace(/\/+$/, ""),
  aiEnabled: (process.env.AI_ENABLED || "false").toLowerCase() === "true",
  searchLimit: Math.max(1, Math.min(20, Number(process.env.SEARCH_LIMIT || 8))),
  broadcastDelayMs: Math.max(0, Number(process.env.BROADCAST_DELAY_MS || 40))
};
