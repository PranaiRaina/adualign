'use client';

import { useEffect, useRef, useState } from 'react';
import {
  CheckCircle2,
  CircleDollarSign,
  Flame,
  MapPin,
  Maximize2,
  AlertCircle,
  XCircle,
  Circle,
  Home,
  Info,
  Lock,
} from 'lucide-react';
import type { FinancePresentation, PropertyContext } from '@/types';
import { formatSqft, formatWholeNumber } from '@/lib/utils/formatting';
import { getAttachedSizeStatus, type AttachedSizeStatus } from '@/lib/utils/attachedSizeRule';
import { isFrontYardOver800 } from '@/lib/utils/frontYardRule';
import { cn } from '@/lib/utils';
import { EstimateDisclaimer } from '@/components/disclaimers';
import { AddonExplanationPopover } from '@/components/feasibility/AddonExplanationPopover';
import { TotalEstimateInfoPopover } from '@/components/feasibility/TotalEstimateInfoPopover';
import {
  getAddonDisplayLabel,
  getAddonExplanation,
} from '@/components/feasibility/addonExplanations';

/* ------------------------------------------------------------------ */
/*  Types                                                             */
/* ------------------------------------------------------------------ */

type ItemStatus = 'pass' | 'fail' | 'warning' | 'unknown';
type FireHazardSeverity = 'None' | 'Moderate' | 'High' | 'Very High';

interface FeasibilityItem {
  id: string;
  icon: React.ReactNode;
  title: string;
  description: string;
  status: ItemStatus;
}

const FIRE_HAZARD_OPTIONS: Array<{
  value: FireHazardSeverity;
  label: string;
  description: string;
}> = [
  {
    value: 'None',
    label: 'None',
    description: 'No designated fire hazard zone is known for this project.',
  },
  {
    value: 'Moderate',
    label: 'Moderate',
    description: 'Use the standard fire-resilient materials allowance.',
  },
  {
    value: 'High',
    label: 'High',
    description: 'Use the standard fire-resilient materials allowance.',
  },
  {
    value: 'Very High',
    label: 'Very High',
    description: 'Use the higher wildfire-compliance allowance.',
  },
];

interface Props {
  propertyContext?: PropertyContext;
  calculatorPresentation?: FinancePresentation | null;
  isCalculatorLoading?: boolean;
  calculatorError?: string | null;
  onToggleManualAddon?: (key: string, nextValue: boolean) => void;
  onFireHazardChange?: (severity: FireHazardSeverity) => void;
  collapsed?: boolean;
}

function getAduTypeLabel(context?: PropertyContext): string {
  if (context?.aduType === 'attached') return 'attached ADU';
  if (context?.aduType === 'garage_conversion') return 'garage conversion ADU';
  if (context?.aduType === 'jadu') return 'JADU';
  return 'detached ADU';
}

function formatFireZoneType(zoneType?: string): string {
  if (!zoneType || zoneType === 'None' || zoneType === 'Manual') return '';
  return ` (${zoneType})`;
}

function getBaseItems(context?: PropertyContext): FeasibilityItem[] {
  const address = context?.address || 'Irvine, CA';
  const size = context?.aduSize || 800;
  const max = context?.maxAduSqft || 1200;
  const fireSeverity = context?.fireHazardSeverity;
  const fireZoneType = context?.fireHazardZoneType;
  const frontYardWarning = isFrontYardOver800({
    currentZone: context?.currentYardZone,
    aduSize: context?.aduSize,
  });
  const zoningDetail = context?.currentYardZone
    ? frontYardWarning
      ? `Current placement is in the ${context.currentYardZone.toLowerCase()} yard zone. CA protects front yard ADUs only up to 800 ft², so verify larger units with your city.`
      : `Current placement is in the ${context.currentYardZone.toLowerCase()} yard zone.`
    : `Setbacks verified for ${address}.`;

  return [
    {
      id: 'zoning',
      icon: <MapPin className="w-4 h-4" />,
      title: 'Zoning & Setbacks',
      description: zoningDetail,
      status: frontYardWarning ? 'warning' : 'pass',
    },
    {
      id: 'size',
      icon: <Maximize2 className="w-4 h-4" />,
      title: `Size Limits (${formatSqft(size)})`,
      description: `Unit falls within the ${formatSqft(max)} maximum for this ${getAduTypeLabel(context)}.`,
      status: 'pass',
    },
    ...buildHomeRatioItems(context),
    buildFireHazardItem(fireSeverity, fireZoneType),
  ];
}

