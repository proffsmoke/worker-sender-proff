import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import LogParser, { LogEntry } from '../../src/log-parser';

test('LogParser correlates postfix queueId with mailId before processing', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'log-parser-'));
  const logFilePath = path.join(tempDir, 'mail.log');
  fs.writeFileSync(logFilePath, '');

  const logParser = new LogParser(logFilePath);
  const processed: LogEntry[] = [];

  (logParser as any).processLogEntry = async (entry: LogEntry) => {
    processed.push(entry);
  };

  const deliveryLine =
    'Sep 12 12:34:57 host postfix/smtp[5678]: ABCDEF1234: to=<user@example.com>, relay=mx.example.com[1.2.3.4]:25, delay=1, delays=0.1/0.1/0.5/0.3, dsn=2.0.0, status=sent (250 2.0.0 Ok: queued as ABCDEF1234)';
  await (logParser as any).handleLogLine(deliveryLine);

  assert.equal(processed.length, 0);

  const mappingLine =
    'Sep 12 12:34:56 host postfix/cleanup[1234]: ABCDEF1234: message-id=<mid@example.com>';
  await (logParser as any).handleLogLine(mappingLine);

  await new Promise((resolve) => setTimeout(resolve, 20));

  assert.equal(processed.length, 1);
  assert.equal(processed[0].queueId, 'ABCDEF1234');
  assert.equal(processed[0].mailId, 'mid@example.com');
  assert.equal(logParser.getQueueIdByMailId('mid@example.com'), 'ABCDEF1234');

  (logParser as any).tail?.unwatch?.();
});
