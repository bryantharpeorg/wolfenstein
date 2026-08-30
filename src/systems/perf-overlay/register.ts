/** The on-screen perf readout. Order 20: after `diagnostics` has written the frame. */
import { defineSystem } from '../../boot/registry';
import { createPerfOverlay, installToggle } from '../../overlay/perf';

let overlay: ReturnType<typeof createPerfOverlay> | null = null;

defineSystem({
  name: 'perf-overlay',
  order: 20,
  setup() {
    overlay = createPerfOverlay();
    installToggle(overlay);
  },
  update(ctx) {
    overlay?.update(ctx.diag);
  },
});
