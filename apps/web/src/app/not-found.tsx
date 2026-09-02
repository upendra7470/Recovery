import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center text-center">
      <div className="rounded-full bg-slate-100 p-4">
        <svg
          className="h-10 w-10 text-slate-400"
          fill="none"
          viewBox="0 0 24 24"
          strokeWidth={1.5}
          stroke="currentColor"
          aria-hidden="true"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 3.75h.008v.008H12v-.008Z"
          />
        </svg>
      </div>
      <h1 className="mt-4 text-2xl font-bold text-slate-900">Page Not Found</h1>
      <p className="mt-2 max-w-sm text-sm text-slate-500">
        The page you are looking for does not exist or has been moved.
      </p>
      <Link
        href="/"
        className="mt-6 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-indigo-500"
      >
        Back to Dashboard
      </Link>
    </div>
  );
}
