export const logger = {
  info: (event: string, context: Record<string, unknown> = {}) =>
    console.info(JSON.stringify({ level: "info", event, ...context })),
  error: (event: string, context: Record<string, unknown> = {}) =>
    console.error(JSON.stringify({ level: "error", event, ...context })),
};
