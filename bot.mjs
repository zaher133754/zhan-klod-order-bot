const token = process.env.TELEGRAM_BOT_TOKEN?.trim();

if (!token) {
  console.error("Добавьте TELEGRAM_BOT_TOKEN в файл окружения.");
  process.exit(1);
}

const apiUrl = `https://api.telegram.org/bot${token}`;
const startedAt = Date.now();
const setupOnly = process.argv.includes("--setup");
let offset = 0;
let stopping = false;

const keyboard = {
  keyboard: [[{ text: "/start" }, { text: "Статус" }]],
  resize_keyboard: true,
  is_persistent: true
};

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
}

process.once("SIGINT", stop);
process.once("SIGTERM", stop);

try {
  await configureMenu();
  const bot = await telegram("getMe");
  if (setupOnly) {
    console.log(`Меню бота @${bot.username} настроено.`);
  } else {
    console.log(`Бот @${bot.username} запущен. Нажмите Ctrl+C для остановки.`);
    await poll();
  }
} catch (error) {
  console.error("Не удалось запустить бота:", error.message);
  process.exitCode = 1;
}
