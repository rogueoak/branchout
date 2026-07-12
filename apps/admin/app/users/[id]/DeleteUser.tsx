'use client';

import { buttonVariants } from '@rogueoak/canopy';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { deleteUser, errorMessage } from '../../../lib/admin-api';

/**
 * Hard-delete a player from the admin console (spec 0040). Two-step confirm so no single click
 * purges an account; on success we route back to the user list (the row is gone).
 */
export function DeleteUser({ userId, gamerTag }: { userId: string; gamerTag: string }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onDelete() {
    setBusy(true);
    setError(null);
    try {
      const res = await deleteUser(userId);
      if (res.ok) {
        router.push('/users');
        router.refresh();
      } else {
        setError(await errorMessage(res));
        setBusy(false);
      }
    } catch {
      setError('Could not reach the server. Try again.');
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      {confirming ? (
        <>
          <p className="text-body-sm text-text-muted">
            Permanently delete <span className="font-semibold text-text">{gamerTag}</span>? Their
            game history is removed too. This cannot be undone.
          </p>
          {/* Cancel first in the DOM so on a phone (flex-col) it is the top target; flex-row-reverse
              restores the destructive action on the left for wider screens. */}
          <div className="flex flex-col gap-2 sm:flex-row-reverse sm:justify-end">
            <button
              type="button"
              onClick={() => setConfirming(false)}
              disabled={busy}
              className={buttonVariants({ variant: 'outline', size: 'sm' })}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={onDelete}
              disabled={busy}
              className={buttonVariants({ variant: 'destructive', size: 'sm' })}
            >
              {busy ? 'Deleting...' : 'Yes, delete this player'}
            </button>
          </div>
        </>
      ) : (
        <button
          type="button"
          onClick={() => setConfirming(true)}
          className={buttonVariants({ variant: 'outline', size: 'sm' })}
        >
          Delete player
        </button>
      )}
      {error ? (
        <p role="alert" className="text-body-sm text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
