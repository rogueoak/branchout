import { redirect } from 'next/navigation';
import { getAdmin } from '../../lib/admin-session';
import { LoginForm } from './LoginForm';

// Admin sign-in. If already authed, skip straight to the console. Otherwise render the form.
export default async function AdminLoginPage() {
  const admin = await getAdmin();
  if (admin) redirect('/users');
  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-6 p-8">
      <div className="flex flex-col gap-1">
        <p className="text-body-sm font-semibold uppercase tracking-wide text-primary">
          Branch Out Admin
        </p>
        <h1 className="text-h2 text-text">Sign in</h1>
      </div>
      <LoginForm />
    </main>
  );
}
