const { createLogger, format, transports } = require('winston');
const DailyRotateFile = require('winston-daily-rotate-file');

const logFormat = format.combine(
  format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  format.printf(({ timestamp, level, message }) => `${timestamp} [${level.toUpperCase()}] ${message}`)
);

const logger = createLogger({
  level: 'info',
  format: logFormat,
  transports: [
    new transports.Console(),
    new DailyRotateFile({
      filename:    'logs/combined-%DATE%.log',
      datePattern: 'YYYY-MM-DD',
      maxFiles:    '14d',
    }),
    new DailyRotateFile({
      filename:    'logs/error-%DATE%.log',
      datePattern: 'YYYY-MM-DD',
      level:       'error',
      maxFiles:    '14d',
    }),
  ],
});

module.exports = logger;
