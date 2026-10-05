import { test as base, expect } from '@playwright/test';

export { expect };
export const test = base.extend({
  cspGuard: [
    async ({ page }, use) => {
      const violations = [];
      await page.exposeFunction('recordCspViolation', (directive) =>
        violations.push(directive),
      );
      await page.addInitScript(() => {
        globalThis.addEventListener('securitypolicyviolation', (event) => {
          globalThis.recordCspViolation({
            directive: event.effectiveDirective,
            blocked:
              event.blockedURI === 'eval'
                ? 'eval'
                : event.blockedURI === 'inline'
                  ? 'inline'
                  : 'resource',
            source: event.sourceFile.split('/').at(-1),
            line: event.lineNumber,
          });
        });
      });
      page.on('console', (message) => {
        if (
          /violat(?:es|ion).*Content Security Policy|Refused to .* (?:script|Content Security Policy)|violates.*directive/i.test(
            message.text(),
          )
        )
          violations.push('browser-console-csp');
      });
      await use();
      expect(
        violations,
        'No CSP violation during the tested legitimate journey',
      ).toEqual([]);
    },
    { auto: true },
  ],
});
