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

export async function openHomepage(page) {
  await page.goto('/');
  // Next moves resolved hidden staging markup into the visible boundary.
  // Do not sample duplicate staging nodes before this real lifecycle completes.
  await expect(page.locator('[hidden][id^="S:"]')).toHaveCount(0);
}
