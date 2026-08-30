/** FPS and draw-call reporting into `window.__diag`. Runs before anything that reads it. */
import { defineSystem } from '../../boot/registry';
import { updateFps } from '../../diag/diag';

defineSystem({
  name: 'diagnostics',
  order: 10,
  update(ctx, deltaMs) {
    const info = (ctx.renderer as { info?: { render: Record<string, number> } }).info;
    if (info != null) {
      ctx.diag.drawCalls =
        'drawCalls' in info.render ? info.render.drawCalls! : info.render.calls!;
    }
    updateFps(ctx.diag, deltaMs);
    ctx.diag.ready = true;
  },
});
