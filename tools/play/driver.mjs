// Real input, and nothing else (009 FR-002, FR-003).
//
// Every command here arrives as the DOM event a player's hardware produces, on the same
// target the game already listens on: `keydown`/`keyup` for the codes `src/player/keyboard.ts`
// binds, `mousedown`/`mouseup` for the fire path `src/systems/combat/register.ts` binds, and
// mouse movement under a pointer lock the game itself requested when we clicked its canvas.
// `window.__playerDrive` is never called and no seam was added to `src/` for this file --
// see DECISIONS.md, 2026-09-02: all three unknowns were measured before this was written.
//
// Two properties are load-bearing and both were measured rather than assumed.
//
// Turning is CLOSED-LOOP. Synthesized mouse movement under lock does turn the camera, but
// the yaw-per-pixel it produces is not the value a first calibration suggests -- 30 moves of
// 12px measured 0.0006 rad/px while 40 moves of 100px measured 0.0020 -- so an open-loop
// "turn by N pixels" would be wrong by a factor of three. `createLook` instead reads the yaw
// the page reports, moves, reads again, and adapts its own estimate, so it converges whatever
// the browser does with a synthetic delta.
//
// The virtual cursor is NEVER re-centred. Measured to x=4100 in a 1280-wide viewport, moves
// past the edge keep producing deltas at exactly the same rate, so there is no wrap to
// manage -- and a re-centring move would itself be a delta, which is to say a turn nobody
// asked for.

/** A failure that is not a fact about the game: retryable, never a gameplay result
 *  (spec.md, Key Entities). */
export class HarnessFault extends Error {
  constructor(message) {
    super(message);
    this.name = 'HarnessFault';
  }
}

/** How close to the requested yaw a turn must land, in radians. ~1.7 degrees: tighter than
 *  the aim a corridor needs and looser than the jitter one frame of adaptation leaves. */
export const LOOK_TOLERANCE_RAD = 0.03;

/** The largest single mouse step, in pixels. A turn is spread over frames rather than
 *  teleporting the view, because the recording is the artifact. */
export const MAX_LOOK_STEP_PX = 140;

/** Frames a turn may spend before it is declared a fault. */
export const LOOK_FRAME_BUDGET = 240;

/** The starting yaw-per-pixel estimate, refined from the first move onward. */
const INITIAL_RAD_PER_PX = 0.002;

/** The centre row the virtual cursor tracks along. */
const CURSOR_Y = 360;

/** Wraps an angle into [-pi, pi] -- the same convention `src/player/look.ts` publishes yaw
 *  in, so an error computed here is the error the page would compute. */
export function wrapAngle(radians) {
  const twoPi = Math.PI * 2;
  let wrapped = radians % twoPi;
  if (wrapped > Math.PI) wrapped -= twoPi;
  else if (wrapped < -Math.PI) wrapped += twoPi;
  return wrapped;
}

/**
 * The yaw that faces the world direction `(dx, dz)`.
 *
 * At yaw 0 the camera faces -Z and `src/player/locomotion.ts` builds forward as
 * `(-sin yaw, -cos yaw)`, so facing `(dx, dz)` is `atan2(-dx, -dz)`. Measured: holding
 * `KeyW` at yaw 0 moved the player from z=10.5 to z=8.35, which is -Z.
 */
export function yawToward(dx, dz) {
  return Math.atan2(-dx, -dz);
}

/** Spends `count` of the page's own animation frames. Frame time is what turns a held key
 *  into distance and a pressed switch into a door, so every command is spent in frames. */
export function frames(page, count) {
  return page.evaluate(
    (n) => new Promise((done) => {
      let seen = 0;
      const tick = () => (++seen >= n ? done() : requestAnimationFrame(tick));
      requestAnimationFrame(tick);
    }),
    count,
  );
}

/** Spends frames until `predicate` (evaluated in the page) holds, or the budget expires.
 *  Returns whether it held, so the caller reports what was actually read. */
export async function until(page, predicate, { frameBudget = 300, arg } = {}) {
  for (let spent = 0; spent < frameBudget; spent += 1) {
    if (await page.evaluate(predicate, arg)) return true;
    await frames(page, 1);
  }
  return page.evaluate(predicate, arg);
}

