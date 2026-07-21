export async function broadcast(recipients, deliver) {
  const uniqueRecipients = [...new Set(recipients.map(String))];
  const deliveries = await Promise.allSettled(
    uniqueRecipients.map((chatId) => deliver(chatId))
  );
  const failures = deliveries
    .map((delivery, index) => ({
      delivery,
      chatId: uniqueRecipients[index]
    }))
    .filter(({ delivery }) => delivery.status === "rejected")
    .map(({ delivery, chatId }) => ({ chatId, reason: delivery.reason }));

  return {
    delivered: deliveries.length - failures.length,
    failures
  };
}
