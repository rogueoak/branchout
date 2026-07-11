// The player avatar (spec 0027): renders the chosen avatar's SVG from the brand set, with an
// initials fallback for a missing/unknown id (a pre-avatar account, or a set that dropped an id).
// No `'use client'` - it only renders markup (the SVG is a build-time brand string, never user
// input), so it works in a Server Component like the public profile page as well as the client
// account page and, later, the nav and lobby roster.

import { avatarSvg } from '@branchout/brand/avatars';

interface AvatarProps {
  /** The stored avatar id; when missing/unknown, an initials chip renders instead. */
  avatar?: string | null;
  /** A display name, used for the accessible label and the initials fallback. */
  name?: string;
  /** Tailwind sizing/extra classes for the square. Defaults to a 40px square. */
  className?: string;
}

function initialsOf(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return '?';
  const parts = trimmed.split(/\s+/);
  const chars = parts.length > 1 ? parts[0]![0]! + parts[1]![0]! : trimmed.slice(0, 2);
  return chars.toUpperCase();
}

export function Avatar({ avatar, name, className = 'h-10 w-10' }: AvatarProps) {
  const label = name ? `${name}'s avatar` : 'Player avatar';
  const svg = avatar ? avatarSvg(avatar) : undefined;

  if (svg) {
    return (
      <span
        role="img"
        aria-label={label}
        className={`inline-block shrink-0 overflow-hidden rounded-full [&>svg]:h-full [&>svg]:w-full ${className}`}
        dangerouslySetInnerHTML={{ __html: svg }}
      />
    );
  }

  return (
    <span
      role="img"
      aria-label={label}
      className={`inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-surface-raised text-text font-semibold ${className}`}
    >
      {initialsOf(name ?? '')}
    </span>
  );
}
