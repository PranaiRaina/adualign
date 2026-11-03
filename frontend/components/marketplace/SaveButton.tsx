'use client';

import { useSaved } from '@/lib/context/SavedContext';
import { Heart } from 'lucide-react';

interface Props {
  listingId: string;
  className?: string;
}

export function SaveButton({ listingId, className = '' }: Props) {
  const { isSaved, toggleSaved } = useSaved();
  const saved = isSaved(listingId);

  return (
    <button
      onClick={(e) => {
        e.preventDefault(); // Prevent listing card click
        toggleSaved(listingId);
      }}
      className={`p-2.5 rounded-full transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-brand-500 shadow-[0_2px_8px_rgba(0,0,0,0.1)] ${
        saved
          ? 'bg-rose-50 text-rose-500 hover:bg-rose-100 hover:scale-105'
          : 'bg-surface-0/95 text-surface-400 hover:text-surface-900 hover:scale-105 backdrop-blur-sm'
      } ${className}`}
      aria-label={saved ? 'Remove from saved' : 'Save property'}
    >
      <Heart className={`w-5 h-5 ${saved ? 'fill-current' : ''}`} />
    </button>
  );
}
