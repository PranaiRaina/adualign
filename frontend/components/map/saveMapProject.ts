import type { AnalyzeResponse, FinanceStateSnapshot } from '@/types';

import type { MapLocation } from './types';
import type { PlanChatContext } from './hooks/useMapSessionLifecycle';

export async function calculateMapFinanceState(args: {
  apiBaseUrl: string;
  token: string;
  result: AnalyzeResponse;
  selectedLocation: MapLocation | null;
  aduSize: number;
  aduType: 'detached' | 'attached';
  financeState?: FinanceStateSnapshot | null;
  planChatContext?: PlanChatContext;
}): Promise<FinanceStateSnapshot> {
  const fireHazard = resolveFireHazard(args.result, args.planChatContext);
  const response = await fetch(`${args.apiBaseUrl}/chatbot/calculator`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${args.token}`,
    },
    body: JSON.stringify({
      address: args.selectedLocation?.name ?? args.result.parcel_address ?? null,
      county: args.result.county ?? null,
      adu_sqft: args.aduSize,
      adu_type: args.aduType,
      fire_hazard_severity: fireHazard.severity,
      fire_hazard_zone_type: fireHazard.zoneType,
      finance_state: args.financeState ?? null,
    }),
  });

  if (!response.ok) {
    throw new Error(`Calculator failed with status ${response.status}`);
  }

  const data = (await response.json()) as { finance_state?: FinanceStateSnapshot };
  if (!data.finance_state) {
    throw new Error('Calculator did not return finance state.');
  }
  return data.finance_state;
}

function resolveFireHazard(
  result: AnalyzeResponse,
  planChatContext?: PlanChatContext,
): { severity: string | null; zoneType: string | null } {
  return {
    severity: planChatContext?.fireHazardSeverity ?? result.fire_hazard?.severity ?? null,
    zoneType: planChatContext?.fireHazardZoneType ?? result.fire_hazard?.zone_type ?? null,
  };
}
