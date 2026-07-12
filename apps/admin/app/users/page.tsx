import { adminFetch, requireAdmin } from '../../lib/admin-session';
import { AdminNav } from '../../components/AdminNav';

interface Player {
  id: string;
  gamerTag: string;
  nickname: string;
  insider: boolean;
}
interface UsersPage {
  items: Player[];
  total: number;
  page: number;
  pageSize: number;
}

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
  const data: UsersPage = res.ok ? await res.json() : { items: [], total: 0, page, pageSize: 20 };
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
                {u.insider ? (
                  <span className="shrink-0 rounded-full border border-primary px-2 py-0.5 text-caption uppercase tracking-wide text-primary">
                    Insider
                  </span>
                ) : null}
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
