import { iconSvg } from '@branchout/brand/icon';

interface WordmarkProps {
  className?: string;
}

/**
 * Branch Out Games wordmark for the admin console: the app-icon mark next to the product name, with
 * "games" set small and tilted at the end. Mirrors the site header wordmark (apps/web) so the
 * operator surface reads as the same product; the "Admin" badge beside it (see AdminNav) marks which
 * surface you are on, matching the "Insider" badge on the insider surface.
 *
 * iconSvg is a build-time constant inlined from a checked-in asset (not user input or a runtime
 * fetch), so dangerouslySetInnerHTML is safe here. The source SVG is a hard square, so the wrapper
 * rounds it (overflow-hidden + rounded) to match the app icon; the `[&>svg]` utilities make it fill
 * the box since the inlined SVG carries its own width/height attributes.
 */
export function Wordmark({ className }: WordmarkProps) {
  return (
    <span
      className={`inline-flex items-center gap-2 ${className ?? ''}`}
      role="img"
      aria-label="Branch Out Games"
    >
      <span
        aria-hidden="true"
        className="inline-block h-8 w-8 shrink-0 overflow-hidden rounded-lg [&>svg]:h-full [&>svg]:w-full sm:h-9 sm:w-9"
        dangerouslySetInnerHTML={{ __html: iconSvg }}
      />
      <span className="flex items-end font-bold leading-none tracking-tight text-text">
        <span className="text-lg sm:text-2xl">Branch Out</span>
        <span className="ml-1 -translate-y-0.5 -rotate-6 text-xs font-semibold uppercase tracking-wide text-primary sm:text-sm">
          games
        </span>
      </span>
    </span>
  );
}
