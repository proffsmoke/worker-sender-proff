// src/services/BlockService.ts

const blockedErrors = {
  permanent: [
    'blacklisted',
    'blacklistado',
    'spamhaus',
    'barracuda',
    'banned sending ip',
    "the ip you're using to send mail is not authorized",
    'spam message rejected',
    'www.spamhaus.org',
    'spfbl permanently blocked',
    'spfbl blocked',
    'banned sending ip',
    'on our block list',
    '550 5.7',
    '554 refused',
    'access denied',
    'blocked by policy',
    'ip blacklisted',
    'too many bad commands',
    'rejected due to policy'
  ],
  temporary: [
    '(s3114)',
    '(s844)',
    '(s3115)',
    'temporarily rate limited',
    '421 temporary failure',
    '421 4.7.0',
    'try again later',
    'unfortunately, messages from',
    'can not connect to any smtp server',
    'too many complaints',
    'connection timed out',
    'limit exceeded ip',
    'temporarily deferred'
  ]
};

class BlockService {
  isPermanentError(message: string): boolean {
    const lowerMessage = message.toLowerCase();
    return blockedErrors.permanent.some((err) => lowerMessage.includes(err));
  }

  isTemporaryError(message: string): boolean {
    const lowerMessage = message.toLowerCase();
    return blockedErrors.temporary.some((err) => lowerMessage.includes(err));
  }
}

export default new BlockService();