function buildHomeRatioItems(context?: PropertyContext): FeasibilityItem[] {
  const ratioStatus = getAttachedSizeStatus({
    aduType: context?.aduType,
    aduSize: context?.aduSize,
    homeSqft: context?.homeSqft,
  });
  if (ratioStatus === 'not-applicable') return [];

  const homeSqft = context?.homeSqft ?? 0;
  const half = formatWholeNumber(Math.round(homeSqft / 2));
  const home = formatWholeNumber(Math.round(homeSqft));
  const copy: Record<Exclude<AttachedSizeStatus, 'not-applicable'>, [ItemStatus, string]> = {
    'ok-under-800': [
      'pass',
      'Within the 800 ft² attached ADU allowance California guarantees regardless of home size.',
    ],
    'ok-under-half': [
      'pass',
      `Within 50% of the primary home's ~${home} ft² living area (county records).`,
    ],
    'over-half': [
      'warning',
      `Exceeds 50% of the primary home's ~${home} ft² living area (county records — may be outdated). California typically caps attached ADUs at ~${half} ft²; verify with your city.`,
    ],
    'unknown-home': [
      'warning',
      "California caps attached ADUs over 800 ft² at 50% of the home's living area, and we couldn't verify your home's size from county records. Confirm before planning above 800 ft².",
    ],
  };
  const [status, description] = copy[ratioStatus];

  return [
    {
      id: 'home-ratio',
      icon: <Home className="w-4 h-4" />,
      title: 'Home Size Ratio',
      description,
      status,
    },
  ];
}

function buildFireHazardItem(fireSeverity?: string, fireZoneType?: string): FeasibilityItem {
  const icon = <Flame className="w-4 h-4" />;
  if (!fireSeverity || fireSeverity === 'Unknown') {
    return {
      id: 'fire',
      icon,
      title: 'Fire Hazard Zone',
      description:
        'Fire hazard status is not specified yet. A tentative fire-resilient allowance is included.',
      status: 'unknown',
    };
  }
  if (fireSeverity === 'None') {
    return {
      id: 'fire',
      icon,
      title: 'Fire Hazard Zone',
      description: `Not in a designated CAL FIRE Hazard Severity Zone${formatFireZoneType(fireZoneType)}. Standard construction requirements apply.`,
      status: 'pass',
    };
  }
  if (fireSeverity === 'Moderate') {
    return {
      id: 'fire',
      icon,
      title: `Moderate Fire Hazard Zone${formatFireZoneType(fireZoneType)}`,
      description:
        'Fire-resistant roofing and ember-resistant vents required. Review local ordinance for additional requirements.',
      status: 'warning',
    };
  }
  return {
    id: 'fire',
    icon,
    title: `${fireSeverity} Fire Hazard Zone${formatFireZoneType(fireZoneType)}`,
    description:
      'Ignition-resistant construction, ember-resistant vents, and fire sprinklers likely required. 1-hr fire-rated walls if within 5ft of property line.',
    // Advisory, not blocking: amber like Moderate so it never reads as a stop.
    status: 'warning',
  };
}

function StatusBadge({ status }: { status: ItemStatus }) {
  if (status === 'pass') return <CheckCircle2 className="w-4 h-4 shrink-0 text-brand-600" />;
  if (status === 'fail') return <XCircle className="w-4 h-4 shrink-0 text-red-600" />;
  if (status === 'warning') return <AlertCircle className="w-4 h-4 shrink-0 text-amber-600" />;
  return <Circle className="w-3.5 h-3.5 shrink-0 text-surface-400" />;
}

