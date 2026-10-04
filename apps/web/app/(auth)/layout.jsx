import Link from 'next/link';
export default function AuthLayout({ children }) {
  return (
    <div className="min-h-screen bg-neutral-50">
      <header className="border-b border-neutral-200 bg-white px-4 py-5 sm:px-6">
        <Link
          href="/"
          className="inline-flex min-h-11 items-center text-2xl font-bold text-primary"
        >
          MartHub
        </Link>
      </header>
      <main
        id="main-content"
        tabIndex={-1}
        className="mx-auto max-w-md px-4 py-10 sm:px-6 sm:py-14"
      >
        {children}
      </main>
    </div>
  );
}