/**
 * Reads the player's live position, facing and condition in one turn.
 *
 * `health` and `dead` belong in this read rather than a separate one because of what
 * `commandsResolve()` does: on death, `src/systems/player-locomotion/register.ts` forces
 * `desiredVel` to zero, so a held key stops producing movement. A caller watching only
 * position sees that as geometry — the first run of this harness reported "stopped advancing
 * at (55.43, 50.54)" in the middle of an empty room, because the player had been shot.
 */
export function readPlayer(page) {
  return page.evaluate(() => {
    const p = window.__diag.player;
    return {
      x: p.x,
      z: p.z,
      yaw: p.yaw,
      locked: p.pointerLocked,
      stuck: p.stuck,
      health: window.__diag.combat?.health ?? null,
      dead: window.__diag.combat?.dead ?? false,
      runState: window.__diag.run?.state ?? 'playing',
    };
  });
}

/**
 * Clicks the game canvas so the page requests pointer lock, and confirms the game agrees it
 * has it. A refused lock is a `HarnessFault`: the browser declined, which is not something
 * the game did wrong.
 *
 * The click also reaches the fire binding on `window`, exactly as a player's first click
 * does. That costs one round and is deliberately not worked around -- suppressing it would
 * mean not clicking, and not clicking means no pointer lock.
 */
export async function acquirePointerLock(page) {
  await page.click('#game-canvas');
  const locked = await until(page, () => window.__diag.player.pointerLocked === true, {
    frameBudget: 120,
  });
  if (!locked) {
    throw new HarnessFault('pointer lock was refused: the browser did not grant it on a canvas click');
  }
}

/**
 * A closed-loop camera. `turnTo(yaw)` moves the mouse until the page reports the requested
 * yaw within tolerance, adapting its yaw-per-pixel estimate from what each move actually
 * achieved. Returns the yaw it settled at.
 */
export function createLook(page) {
  let cursorX = 640;
  let radPerPx = INITIAL_RAD_PER_PX;

  return {
    /** The live estimate, for the record: a number worth reporting because it was measured. */
    sensitivity: () => radPerPx,

    async turnTo(targetYaw) {
      let before = (await readPlayer(page)).yaw;
      for (let spent = 0; spent < LOOK_FRAME_BUDGET; spent += 1) {
        const error = wrapAngle(targetYaw - before);
        if (Math.abs(error) <= LOOK_TOLERANCE_RAD) return before;

        // Positive mouse-x decreases yaw (`src/player/look.ts`), so the step is negated.
        const wanted = -error / radPerPx;
        const stepPx = Math.max(-MAX_LOOK_STEP_PX, Math.min(MAX_LOOK_STEP_PX, wanted));
        cursorX += stepPx;
        await page.mouse.move(cursorX, CURSOR_Y);
        await frames(page, 1);

        const after = (await readPlayer(page)).yaw;
        const achieved = wrapAngle(after - before);
        // Adapt only on a step big enough to measure, and only toward a sane estimate: a
        // frame that dropped the move entirely must not drive the estimate to zero.
        if (Math.abs(stepPx) >= 4 && Math.abs(achieved) > 1e-4) {
          const observed = Math.abs(achieved / stepPx);
          if (observed > 1e-5 && observed < 1) radPerPx = radPerPx * 0.6 + observed * 0.4;
        }
        before = after;
      }
      throw new HarnessFault(
        `the camera did not reach yaw ${targetYaw.toFixed(3)} within ${LOOK_FRAME_BUDGET} frames (stopped at ${before.toFixed(3)})`,
      );
    },
  };
}

/** Holds a movement key. The code is the one `src/player/keyboard.ts` binds. */
export const holdKey = (page, code) => page.keyboard.down(code);

/** Releases it. Callers must release in a `finally`: a key left down survives the leg. */
export const releaseKey = (page, code) => page.keyboard.up(code);

/** One keypress, spent over frames so the page sees it as a press and not a blip. */
export async function tapKey(page, code, { framesHeld = 2 } = {}) {
  await page.keyboard.down(code);
  await frames(page, framesHeld);
  await page.keyboard.up(code);
  await frames(page, 1);
}

/** The interact command, issued through a code `src/interaction/bindings.ts` binds. */
export const interact = (page) => tapKey(page, 'Space');

/** Holds the fire button for `framesHeld` of the page's frames, then releases. */
export async function fire(page, { framesHeld = 6 } = {}) {
  await page.mouse.down();
  await frames(page, framesHeld);
  await page.mouse.up();
  await frames(page, 1);
}
