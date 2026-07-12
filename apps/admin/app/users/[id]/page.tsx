import { notFound } from 'next/navigation';
import { adminFetch, requireAdmin } from '../../../lib/admin-session';
import { AdminNav } from '../../../components/AdminNav';
import { DeleteUser } from './DeleteUser';
import { InsiderToggle } from './InsiderToggle';

interface Player {
  id: string;
  gamerTag: string;
  nickname: string;
  avatar: string;
  visibility: string;
  insider: boolean;
  /** Set when the player soft-deleted their account (spec 0040); null while live. */
  deletedAt: string | null;
}

export default async function UserDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin();
  const { id } = await params;
  const res = await adminFetch(`/admin/users/${id}`);
  if (res.status === 404) notFound();
  if (!res.ok) throw new Error('Failed to load user');
  const { account } = (await res.json()) as { account: Player };

  return (
    <div className="flex min-h-screen flex-col bg-bg text-text">
      <AdminNav email={admin.email} />
      <section className="mx-auto w-full max-w-2xl flex-1 px-4 py-8 sm:px-6">
        <a
          href="/users"
          className="text-body-sm text-text-muted underline-offset-4 hover:text-text hover:underline"
        >
          &larr; Back to users
        </a>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <h1 className="text-h2 text-text">{account.gamerTag}</h1>
          {account.deletedAt ? (
            <span className="rounded-full bg-danger/15 px-2 py-0.5 text-caption font-semibold uppercase tracking-wide text-danger">
              Deleted
            </span>
          ) : null}
        </div>

        <dl className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <dt className="text-caption uppercase tracking-wide text-text-muted">Nickname</dt>
            <dd className="text-body text-text">{account.nickname}</dd>
          </div>
          <div>
            <dt className="text-caption uppercase tracking-wide text-text-muted">Avatar</dt>
            <dd className="text-body text-text">{account.avatar}</dd>
          </div>
          <div>
            <dt className="text-caption uppercase tracking-wide text-text-muted">Visibility</dt>
            <dd className="text-body text-text">{account.visibility}</dd>
          </div>
          <div>
            <dt className="text-caption uppercase tracking-wide text-text-muted">Insider</dt>
            <dd className="text-body text-text">{account.insider ? 'Yes' : 'No'}</dd>
          </div>
        </dl>

        <div className="mt-8 rounded-md border border-border p-4">
          <h2 className="text-body font-semibold text-text">Insider access</h2>
          <p className="mt-1 text-body-sm text-text-muted">
            Grant or revoke this player&apos;s access to the insider surface.
          </p>
          <div className="mt-3">
            <InsiderToggle userId={account.id} initialInsider={account.insider} />
          </div>
        </div>

        <div className="mt-6 rounded-md border border-danger/40 p-4">
          <h2 className="text-body font-semibold text-danger">Delete player</h2>
          <p className="mt-1 text-body-sm text-text-muted">
            Permanently remove this account and its game history from the database. The credit
            ledger is kept for audit. This cannot be undone.
          </p>
          <div className="mt-3">
            <DeleteUser userId={account.id} gamerTag={account.gamerTag} />
          </div>
        </div>
      </section>
    </div>
  );
}
