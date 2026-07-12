import { adminFetch, requireAdmin } from '../../lib/admin-session';
import { AdminNav } from '../../components/AdminNav';

interface Player {
  id: string;
  gamerTag: string;
  nickname: string;
  insider: boolean;
  /** Set when the player soft-deleted their account (spec 0040); null while live. */
  deletedAt: string | null;
}
interface UsersPage {
  items: Player[];
  total: number;
  page: number;
  pageSize: number;
}

// Mirrors control-plane routes/admin.ts USERS_PAGE_SIZE. Only used as the error-fallback page size
// (when the API is unreachable the list is empty, so this drives the page-count math, not slicing);
// kept as a named constant so it does not silently drift from the server's value.
const FALLBACK_PAGE_SIZE = 20;

const linkClass =
  'text-body-sm font-medium text-primary underline-offset-4 hover:underline ' +
  'focus-visible:rounded focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary';

export default async function UsersPage({
  searchParams,
}: {
  searchParams: Promise<{ query?: string; page?: string }>;
}) {
  const admin = await requireAdmin();
  const sp = await searchParams;
  const query = sp.query ?? '';
  const page = Math.max(1, Number.parseInt(sp.page ?? '1', 10) || 1);
  const res = await adminFetch(`/admin/users?query=${encodeURIComponent(query)}&page=${page}`);
  const data: UsersPage = res.ok
    ? await res.json()
    : { items: [], total: 0, page, pageSize: FALLBACK_PAGE_SIZE };
  const lastPage = Math.max(1, Math.ceil(data.total / data.pageSize));

  const pageHref = (p: number) => `/users?query=${encodeURIComponent(query)}&page=${p}`;

  return (
    <div className="flex min-h-screen flex-col bg-bg text-text">
      <AdminNav email={admin.email} />
      <section className="mx-auto w-full max-w-5xl flex-1 px-4 py-8 sm:px-6">
        <h1 className="text-h2 text-text">Users</h1>
        <form method="GET" action="/users" className="mt-4 flex gap-2">
          <input
            type="search"
            name="query"
            defaultValue={query}
            placeholder="Search by gamer tag"
            aria-label="Search users by gamer tag"
            className="w-full max-w-xs rounded-md border border-border bg-bg px-3 py-2 text-body text-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          />
          <button
            type="submit"
            className="rounded-md border border-border px-3 py-2 text-body-sm font-medium text-text hover:bg-surface"
          >
            Search
          </button>
        </form>

        <p className="mt-4 text-caption text-text-muted">
          {data.total} {data.total === 1 ? 'user' : 'users'}
          {query ? ` matching "${query}"` : ''}
        </p>

        <ul className="mt-2 divide-y divide-border rounded-md border border-border">
          {data.items.length === 0 ? (
            <li className="px-4 py-6 text-body-sm text-text-muted">No users found.</li>
          ) : (
            data.items.map((u) => (
              <li key={u.id} className="flex items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <a href={`/users/${u.id}`} className={linkClass}>
                    {u.gamerTag}
                  </a>
                  <p className="truncate text-caption text-text-muted">{u.nickname}</p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {u.deletedAt ? (
                    <span className="rounded-full bg-danger/15 px-2 py-0.5 text-caption font-semibold uppercase tracking-wide text-danger">
                      Deleted
                    </span>
                  ) : null}
                  {u.insider ? (
                    <span className="rounded-full border border-primary px-2 py-0.5 text-caption uppercase tracking-wide text-primary">
                      Insider
                    </span>
                  ) : null}
                </div>
              </li>
            ))
          )}
        </ul>

        <nav aria-label="Pagination" className="mt-4 flex items-center justify-between">
          {page > 1 ? (
            <a href={pageHref(page - 1)} className={linkClass}>
              Previous
            </a>
          ) : (
            <span className="text-body-sm text-text-muted">Previous</span>
          )}
          <span className="text-caption text-text-muted">
            Page {page} of {lastPage}
          </span>
          {page < lastPage ? (
            <a href={pageHref(page + 1)} className={linkClass}>
              Next
            </a>
          ) : (
            <span className="text-body-sm text-text-muted">Next</span>
          )}
        </nav>
      </section>
    </div>
  );
}