function statusIconClass(status: ItemStatus): string {
  if (status === 'pass') return 'bg-brand-50 border-brand-200 text-brand-600';
  if (status === 'warning') return 'bg-amber-50 border-amber-200 text-amber-600';
  if (status === 'fail') return 'bg-red-50 border-red-200 text-red-600';
  return 'bg-surface-100 border-surface-200 text-surface-500';
}

const MISSING_INPUT_LABELS: Record<string, string> = {
  adu_sqft: 'ADU size',
};

function formatCurrency(value: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(value);
}

function formatRange(range?: { low: number; high: number } | null): string {
  if (!range) return 'Not available yet';
  return `${formatCurrency(range.low)} - ${formatCurrency(range.high)}`;
}

function renderMissingInputs(missingInputs: string[]): string {
  if (missingInputs.length === 0) return 'Provide project details to start the estimate.';
  return `Add ${missingInputs.map((key) => MISSING_INPUT_LABELS[key] ?? key).join(', ')} to unlock the calculator.`;
}

function RequirementItemContent({
  item,
  collapsed,
}: {
  item: FeasibilityItem;
  collapsed: boolean;
}) {
  return (
    <>
      <div
        className={`shrink-0 w-8 h-8 rounded-lg flex items-center justify-center border transition-all duration-300 ${statusIconClass(item.status)} ${collapsed ? 'scale-110' : ''}`}
      >
        {item.icon}
      </div>
      {!collapsed && (
        <div className="flex-1 min-w-0 animate-in fade-in slide-in-from-left-2 duration-300">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[13px] font-medium text-surface-900 leading-tight truncate">
              {item.title}
            </span>
            <StatusBadge status={item.status} />
          </div>
          <p className="text-[11px] leading-relaxed text-surface-500 mt-0.5">{item.description}</p>
        </div>
      )}
    </>
  );
}

