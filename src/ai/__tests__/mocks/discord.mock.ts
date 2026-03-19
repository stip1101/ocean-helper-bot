export interface MockMessageOptions {
  content?: string;
  authorId?: string;
  mentionedUserIds?: string[];
  reference?: { messageId: string } | null;
}

export interface MockMessage {
  content: string;
  author: {
    id: string;
  };
  mentions: {
    has: (userId: string) => boolean;
  };
  reference: { messageId: string } | null;
}

export function createMockMessage(options: MockMessageOptions = {}): MockMessage {
  const {
    content = 'Test message',
    authorId = '123456789012345678',
    mentionedUserIds = [],
    reference = null,
  } = options;

  return {
    content,
    author: {
      id: authorId,
    },
    mentions: {
      has: (userId: string) => mentionedUserIds.includes(userId),
    },
    reference,
  };
}

export function generateValidUserId(length: 17 | 18 | 19 = 18): string {
  const start = length === 17 ? '1' : length === 18 ? '10' : '100';
  const remaining = length - start.length;
  let id = start;
  for (let i = 0; i < remaining; i++) {
    id += Math.floor(Math.random() * 10).toString();
  }
  return id;
}
