'use client';

import { useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, FileText, BookOpen, ExternalLink } from 'lucide-react';

export interface SourceRef {
  id?: string | null;
  page_number?: number | null;
  source?: string;
  regulation_topic?: string | null;
  chunk_text?: string;
  url?: string | null;
  citation_url?: string | null;
}

interface SourceDrawerProps {
  activeSource: SourceRef | null;
  allSources: SourceRef[];
  onSelectSource: (source: SourceRef) => void;
  onClose: () => void;
}

export function SourceDrawer({
  activeSource,
  allSources,
  onSelectSource,
  onClose,
}: SourceDrawerProps) {
  /* Close on Escape key */
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    if (activeSource) {
      document.addEventListener('keydown', handleKey);
      return () => document.removeEventListener('keydown', handleKey);
    }
  }, [activeSource, onClose]);

  if (!activeSource) return null;

  const displayName = activeSource?.source
    ? activeSource.source.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
    : 'ADU Handbook';

  const pdfUrl = activeSource.citation_url ?? activeSource.url ?? '/adu-handbook.pdf';
  const pdfSrc = activeSource.page_number ? `${pdfUrl}#page=${activeSource.page_number}` : pdfUrl;

  return (
    <AnimatePresence mode="wait">
      <motion.aside
        key="source-panel"
        initial={{ opacity: 0, x: 20 }}
        animate={{ opacity: 1, x: 0 }}
        exit={{ opacity: 0, x: 20 }}
        transition={{ duration: 0.4, ease: [0.23, 1, 0.32, 1] }}
        className="flex flex-col h-full bg-surface-0"
        role="dialog"
        aria-modal="true"
        aria-label="Source citation viewer"
      >
        {/* ── Tab Bar ── */}
        <div className="flex items-center gap-1 px-4 py-2 border-b border-surface-100 bg-surface-50 flex-wrap shrink-0">
          {allSources.map((s, idx) => (
            <button
              key={`${s.page_number}-${idx}`}
              onClick={() => onSelectSource(s)}
              title={s.regulation_topic ?? `Source ${idx + 1}`}
              className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[10px] font-mono whitespace-nowrap transition-all duration-200 border ${
                activeSource === s
                  ? 'bg-brand-50 border-brand-200 text-brand-600'
                  : 'bg-transparent border-transparent text-surface-500 hover:bg-surface-100'
              }`}
            >
              <FileText className="w-3 h-3" />
              {idx + 1}
            </button>
          ))}
        </div>

        {/* ── Header ── */}
        <header className="flex items-start justify-between gap-3 px-5 py-5 border-b border-surface-100 shrink-0 bg-surface-0">
          <div className="flex items-center gap-3 min-w-0">
            <div className="flex-shrink-0 w-10 h-10 rounded-xl bg-brand-50 border border-brand-200 flex items-center justify-center">
              <BookOpen className="w-5 h-5 text-brand-600" />
            </div>
            <div className="min-w-0">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-surface-400 leading-none mb-1.5">
                Source Document
              </p>
              <h2 className="text-sm font-bold text-surface-900 leading-snug truncate tracking-tight">
                {displayName}
              </h2>
              <div className="flex items-center gap-2 mt-2 flex-wrap">
                {activeSource?.page_number != null && (
                  <span className="text-[10px] font-mono text-brand-600 bg-brand-50 border border-brand-200 rounded px-2 py-0.5 font-bold">
                    P. {activeSource.page_number}
                  </span>
                )}
                {activeSource?.regulation_topic &&
                  (() => {
                    const raw = activeSource.regulation_topic
                      .replace(/^\[|\]$/g, '')
                      .replace(/'/g, '');
                    const topics = raw
                      .split(/[|,]/)
                      .map((t) => t.trim().replace(/_/g, ' '))
                      .filter(Boolean);
                    return topics.map((topic) => (
                      <span
                        key={topic}
                        className="text-[10px] font-mono text-surface-500 bg-surface-100 border border-surface-200 rounded-full px-2 py-0.5 capitalize"
                      >
                        {topic}
                      </span>
                    ));
                  })()}
              </div>
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="Close source drawer"
            className="flex-shrink-0 flex items-center justify-center w-9 h-9 rounded-xl text-surface-500 hover:text-surface-800 hover:bg-surface-100 border border-transparent hover:border-surface-200 transition-all duration-200 cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </header>

        {/* ── Body (scrollable) ── */}
        <div className="flex-1 overflow-y-auto overscroll-contain chat-scrollbar bg-surface-50">
          {/* Chunk text */}
          {activeSource?.chunk_text && (
            <section className="px-5 pt-6 pb-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
              <div className="flex items-center gap-2 mb-3">
                <div className="w-1 h-3 bg-brand-600 rounded-full" />
                <span className="text-[10px] font-semibold uppercase tracking-widest text-surface-500">
                  Cited Text
                </span>
              </div>
              <div className="relative">
                <div className="rounded-xl border border-surface-200 bg-surface-0 p-5 overflow-hidden">
                  <p className="text-[13px] leading-[1.8] text-surface-800 selection:bg-brand-100 break-words">
                    {(activeSource.chunk_text ?? '')
                      .replace(/^\[Summary:[\s\S]*?\]\s*/, '')
                      .replace(/^\d+\s+/, '')
                      .trim()}
                  </p>
                </div>
              </div>
            </section>
          )}

          {/* PDF iframe — handbook sources only */}
          {activeSource?.page_number != null && (
            <section className="px-5 pb-8 animate-in fade-in slide-in-from-bottom-6 duration-700">
              <div className="flex items-center gap-2 mb-3">
                <div className="w-1 h-3 bg-brand-600 rounded-full" />
                <span className="text-[10px] font-semibold uppercase tracking-widest text-surface-500">
                  Full Document Preview
                </span>
              </div>
              <div className="rounded-xl border border-surface-200 overflow-hidden bg-surface-100 aspect-[3/4.2] shadow-[0_4px_16px_rgba(0,0,0,0.10),0_1px_4px_rgba(0,0,0,0.06)]">
                <iframe
                  key={`pdf-page-${activeSource.page_number}`}
                  src={pdfSrc}
                  title={`ADU Handbook page ${activeSource.page_number}`}
                  className="w-full h-full grayscale-[0.2] brightness-[1.02] contrast-[1.05]"
                />
              </div>
            </section>
          )}

          {/* Web source link — web_search results */}
          {activeSource?.url && (
            <section className="px-5 pb-8 animate-in fade-in slide-in-from-bottom-6 duration-700">
              <div className="flex items-center gap-2 mb-3">
                <div className="w-1 h-3 bg-brand-600 rounded-full" />
                <span className="text-[10px] font-semibold uppercase tracking-widest text-surface-500">
                  Web Source
                </span>
              </div>
              <a
                href={activeSource.url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 px-4 py-3 rounded-xl border border-surface-200 bg-surface-0 hover:border-brand-200 hover:bg-brand-50 transition-all duration-200 group"
              >
                <ExternalLink className="w-3.5 h-3.5 text-surface-400 group-hover:text-brand-600 shrink-0 transition-colors" />
                <span className="text-[11px] font-mono text-surface-500 group-hover:text-surface-800 break-all transition-colors">
                  {activeSource.url}
                </span>
              </a>
            </section>
          )}
        </div>
      </motion.aside>
    </AnimatePresence>
  );
}
