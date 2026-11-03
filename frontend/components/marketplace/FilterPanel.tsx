'use client';

import { useState } from 'react';
import { AduType } from '@/lib/types/listing';
import { FilterState } from '@/lib/utils/filters';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { Filter, X } from 'lucide-react';
import { formatCurrency } from '@/lib/utils/formatting';

interface FilterPanelProps {
  filters: FilterState;
  onFilterChange: (filters: Partial<FilterState>) => void;
}

const ADU_TYPES: { value: AduType; label: string }[] = [
  { value: 'detached', label: 'Detached' },
  { value: 'attached', label: 'Attached' },
  { value: 'garage_conversion', label: 'Garage Conv.' },
  { value: 'basement', label: 'Basement' },
  { value: 'above_garage', label: 'Above Garage' },
  { value: 'junior_adu', label: 'Junior ADU' },
];

export function FilterPanel({ filters, onFilterChange }: FilterPanelProps) {
  const [isOpen, setIsOpen] = useState(false);

  // Count active filters (excluding query and price if at defaults)
  let activeCount = 0;
  if (filters.aduTypes.length > 0) activeCount++;
  if (filters.minBedrooms !== null) activeCount++;
  if (filters.minBathrooms !== null) activeCount++;
  if (filters.requireVerifiedPermit) activeCount++;
  if (filters.minPrice > 0 || filters.maxPrice < 10000) activeCount++;

  const toggleAduType = (type: AduType) => {
    const newTypes = filters.aduTypes.includes(type)
      ? filters.aduTypes.filter((t) => t !== type)
      : [...filters.aduTypes, type];
    onFilterChange({ aduTypes: newTypes });
  };

  const handlePriceChange = (values: number[]) => {
    onFilterChange({
      minPrice: values[0],
      maxPrice: values[1],
    });
  };

  const clearFilters = () => {
    onFilterChange({
      aduTypes: [],
      minPrice: 0,
      maxPrice: 10000,
      minBedrooms: null,
      minBathrooms: null,
      requireVerifiedPermit: false,
    });
  };

  return (
    <div className="bg-surface-0 rounded-2xl border border-surface-200 shadow-sm overflow-hidden md:sticky md:top-24">
      {/* Mobile Toggle */}
      <div
        className="p-4 flex items-center justify-between md:hidden cursor-pointer"
        onClick={() => setIsOpen(!isOpen)}
      >
        <div className="flex items-center gap-2 font-semibold text-surface-900">
          <Filter className="w-5 h-5 text-surface-500" />
          Filters
          {activeCount > 0 && (
            <span className="bg-brand-100 text-brand-700 text-xs font-bold px-2 py-0.5 rounded-full ml-1">
              {activeCount}
            </span>
          )}
        </div>
        <div className="text-surface-400">
          {isOpen ? <X className="w-5 h-5" /> : <Filter className="w-5 h-5" />}
        </div>
      </div>

      <div className={`p-6 ${isOpen ? 'block' : 'hidden md:block'}`}>
        <div className="flex items-center justify-between mb-8 pb-4 border-b border-surface-100">
          <h2 className="text-lg font-bold text-surface-900 flex items-center gap-2">
            Refine Search
            {activeCount > 0 && (
              <span className="bg-brand-100 text-brand-700 text-xs font-bold px-2 py-0.5 rounded-full">
                {activeCount}
              </span>
            )}
          </h2>
          {activeCount > 0 && (
            <button
              onClick={clearFilters}
              className="text-sm font-semibold text-surface-500 hover:text-surface-900 transition-colors"
            >
              Clear all
            </button>
          )}
        </div>

        <div className="space-y-8">
          {/* ADU Type */}
          <div>
            <h3 className="text-xs font-bold text-surface-500 uppercase tracking-wider mb-4">
              Space Type
            </h3>
            <div className="flex flex-wrap gap-2">
              {ADU_TYPES.map((type) => {
                const isSelected = filters.aduTypes.includes(type.value);
                return (
                  <button
                    key={type.value}
                    onClick={() => toggleAduType(type.value)}
                    className={`px-3 py-1.5 rounded-full text-sm font-medium transition-all duration-200 border ${
                      isSelected
                        ? 'bg-brand-600 text-surface-0 border-brand-600 shadow-sm'
                        : 'bg-surface-50 text-surface-600 border-surface-200 hover:border-brand-300 hover:bg-brand-50'
                    }`}
                  >
                    {type.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Price Range */}
          <div>
            <div className="flex justify-between items-end mb-4">
              <h3 className="text-xs font-bold text-surface-500 uppercase tracking-wider mb-0">
                Monthly Rent
              </h3>
              <span className="text-sm font-semibold text-brand-700">
                {formatCurrency(filters.minPrice)} -{' '}
                {filters.maxPrice >= 10000 ? '$10,000+' : formatCurrency(filters.maxPrice)}
              </span>
            </div>
            <div className="px-2 pt-2">
              <Slider
                min={0}
                max={10000}
                step={100}
                value={[filters.minPrice, filters.maxPrice]}
                onValueChange={handlePriceChange}
                className="my-4"
              />
            </div>
          </div>

          {/* Bedrooms / Bathrooms */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <h3 className="text-xs font-bold text-surface-500 uppercase tracking-wider mb-4">
                Bedrooms
              </h3>
              <div className="flex flex-wrap gap-2">
                {[0, 1, 2, 3].map((num) => {
                  const isSelected = filters.minBedrooms === num;
                  return (
                    <button
                      key={num}
                      onClick={() => onFilterChange({ minBedrooms: isSelected ? null : num })}
                      className={`w-10 h-10 flex items-center justify-center rounded-full text-sm font-medium transition-all duration-200 border ${
                        isSelected
                          ? 'bg-brand-600 text-surface-0 border-brand-600 shadow-sm'
                          : 'bg-surface-50 text-surface-600 border-surface-200 hover:border-brand-300 hover:bg-brand-50'
                      }`}
                    >
                      {num === 0 ? 'Any' : `${num}+`}
                    </button>
                  );
                })}
              </div>
            </div>

            <div>
              <h3 className="text-xs font-bold text-surface-500 uppercase tracking-wider mb-4">
                Bathrooms
              </h3>
              <div className="flex flex-wrap gap-2">
                {[1, 2, 3].map((num) => {
                  const isSelected = filters.minBathrooms === num;
                  return (
                    <button
                      key={num}
                      onClick={() => onFilterChange({ minBathrooms: isSelected ? null : num })}
                      className={`w-10 h-10 flex items-center justify-center rounded-full text-sm font-medium transition-all duration-200 border ${
                        isSelected
                          ? 'bg-brand-600 text-surface-0 border-brand-600 shadow-sm'
                          : 'bg-surface-50 text-surface-600 border-surface-200 hover:border-brand-300 hover:bg-brand-50'
                      }`}
                    >
                      {num === 1 && filters.minBathrooms !== 1 ? 'Any' : `${num}+`}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Trust/Verification */}
          <div className="pt-4 border-t border-surface-100">
            <label className="flex items-center gap-3 cursor-pointer group">
              <div className="relative flex items-center justify-center">
                <input
                  type="checkbox"
                  checked={filters.requireVerifiedPermit}
                  onChange={(e) => onFilterChange({ requireVerifiedPermit: e.target.checked })}
                  className="w-5 h-5 appearance-none rounded border-2 border-surface-300 checked:bg-brand-600 checked:border-brand-600 transition-colors focus:ring-2 focus:ring-brand-500 focus:outline-none focus:ring-offset-2"
                />
                {filters.requireVerifiedPermit && (
                  <svg
                    className="absolute w-3 h-3 text-white pointer-events-none"
                    viewBox="0 0 14 10"
                    fill="none"
                  >
                    <path
                      d="M1 5L4.5 8.5L13 1"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                )}
              </div>
              <div className="flex flex-col">
                <span className="text-sm font-semibold text-surface-900 group-hover:text-brand-600 transition-colors">
                  Verified Permits Only
                </span>
                <span className="text-[11px] text-surface-500 font-medium">
                  Hide unpermitted properties
                </span>
              </div>
            </label>
          </div>

          {/* Mobile Apply Button */}
          <div className="md:hidden pt-4 mt-2 border-t border-surface-100">
            <Button
              className="w-full bg-brand-600 hover:bg-brand-700 text-white font-bold h-12 rounded-xl"
              onClick={() => setIsOpen(false)}
            >
              Show Results
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
