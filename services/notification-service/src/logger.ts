export type LogLevel = "debug" | "info" | "warn" | "error";

const levelWeight: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

export interface Logger {
  debug(message: string, fields?: Record<string, unknown>): void;
  info(message: string, fields?: Record<string, unknown>): void;
  warn(message: string, fields?: Record<string, unknown>): void;
  error(message: string, fields?: Record<string, unknown>): void;
}

export function createLogger(level: string): Logger {
  const threshold = levelWeight[level as LogLevel] ?? levelWeight.info;

  function write(
    entryLevel: LogLevel,
    message: string,
    fields?: Record<string, unknown>,
  ): void {
    if (levelWeight[entryLevel] < threshold) {
      return;
    }

    const line = JSON.stringify({
      time: new Date().toISOString(),
      level: entryLevel,
      message,
      ...fields,
    });

    if (entryLevel === "error") {
      console.error(line);
    } else {
      console.log(line);
    }
  }

  return {
    debug: (message, fields) => write("debug", message, fields),
    info: (message, fields) => write("info", message, fields),
    warn: (message, fields) => write("warn", message, fields),
    error: (message, fields) => write("error", message, fields),
  };
}
