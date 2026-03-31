// ============================================================================
// @dantecode/core — Enterprise-Grade Structured Logger
// Production-ready logging with filtering, context, and structured output
// ============================================================================

/**
 * Log levels in order of severity
 */
export type LogLevel = "trace" | "debug" | "info" | "warn" | "error" | "fatal";

/**
 * Structured log context - any serializable data
 */
export type LogContext = Record<string, unknown>;

/**
 * Log entry structure
 */
export interface LogEntry {
  level: LogLevel;
  timestamp: string;
  message: string;
  context?: LogContext;
  error?: {
    message: string;
    stack?: string;
    code?: string;
  };
}

/**
 * Logger configuration
 */
export interface LoggerConfig {
  /** Minimum log level to output (default: "info") */
  level: LogLevel;
  /** Pretty print for development (default: false) */
  pretty: boolean;
  /** Include timestamp (default: true) */
  timestamp: boolean;
}

const LOG_LEVELS: Record<LogLevel, number> = {
  trace: 10,
  debug: 20,
  info: 30,
  warn: 40,
  error: 50,
  fatal: 60,
};

/**
 * Enterprise-grade structured logger
 *
 * Usage:
 * ```typescript
 * import { logger } from '@dantecode/core';
 *
 * logger.info({ sessionId, roundNumber }, 'Agent loop started');
 * logger.error({ error, sessionId }, 'Tool execution failed');
 * logger.warn({ usage: 0.85 }, 'Context window at 85%');
 * ```
 */
export class EnterpriseLogger {
  private config: LoggerConfig;

  constructor(config: Partial<LoggerConfig> = {}) {
    this.config = {
      level: (process.env.LOG_LEVEL as LogLevel) || "info",
      pretty: process.env.NODE_ENV === "development",
      timestamp: true,
      ...config,
    };
  }

  /**
   * Check if a log level should be output
   */
  private shouldLog(level: LogLevel): boolean {
    return LOG_LEVELS[level] >= LOG_LEVELS[this.config.level];
  }

  /**
   * Format error object for logging
   */
  private formatError(error: unknown): LogEntry["error"] | undefined {
    if (!error) return undefined;

    if (error instanceof Error) {
      return {
        message: error.message,
        stack: error.stack,
        code: (error as NodeJS.ErrnoException).code,
      };
    }

    return {
      message: String(error),
    };
  }

  /**
   * Write log entry to output
   */
  private write(entry: LogEntry): void {
    if (this.config.pretty) {
      // Pretty format for development
      const colors = {
        trace: "\x1b[90m",
        debug: "\x1b[36m",
        info: "\x1b[32m",
        warn: "\x1b[33m",
        error: "\x1b[31m",
        fatal: "\x1b[35m",
      };
      const reset = "\x1b[0m";
      const color = colors[entry.level];

      console.log(
        `${color}[${entry.level.toUpperCase()}]${reset} ${entry.timestamp} ${entry.message}`,
        entry.context ? JSON.stringify(entry.context, null, 2) : "",
        entry.error ? `\nError: ${entry.error.message}\n${entry.error.stack || ""}` : ""
      );
    } else {
      // JSON format for production (machine-readable)
      console.log(JSON.stringify(entry));
    }
  }

  /**
   * Core logging method
   */
  private log(level: LogLevel, context: LogContext | string, message?: string): void {
    if (!this.shouldLog(level)) return;

    let finalContext: LogContext | undefined;
    let finalMessage: string;

    // Handle overloaded signature: log(level, message) or log(level, context, message)
    if (typeof context === "string") {
      finalMessage = context;
      finalContext = undefined;
    } else {
      finalMessage = message || "";
      finalContext = context;
    }

    // Extract error from context if present
    const error = finalContext?.error;
    const contextWithoutError = error ? { ...finalContext } : finalContext;
    if (contextWithoutError && "error" in contextWithoutError) {
      delete contextWithoutError.error;
    }

    const entry: LogEntry = {
      level,
      timestamp: new Date().toISOString(),
      message: finalMessage,
      context: Object.keys(contextWithoutError || {}).length > 0 ? contextWithoutError : undefined,
      error: this.formatError(error),
    };

    this.write(entry);
  }

  /**
   * Trace-level logging (very verbose)
   */
  trace(context: LogContext, message: string): void;
  trace(message: string): void;
  trace(contextOrMessage: LogContext | string, message?: string): void {
    this.log("trace", contextOrMessage as LogContext, message);
  }

  /**
   * Debug-level logging (verbose)
   */
  debug(context: LogContext, message: string): void;
  debug(message: string): void;
  debug(contextOrMessage: LogContext | string, message?: string): void {
    this.log("debug", contextOrMessage as LogContext, message);
  }

  /**
   * Info-level logging (default)
   */
  info(context: LogContext, message: string): void;
  info(message: string): void;
  info(contextOrMessage: LogContext | string, message?: string): void {
    this.log("info", contextOrMessage as LogContext, message);
  }

  /**
   * Warning-level logging
   */
  warn(context: LogContext, message: string): void;
  warn(message: string): void;
  warn(contextOrMessage: LogContext | string, message?: string): void {
    this.log("warn", contextOrMessage as LogContext, message);
  }

  /**
   * Error-level logging
   */
  error(context: LogContext, message: string): void;
  error(message: string): void;
  error(contextOrMessage: LogContext | string, message?: string): void {
    this.log("error", contextOrMessage as LogContext, message);
  }

  /**
   * Fatal-level logging (highest severity)
   */
  fatal(context: LogContext, message: string): void;
  fatal(message: string): void;
  fatal(contextOrMessage: LogContext | string, message?: string): void {
    this.log("fatal", contextOrMessage as LogContext, message);
  }

  /**
   * Create a child logger with persistent context
   */
  child(context: LogContext): EnterpriseLogger {
    const childLogger = new EnterpriseLogger(this.config);

    // Override write to inject parent context
    const originalWrite = childLogger.write.bind(childLogger);
    childLogger.write = (entry: LogEntry) => {
      entry.context = { ...context, ...entry.context };
      originalWrite(entry);
    };

    return childLogger;
  }
}

/**
 * Global logger instance
 *
 * Configure via environment variables:
 * - LOG_LEVEL: trace|debug|info|warn|error|fatal (default: info)
 * - NODE_ENV: development (pretty) | production (JSON)
 */
export const logger = new EnterpriseLogger();
