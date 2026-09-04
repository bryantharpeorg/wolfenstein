// The crosshair's play observations (T023, FR-017; US4-S7, US4-S8).
//
// Three observations, all read from `__diag` and never from the video: the
// reticle was present, its gap differed between standing still and moving, and
// whether a hit mark appeared on a frame `__diag.combat.hits` rose. They are
// **soft** criteria and stay soft — `009` fixed the hard criteria as completion
// and errors — so a playthrough that never shot anything reports the hit mark as
// "not observed", a shortfall in the record, rather than a failed playthrough.
// Nothing here can move `passed`, the exit code, or the verdict.
//
// The sampler is installed in the page and rides the page's own animation
// frames, so it observes the frames the player actually saw and costs one read
// of the published diagnostics per frame. No seam is added to `src/`: the mark
// and the gap are already published exactly so a surface like this can read them.

const MAX_SAMPLES = 20000;

/** Installs a per-frame sampler in the page. Rides `requestAnimationFrame`,
 *  which is also the loop the game renders on, so each entry is one drawn frame
 *  of the recording. Capped, because a long run at 60 fps is tens of thousands
 *  of frames and the observations need no more than the recent ones. */
export function installCrosshairSampler(page) {
  return page.evaluate((cap) => {
    if (window.__crosshairPlay != null) return;
    const samples = [];
    window.__crosshairPlay = { samples };
    let previousHits = 0;
    const record = () => {
      const crosshair = window.__diag?.crosshair;
      if (crosshair != null) {
        const hits = window.__diag.combat?.hits ?? 0;
        samples.push({
          gap: crosshair.gap,
          hidden: crosshair.hidden === true,
          mark: crosshair.mark,
          speed: window.__diag.player?.speed ?? 0,
          hits,
          hitRose: hits > previousHits,
        });
        previousHits = hits;
        if (samples.length > cap) samples.shift();
      }
      requestAnimationFrame(record);
    };
    requestAnimationFrame(record);
  }, MAX_SAMPLES);
}

/** Reads the samples back and computes the three observations. Never throws and
 *  never returns a verdict: every failure to read is reported as a reason, and
 *  the caller's `passed` is none of this file's business. */
export async function collectCrosshairObservations(page) {
  const record = { soft: true };
  let samples = null;
  try {
    samples = await page.evaluate(() => window.__crosshairPlay?.samples ?? null);
  } catch (error) {
    return { soft: true, error: `the crosshair sampler could not be read: ${
      error instanceof Error ? error.message : String(error)}` };
  }
  if (samples == null) {
    return { soft: true, error: 'the crosshair sampler never published a sample' };
  }

  const drawn = samples.filter((sample) => !sample.hidden);
  record.present = {
    observed: drawn.length > 0,
    detail: `drawn on ${drawn.length} of ${samples.length} sampled frames`,
  };

  // Standing still means settled: the smallest gap seen at rest is the weapon's
  // resting gap with no recoil owed, and the peak while moving carries both the
  // movement opening and whatever the firefights added. A gap that differed by
  // more than a pixel between the two states is the reaction FR-017 asks for.
  const standing = drawn.filter((sample) => sample.speed <= 0.1);
  const moving = drawn.filter((sample) => sample.speed >= 2);
  if (standing.length === 0 || moving.length === 0) {
    record.gapReactedToMovement = {
      observed: false,
      reason: standing.length === 0 ? 'the playthrough never stood still' : 'the playthrough never moved',
    };
  } else {
    let still = Infinity;
    let peak = -Infinity;
    for (const sample of standing) if (sample.gap < still) still = sample.gap;
    for (const sample of moving) if (sample.gap > peak) peak = sample.gap;
    record.gapReactedToMovement = {
      observed: peak - still > 1,
      standingPx: Math.round(still * 10) / 10,
      movingPx: Math.round(peak * 10) / 10,
    };
  }

  // A rise in `hits` is the event; the mark is the reticle's answer to it. The
  // mark outlives the frame that lit it by its declared duration, so a sampler
  // frame one or two behind the combat publish still shows it — but a mark seen
  // with no rise behind it would be a false positive, so only rises are counted.
  let rises = 0;
  let marked = 0;
  for (let index = 0; index < samples.length; index += 1) {
    if (!samples[index].hitRose) continue;
    rises += 1;
    for (let follow = index; follow <= Math.min(index + 3, samples.length - 1); follow += 1) {
      if (samples[follow].mark === 'hit' || samples[follow].mark === 'kill') {
        marked += 1;
        break;
      }
    }
  }
  record.hitMarkSeen = rises === 0
    ? { observed: false, reason: 'no rise in __diag.combat.hits was sampled — nothing the playthrough shot connected' }
    : { observed: marked > 0, rises, marked };

  return record;
}

/** One line for the operator's console: the three observations as the record
 *  holds them, with every "not observed" named rather than implied. */
export function describeObservations(record) {
  if (record.error != null) return record.error;
  const parts = [];
  parts.push(record.present.observed
    ? `reticle present (${record.present.detail})`
    : 'reticle NOT observed');
  const gap = record.gapReactedToMovement;
  parts.push(gap.observed
    ? `gap ${gap.standingPx} px standing vs ${gap.movingPx} px moving`
    : `gap reaction not observed (${gap.reason})`);
  const hit = record.hitMarkSeen;
  parts.push(hit.observed
    ? `hit mark seen on ${hit.marked} of ${hit.rises} rises in hits`
    : `hit mark not observed (${hit.reason})`);
  return parts.join('; ');
}