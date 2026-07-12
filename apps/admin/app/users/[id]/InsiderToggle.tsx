'use client';

import { buttonVariants } from '@rogueoak/canopy';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { errorMessage, setInsider } from '../../../lib/admin-api';

export function InsiderToggle({
  userId,
  initialInsider,
}: {
  userId: string;
  initialInsider: boolean;
}) {
  const router = useRouter();
  const [insider, setInsiderState] = useState(initialInsider);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onToggle() {
    setBusy(true);
    setError(null);
    const next = !insider;
    try {
      const res = await setInsider(userId, next);
      if (res.ok) {
        setInsiderState(next);
        router.refresh();
      } else {
        setError(await errorMessage(res));
      }
    } catch {
      setError('Could not reach the server. Try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        onClick={onToggle}
        disabled={busy}
        className={buttonVariants({ variant: insider ? 'outline' : 'primary', size: 'sm' })}
      >
        {busy ? 'Saving...' : insider ? 'Revoke insider' : 'Grant insider'}
      </button>
      {error ? (
        <p role="alert" className="text-body-sm text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
