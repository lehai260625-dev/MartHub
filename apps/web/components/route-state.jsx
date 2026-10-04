import Link from 'next/link';

export default function RouteState({ title, children }) {
  return (
    <main
      id="main-content"
      className="mx-auto flex min-h-screen max-w-6xl flex-col justify-center px-4 py-16 md:px-6"
    >
      <p className="mb-8 text-xl font-bold text-primary">MartHub</p>
      <h1 className="text-3xl font-semibold">{title}</h1>
      <div className="mt-5 max-w-lg text-base leading-7 text-muted">
        {children}
      </div>
      <Link
        className="mt-6 inline-flex min-h-11 w-fit items-center font-semibold text-primary underline"
        href="/"
      >
        Return to MartHub
      </Link>
    </main>
  );
}
