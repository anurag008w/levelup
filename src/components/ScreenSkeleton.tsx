/** Full-screen skeleton shown while a lazy-loaded tab is resolving. */

export default function ScreenSkeleton() {
  return (
    <div className="screen fade-in" aria-busy="true" aria-label="Loading">
      <div className="mb-5 flex items-start justify-between">
        <div className="space-y-2">
          <div className="skeleton h-3 w-24" />
          <div className="skeleton h-6 w-44" />
          <div className="skeleton h-3 w-32" />
        </div>
        <div className="skeleton h-10 w-10 rounded-full" />
      </div>

      <div className="card mb-4 p-5">
        <div className="mx-auto mb-4 flex h-36 w-36 items-center justify-center">
          <div className="skeleton h-full w-full rounded-full" />
        </div>
        <div className="skeleton mx-auto mb-2 h-4 w-40" />
        <div className="skeleton mx-auto h-3 w-28" />
      </div>

      <div className="mb-4 grid grid-cols-3 gap-2.5">
        <div className="skeleton h-20" />
        <div className="skeleton h-20" />
        <div className="skeleton h-20" />
      </div>

      <div className="space-y-2.5">
        <div className="skeleton h-16" />
        <div className="skeleton h-16" />
        <div className="skeleton h-16" />
        <div className="skeleton h-16" />
      </div>
    </div>
  );
}
