import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { RecoveryModulesService } from '../services/recovery-modules.service.js';
import {
  RECOVERY_MODULE_TYPES,
  type RecoveryModuleType,
  type RecoveryModulesOverview,
  type RecoveryModuleSummary,
  type ModuleOpportunityItem,
} from '../domain/recovery-module.js';

export type {
  RecoveryModulesOverview as RecoveryModulesOverviewResponse,
  RecoveryModuleSummary as RecoveryModuleSummaryResponse,
  ModuleOpportunityItem as ModuleOpportunityItemResponse,
};

const moduleTypeParamSchema = z.object({
  type: z.enum(RECOVERY_MODULE_TYPES as unknown as [string, ...string[]]),
});

const moduleOpportunityQuerySchema = z
  .object({
    merchantId: z.string().uuid().optional(),
    module: z.enum(RECOVERY_MODULE_TYPES as unknown as [string, ...string[]]).optional(),
  })
  .strict();

/**
 * Recovery Modules routes (Phase 12).
 *
 * GET  /recovery-modules                   — Overview of all modules + metrics
 * GET  /recovery-modules/:type             — Detail for a single module
 * GET  /recovery-modules/opportunities     — Module-enriched opportunity list
 * POST /recovery-modules/detect            — Detect module type from evidence payload
 */
export const recoveryModuleRoutes: FastifyPluginAsync = async (app) => {
  const createService = (): RecoveryModulesService => new RecoveryModulesService(app.db);

  app.get<{ Reply: RecoveryModulesOverview | { error: { code: string; message: string } } }>(
    '/recovery-modules',
    async (_request, reply) => {
      const service = createService();
      const overview = await service.getOverview();
      return reply.send(overview);
    }
  );

  app.get<{
    Params: { type: string };
    Reply: RecoveryModuleSummary | { error: { code: string; message: string } };
  }>(
    '/recovery-modules/:type',
    async (request, reply) => {
      const parsed = moduleTypeParamSchema.safeParse(request.params);
      if (!parsed.success) {
        return reply.status(400).send({
          error: {
            code: 'INVALID_MODULE_TYPE',
            message: `Module type must be one of: ${RECOVERY_MODULE_TYPES.join(', ')}`,
          },
        });
      }

      const service = createService();
      const detail = await service.getModuleDetail(parsed.data.type as RecoveryModuleType);
      return reply.send(detail);
    }
  );

  app.get<{
    Querystring: { merchantId?: string; module?: string };
    Reply: { opportunities: ModuleOpportunityItem[]; total: number } | { error: { code: string; message: string } };
  }>(
    '/recovery-modules/opportunities',
    async (request, reply) => {
      const parsed = moduleOpportunityQuerySchema.safeParse(request.query);
      if (!parsed.success) {
        return reply.status(400).send({
          error: {
            code: 'INVALID_QUERY',
            message: 'Invalid query parameters.',
          },
        });
      }

      const service = createService();
      const overview = await service.getOverview(parsed.data.merchantId);

      let items: ModuleOpportunityItem[] = [];
      for (const mod of overview.modules) {
        if (parsed.data.module && mod.moduleType !== parsed.data.module) {
          continue;
        }
        items = items.concat(mod.sampleOpportunities);
      }

      return reply.send({
        opportunities: items,
        total: items.length,
      });
    }
  );

  app.post<{
    Body: { evidence?: unknown; opportunityType?: string };
    Reply: { moduleType: RecoveryModuleType; confidence: string } | { error: { code: string; message: string } };
  }>(
    '/recovery-modules/detect',
    async (request, reply) => {
      const { detectModuleFromEvidence } = await import('../domain/recovery-module.js');
      const body = request.body as { evidence?: unknown; opportunityType?: string } | undefined;

      if (!body?.evidence && !body?.opportunityType) {
        return reply.status(400).send({
          error: {
            code: 'MISSING_PAYLOAD',
            message: 'Provide either evidence or opportunityType to detect a module.',
          },
        });
      }

      const { evidence, opportunityType } = body ?? {};
      const modType = detectModuleFromEvidence(
        evidence,
        opportunityType as Parameters<typeof detectModuleFromEvidence>[1]
      );

      return reply.send({
        moduleType: modType,
        confidence: 'deterministic',
      });
    }
  );
};
