export default function ProductLoading() {
  return (
    <main
      aria-busy="true"
      aria-label="Loading product"
      className="product-detail-page"
      id="main-content"
    >
      <p className="sr-only" role="status">
        Loading product…
      </p>
      <div aria-hidden="true" className="product-detail-layout animate-pulse">
        <div className="product-gallery-main bg-neutral-200" />
        <div className="space-y-4">
          <div className="h-5 w-32 rounded bg-neutral-200" />
          <div className="h-12 w-4/5 rounded bg-neutral-200" />
          <div className="h-7 w-full rounded bg-neutral-200" />
          <div className="h-12 w-48 rounded bg-neutral-200" />
          <div className="h-40 rounded bg-neutral-200" />
        </div>
      </div>
    </main>
  );
}
