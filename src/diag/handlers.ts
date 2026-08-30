import type { Diagnostics } from './diag';

function describeError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (error != null) {
    return String(error);
  }
  return 'unknown error';
}

/**
 * Installs handlers that append uncaught exceptions and console.error calls to the
 * provided diagnostics object. This lets browser-side failures reach the headless
 * smoke harness through window.__diag.errors.
 */
export function installErrorHandlers(diag: Diagnostics): void {
  window.onerror = (_event, _source, _lineno, _colno, error) => {
    diag.errors.push(describeError(error));
    return false;
  };

  window.addEventListener('unhandledrejection', (event) => {
    diag.errors.push(`Unhandled rejection: ${describeError(event.reason)}`);
  });

  const originalConsoleError = console.error;
  console.error = (...args: unknown[]) => {
    originalConsoleError.apply(console, args);
    diag.errors.push(args.map(String).join(' '));
  };
}
