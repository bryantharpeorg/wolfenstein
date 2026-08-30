import type { Diagnostics } from './diag';

export function attachErrorHandlers(diag: Diagnostics): void {
  window.onerror = (_event, _source, _lineno, _colno, error) => {
    const message = error instanceof Error ? error.message : String(error ?? 'unknown error');
    diag.errors.push(message);
    return false;
  };

  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason instanceof Error ? event.reason.message : String(event.reason ?? 'unhandled rejection');
    diag.errors.push(reason);
  });

  const originalConsoleError = console.error;
  console.error = (...args: unknown[]) => {
    originalConsoleError.apply(console, args);
    diag.errors.push(args.map(String).join(' '));
  };
}
