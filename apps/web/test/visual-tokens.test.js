import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(resolve('app/visual-tokens.css'), 'utf8');
const globals = readFileSync(resolve('app/globals.css'), 'utf8');
const colors = Object.fromEntries(
  [...css.matchAll(/--mh-([a-z-]+): (#[0-9a-f]{6});/g)].map(
    ([, name, value]) => [name, value],
  ),
);

function luminance(hex) {
  const channels = hex
    .slice(1)
    .match(/../g)
    .map((channel) => {
      const value = parseInt(channel, 16) / 255;
      return value <= 0.04045
        ? value / 12.92
        : ((value + 0.055) / 1.055) ** 2.4;
    });
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}

function contrast(first, second) {
  const a = luminance(colors[first]);
  const b = luminance(colors[second]);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

describe('M9.1 approved visual contract', () => {
  const textColors = [
    'text',
    'muted',
    'primary',
    'primary-hover',
    'primary-active',
    'accent',
    'accent-hover',
    'success',
    'warning',
    'error',
  ];
  for (const foreground of textColors) {
    for (const background of ['background', 'surface', 'surface-subtle']) {
      // Owner colors are fixed: warning text uses its own subtle or white surface.
      if (foreground === 'warning' && background === 'surface-subtle') continue;
      it(`${foreground} on ${background} meets normal-text AA`, () => {
        expect(contrast(foreground, background)).toBeGreaterThanOrEqual(4.5);
      });
    }
  }
  it('rejects the unsafe warning-on-generic-subtle pairing rather than rounding it to AA', () => {
    expect(contrast('warning', 'surface-subtle')).toBeLessThan(4.5);
  });
  for (const semantic of ['success', 'warning', 'error']) {
    it(`${semantic} badge/status on its subtle surface meets AA`, () => {
      expect(contrast(semantic, `${semantic}-subtle`)).toBeGreaterThanOrEqual(
        4.5,
      );
      expect(contrast('surface', semantic)).toBeGreaterThanOrEqual(4.5);
    });
  }

  it('focus and control outlines meet non-text contrast on supported light surfaces', () => {
    for (const background of ['background', 'surface', 'surface-subtle']) {
      expect(contrast('primary', background)).toBeGreaterThanOrEqual(3);
      expect(contrast('muted', background)).toBeGreaterThanOrEqual(3);
    }
    expect(globals).toContain('outline: 2px solid var(--mh-focus-ring)');
    expect(globals).toContain('outline-offset: 2px');
  });

  it('reports disabled colors honestly without treating exempt inactive controls as normal text', () => {
    expect(contrast('disabled-text', 'disabled-background')).toBeGreaterThan(3);
    expect(contrast('disabled-text', 'disabled-background')).toBeLessThan(4.5);
    expect(globals).toContain('opacity: 1');
    expect(globals).toContain('background: var(--mh-disabled-background)');
    expect(globals).toContain('color: var(--mh-disabled-text)');
  });

  it('exposes reusable scale tokens and reduced-motion overrides without an external font', () => {
    for (const px of [4, 8, 12, 16, 24, 32, 48, 64])
      expect(css).toMatch(new RegExp(`--mh-space-\\d+: ${px}px;`));
    for (const [name, size, height] of [
      ['xs', 12, 16],
      ['sm', 14, 20],
      ['base', 16, 24],
      ['lg', 18, 28],
      ['xl', 20, 28],
      ['2xl', 24, 32],
      ['3xl', 30, 36],
      ['4xl', 36, 40],
    ]) {
      expect(css).toContain(`--text-${name}: ${size}px`);
      expect(css).toContain(`--text-${name}--line-height: ${height}px`);
    }
    expect(css).toContain('--mh-motion-fast: 120ms');
    expect(css).toContain('--mh-motion-normal: 180ms');
    expect(css).toContain('--mh-motion-slow: 240ms');
    expect(globals).toContain('--mh-motion-fast: 0ms');
    expect(globals).toContain('prefers-reduced-motion: reduce');
    expect(css).not.toMatch(/https?:|@font-face/);
  });

  it('keeps affected storefront radii bounded and originals free of imported resources', () => {
    expect(globals).not.toMatch(/border-radius: (?:0\.75rem|999px|12px)/);
    const files = readdirSync(resolve('public/brand/'));
    expect(files.sort()).toEqual(['monogram.svg', 'wordmark.svg']);
    for (const file of [
      '../public/brand/monogram.svg',
      '../public/brand/wordmark.svg',
      '../app/icon.svg',
    ]) {
      const svg = readFileSync(resolve('test', file), 'utf8');
      expect(svg).toContain('viewBox=');
      expect(svg).not.toMatch(
        /<script|<image|<foreignObject|\shref=|\son[a-z]+=/i,
      );
      expect(svg).toContain('#0F766E');
      expect(svg).toContain('#C2410C');
    }
    expect(readFileSync(resolve('app/icon.svg'), 'utf8')).toBe(
      readFileSync(resolve('public/brand/monogram.svg'), 'utf8'),
    );
  });
});
