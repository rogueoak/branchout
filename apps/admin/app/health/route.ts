// Liveness probe for docker-compose and the Caddy edge. Trivial: if Next can answer, admin is up.
export function GET() {
  return Response.json({ status: 'ok' });
}
