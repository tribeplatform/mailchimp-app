import { existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { LOG_DIR, LOG_FORMAT, LOGGER_PRETTY_PRINT, NODE_ENV } from '@config';
import { Logger, LoggerLevel } from '@tribeplatform/node-logger';

const logDir: string = join(__dirname, LOG_DIR);

if (!existsSync(logDir)) {
  mkdirSync(logDir);
}


const createLogger = (context: string = 'Global'): Logger => new Logger({
  pretty: LOGGER_PRETTY_PRINT ? LOGGER_PRETTY_PRINT === 'true' : NODE_ENV === 'production' ? false : true,
  level: (LOG_FORMAT as LoggerLevel) || 'info',
  context,
});

const logger = createLogger('Global')

const stream = {
  write: (message: string) => {
    logger.log(message.substring(0, message.lastIndexOf('\n')));
  },
};

export { logger, stream, createLogger };
