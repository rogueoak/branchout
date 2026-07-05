/**
 * The shared session shape. Account and anonymous sessions carry the same fields so
 * downstream code reads one object and branches on `kind`. The session lives server-side in
 * Redis; the cookie only carries the opaque `id`.
 */
export type SessionKind = 'account' | 'anonymous';

export interface Session {
  /** Opaque, unguessable session id - the only thing stored in the cookie. */
  id: string;
  kind: SessionKind;
  /** Present only for an account session; the durable Postgres account id. */
  accountId?: string;
  /** What to show for this session: the account's nickname, or an anonymous display name. */
  displayName: string;
  /** For an anonymous join-by-code session, the room code they joined with. */
  roomCode?: string;
  /** Epoch millis the session was created. */
  createdAt: number;
}

/**
 * Authorization: only a signed-in account may host a room. Anonymous players join and play
 * but never host. One field read - see spec 0004. Hosting itself is built in 0006; this is
 * the guard it will use.
 */
export function canHost(session: Session): boolean {
  return session.kind === 'account';
}
