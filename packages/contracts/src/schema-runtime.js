import { z } from 'zod';

// Configure before constructing schemas. Zod's optional Function() JIT probe
// itself reports a CSP violation even when caught. Browser validation must use
// the equivalent interpreter; server-side validation keeps its existing mode.
if (typeof window !== 'undefined') z.config({ jitless: true });

export { z };
