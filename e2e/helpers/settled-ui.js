import { expect } from '@playwright/test';

// Axe/screenshot assertions describe a settled UI state. Wait for actual finite
// transitions, not a fixed sleep, without disabling motion or changing CSS.
export async function waitForSettledUi(page) {
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          globalThis.document
            .getAnimations()
            .filter(
              (animation) =>
                animation.playState === 'running' &&
                animation.effect?.getComputedTiming().iterations !== Infinity,
            ).length,
      ),
    )
    .toBe(0);
}
