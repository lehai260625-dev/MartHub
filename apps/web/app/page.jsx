import { Homepage } from '../features/homepage/homepage';
import { connection } from 'next/server';
import { homepageResponseSchema } from '@marthub/contracts';
import { serverApi } from '../lib/api/server';

export default async function HomePage() {
  await connection();
  let initialData;
  try {
    initialData = await serverApi('/homepage', {
      schema: homepageResponseSchema,
    });
  } catch {
    // Preserve the existing client loading/error/retry path when public bootstrap fails.
  }
  return (
    <main id="main-content" className="home-page" lang="vi">
      <h1 className="sr-only">MartHub</h1>
      <Homepage initialData={initialData} />
    </main>
  );
}
