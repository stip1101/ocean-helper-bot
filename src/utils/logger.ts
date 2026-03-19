import pino from 'pino';

const isDev = process.env.NODE_ENV !== 'production';

export const logger = pino({
  level: process.env.LOG_LEVEL || (isDev ? 'debug' : 'info'),
  transport: isDev
    ? {
        target: 'pino-pretty',
        options: { colorize: true },
      }
    : undefined,
  formatters: {
    level: (label) => ({ level: label }),
  },
  base: { service: 'on-ai-helper' },
});

export const botLogger = logger.child({ module: 'bot' });
export const stateLogger = logger.child({ module: 'state' });
