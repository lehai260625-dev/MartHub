import { serializeStructuredData } from './catalog-seo';

export function StructuredData({ data, id }) {
  return (
    <script
      dangerouslySetInnerHTML={{ __html: serializeStructuredData(data) }}
      id={id}
      type="application/ld+json"
    />
  );
}
