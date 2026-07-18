import { iconSvg } from '@branchout/brand/icon';

interface WordmarkProps {
  className?: string;
  /**
   * On the narrowest phones, render the mark icon-only and hide the "Branch Out games" text lockup,
   * so a crowded nav (wordmark + Games + Join + Log in + Sign up) fits at 360px without the groups
   * overlapping. The `aria-label` stays on the wrapper, so a screen reader still hears the brand.
   * The text reappears from ~430px up. Off by default (standalone pages have room for the full mark).
   */
  collapseTextOnMobile?: boolean;
}

/**
 * Branch Out Games site wordmark: the app-icon mark next to the product name, with "games" set
 * small and tilted at the end (the product is "Branch Out Games", not just "Branch Out"). The
 * site header uses this light mark so it reads cleanly at header size and on a phone; the full
 * lockup badge lives in the README, not the site.
 *
 * iconSvg is a build-time constant inlined from a checked-in asset (not user input or a runtime
 * fetch), so dangerouslySetInnerHTML is safe here. The source SVG is a hard square, so the
 * wrapper rounds it (overflow-hidden + rounded) to match the app icon; the `[&>svg]` utilities
 * make it fill the box since the inlined SVG carries its own width/height attributes.
 */
export function Wordmark({ className, collapseTextOnMobile = false }: WordmarkProps) {
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
      <span
        className={`${collapseTextOnMobile ? 'hidden min-[430px]:flex' : 'flex'} items-end font-bold leading-none tracking-tight text-text`}
      >
        {/* text-lg on the smallest phones so the nav (wordmark + Games + Log in + Sign up) fits at
            360px without horizontal overflow; scales up from sm. */}
        <span className="text-lg sm:text-2xl">Branch Out</span>
        <span className="ml-1 -translate-y-0.5 -rotate-6 text-xs font-semibold uppercase tracking-wide text-primary sm:text-sm">
          games
        </span>
      </span>
    </span>
  );
}
