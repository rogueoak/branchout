import type { FastifyInstance } from 'fastify';
import type { ProfileService } from '../profiles/service';

export interface ProfileRoutesDeps {
  profiles: ProfileService;
}

/**
 * The public profile read (spec 0027). Unauthenticated on purpose - the profile page and link
 * crawlers have no session - so it returns only the visibility-gated projection (`PublicProfile`),
 * never email/account-id/session. 404s an unknown gamer tag.
 */
export function registerProfileRoutes(app: FastifyInstance, deps: ProfileRoutesDeps): void {
  const { profiles } = deps;

  app.get<{ Params: { gamerTag: string } }>('/profiles/:gamerTag', async (request, reply) => {
    const profile = await profiles.getPublicProfile(request.params.gamerTag);
    if (!profile) {
      return reply.code(404).send({ error: 'No such player.' });
    }
    return reply.code(200).send({ profile });
  });
}
