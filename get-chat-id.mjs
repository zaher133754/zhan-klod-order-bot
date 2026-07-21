const token = process.env.TELEGRAM_BOT_TOKEN?.trim();

if (!token) {
  console.error("Добавьте TELEGRAM_BOT_TOKEN в корневой файл .env.local.");
  process.exit(1);
}

const response = await fetch(`https://api.telegram.org/bot${token}/getUpdates`);
const result = await response.json();

if (!response.ok || !result.ok) {
  console.error(result.description || `Telegram API: HTTP ${response.status}`);
  process.exit(1);
}

const chats = new Map();
for (const update of result.result) {
  const chat = update.message?.chat || update.channel_post?.chat;
  if (chat) {
    chats.set(String(chat.id), {
      id: chat.id,
      type: chat.type,
      name:
        chat.title ||
        [chat.first_name, chat.last_name].filter(Boolean).join(" ") ||
        chat.username
    });
  }
}

if (chats.size === 0) {
  console.log(
    "Чаты не найдены. Откройте бота в Telegram, нажмите Start, отправьте ему любое сообщение и запустите команду ещё раз."
  );
} else {
  console.table([...chats.values()]);
  console.log("Скопируйте нужный id в TELEGRAM_CHAT_ID файла .env.local.");
}

