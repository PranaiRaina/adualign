'use client';

import { useState } from 'react';
import { Search } from 'lucide-react';

interface SearchBarProps {
  onSearch: (query: string) => void;
  className?: string;
}

export function SearchBar({ onSearch, className = '' }: SearchBarProps) {
  const [query, setQuery] = useState('');

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    onSearch(query.trim());
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setQuery(e.target.value);
    // Live search as user types
    onSearch(e.target.value.trim());
  };

  return (
    <form
      onSubmit={handleSearch}
      className={`relative flex items-center w-full max-w-2xl bg-surface-0 border-2 border-surface-200 rounded-xl overflow-hidden shadow-sm transition-all focus-within:ring-4 focus-within:ring-brand-500/20 focus-within:border-brand-500 ${className}`}
    >
      <div className="pl-4 pr-3 flex items-center justify-center text-surface-400">
        <Search className="w-5 h-5" />
      </div>

      <input
        type="text"
        placeholder="Search by city, zip code, or address..."
        value={query}
        onChange={handleChange}
        className="flex-1 h-12 bg-transparent text-surface-900 placeholder:text-surface-400 focus:outline-none text-base"
      />

      <div className="pr-2">
        <button
          type="submit"
          className="h-9 px-6 bg-surface-900 hover:bg-brand-600 text-surface-0 font-semibold rounded-lg transition-colors text-sm"
        >
          Search
        </button>
      </div>
    </form>
  );
}
