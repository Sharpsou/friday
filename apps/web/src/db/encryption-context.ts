export function taskAad(taskId: string, deviceId: string): string {
  return `tasks:${taskId}:1:${deviceId}`;
}

export function groceryItemAad(itemId: string, deviceId: string): string {
  return `grocery-items:${itemId}:1:${deviceId}`;
}

export function groceryClassificationAad(
  itemId: string,
  deviceId: string,
): string {
  return `grocery-classifications:${itemId}:1:${deviceId}`;
}

export function outboxAad(operationId: string, deviceId: string): string {
  return `outbox:${operationId}:1:${deviceId}`;
}
