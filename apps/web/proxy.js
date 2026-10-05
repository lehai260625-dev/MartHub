import { randomBytes } from 'node:crypto';
import { NextResponse } from 'next/server';
import { productionCsp } from './lib/security/csp';

export function proxy(request) {
  if (process.env.NODE_ENV !== 'production') return NextResponse.next();
  const nonce = randomBytes(32).toString('base64');
  const csp = productionCsp(nonce);
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-nonce', nonce);
  requestHeaders.set('Content-Security-Policy', csp);
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set('Content-Security-Policy', csp);
  response.headers.set('Cache-Control', 'private, no-store');
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('X-Frame-Options', 'DENY');
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  return response;
}

export const config = {
  matcher:
    '/((?!api(?:/|$)|_next/static|_next/image|favicon.ico|icon.svg|brand/|sitemap.xml).*)',
};
