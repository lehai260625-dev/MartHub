export const jsonLogger = (record) =>
  process.stdout.write(JSON.stringify(record) + '\n');

// Callers supply fixed operational vocabulary, never raw request/error objects.
export function emitEvent(logger, event, { requestId, durationMs } = {}) {
  try {
    logger({
      level: event.endsWith('_failed') ? 'error' : 'info',
      event,
      ...(requestId ? { requestId } : {}),
      ...(durationMs === undefined ? {} : { durationMs }),
    });
  } catch {
    // Telemetry must not change request, transaction or shutdown outcomes.
  }
}
