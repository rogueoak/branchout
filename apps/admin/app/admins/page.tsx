import { adminFetch, requireAdmin } from '../../lib/admin-session';
import { AdminNav } from '../../components/AdminNav';
import { CreateAdminForm } from './CreateAdminForm';

interface AdminRow {
  id: string;
  email: string;
  createdBy: string | null;
  createdAt: string;
}

export default async function AdminsPage() {
  const admin = await requireAdmin();
  const res = await adminFetch('/admin/admins');
  const { admins } = res.ok ? ((await res.json()) as { admins: AdminRow[] }) : { admins: [] };

  return (
    <div className="flex min-h-screen flex-col bg-bg text-text">
      <AdminNav email={admin.email} />
      <section className="mx-auto w-full max-w-3xl flex-1 px-4 py-8 sm:px-6">
        <h1 className="text-h2 text-text">Admins</h1>

        <ul className="mt-4 divide-y divide-border rounded-md border border-border">
          {admins.map((a) => (
            <li key={a.id} className="flex items-center justify-between gap-3 px-4 py-3">
              <span className="min-w-0 truncate text-body-sm text-text">{a.email}</span>
              {a.createdBy === null ? (
                <span className="shrink-0 rounded-full border border-border px-2 py-0.5 text-caption uppercase tracking-wide text-text-muted">
                  Root
                </span>
              ) : null}
            </li>
          ))}
        </ul>

        <div className="mt-8 rounded-md border border-border p-4">
          <h2 className="text-body font-semibold text-text">Create an admin</h2>
          <p className="mt-1 text-body-sm text-text-muted">
            Admins are a separate identity from players. There is no public signup.
          </p>
          <div className="mt-3">
            <CreateAdminForm />
          </div>
        </div>
      </section>
    </div>
  );
}
