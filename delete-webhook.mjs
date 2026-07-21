const token = process.env.TELEGRAM_BOT_TOKEN?.trim();

if (!token) {
  console.error("Добавьте TELEGRAM_BOT_TOKEN в корневой файл .env.local.");
  process.exit(1);
}

const response = await fetch(
  `https://api.telegram.org/bot${token}/deleteWebhook`
);
const result = await response.json();

if (!response.ok || !result.ok) {
  console.error(result.description || `Telegram API: HTTP ${response.status}`);
  process.exit(1);
}

console.log("✓ Webhook удалён. Теперь отправьте боту /start.");

