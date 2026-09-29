'use client';
import './globals.css';
import ErrorPage from './error';
export default function GlobalError({ retry }) {
  return (
    <html lang="en">
      <body>
        <ErrorPage retry={retry} />
      </body>
    </html>
  );
}
