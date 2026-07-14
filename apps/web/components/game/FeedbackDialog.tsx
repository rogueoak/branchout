'use client';

// The host's in-game feedback dialog (spec 0048). A "Feedback" trigger opens a ResponsiveDialog
// (a centred modal on desktop, a bottom sheet on a phone - canopy's branch, spec 0031) with a
// required message field. Submitting POSTs the message plus auto-captured context (room code, game
// id, phase, that the sender is the host, a timestamp) to /v1/feedback; the host never types the
// context. Success thanks the host and closes; an unset RESEND_API_KEY comes back as a clear
// "not configured" message rather than a crash.

import { Button } from '@rogueoak/canopy';
import {
  ResponsiveDialog,
  ResponsiveDialogClose,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
  ResponsiveDialogTrigger,
} from '@rogueoak/canopy/branches';
import { useEffect, useId, useState } from 'react';
import { sendFeedback, type FeedbackContext } from '../../lib/feedback-api';

interface FeedbackDialogProps {
  /** Auto-captured context sent alongside the message; the host never types this. */
  context: FeedbackContext;
}

type Status = 'idle' | 'submitting' | 'success' | 'error';

export function FeedbackDialog({ context }: FeedbackDialogProps) {
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState('');
  const [status, setStatus] = useState<Status>('idle');
  const [errorText, setErrorText] = useState<string | null>(null);
  const fieldId = useId();

  // Reset the form each time the dialog opens so a prior success/error never lingers on reopen.
  useEffect(() => {
    if (open) {
      setMessage('');
      setStatus('idle');
      setErrorText(null);
    }
  }, [open]);

  const trimmed = message.trim();
  const canSubmit = trimmed.length > 0 && status !== 'submitting';

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!canSubmit) {
      return;
    }
    setStatus('submitting');
    setErrorText(null);
    try {
      await sendFeedback(trimmed, { ...context, at: new Date().toISOString() });
      setStatus('success');
      // Give the host a moment to read the thank-you, then close.
      setTimeout(() => setOpen(false), 1200);
    } catch (error) {
      setStatus('error');
      setErrorText(error instanceof Error ? error.message : 'Could not send feedback.');
    }
  }

  return (
    <ResponsiveDialog open={open} onOpenChange={setOpen}>
      <ResponsiveDialogTrigger asChild>
        <Button type="button" variant="outline" size="sm">
          Feedback
        </Button>
      </ResponsiveDialogTrigger>
      <ResponsiveDialogContent>
        <form onSubmit={onSubmit} className="flex flex-col gap-4">
          <ResponsiveDialogHeader>
            <ResponsiveDialogTitle>Send feedback</ResponsiveDialogTitle>
            <ResponsiveDialogDescription>
              Hit a rough edge? Tell us what happened. The room and game details are attached
              automatically.
            </ResponsiveDialogDescription>
          </ResponsiveDialogHeader>

          <div className="flex flex-col gap-2">
            <label htmlFor={fieldId} className="text-body-sm font-medium text-text">
              Your feedback
            </label>
            <textarea
              id={fieldId}
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              required
              rows={5}
              maxLength={5000}
              disabled={status === 'submitting' || status === 'success'}
              placeholder="What worked, what did not, what you would change."
              className="w-full rounded-md border border-border bg-surface p-3 text-body text-text placeholder:text-text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
            />
          </div>

          {status === 'success' ? (
            <p role="status" className="text-body-sm text-success">
              Thanks - your feedback is on its way.
            </p>
          ) : null}
          {status === 'error' && errorText ? (
            <p role="alert" className="text-body-sm text-danger">
              {errorText}
            </p>
          ) : null}

          <ResponsiveDialogFooter>
            <ResponsiveDialogClose asChild>
              <Button type="button" variant="ghost">
                {status === 'success' ? 'Close' : 'Cancel'}
              </Button>
            </ResponsiveDialogClose>
            <Button type="submit" variant="primary" disabled={!canSubmit}>
              {status === 'submitting' ? 'Sending...' : 'Submit'}
            </Button>
          </ResponsiveDialogFooter>
        </form>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
