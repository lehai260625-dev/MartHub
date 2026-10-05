import { serializeStructuredData } from './catalog-seo';

import { headers } from 'next/headers';

export async function StructuredData({ data, id }) {
  const nonce = (await headers()).get('x-nonce');
  return (
    <script
      dangerouslySetInnerHTML={{ __html: serializeStructuredData(data) }}
      id={id}
      nonce={nonce || undefined}
      type="application/ld+json"
    />
  );
}