function FireHazardRequirementRow({
  item,
  collapsed,
  currentSeverity,
  index,
  onFireHazardChange,
}: {
  item: FeasibilityItem;
  collapsed: boolean;
  currentSeverity?: string;
  index: number;
  onFireHazardChange?: (severity: FireHazardSeverity) => void;
}) {
  const rowRef = useRef<HTMLButtonElement>(null);
  const [isOpen, setIsOpen] = useState(false);
  const canEdit = item.id === 'fire' && !collapsed && !!onFireHazardChange;
  const rowClass = `group relative flex items-start gap-3 rounded-xl transition-all duration-300 hover:bg-surface-100 ${collapsed ? 'p-2' : 'px-3 py-3'}`;

  if (!canEdit) {
    return (
      <div className={rowClass} style={{ animationDelay: `${index * 80}ms` }}>
        <RequirementItemContent item={item} collapsed={collapsed} />
      </div>
    );
  }

  return (
    <>
      <button
        ref={rowRef}
        type="button"
        onClick={() => setIsOpen(true)}
        aria-expanded={isOpen}
        className={`${rowClass} w-full text-left cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-600/30`}
        style={{ animationDelay: `${index * 80}ms` }}
      >
        <RequirementItemContent item={item} collapsed={collapsed} />
      </button>
      <AddonExplanationPopover
        open={isOpen}
        anchorRef={rowRef}
        triggerRef={rowRef}
        label="Fire Hazard Zone"
        explanation=""
        onClose={() => setIsOpen(false)}
      >
        <div className="px-3.5 py-3 pr-8">
          <p className="text-[13px] font-semibold leading-snug text-surface-900">
            Fire Hazard Zone
          </p>
          <p className="mt-1 text-[11px] leading-relaxed text-surface-500">
            Current: {currentSeverity || 'Unknown'}
          </p>
          <div className="mt-3 space-y-1.5">
            {FIRE_HAZARD_OPTIONS.map((option) => {
              const isSelected = option.value === currentSeverity;
              return (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => {
                    onFireHazardChange?.(option.value);
                    setIsOpen(false);
                  }}
                  className={cn(
                    'w-full rounded-lg border px-3 py-2 text-left transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-600/30',
                    isSelected
                      ? 'border-brand-200 bg-brand-50 text-brand-700'
                      : 'border-surface-200 bg-surface-0 text-surface-700 hover:border-brand-200 hover:bg-surface-50',
                  )}
                >
                  <span className="flex items-center justify-between gap-3">
                    <span className="text-[12px] font-medium">{option.label}</span>
                    {isSelected && <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />}
                  </span>
                  <span className="mt-0.5 block text-[11px] leading-relaxed text-surface-500">
                    {option.description}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </AddonExplanationPopover>
    </>
  );
}

function CalculatorAddonRow({
  label,
  rangeText,
  isSelected,
  isAutomatic,
  triggerReason,
  explanation,
  isExplainOpen,
  onToggle,
  onExplainOpenChange,
}: {
  label: string;
  rangeText: string;
  isSelected: boolean;
  isAutomatic: boolean;
  triggerReason?: string | null;
  explanation: string;
  isExplainOpen: boolean;
  onToggle?: () => void;
  onExplainOpenChange: (open: boolean) => void;
}) {
  const rowRef = useRef<HTMLDivElement>(null);
  const explainBtnRef = useRef<HTMLButtonElement>(null);
  const [optimisticSelected, setOptimisticSelected] = useState(isSelected);

  useEffect(() => {
    setOptimisticSelected(isSelected);
  }, [isSelected]);

  // ponytail: only the leading "$X – $Y" renders in mono; trailing prose stays sans
  const rangeMatch = rangeText.match(/^(\$[\d,]+(?:\s*[–—-]\s*\$[\d,]+)?)\s*(.*)$/);
  const rangeLine = (
    <p className="mt-1 text-left text-[11px] leading-relaxed text-surface-500">
      {rangeMatch ? (
        <>
          <span className="font-mono tracking-wide">{rangeMatch[1]}</span>
          {rangeMatch[2] && <> {rangeMatch[2]}</>}
        </>
      ) : (
        rangeText
      )}
    </p>
  );

  const explainButton = (
    <button
      ref={explainBtnRef}
      type="button"
      onClick={(event) => {
        event.stopPropagation();
        onExplainOpenChange(!isExplainOpen);
      }}
      aria-expanded={isExplainOpen}
      className={cn(
        'inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-1 text-[10px] font-medium transition-all duration-200',
        isExplainOpen
          ? 'border-brand-200 bg-brand-50 text-brand-600 opacity-100 md:opacity-100'
          : 'border-surface-200 text-surface-500 hover:border-brand-200 hover:text-brand-600 md:opacity-0 md:group-hover:opacity-100',
      )}
    >
      <Info className="h-3 w-3" />
      Explain
    </button>
  );

  const popover = (
    <AddonExplanationPopover
      open={isExplainOpen}
      anchorRef={rowRef}
      triggerRef={explainBtnRef}
      label={label}
      explanation={explanation}
      onClose={() => onExplainOpenChange(false)}
    />
  );

  if (isAutomatic) {
    return (
      <div
        ref={rowRef}
        className="group rounded-xl border border-surface-200 bg-surface-0 px-3 py-3 transition-all duration-200 hover:border-brand-200 hover:bg-surface-50"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-1.5">
            <Lock className="h-3 w-3 shrink-0 text-brand-600" />
            <p className="text-[13px] font-medium leading-tight text-surface-900">{label}</p>
          </div>
          {explainButton}
        </div>

        {rangeLine}

        {triggerReason && (
          <p className="mt-2 text-left text-[11px] leading-relaxed text-surface-500">
            {triggerReason}
          </p>
        )}
        {popover}
      </div>
    );
  }

  const handleToggle = () => {
    setOptimisticSelected((prev) => !prev);
    onToggle?.();
  };

  return (
    <div
      ref={rowRef}
      role="button"
      tabIndex={0}
      aria-pressed={optimisticSelected}
      onClick={handleToggle}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          handleToggle();
        }
      }}
      className="group cursor-pointer rounded-xl border border-surface-200 bg-surface-0 px-3 py-3 transition-all duration-200 hover:border-brand-200 hover:bg-surface-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-600/30"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <span
            className={`relative flex h-4 w-7 shrink-0 items-center rounded-full border transition-colors duration-200 ${
              optimisticSelected
                ? 'border-brand-600/30 bg-brand-600'
                : 'border-surface-300 bg-surface-100'
            }`}
            aria-hidden="true"
          >
            <span
              className={`ml-0.5 block h-3 w-3 rounded-full bg-white shadow-sm transition-transform duration-200 ease-out ${
                optimisticSelected ? 'translate-x-3' : 'translate-x-0'
              }`}
            />
          </span>
          <p className="text-[13px] font-medium leading-tight text-surface-900">{label}</p>
        </div>

        {explainButton}
      </div>

      {rangeLine}

      {triggerReason && (
        <p className="mt-2 text-left text-[11px] leading-relaxed text-surface-500">
          {triggerReason}
        </p>
      )}
      {popover}
    </div>
  );
}

