# 0030 - The rooms "Join a room" code input autofocuses on mobile

## Symptom

Opening `/rooms` ("Play a game") on a phone, the "Join a room" code input takes focus on load and
pops the mobile keyboard. That is annoying, and it buries the primary "Create a room" action above
it - the wrong first impression for a mobile-first surface where hosting is the primary path.

## Root cause

Not app code and not a canopy default. A code search found NO `autoFocus` prop in
`apps/web/app/rooms/RoomsHome.tsx`, and canopy's `Input` (`@rogueoak/canopy` seeds) is a bare
`React.forwardRef` `<input>` that forwards props unchanged with no `autoFocus` default - so nothing
in our code or the component library focuses the field. Rendering `RoomsHome` in jsdom confirms the
join-code input is NOT the active element on mount there. The observed focus is a **browser
heuristic**: some mobile browsers autofocus the first empty text input on a page when there is a
single obvious field, which the join-code input is (the host section is a button, not an input).

## Fix

Set `autoFocus={false}` explicitly on the join-code `Input`, with an inline comment explaining that
nothing focuses it and this is the guard against a browser autofocusing the page's first empty text
input. Add a `RoomsHome` test asserting the input is not the active element on mount and its
`autofocus` property is `false`.

## Learning

When a "steals focus on mount" report has no `autoFocus` in the code and the component is a plain
input, suspect a **browser autofocus heuristic** (first/only empty text field), not a bug in your
code - and reproduce before fixing. jsdom will not show it (no heuristic), so the honest guard is an
explicit `autoFocus={false}` plus a not-focused-on-mount test, not a hunt for a focus() call that
does not exist. Generalizes past this one field; captured in `overview/learnings.md`.
