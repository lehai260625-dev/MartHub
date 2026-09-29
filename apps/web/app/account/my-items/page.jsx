import { Suspense } from 'react';
import { MyItems } from '../../../features/shopping/my-items';

export const metadata = { title: 'My Items' };

export default function MyItemsPage() {
  return (
    <Suspense fallback={<p role="status">Loading My Items…</p>}>
      <MyItems />
    </Suspense>
  );
}
