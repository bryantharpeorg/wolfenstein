import type { Diagnostics } from './diag';

export function installErrorHandlers(getDiag: () => Diagnostics | undefined): void {
  const push = (message: string) => {
    const diag = getDiag();
    if (diag != null) {
      diag.errors.push(message);
    }
  };

  window.onerror = (_event, _source, _lineno, _colno, error) => {
    const message = error instanceof Error ? error.message : String(error ?? 'unknown error');
    push(message);
    return false;
  };

  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason;
    const message = reason instanceof Error ? reason.message : String(reason ?? 'unhandled rejection');
    push(message);
  });

  const originalConsoleError = console.error;
  console.error = (...args: unknown[]) => {
    originalConsoleError.apply(console, args);
    push(args.map(String).join(' '));
  };
}