function CalculatorTab({
  presentation,
  isLoading,
  error,
  onToggleManualAddon,
}: {
  presentation?: FinancePresentation | null;
  isLoading: boolean;
  error?: string | null;
  onToggleManualAddon?: (key: string, nextValue: boolean) => void;
}) {
  // Only one explanation popover is open at a time, keyed by a row id that is
  // namespaced so an automatic and a manual add-on sharing a key never collide.
  const [openExplainRow, setOpenExplainRow] = useState<string | null>(null);
  const [isEstimateInfoOpen, setIsEstimateInfoOpen] = useState(false);
  const estimateInfoButtonRef = useRef<HTMLButtonElement>(null);

  if (isLoading && !presentation) {
    return (
      <div className="flex h-full items-center justify-center px-4 text-center">
        <div>
          <div className="mx-auto mb-3 h-9 w-9 animate-spin rounded-full border-2 border-brand-600/20 border-t-brand-600" />
          <p className="text-[12px] text-surface-500">Refreshing your cost calculator…</p>
        </div>
      </div>
    );
  }

  const missingInputs = presentation?.missing_inputs ?? [];
  const displayRange =
    presentation?.current_estimate_range ?? presentation?.base_estimate_range ?? null;
  const hasEstimate = !!displayRange;

  return (
    <div className="flex h-full flex-col gap-3 px-3 py-3">
      <div className="group rounded-xl border border-brand-100 bg-brand-50 px-4 py-4 transition-all duration-200 hover:border-brand-200 hover:bg-brand-100">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 whitespace-nowrap text-[12px] font-semibold text-brand-600 uppercase tracking-wide">
            <CircleDollarSign className="h-3.5 w-3.5 shrink-0" />
            Your total cost estimate
          </div>
          <button
            ref={estimateInfoButtonRef}
            type="button"
            aria-label="Explain total cost estimate"
            aria-expanded={isEstimateInfoOpen}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => setIsEstimateInfoOpen((open) => !open)}
            className={cn(
              'inline-flex shrink-0 items-center justify-center rounded-full border p-1.5 text-surface-500 transition-none',
              'focus:outline-none focus-visible:opacity-100',
              isEstimateInfoOpen
                ? 'border-brand-200 bg-brand-50 text-brand-600 opacity-100 md:opacity-100'
                : 'border-surface-200 hover:border-brand-200 hover:text-brand-600 md:opacity-0 md:group-hover:opacity-100',
            )}
          >
            <Info className="h-3 w-3" />
          </button>
        </div>
        <p className="mt-2 text-[20px] font-semibold tracking-tight text-surface-900">
          {hasEstimate ? formatRange(displayRange) : 'Estimate unavailable'}
        </p>
        {!hasEstimate && !error && (
          <p className="mt-1 text-[11px] leading-relaxed text-surface-500">
            {renderMissingInputs(missingInputs)}
          </p>
        )}
        {!hasEstimate && error && (
          <p className="mt-1 text-[11px] leading-relaxed text-red-700">{error}</p>
        )}
        <TotalEstimateInfoPopover
          open={isEstimateInfoOpen}
          anchorRef={estimateInfoButtonRef}
          triggerRef={estimateInfoButtonRef}
          onClose={() => setIsEstimateInfoOpen(false)}
        />
      </div>

      {!hasEstimate && (
        <div
          className={`rounded-2xl px-4 py-3 ${error ? 'border border-red-300 bg-red-50' : 'border border-amber-400/20 bg-amber-400/8'}`}
        >
          <div className="flex items-start gap-2">
            <AlertCircle
              className={`mt-0.5 h-4 w-4 shrink-0 ${error ? 'text-red-700' : 'text-amber-500'}`}
            />
            <p
              className={`text-[12px] leading-relaxed ${error ? 'text-red-700' : 'text-amber-700'}`}
            >
              {error ?? renderMissingInputs(missingInputs)}
            </p>
          </div>
        </div>
      )}

      <div className="space-y-2">
        <p className="px-1 text-[11px] font-semibold text-surface-500 uppercase tracking-widest">
          Automatic cost add-ons
        </p>
        {presentation?.automatic_addons.length ? (
          presentation.automatic_addons.map((addon) => {
            const rowId = `automatic:${addon.key}`;
            return (
              <CalculatorAddonRow
                key={addon.key}
                label={getAddonDisplayLabel(addon.key, addon.label)}
                rangeText={addon.display_range_text}
                isSelected={addon.is_selected}
                isAutomatic={true}
                triggerReason={addon.trigger_reason}
                explanation={getAddonExplanation(addon.key)}
                isExplainOpen={openExplainRow === rowId}
                onExplainOpenChange={(open) => setOpenExplainRow(open ? rowId : null)}
              />
            );
          })
        ) : (
          <div className="rounded-xl border border-dashed border-surface-200 px-4 py-4 text-[12px] text-surface-400">
            No automatic add-ons apply yet.
          </div>
        )}
      </div>

      <div className="space-y-2">
        <p className="px-1 text-[11px] font-semibold text-surface-500 uppercase tracking-widest">
          Common complications
        </p>
        {presentation?.manual_addons.map((addon) => {
          const rowId = `manual:${addon.key}`;
          return (
            <CalculatorAddonRow
              key={addon.key}
              label={getAddonDisplayLabel(addon.key, addon.label)}
              rangeText={addon.display_range_text}
              isSelected={addon.is_selected}
              isAutomatic={false}
              explanation={getAddonExplanation(addon.key)}
              isExplainOpen={openExplainRow === rowId}
              onToggle={() => onToggleManualAddon?.(addon.key, !addon.is_selected)}
              onExplainOpenChange={(open) => setOpenExplainRow(open ? rowId : null)}
            />
          );
        })}
      </div>

      <EstimateDisclaimer asFooter />
    </div>
  );
}

