'use client';
import RouteState from '../components/route-state';
export default function ErrorPage({ retry }) {
  return (
    <RouteState title="We could not load this page">
      <p>Please try again.</p>
      <button
        className="mt-4 min-h-11 rounded px-4 py-2 font-semibold text-white bg-emerald-800"
        onClick={() => retry()}
      >
        Try again
      </button>
    </RouteState>
  );
}
