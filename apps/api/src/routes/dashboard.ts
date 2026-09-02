import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';

const dashboardQuerySchema = z
  .object({
    merchantId: z.string().uuid().optional(),
  })
  .strict();

export const dashboardRoutes: FastifyPluginAsync = async (app) => {
  app.get<{
    Querystring: Record<string, unknown>;
  }>('/dashboard/overview', async (request, reply) => {
    const query = dashboardQuerySchema.parse(request.query);
    const overview = await app.dashboardService.getOverview(query.merchantId);
    return reply.send(overview);
  });
};
