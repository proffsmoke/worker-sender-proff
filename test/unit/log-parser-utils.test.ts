import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  normalizeMailId,
  parseDeliveryLine,
  parseQueueMappingLine,
} from '../../src/log-parser-utils';

test('normalizeMailId removes angle brackets and trims', () => {
  assert.equal(normalizeMailId(' <test-id@example.com> '), 'test-id@example.com');
});

test('parseQueueMappingLine extracts queueId and mailId', () => {
  const line =
    'Sep 12 12:34:56 host postfix/cleanup[1234]: ABCDEF1234: message-id=<test-123@example.com>';
  const result = parseQueueMappingLine(line);

  assert.ok(result);
  assert.equal(result?.queueId, 'ABCDEF1234');
  assert.equal(result?.mailId, 'test-123@example.com');
});

test('parseDeliveryLine extracts delivery data', () => {
  const line =
    'Sep 12 12:34:57 host postfix/smtp[5678]: ABCDEF1234: to=<user@example.com>, relay=mx.example.com[1.2.3.4]:25, delay=1, delays=0.1/0.1/0.5/0.3, dsn=2.0.0, status=sent (250 2.0.0 Ok: queued as ABCDEF1234)';
  const result = parseDeliveryLine(line);

  assert.ok(result);
  assert.equal(result?.queueId, 'ABCDEF1234');
  assert.equal(result?.email, 'user@example.com');
  assert.equal(result?.status, 'sent');
  assert.equal(result?.detail, '250 2.0.0 Ok: queued as ABCDEF1234');
});
