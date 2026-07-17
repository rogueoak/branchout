// The Nightleaf game mark (spec 0060): a night grove where numbered leaves climb an oak trunk in
// ascending order, a firefly aglow beside them, over the single gold root the whole brand family
// carries (#d2a463). A cooperative, silent, ascending-number game - the mark reads as "play your
// leaves in order as the grove falls quiet". Inlined as a string (like the wordmark) so the web can
// import it directly with no asset/raster step.

/** Raw SVG string for the 512x512 Nightleaf game mark. */
export const nightleafSvg: string = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512" role="img" aria-label="Branch out Nightleaf">
  <defs>
    <radialGradient id="nl-bg" cx="0.5" cy="0.34" r="0.85">
      <stop offset="0" stop-color="#1a1430"/>
      <stop offset="1" stop-color="#0d0a15"/>
    </radialGradient>
    <radialGradient id="nl-moon" cx="0.5" cy="0.5" r="0.5">
      <stop offset="0" stop-color="#f4ecff"/>
      <stop offset="1" stop-color="#b9a7e8"/>
    </radialGradient>
    <radialGradient id="nl-firefly" cx="0.5" cy="0.5" r="0.5">
      <stop offset="0" stop-color="#FDE047" stop-opacity="0.9"/>
      <stop offset="1" stop-color="#FDE047" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="512" height="512" fill="url(#nl-bg)"/>

  <!-- a quiet night sky: a moon and a scatter of stars -->
  <circle cx="384" cy="104" r="40" fill="url(#nl-moon)"/>
  <circle cx="378" cy="94" r="34" fill="#1a1430"/>
  <g fill="#e9deff">
    <circle cx="96" cy="86" r="3"/>
    <circle cx="150" cy="132" r="2"/>
    <circle cx="250" cy="70" r="2.5"/>
    <circle cx="430" cy="180" r="2"/>
    <circle cx="72" cy="188" r="2"/>
  </g>

  <!-- the oak trunk: a bent skeleton the leaves climb -->
  <path d="M256 452 C 250 380 262 330 240 264 C 222 210 264 168 250 112"
        fill="none" stroke="#6f5a86" stroke-width="14" stroke-linecap="round"/>

  <!-- ascending numbered leaves (the trunk), low to high: 3, 27, 61, 94 -->
  <g font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif" font-weight="700" text-anchor="middle">
    <!-- leaf 1 (lowest) -->
    <g transform="translate(196 396) rotate(-18)">
      <ellipse cx="0" cy="0" rx="40" ry="26" fill="#2f8f5b" stroke="#1c6b41" stroke-width="5"/>
      <text x="0" y="8" font-size="26" fill="#eafff2">3</text>
    </g>
    <!-- leaf 2 -->
    <g transform="translate(300 316) rotate(16)">
      <ellipse cx="0" cy="0" rx="42" ry="27" fill="#3aa06a" stroke="#1c6b41" stroke-width="5"/>
      <text x="0" y="9" font-size="26" fill="#eafff2">27</text>
    </g>
    <!-- leaf 3 -->
    <g transform="translate(190 236) rotate(-16)">
      <ellipse cx="0" cy="0" rx="44" ry="28" fill="#57b985" stroke="#1c6b41" stroke-width="5"/>
      <text x="0" y="9" font-size="26" fill="#0d3320">61</text>
    </g>
    <!-- leaf 4 (highest) -->
    <g transform="translate(296 150) rotate(14)">
      <ellipse cx="0" cy="0" rx="46" ry="29" fill="#7fd3a6" stroke="#1c6b41" stroke-width="5"/>
      <text x="0" y="9" font-size="26" fill="#0d3320">94</text>
    </g>
  </g>

  <!-- a firefly glowing beside the climb (the hush spark) -->
  <circle cx="372" cy="300" r="30" fill="url(#nl-firefly)"/>
  <circle cx="372" cy="300" r="7" fill="#FDE047"/>

  <!-- the single gold root the whole family carries (#d2a463) -->
  <g stroke="#d2a463" stroke-width="10" stroke-linecap="round" fill="none">
    <path d="M256 452 C 228 468 208 470 186 486"/>
    <path d="M256 452 C 284 468 304 470 326 486"/>
    <path d="M256 452 L 256 492"/>
  </g>
  <circle cx="256" cy="452" r="12" fill="#d2a463"/>
</svg>`;
