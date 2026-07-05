// Liveness probe for docker-compose and load balancers. Kept trivial: if the Next server can
// answer, the web app is up.
export function GET() {
  return Response.json({ status: 'ok' });
}