export function FeasibilitySidebar({
  propertyContext,
  calculatorPresentation,
  isCalculatorLoading = false,
  calculatorError,
  onToggleManualAddon,
  onFireHazardChange,
  collapsed,
}: Props) {
  const [activeTab, setActiveTab] = useState<'calculator' | 'requirements'>('calculator');
  const requirementItems = getBaseItems(propertyContext);

  return (
    <aside className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div
        className={`px-5 pt-6 pb-4 transition-all duration-500 ${collapsed ? 'opacity-0 scale-95 h-0 overflow-hidden py-0' : 'opacity-100 scale-100'}`}
      >
        <h2 className="text-base font-semibold text-surface-900 tracking-tight">
          Project Feasibility
        </h2>
        <div className="flex items-center gap-2 mt-1.5">
          <div className="w-1.5 h-1.5 rounded-full bg-brand-600" />
          <span
            className="text-xs text-surface-500 truncate"
            title={propertyContext?.address || 'Irvine, CA'}
          >
            {propertyContext?.address || 'Irvine, CA'}
          </span>
        </div>
        {(propertyContext?.aduType || propertyContext?.aduSize || propertyContext?.aduShape) && (
          <div className="flex items-center gap-1.5 mt-1 ml-3.5">
            {propertyContext.aduType && (
              <span className="text-xs text-surface-600">
                {getAduTypeLabel(propertyContext).replace(' ADU', '')}
              </span>
            )}
            {propertyContext.aduType && propertyContext.aduSize && (
              <span className="text-surface-300">·</span>
            )}
            {propertyContext.aduSize && (
              <span className="text-xs text-surface-600">
                {formatSqft(propertyContext.aduSize)}
              </span>
            )}
            {(propertyContext.aduType || propertyContext.aduSize) && propertyContext.aduShape && (
              <span className="text-surface-300">·</span>
            )}
            {propertyContext.aduShape && (
              <span className="text-xs text-surface-600">
                {propertyContext.aduShape.replace(/[_-]/g, ' ')}
              </span>
            )}
          </div>
        )}
      </div>

      <div
        className={`mx-5 flex gap-1 rounded-xl bg-surface-100 p-1 transition-all duration-500 ${collapsed ? 'opacity-0 scale-95 h-0 overflow-hidden mb-0' : 'opacity-100 scale-100 mb-0'}`}
      >
        <button
          onClick={() => setActiveTab('calculator')}
          className={`flex-1 text-[12px] font-medium py-1.5 rounded-lg transition-all duration-200 cursor-pointer ${
            activeTab === 'calculator'
              ? 'bg-surface-0 text-surface-900 shadow-sm'
              : 'text-surface-500 hover:text-surface-800'
          }`}
        >
          Calculator
        </button>
        <button
          onClick={() => setActiveTab('requirements')}
          className={`flex-1 text-[12px] font-medium py-1.5 rounded-lg transition-all duration-200 cursor-pointer ${
            activeTab === 'requirements'
              ? 'bg-surface-0 text-surface-900 shadow-sm'
              : 'text-surface-500 hover:text-surface-800'
          }`}
        >
          Requirements
        </button>
      </div>

      <div
        className={`mx-5 mt-3 h-px bg-surface-200 transition-all duration-500 ${collapsed ? 'opacity-0 h-0 overflow-hidden mt-0' : 'opacity-100'}`}
      />

      {activeTab === 'calculator' && (
        <div
          data-addon-scroll
          className="flex-1 overflow-y-auto animate-in fade-in slide-in-from-bottom-2 duration-300"
        >
          {!collapsed && (
            <CalculatorTab
              presentation={calculatorPresentation}
              isLoading={isCalculatorLoading}
              error={calculatorError}
              onToggleManualAddon={onToggleManualAddon}
            />
          )}
        </div>
      )}

      {activeTab === 'requirements' && (
        <div className="flex-1 overflow-y-auto px-3 py-3">
          <div
            className={`flex flex-col gap-1.5 transition-all duration-500 ${collapsed ? 'items-center px-0' : ''}`}
          >
            {requirementItems.map((item, index) => (
              <FireHazardRequirementRow
                key={item.id}
                item={item}
                collapsed={!!collapsed}
                currentSeverity={propertyContext?.fireHazardSeverity}
                index={index}
                onFireHazardChange={onFireHazardChange}
              />
            ))}
          </div>
        </div>
      )}
    </aside>
  );
}
