import { redirect } from 'next/navigation';

// The console's home is the users table; middleware + the users page enforce the admin session.
export default function AdminHome() {
  redirect('/users');
}
