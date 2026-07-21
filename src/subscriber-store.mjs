import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

function normalizeChatId(chatId) {
  const value = String(chatId).trim();
  if (!/^-?\d+$/.test(value)) {
    throw new TypeError(`Invalid Telegram chat id: ${value}`);
  }
  return value;
}

export class SubscriberStore {
  #chatIds = new Set();
  #filePath;
  #writeQueue = Promise.resolve();

  constructor(filePath) {
    this.#filePath = filePath;
  }

  async load() {
    let contents;
    try {
      contents = await readFile(this.#filePath, "utf8");
    } catch (error) {
      if (error?.code === "ENOENT") return;
      throw error;
    }

    const data = JSON.parse(contents);
    if (!Array.isArray(data?.chatIds)) {
      throw new Error(`Invalid subscribers file: ${this.#filePath}`);
    }

    this.#chatIds = new Set(data.chatIds.map(normalizeChatId));
  }

  values() {
    return [...this.#chatIds];
  }

  async add(chatId) {
    const normalizedChatId = normalizeChatId(chatId);
    if (this.#chatIds.has(normalizedChatId)) return false;

    this.#chatIds.add(normalizedChatId);
    await this.#persist();
    return true;
  }

  #persist() {
    this.#writeQueue = this.#writeQueue
      .catch(() => {})
      .then(async () => {
        await mkdir(dirname(this.#filePath), { recursive: true });
        const temporaryPath = `${this.#filePath}.${process.pid}.tmp`;
        const contents = `${JSON.stringify({ chatIds: this.values() }, null, 2)}\n`;
        await writeFile(temporaryPath, contents, "utf8");
        await rename(temporaryPath, this.#filePath);
      });

    return this.#writeQueue;
  }
}
