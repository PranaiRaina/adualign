'use client';

import { CheckCircle2, AlertCircle } from 'lucide-react';
import { useState, useRef, useEffect } from 'react';
import type { FieldMeta } from '@/lib/types/listing';

interface CanvasFieldProps {
  label: string;
  value: string | number | boolean | null;
  fieldKey: string;
  meta?: FieldMeta;
  required?: boolean;
  type?: 'text' | 'number' | 'boolean' | 'select' | 'image' | 'currency' | 'percent';
  options?: { value: string; label: string }[];
  suffix?: string;
  onUpdate: (fieldKey: string, value: any) => void;
}

export function CanvasField({
  label,
  value,
  fieldKey,
  meta,
  required = false,
  type = 'text',
  options,
  suffix,
  onUpdate,
}: CanvasFieldProps) {
  const [editing, setEditing] = useState(false);
  const [localValue, setLocalValue] = useState(value?.toString() || '');
  const inputRef = useRef<HTMLInputElement | HTMLSelectElement>(null);

  useEffect(() => {
    setLocalValue(value?.toString() || '');
  }, [value]);

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
    }
  }, [editing]);

  const isEmpty =
    value === null ||
    value === undefined ||
    value === '' ||
    (Array.isArray(value) && value.length === 0);

  const isAutoFilled = meta?.status === 'auto-filled';

  const handleSave = () => {
    setEditing(false);
    let parsed: any = localValue;
    if (type === 'number' || type === 'currency' || type === 'percent') {
      parsed = parseFloat(localValue) || null;
    } else if (type === 'boolean') {
      parsed = localValue === 'true';
    }
    onUpdate(fieldKey, parsed);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleSave();
    if (e.key === 'Escape') {
      setLocalValue(value?.toString() || '');
      setEditing(false);
    }
  };

  const displayValue = () => {
    if (isEmpty) return null;
    if (type === 'boolean') return value ? 'Yes' : 'No';
    if (type === 'currency') return `$${Number(value).toLocaleString()}`;
    if (type === 'percent') return `${value}%`;
    if (suffix) return `${value}${suffix}`;
    if (options) {
      const opt = options.find((o) => o.value === value);
      return opt?.label || value?.toString();
    }
    return value?.toString();
  };

  // Image field
  if (type === 'image') {
    return (
      <div className="group">
        <label className="text-xs font-bold uppercase tracking-wider text-surface-500 mb-1.5 block">
          {label}
          {isEmpty && (
            <span
              className={`ml-2 text-[10px] px-1.5 py-0.5 rounded-full font-bold ${
                required
                  ? 'bg-amber-50 text-amber-600 border border-amber-200'
                  : 'bg-surface-100 text-surface-400 border border-surface-200'
              }`}
            >
              {required ? 'Required' : 'Optional'}
            </span>
          )}
        </label>
        {isEmpty ? (
          <div className="border-2 border-dashed border-surface-200 rounded-xl h-32 flex items-center justify-center text-surface-400 text-sm font-medium hover:border-brand-300 hover:bg-brand-50/30 transition-all cursor-pointer">
            + Upload or drag image
          </div>
        ) : (
          <div className="relative rounded-xl overflow-hidden h-32 bg-surface-100">
            <img src={value as string} alt={label} className="w-full h-full object-cover" />
            {isAutoFilled && <AutoFillBadge />}
          </div>
        )}
      </div>
    );
  }

  return (
    <div
      className={`group relative rounded-xl p-3 transition-all cursor-pointer ${
        editing
          ? 'bg-white ring-2 ring-brand-500/30 shadow-sm'
          : isEmpty
            ? 'bg-surface-50 hover:bg-surface-100 border border-dashed border-surface-200'
            : isAutoFilled
              ? 'bg-brand-50/40 hover:bg-brand-50/60 border border-brand-100'
              : 'bg-surface-50 hover:bg-surface-100 border border-surface-200'
      }`}
      onClick={() => !editing && setEditing(true)}
    >
      <div className="flex items-center justify-between mb-1">
        <label className="text-[11px] font-bold uppercase tracking-wider text-surface-500">
          {label}
        </label>
        <div className="flex items-center gap-1.5">
          {isAutoFilled && !isEmpty && <AutoFillBadge />}
          {isEmpty && (
            <span
              className={`text-[10px] px-1.5 py-0.5 rounded-full font-bold ${
                required
                  ? 'bg-amber-50 text-amber-600 border border-amber-200'
                  : 'bg-surface-100 text-surface-400 border border-surface-200'
              }`}
            >
              {required ? 'Required' : 'Optional'}
            </span>
          )}
        </div>
      </div>

      {editing ? (
        type === 'select' && options ? (
          <select
            ref={inputRef as React.RefObject<HTMLSelectElement>}
            value={localValue}
            onChange={(e) => {
              setLocalValue(e.target.value);
              onUpdate(
                fieldKey,
                e.target.value === 'true'
                  ? true
                  : e.target.value === 'false'
                    ? false
                    : e.target.value,
              );
              setEditing(false);
            }}
            onBlur={handleSave}
            className="w-full bg-transparent text-surface-900 font-semibold text-sm outline-none"
          >
            <option value="">Select...</option>
            {options.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        ) : (
          <input
            ref={inputRef as React.RefObject<HTMLInputElement>}
            type={
              type === 'currency' || type === 'number' || type === 'percent' ? 'number' : 'text'
            }
            value={localValue}
            onChange={(e) => setLocalValue(e.target.value)}
            onBlur={handleSave}
            onKeyDown={handleKeyDown}
            className="w-full bg-transparent text-surface-900 font-semibold text-sm outline-none"
            placeholder={`Enter ${label.toLowerCase()}...`}
          />
        )
      ) : (
        <div className="text-sm font-semibold text-surface-900 min-h-[20px]">
          {isEmpty ? (
            <span className="text-surface-400 font-medium italic">Click to add...</span>
          ) : (
            displayValue()
          )}
        </div>
      )}
    </div>
  );
}

function AutoFillBadge() {
  return (
    <span className="inline-flex items-center gap-1 text-[10px] font-bold text-brand-600 bg-brand-50 px-1.5 py-0.5 rounded-full border border-brand-200">
      <CheckCircle2 className="w-2.5 h-2.5" />
      Auto-filled
    </span>
  );
}
