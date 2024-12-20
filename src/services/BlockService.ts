const blockedErrors = {
  permanent: [
    'blacklisted',
    'blacklistado',
    'Spamhaus',
    'Barracuda',
    'barracuda',
    "The IP you're using to send mail is not authorized",
    'Spam message rejected',
    'www.spamhaus.org',
    'SPFBL permanently blocked',
    'SPFBL BLOCKED',
    'banned sending IP',
    'on our block list',
    '550 5.7.1',
    '554 Refused',
    'access denied',
    'blocked by policy',
    'IP blacklisted',
    'too many bad commands',
    'rejected due to policy'
  ],
  temporary: [
    '(S3114)',
    '(S844)',
    '(S3115)',
    'temporarily rate limited',
    '421 Temporary Failure',
    '421 4.7.0',
    'try again later',
    'unfortunately, messages from',
    'can not connect to any SMTP server',
    'Too many complaints',
    'Connection timed out',
    'Limit exceeded ip',
    'temporarily deferred'
  ]
};

class BlockService {
  isPermanentError(message: string): boolean {
    return blockedErrors.permanent.some((err) => message.includes(err));
  }

  isTemporaryError(message: string): boolean {
    return blockedErrors.temporary.some((err) => message.includes(err));
  }
}

export default new BlockService();
