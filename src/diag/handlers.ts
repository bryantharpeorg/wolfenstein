import type { Diagnostics } from './diag';

export function attachErrorHandlers(diag: Diagnostics): void {
  window.onerror = (_event, _source, _lineno, _colno, error) => {
    const message = error instanceof Error ? error.message : String(error ?? 'unknown error');
    diag.errors.push(message);
    return false;
  };

  const originalConsoleError = console.error;
  console.error = (...args: unknown[]) => {
    originalConsoleError.apply(console, args);
    diag.errors.push(args.map(String).join(' '));
  };
}
