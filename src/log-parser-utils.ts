export interface QueueMapping {
  queueId: string;
  mailId: string;
}

export interface DeliveryParseResult {
  queueId: string;
  email: string;
  status: string;
  detail: string;
  mailId?: string;
}

export function normalizeMailId(value: string): string {
  return value.replace(/[<>]/g, '').trim();
}

export function parseQueueMappingLine(line: string): QueueMapping | null {
  const match = line.match(
    /postfix\/cleanup\[\d+\]:\s+([A-Za-z0-9]+):\s+message-id=<([^>]+)>/
  );
  if (!match) {
    return null;
  }

  const [, queueId, rawMailId] = match;
  return { queueId: queueId.toUpperCase(), mailId: normalizeMailId(rawMailId) };
}

export function parseDeliveryLine(line: string): DeliveryParseResult | null {
  const match = line.match(
    /postfix\/(?:smtp|local|pipe|lmtp)\[\d+\]:\s+([A-Za-z0-9]+):\s+.*?\bto=<([^>]+)>.*?\bstatus=([A-Za-z]+)(?: \((.*)\))?/
  );
  if (!match) {
    return null;
  }

  const [, queueId, email, status, detail] = match;
  const messageIdMatch = line.match(/message-id=<([^>]+)>/);
  const mailId = messageIdMatch ? normalizeMailId(messageIdMatch[1]) : undefined;

  return {
    queueId: queueId.toUpperCase(),
    email,
    status: status.toLowerCase(),
    detail: detail || status,
    mailId,
  };
}
