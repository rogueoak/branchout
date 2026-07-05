import { logoSvg } from '@branchout/brand/logo';

interface LogoProps {
  className?: string;
}

/**
 * Branch out logo lockup rendered as an inline SVG.
 * 520x150 mark: icon tile, "Branch out" wordmark ("out" in the Confetti gradient),
 * tagline "where game night grows". Inlined for crisp rendering at all DPRs.
 */
export function Logo({ className }: LogoProps) {
  return (
    <span
      className={className}
      dangerouslySetInnerHTML={{ __html: logoSvg }}
      role="img"
      aria-label="Branch out - where game night grows"
    />
  );
}
