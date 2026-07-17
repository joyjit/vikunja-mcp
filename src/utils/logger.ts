import { format } from 'util';
import { sanitizeLogData } from './security';

export enum LogLevel {
  ERROR = 0,
  WARN = 1,
  INFO = 2,
  DEBUG = 3,
}

class Logger {
  private level: LogLevel;
  private readonly levelNames: Record<LogLevel, string> = {
    [LogLevel.ERROR]: 'ERROR',
    [LogLevel.WARN]: 'WARN',
    [LogLevel.INFO]: 'INFO',
    [LogLevel.DEBUG]: 'DEBUG',
  };

  constructor() {
    this.level = this.resolveLevel();
  }

  private resolveLevel(): LogLevel {
    const rawLevel = process.env.LOG_LEVEL?.toLowerCase();
    const levelMap: Record<string, LogLevel> = {
      error: LogLevel.ERROR,
      warn: LogLevel.WARN,
      info: LogLevel.INFO,
      debug: LogLevel.DEBUG,
    };

    if (rawLevel) {
      const mapped = levelMap[rawLevel];
      if (mapped !== undefined) {
        return mapped;
      }
    }

    if (process.env.DEBUG === 'true') {
      return LogLevel.DEBUG;
    }

    // Invalid LOG_LEVEL with DEBUG=true is handled above; otherwise default INFO
    return LogLevel.INFO;
  }

  /**
   * Redact secrets from structured log args before they hit stderr.
   * Errors keep util.format's readable stack; plain strings stay as-is
   * (callers must not interpolate credentials into the message).
   */
  private sanitizeArgs(args: unknown[]): unknown[] {
    return args.map((arg) => {
      if (arg instanceof Error) {
        return arg;
      }
      if (arg !== null && typeof arg === 'object') {
        return sanitizeLogData(arg);
      }
      return arg;
    });
  }

  private log(level: LogLevel, message: string, ...args: unknown[]): void {
    if (level <= this.level) {
      const timestamp = new Date().toISOString();
      const levelStr = this.levelNames[level];
      const formattedMessage = format(message, ...this.sanitizeArgs(args));

      // Always use console.error for MCP servers as stdout is reserved for protocol
      console.error(`[${timestamp}] [${levelStr}] ${formattedMessage}`);
    }
  }

  error(message: string, ...args: unknown[]): void {
    this.log(LogLevel.ERROR, message, ...args);
  }

  warn(message: string, ...args: unknown[]): void {
    this.log(LogLevel.WARN, message, ...args);
  }

  info(message: string, ...args: unknown[]): void {
    this.log(LogLevel.INFO, message, ...args);
  }

  debug(message: string, ...args: unknown[]): void {
    this.log(LogLevel.DEBUG, message, ...args);
  }
}

export const logger = new Logger();
