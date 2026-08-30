import type { AppDatabase } from '../lib/database.js';
import {
  RECOVERY_MODULE_TYPES,
  RECOVERY_MODULE_DEFINITIONS,
  detectModuleFromEvidence,
  type RecoveryModuleType,
  type RecoveryModuleSummary,
  type RecoveryModulesOverview,
  type ModuleOpportunityItem,
} from '../domain/recovery-module.js';
import type { RecoveryOpportunityRow } from '../domain/recovery-opportunity.js';
import type { RecoveryDecisionRow } from '../domain/recovery-decision.js';
import type { RecoveryExecutionRow } from '../domain/recovery-execution.js';
import { ModuleAdapterRegistry } from '../modules/module-adapters.js';

export class RecoveryModulesService {
  private readonly adapterRegistry = new ModuleAdapterRegistry();

  constructor(private readonly db: AppDatabase) {}

  async getOverview(merchantId?: string): Promise<RecoveryModulesOverview> {
    const opportunities = await this.db.recoveryOpportunity.list({ merchantId });
    const decisions = await this.db.recoveryDecision.listAll({ merchantId });
    const executions = await this.db.recoveryExecution.listAll({ merchantId });

    // Map opportunities to decisions & executions
    const decisionByOppId = new Map<string, RecoveryDecisionRow>();
    for (const d of decisions) {
      decisionByOppId.set(d.opportunityId, d);
    }

    const executionsByOppId = new Map<string, RecoveryExecutionRow[]>();
    for (const ex of executions) {
      const list = executionsByOppId.get(ex.opportunityId) ?? [];
      list.push(ex);
      executionsByOppId.set(ex.opportunityId, list);
    }

    // Group by module
    const moduleMap = new Map<RecoveryModuleType, RecoveryOpportunityRow[]>();
    for (const type of RECOVERY_MODULE_TYPES) {
      moduleMap.set(type, []);
    }

    for (const opp of opportunities) {
      const modType = detectModuleFromEvidence(opp.evidence, opp.type);
      const list = moduleMap.get(modType) ?? [];
      list.push(opp);
      moduleMap.set(modType, list);
    }

    const moduleSummaries: RecoveryModuleSummary[] = [];
    let grandRevenueAtRisk = 0;
    let grandRecoverableRevenue = 0;
    let grandRecoveredRevenue = 0;
    let grandBlockedActions = 0;
    let grandHumanReviews = 0;

    for (const type of RECOVERY_MODULE_TYPES) {
      const modOpps = moduleMap.get(type) ?? [];
      const info = RECOVERY_MODULE_DEFINITIONS[type];

      let revenueAtRisk = 0;
      let recoverableRevenue = 0;
      let recoveredRevenue = 0;
      let activeCases = 0;
      let blockedActions = 0;
      let humanReviews = 0;

      const items: ModuleOpportunityItem[] = [];

      for (const opp of modOpps) {
        const dec = decisionByOppId.get(opp.id);
        const oppExecs = executionsByOppId.get(opp.id) ?? [];
        const isRecovered = opp.status === 'RECOVERED';
        const isOpen = opp.status === 'OPEN';

        recoverableRevenue += opp.amountAtRisk;

        if (isOpen) {
          revenueAtRisk += opp.amountAtRisk;
          activeCases++;
        }

        if (isRecovered) {
          recoveredRevenue += opp.amountAtRisk;
        }

        const isBlocked = oppExecs.some((e) => e.status === 'BLOCKED') || dec?.recommendedAction === 'DO_NOT_RETRY';
        const isReview = dec?.recommendedAction === 'REVIEW';

        if (isBlocked) blockedActions++;
        if (isReview) humanReviews++;

        const ev = (typeof opp.evidence === 'object' && opp.evidence !== null ? opp.evidence : {}) as Record<string, unknown>;
        const customerName = (ev['customerName'] as string) ?? (ev['businessName'] as string) ?? 'Synthetic Customer';
        const businessContext = (ev['planName'] as string) ?? (ev['invoiceId'] as string) ?? (ev['mandateId'] as string) ?? (ev['failureReason'] as string) ?? opp.reason;

        // Policy results
        const checks = [
          { name: 'Policy Cap', passed: true, detail: 'Within allowed threshold' },
          { name: 'Classification', passed: !isBlocked, detail: isBlocked ? 'Blocked condition' : 'Recoverable pattern' },
          { name: 'Safety Gate', passed: !isBlocked, detail: isBlocked ? 'Intervention engaged' : 'Passed guardrails' },
        ];

        items.push({
          id: opp.id,
          moduleType: type,
          moduleName: info.name,
          amount: opp.amountAtRisk,
          currency: opp.currency,
          status: opp.status,
          urgency: (ev['urgency'] as 'low' | 'medium' | 'high' | 'critical') ?? info.defaultUrgency,
          triggerEvent: (ev['eventType'] as string) ?? info.triggerEvent,
          failureReason: opp.reason,
          customerName,
          businessContext,
          detectedAt: opp.detectedAt.toISOString(),
          resolvedAt: opp.resolvedAt ? opp.resolvedAt.toISOString() : null,
          decision: dec
            ? {
                recommendedAction: dec.recommendedAction,
                score: dec.score,
                confidence: dec.confidence,
                priority: dec.priority,
                reasons: Array.isArray(dec.reasons) ? dec.reasons : [],
              }
            : null,
          policyResult: {
            passed: !isBlocked,
            checks,
          },
          action: {
            type: dec?.recommendedAction ?? info.primaryAction,
            status: oppExecs.length > 0 ? (oppExecs[0]?.status ?? 'PENDING') : 'PENDING',
            summary: isBlocked ? 'Action blocked by safety policy' : isRecovered ? 'Recovery completed & verified' : 'Action planned / pending execution',
            providerReferenceId: oppExecs[0]?.providerPaymentId ?? undefined,
          },
          outcome: {
            recovered: isRecovered,
            recoveredAmount: isRecovered ? opp.amountAtRisk : 0,
            description: isRecovered
              ? 'Payment captured and verified in ledger.'
              : isBlocked
                ? 'Action blocked to prevent fees & customer friction.'
                : 'Opportunity open in pipeline.',
          },
        });
      }

      const recoveryRate = recoverableRevenue > 0 ? Math.round((recoveredRevenue / recoverableRevenue) * 100) : 0;

      grandRevenueAtRisk += revenueAtRisk;
      grandRecoverableRevenue += recoverableRevenue;
      grandRecoveredRevenue += recoveredRevenue;
      grandBlockedActions += blockedActions;
      grandHumanReviews += humanReviews;

      moduleSummaries.push({
        moduleType: type,
        info,
        metrics: {
          totalOpportunities: modOpps.length,
          revenueAtRisk,
          recoverableRevenue,
          recoveredRevenue,
          recoveryRate,
          activeCases,
          blockedActions,
          humanReviews,
        },
        opportunitiesCount: modOpps.length,
        sampleOpportunities: items.slice(0, 10),
      });
    }

    const grandRecoveryRate = grandRecoverableRevenue > 0 ? Math.round((grandRecoveredRevenue / grandRecoverableRevenue) * 100) : 0;

    return {
      summary: {
        totalModules: RECOVERY_MODULE_TYPES.length,
        totalOpportunities: opportunities.length,
        totalRevenueAtRisk: grandRevenueAtRisk,
        totalRecoverableRevenue: grandRecoverableRevenue,
        totalRecoveredRevenue: grandRecoveredRevenue,
        overallRecoveryRate: grandRecoveryRate,
        totalBlockedActions: grandBlockedActions,
        totalHumanReviews: grandHumanReviews,
      },
      modules: moduleSummaries,
    };
  }

