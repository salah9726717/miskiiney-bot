const http = require("http");
const config = require("./config");
const { initDb, pool } = require("./database");
const { bot } = require("./bot");

async function main() {
  await initDb();
  console.log("PostgreSQL schema ready.");

  const server = http.createServer((req, res) => {
    if (req.url === "/health" && req.method === "GET") {
      res.writeHead(200, { "content-type": "application/json" });
      return res.end(JSON.stringify({ ok: true, service: "miskiiney-bot", uptime: Math.round(process.uptime()) }));
    }
    if (req.url === "/" && req.method === "GET") {
      res.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
      return res.end("Miskiiney Bot is running.");
    }
    if (config.webhookUrl && req.url === `/telegram/${config.webhookSecret}` && req.method === "POST") {
      const receivedSecret = req.headers["x-telegram-bot-api-secret-token"];
      if (receivedSecret !== config.webhookSecret) {
        res.writeHead(403); return res.end("Forbidden");
      }
      let body = "";
      req.on("data", chunk => { body += chunk; if (body.length > 2e6) req.destroy(); });
      req.on("end", async () => {
        try {
          const update = JSON.parse(body);
          await bot.handleUpdate(update);
          res.writeHead(200); res.end("OK");
        } catch (e) {
          console.error("Webhook update failed:", e);
          res.writeHead(500); res.end("ERROR");
        }
      });
      return;
    }
    res.writeHead(404); res.end("Not found");
  });

  if (config.webhookUrl) {
    server.listen(config.port, async () => {
      const path = `/telegram/${config.webhookSecret}`;
      const webhook = `${config.webhookUrl}${path}`;
      await bot.api.setWebhook(webhook, {
        secret_token: config.webhookSecret,
        allowed_updates: ["message", "callback_query", "channel_post", "edited_channel_post"]
      });
      console.log(`Webhook mode active at ${webhook}`);
    });
  } else {
    server.listen(config.port, () => console.log(`Health server listening on ${config.port}; starting long polling.`));
    await bot.api.deleteWebhook({ drop_pending_updates: false });
    await bot.start({
      allowed_updates: ["message", "callback_query", "channel_post", "edited_channel_post"],
      onStart: info => console.log(`Miskiiney Bot started as @${info.username}`)
    });
  }

  const shutdown = async signal => {
    console.log(`Received ${signal}; shutting down...`);
    try { await bot.stop(); } catch (_) {}
    server.close();
    await pool.end();
    process.exit(0);
  };
  process.once("SIGINT", () => shutdown("SIGINT"));
  process.once("SIGTERM", () => shutdown("SIGTERM"));
}
main().catch(err => {
  console.error("Fatal startup error:", err);
  process.exit(1);
});
