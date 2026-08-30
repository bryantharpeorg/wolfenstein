import type { Diagnostics } from './diag';

export function installErrorHandlers(getDiagnostics: () => Diagnostics | undefined): void {
  const originalOnError = window.onerror;
  window.onerror = (message, _source, _lineno, _colno, error) => {
    const text =
      error instanceof Error
        ? error.message
        : typeof message === 'string'
          ? message
          : String(error ?? message ?? 'unknown error');
    const diag = getDiagnostics();
    if (diag != null) {
      diag.errors.push(text);
    }
    if (typeof originalOnError === 'function') {
      originalOnError.call(window, message, _source, _lineno, _colno, error);
    }
    return false;
  };

  const originalConsoleError = console.error;
  console.error = (...args: unknown[]) => {
    originalConsoleError.apply(console, args);
    const text = args.map((arg) => (arg instanceof Error ? arg.message : String(arg))).join(' ');
    const diag = getDiagnostics();
    if (diag != null && text.length > 0) {
      diag.errors.push(text);
    }
  };
}
