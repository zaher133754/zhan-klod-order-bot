import { createHash, timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";

const token = process.env.TELEGRAM_BOT_TOKEN?.trim();

if (!token) {
  console.error("Добавьте TELEGRAM_BOT_TOKEN в файл окружения.");
  process.exit(1);
}

const apiUrl = `https://api.telegram.org/bot${token}`;
const startedAt = Date.now();
const setupOnly = process.argv.includes("--setup");
const relayChatId = process.env.TELEGRAM_CHAT_ID?.trim();
const relaySecret = process.env.TELEGRAM_RELAY_SECRET?.trim();
const configuredPort = Number(process.env.PORT || 3000);
const relayPort =
  Number.isInteger(configuredPort) && configuredPort > 0
    ? configuredPort
    : 3000;
let offset = 0;
let stopping = false;
let relayServer;

const keyboard = {
  keyboard: [[{ text: "/start" }, { text: "Статус" }]],
  resize_keyboard: true,
  is_persistent: true
};

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff"
  });
  response.end(JSON.stringify(payload));
}

function secureEqual(left, right) {
  const leftHash = createHash("sha256").update(left).digest();
  const rightHash = createHash("sha256").update(right).digest();
  return timingSafeEqual(leftHash, rightHash);
}

async function readJson(request) {
  const chunks = [];
  let length = 0;

  for await (const chunk of request) {
    length += chunk.length;
    if (length > 20_000) {
      throw new Error("REQUEST_TOO_LARGE");
    }
    chunks.push(chunk);
  }

  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

async function telegram(method, body = {}, signal) {
  const response = await fetch(`${apiUrl}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal
  });
  const result = await response.json();

  if (!response.ok || !result.ok) {
    throw new Error(result.description || `Telegram API: HTTP ${response.status}`);
  }

  return result.result;
}

function formatUptime(milliseconds) {
  const totalSeconds = Math.floor(milliseconds / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  return [
    hours > 0 ? `${hours} ч` : null,
    minutes > 0 ? `${minutes} мин` : null,
    `${seconds} сек`
  ]
    .filter(Boolean)
    .join(" ");
}

async function sendMessage(chatId, text) {
  await telegram("sendMessage", {
    chat_id: chatId,
    text,
    reply_markup: keyboard
  });
}

async function handleRelayRequest(request, response) {
  const url = new URL(request.url || "/", "http://localhost");

  if (request.method === "GET" && url.pathname === "/health") {
    sendJson(response, 200, {
      ok: true,
      uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000)
    });
    return;
  }

  if (request.method !== "POST" || url.pathname !== "/telegram/order") {
    sendJson(response, 404, { ok: false, error: "Not found" });
    return;
  }

  if (!relayChatId || !relaySecret) {
    sendJson(response, 503, { ok: false, error: "Relay is not configured" });
    return;
  }

  const authorization = request.headers.authorization || "";
  const providedSecret = authorization.startsWith("Bearer ")
    ? authorization.slice(7)
    : "";

  if (!providedSecret || !secureEqual(providedSecret, relaySecret)) {
    sendJson(response, 401, { ok: false, error: "Unauthorized" });
    return;
  }

  let payload;
  try {
    payload = await readJson(request);
  } catch (error) {
    const isTooLarge = error instanceof Error && error.message === "REQUEST_TOO_LARGE";
    sendJson(response, isTooLarge ? 413 : 400, {
      ok: false,
      error: isTooLarge ? "Request is too large" : "Invalid JSON"
    });
    return;
  }

  const text = typeof payload.text === "string" ? payload.text.trim() : "";
  if (!text || text.length > 3900) {
    sendJson(response, 400, { ok: false, error: "Invalid message text" });
    return;
  }

  try {
    await telegram("sendMessage", {
      chat_id: relayChatId,
      text,
      disable_notification: payload.silent === true,
      link_preview_options: { is_disabled: true }
    });
    sendJson(response, 200, { ok: true });
  } catch (error) {
    console.error("Не удалось отправить заказ в Telegram:", error.message);
    sendJson(response, 502, {
      ok: false,
      error: error instanceof Error ? error.message : "Telegram delivery failed"
    });
  }
}

function startRelayServer() {
  relayServer = createServer((request, response) => {
    handleRelayRequest(request, response).catch((error) => {
      console.error("Ошибка HTTP relay:", error.message);
      if (!response.headersSent) {
        sendJson(response, 500, { ok: false, error: "Internal server error" });
      } else {
        response.end();
      }
    });
  });

  relayServer.listen(relayPort, "127.0.0.1", () => {
    console.log(`HTTP relay запущен на порту ${relayPort}.`);
  });
}

async function handleMessage(message) {
  const text = message.text?.trim();
  if (!text) return;

  const command = text.split(/\s+/, 1)[0].toLowerCase().split("@", 1)[0];

  if (command === "/start") {
    await sendMessage(
      message.chat.id,
      "Бот запущен и работает. Используйте кнопку «Статус», чтобы проверить его состояние."
    );
    return;
  }

  if (command === "/status" || text.toLowerCase() === "статус") {
    await sendMessage(
      message.chat.id,
      `✅ Бот работает\nВремя работы: ${formatUptime(Date.now() - startedAt)}`
    );
  }
}

async function configureMenu() {
  await telegram("setMyCommands", {
    commands: [
      { command: "start", description: "Запустить бота" },
      { command: "status", description: "Проверить статус бота" }
    ]
  });
  await telegram("setChatMenuButton", {
    menu_button: { type: "commands" }
  });
}

async function poll() {
  while (!stopping) {
    const controller = new AbortController();
    const stopPolling = () => controller.abort();
    process.once("SIGINT", stopPolling);
    process.once("SIGTERM", stopPolling);

    try {
      const updates = await telegram(
        "getUpdates",
        {
          offset,
          timeout: 50,
          allowed_updates: ["message"]
        },
        controller.signal
      );

      for (const update of updates) {
        offset = update.update_id + 1;
        if (update.message) {
          try {
            await handleMessage(update.message);
          } catch (error) {
            console.error("Не удалось ответить на сообщение:", error.message);
          }
        }
      }
    } catch (error) {
      if (error.name !== "AbortError" && !stopping) {
        console.error("Ошибка соединения с Telegram:", error.message);
        await new Promise((resolve) => setTimeout(resolve, 3000));
      }
    } finally {
      process.removeListener("SIGINT", stopPolling);
      process.removeListener("SIGTERM", stopPolling);
    }
  }
}

function stop() {
  stopping = true;
  relayServer?.close();
}

process.once("SIGINT", stop);
process.once("SIGTERM", stop);

try {
  await configureMenu();
  const bot = await telegram("getMe");
  if (setupOnly) {
    console.log(`Меню бота @${bot.username} настроено.`);
  } else {
    startRelayServer();
    console.log(`Бот @${bot.username} запущен. Нажмите Ctrl+C для остановки.`);
    await poll();
  }
} catch (error) {
  console.error("Не удалось запустить бота:", error.message);
  process.exitCode = 1;
}
