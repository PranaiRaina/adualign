'use client';

import { useState } from 'react';
import { Check, ChevronRight } from 'lucide-react';

export interface ChipOption {
  id: string;
  label: string;
  exclusive?: boolean;
}

interface ChipGroupProps {
  label?: string;
  options: ChipOption[];
  multiSelect?: boolean;
  selected: string[];
  onSelect: (selected: string[]) => void;
  locked?: boolean;
}

export function ChipGroup({
  label,
  options,
  multiSelect = false,
  selected,
  onSelect,
  locked = false,
}: ChipGroupProps) {
  const handleClick = (id: string) => {
    if (locked) return;
    if (!multiSelect) {
      onSelect([id]);
      return;
    }
    const opt = options.find((o) => o.id === id);
    if (opt?.exclusive) {
      onSelect(selected.includes(id) ? [] : [id]);
    } else {
      const filtered = selected.filter((s) => !options.find((o) => o.id === s)?.exclusive);
      if (filtered.includes(id)) {
        onSelect(filtered.filter((s) => s !== id));
      } else {
        onSelect([...filtered, id]);
      }
    }
  };

  return (
    <div className="mb-3">
      {label && (
        <p className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground/60 mb-2">
          {label}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        {options.map((opt) => {
          const isSelected = selected.includes(opt.id);
          return (
            <button
              key={opt.id}
              onClick={() => handleClick(opt.id)}
              disabled={locked}
              className={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-[13px] font-medium border transition-all duration-200 ${
                locked
                  ? isSelected
                    ? 'bg-primary/15 border-primary/30 text-primary cursor-default'
                    : 'bg-secondary/20 border-border/20 text-muted-foreground/25 cursor-default'
                  : isSelected
                    ? 'bg-primary/15 border-primary/40 text-primary hover:bg-primary/20 cursor-pointer'
                    : 'bg-card/60 border-border/60 text-muted-foreground hover:border-primary/30 hover:text-foreground cursor-pointer'
              }`}
            >
              {isSelected && <Check className="w-3 h-3" strokeWidth={3} />}
              {opt.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Compound Q2 component (two groups + confirm button)               */
/* ------------------------------------------------------------------ */

const BLOCKER_OPTIONS: ChipOption[] = [
  { id: 'hoa', label: 'HOA' },
  { id: 'historic', label: 'Historic district' },
  { id: 'hillside', label: 'Hillside lot' },
  { id: 'none', label: 'None of these', exclusive: true },
];

const STRUCTURE_OPTIONS: ChipOption[] = [
  { id: 'yes', label: 'Yes' },
  { id: 'no', label: 'No' },
  { id: 'unsure', label: 'Not sure' },
];

interface Step2Props {
  onAnswer: (blockerTypes: string[], hasStructure: boolean | null) => void;
  locked: boolean;
  savedBlockers: string[];
  savedStructure: boolean | null;
}

export function OnboardingQ2({ onAnswer, locked, savedBlockers, savedStructure }: Step2Props) {
  const [blockers, setBlockers] = useState<string[]>([]);
  const [structure, setStructure] = useState<string | null>(null);

  const displayBlockers = locked ? (savedBlockers.length > 0 ? savedBlockers : ['none']) : blockers;

  const displayStructure = locked
    ? savedStructure === true
      ? 'yes'
      : savedStructure === false
        ? 'no'
        : savedStructure === null && savedBlockers !== undefined
          ? 'unsure'
          : null
    : structure;

  const canContinue = blockers.length > 0 && structure !== null && !locked;

  const handleConfirm = () => {
    const types = blockers.filter((b) => b !== 'none');
    const hasStruct = structure === 'yes' ? true : structure === 'no' ? false : null;
    onAnswer(types, hasStruct);
  };

  return (
    <div>
      <ChipGroup
        label="Does any of this apply?"
        options={BLOCKER_OPTIONS}
        multiSelect
        selected={displayBlockers}
        onSelect={setBlockers}
        locked={locked}
      />
      <ChipGroup
        label="Existing garage, basement, or structure to convert?"
        options={STRUCTURE_OPTIONS}
        selected={displayStructure ? [displayStructure] : []}
        onSelect={(s) => setStructure(s[0] ?? null)}
        locked={locked}
      />
      {canContinue && (
        <button
          onClick={handleConfirm}
          className="inline-flex items-center gap-1.5 mt-1 px-4 py-2 rounded-xl text-[13px] font-medium bg-primary/15 border border-primary/30 text-primary hover:bg-primary/25 transition-all duration-200 cursor-pointer"
        >
          Continue
          <ChevronRight className="w-3.5 h-3.5" />
        </button>
      )}
    </div>
  );
}
