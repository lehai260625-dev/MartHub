import './globals.css';
import { STORE_NAME } from '@marthub/contracts';
import { getWebOrigin } from '../features/catalog/catalog-seo';
import Providers from './providers';

export const metadata = {
  metadataBase: new URL(getWebOrigin()),
  title: { default: STORE_NAME, template: `%s | ${STORE_NAME}` },
  description: 'Everyday shopping, thoughtfully arranged.',
  alternates: { canonical: '/' },
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        <a className="skip-link" href="#main-content">
          Skip to content
        </a>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
