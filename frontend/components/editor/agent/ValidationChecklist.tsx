'use client';

import { CheckCircle2, Circle, AlertCircle } from 'lucide-react';
import {
  REQUIRED_FIELDS,
  OPTIONAL_FIELDS,
  FIELD_LABELS,
  ListingFieldKey,
  ListingDraft,
} from '@/lib/types/listing';

interface ValidationChecklistProps {
  listing: ListingDraft;
  onFieldClick?: (fieldKey: string) => void;
}

function isFieldFilled(value: any): boolean {
  if (value === null || value === undefined || value === '') return false;
  if (Array.isArray(value) && value.length === 0) return false;
  return true;
}

export function ValidationChecklist({ listing, onFieldClick }: ValidationChecklistProps) {
  const requiredStatus = REQUIRED_FIELDS.map((key) => ({
    key,
    label: FIELD_LABELS[key] || key,
    filled: isFieldFilled(listing[key]),
  }));

  const optionalStatus = OPTIONAL_FIELDS.map((key) => ({
    key,
    label: FIELD_LABELS[key] || key,
    filled: isFieldFilled(listing[key]),
  }));

  const requiredDone = requiredStatus.filter((f) => f.filled).length;
  const optionalDone = optionalStatus.filter((f) => f.filled).length;
  const totalRequired = requiredStatus.length;
  const totalOptional = optionalStatus.length;
  const allRequiredDone = requiredDone === totalRequired;

  return (
    <div className="space-y-4">
      {/* Required */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <h4 className="text-xs font-bold uppercase tracking-wider text-surface-500">
            Required Fields
          </h4>
          <span
            className={`text-xs font-bold px-2 py-0.5 rounded-full ${
              allRequiredDone ? 'bg-brand-50 text-brand-600' : 'bg-amber-50 text-amber-600'
            }`}
          >
            {requiredDone}/{totalRequired}
          </span>
        </div>
        {/* Progress bar */}
        <div className="w-full h-1.5 bg-surface-100 rounded-full mb-3 overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-500 ${
              allRequiredDone ? 'bg-brand-500' : 'bg-amber-400'
            }`}
            style={{ width: `${(requiredDone / totalRequired) * 100}%` }}
          />
        </div>
        <div className="space-y-1">
          {requiredStatus.map((field) => (
            <button
              key={field.key}
              onClick={() => onFieldClick?.(field.key)}
              className="w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg text-sm hover:bg-surface-50 transition-colors text-left cursor-pointer"
            >
              {field.filled ? (
                <CheckCircle2 className="w-4 h-4 text-brand-500 shrink-0" />
              ) : (
                <Circle className="w-4 h-4 text-amber-400 shrink-0" />
              )}
              <span
                className={`font-medium ${
                  field.filled ? 'text-surface-400 line-through' : 'text-surface-700'
                }`}
              >
                {field.label}
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* Optional */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <h4 className="text-xs font-bold uppercase tracking-wider text-surface-500">
            Optional Upgrades
          </h4>
          <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-surface-100 text-surface-400">
            {optionalDone}/{totalOptional}
          </span>
        </div>
        <div className="space-y-1">
          {optionalStatus.map((field) => (
            <button
              key={field.key}
              onClick={() => onFieldClick?.(field.key)}
              className="w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg text-sm hover:bg-surface-50 transition-colors text-left cursor-pointer"
            >
              {field.filled ? (
                <CheckCircle2 className="w-4 h-4 text-brand-500 shrink-0" />
              ) : (
                <Circle className="w-4 h-4 text-surface-300 shrink-0" />
              )}
              <span
                className={`font-medium ${
                  field.filled ? 'text-surface-400 line-through' : 'text-surface-600'
                }`}
              >
                {field.label}
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