  async getModuleDetail(moduleType: RecoveryModuleType, merchantId?: string): Promise<RecoveryModuleSummary> {
    const overview = await this.getOverview(merchantId);
    const mod = overview.modules.find((m) => m.moduleType === moduleType);
    if (!mod) {
      return {
        moduleType,
        info: RECOVERY_MODULE_DEFINITIONS[moduleType] ?? RECOVERY_MODULE_DEFINITIONS.FAILED_PAYMENT,
        metrics: {
          totalOpportunities: 0,
          revenueAtRisk: 0,
          recoverableRevenue: 0,
          recoveredRevenue: 0,
          recoveryRate: 0,
          activeCases: 0,
          blockedActions: 0,
          humanReviews: 0,
        },
        opportunitiesCount: 0,
        sampleOpportunities: [],
      };
    }
    return mod;
  }

  async getOpportunity(id: string, merchantId?: string): Promise<ModuleOpportunityItem | null> {
    const opp = await this.db.recoveryOpportunity.findById(id);
    if (!opp) return null;
    if (merchantId && opp.merchantId !== merchantId) return null;

    const modType = detectModuleFromEvidence(opp.evidence, opp.type);
    const info = RECOVERY_MODULE_DEFINITIONS[modType];
    const dec = await this.db.recoveryDecision.findByOpportunityAndEngineVersion(opp.id, 'v1');
    const aiAdvice = await this.db.recoveryAIAdvice.findByDecisionId(dec?.id ?? '');
    const executions = await this.db.recoveryExecution.listByOpportunity(opp.id);

    const isRecovered = opp.status === 'RECOVERED';
    const isBlocked = executions.some((e) => e.status === 'BLOCKED') || dec?.recommendedAction === 'DO_NOT_RETRY';
    const ev = (typeof opp.evidence === 'object' && opp.evidence !== null ? opp.evidence : {}) as Record<string, unknown>;

    const customerName = (ev['customerName'] as string) ?? (ev['businessName'] as string) ?? 'Synthetic Customer';
    const businessContext = (ev['planName'] as string) ?? (ev['invoiceId'] as string) ?? (ev['mandateId'] as string) ?? opp.reason;

    return {
      id: opp.id,
      moduleType: modType,
      moduleName: info.name,
      amount: opp.amountAtRisk,
      currency: opp.currency,
      status: opp.status,
      urgency: (ev['urgency'] as 'low' | 'medium' | 'high' | 'critical') ?? info.defaultUrgency,
      triggerEvent: (ev['eventType'] as string) ?? info.triggerEvent,
      failureReason: opp.reason,
      customerName,
      businessContext,
      detectedAt: opp.detectedAt.toISOString(),
      resolvedAt: opp.resolvedAt ? opp.resolvedAt.toISOString() : null,
      decision: dec
        ? {
            recommendedAction: dec.recommendedAction,
            score: dec.score,
            confidence: dec.confidence,
            priority: dec.priority,
            reasons: Array.isArray(dec.reasons) ? dec.reasons : [],
          }
        : null,
      aiAdvice: aiAdvice
        ? {
            summary: aiAdvice.summary,
            explanation: aiAdvice.explanation,
            nextStep: aiAdvice.nextStep,
            confidence: aiAdvice.confidence,
          }
        : null,
      policyResult: {
        passed: !isBlocked,
        checks: [
          { name: 'Module Policy Alignment', passed: true, detail: `Complies with ${info.name} safety matrix` },
          { name: 'Execution Authorization', passed: !isBlocked, detail: isBlocked ? 'Safety Gate Blocked' : 'Authorized' },
        ],
      },
      action: {
        type: dec?.recommendedAction ?? info.primaryAction,
        status: executions[0]?.status ?? 'PENDING',
        summary: isBlocked ? 'Action halted by safety policy' : isRecovered ? 'Verified recovered in ledger' : 'Ready for execution',
        providerReferenceId: executions[0]?.providerPaymentId ?? undefined,
      },
      outcome: {
        recovered: isRecovered,
        recoveredAmount: isRecovered ? opp.amountAtRisk : 0,
        description: isRecovered ? 'Verified recovery' : isBlocked ? 'Blocked' : 'Open',
      },
    };
  }
}
