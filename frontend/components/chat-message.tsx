'use client';

import React from 'react';
import ReactMarkdown from 'react-markdown';
import { FileSearch } from 'lucide-react';
import type { SourceRef } from '@/components/source-drawer';

interface ChatMessageProps {
  role: 'user' | 'assistant';
  content: string;
  isLatest?: boolean;
  sources?: SourceRef[];
  isStreaming?: boolean;
  onSourceClick?: (source: SourceRef, allSources: SourceRef[]) => void;
}

const CITATION_RE = /(\[\d+\])/g;

/** Split a string on [N] markers and return a mix of text spans and citation buttons. */
function injectCitations(
  text: string,
  sources: SourceRef[],
  onSourceClick: ((src: SourceRef, all: SourceRef[]) => void) | undefined,
  keyPrefix: string,
): React.ReactNode[] {
  const parts = text.split(CITATION_RE);
  return parts.map((part, i) => {
    const m = part.match(/^\[(\d+)\]$/);
    if (!m) return part;
    const num = parseInt(m[1], 10);
    const src = sources[num - 1]; // 1-indexed → 0-indexed
    if (!src) return <span key={`${keyPrefix}-${i}`}>{part}</span>; // hallucinated index — safe fallback
    return (
      <sup key={`${keyPrefix}-${i}`}>
        <button
          type="button"
          onClick={() => onSourceClick?.(src, sources)}
          title={src.regulation_topic ? `Source: ${src.regulation_topic}` : `Source ${num}`}
          className="inline-flex items-center justify-center min-w-[1.1em] text-[10px] font-bold font-mono text-brand-600 hover:text-brand-700 hover:bg-brand-50 rounded px-0.5 cursor-pointer transition-colors duration-150 leading-none"
        >
          {num}
        </button>
      </sup>
    );
  });
}

/** Recursively walk React children and inject citation buttons into string nodes. */
function processChildren(
  children: React.ReactNode,
  sources: SourceRef[],
  onSourceClick: ((src: SourceRef, all: SourceRef[]) => void) | undefined,
  keyPrefix = 'c',
): React.ReactNode {
  return React.Children.map(children, (child, i) => {
    if (typeof child === 'string') {
      return injectCitations(child, sources, onSourceClick, `${keyPrefix}-${i}`);
    }
    if (React.isValidElement(child) && (child.props as any).children) {
      return React.cloneElement(child as React.ReactElement<any>, {
        children: processChildren(
          (child.props as any).children,
          sources,
          onSourceClick,
          `${keyPrefix}-${i}`,
        ),
      });
    }
    return child;
  });
}

export function ChatMessage({
  role,
  content,
  isLatest,
  sources,
  isStreaming,
  onSourceClick,
}: ChatMessageProps) {
  const isAI = role === 'assistant';
  const hasSources = isAI && sources && sources.length > 0;

  // Compute which source indices (0-based) are actually cited in the text.
  // While streaming, show all sources since citations may not have appeared yet.
  const citedIndices = React.useMemo(() => {
    if (!hasSources || !sources || isStreaming) return null; // null = show all
    const cited = new Set<number>();
    for (const m of Array.from(content.matchAll(/\[(\d+)\]/g))) {
      const idx = parseInt(m[1], 10) - 1; // [N] → 0-based index
      if (idx >= 0 && idx < sources.length) cited.add(idx);
    }
    return cited; // empty set = no citations found → show no source chips
  }, [content, hasSources, sources, isStreaming]);

  // Subset of sources actually shown as chips (cited ones only, once streaming done).
  // During streaming citedIndices is null (show all); after streaming it's a Set.
  const visibleSources = React.useMemo(() => {
    if (!sources) return [];
    if (!citedIndices) return sources; // still streaming → show all
    return sources.filter((_, i) => citedIndices.has(i)); // only cited
  }, [sources, citedIndices]);

  // --- Appearance Order Re-indexing ---
  // Standard Writing Protocol: The first unique source mentioned becomes [1], etc.
  const { reindexedContent, reindexedSources } = React.useMemo(() => {
    if (!hasSources || !sources || isStreaming) {
      return { reindexedContent: content, reindexedSources: sources || [] };
    }

    const appearanceOrder: number[] = [];
    const originalToNew = new Map<number, number>();

    // 1. Find unique original indices in order of appearance
    const matches = Array.from(content.matchAll(/\[(\d+)\]/g));
    for (const m of matches) {
      const originalNum = parseInt(m[1], 10);
      const originalIdx = originalNum - 1;

      if (originalIdx >= 0 && originalIdx < sources.length) {
        if (!originalToNew.has(originalNum)) {
          appearanceOrder.push(originalIdx);
          originalToNew.set(originalNum, appearanceOrder.length);
        }
      }
    }

    // 2. Re-map the content markers
    // We sort matches backwards to safely replace without shifting offsets
    let newContent = content;
    const SortedMatches = [...matches].sort((a, b) => (b.index || 0) - (a.index || 0));
    for (const m of SortedMatches) {
      const originalNum = parseInt(m[1], 10);
      const newNum = originalToNew.get(originalNum);
      if (newNum) {
        const start = m.index || 0;
        const end = start + m[0].length;
        newContent = newContent.slice(0, start) + `[${newNum}]` + newContent.slice(end);
      }
    }

    // 3. Re-order the sources array
    const newSources = appearanceOrder.map((idx) => sources[idx]);

    // 4. Final step: Re-order multiple citations on the same point (e.g. [2][1] -> [1][2])
    // This is optional but adds that final polish.
    newContent = newContent.replace(/(\[\d+\])+/g, (match) => {
      const nums = Array.from(match.matchAll(/\[(\d+)\]/g)).map((m) => parseInt(m[1], 10));
      nums.sort((a, b) => a - b);
      return nums.map((n) => `[${n}]`).join('');
    });

    return { reindexedContent: newContent, reindexedSources: newSources };
  }, [content, hasSources, sources, isStreaming]);

  /** ReactMarkdown component overrides that intercept text nodes for citation injection. */
  const mdComponents = React.useMemo(() => {
    if (!hasSources || !reindexedSources) return {};
    // Always use the reindexed sources array for citation lookup so [N] indices stay correct
    const inject = (children: React.ReactNode) =>
      processChildren(children, reindexedSources, onSourceClick);
    return {
      p: ({ children }: any) => <p>{inject(children)}</p>,
      li: ({ children }: any) => <li>{inject(children)}</li>,
      td: ({ children }: any) => <td>{inject(children)}</td>,
      strong: ({ children }: any) => <strong>{inject(children)}</strong>,
      em: ({ children }: any) => <em>{inject(children)}</em>,
    };
  }, [hasSources, reindexedSources, onSourceClick]);

  return (
    <div
      className={`flex ${isAI ? 'justify-start' : 'justify-end'} ${
        isLatest ? (isAI ? 'animate-fade-in-up' : 'animate-scale-in') : ''
      }`}
    >
      <div className="relative max-w-[85%]">
        <div className={`flex items-center gap-2 mb-2 ${isAI ? '' : 'justify-end'}`}>
          {isAI ? (
            <div className="flex items-center gap-1.5">
              <div className="w-1.5 h-1.5 rounded-full bg-brand-600" />
              <span className="text-xs font-semibold text-surface-500">ADU Advisor</span>
            </div>
          ) : (
            <span className="text-xs font-semibold text-surface-400">You</span>
          )}
        </div>

        <div
          className={`relative ${
            isAI
              ? 'bg-surface-50 border border-surface-200 rounded-xl'
              : 'bg-surface-100 border border-surface-200 rounded-xl'
          } px-4 py-3.5`}
        >
          {isAI ? (
            <div className="chat-prose relative">
              <ReactMarkdown components={mdComponents}>{reindexedContent}</ReactMarkdown>
              {isStreaming && (
                <span className="inline-block w-2.5 h-[1.1em] ml-1 bg-brand-600/80 align-middle animate-pulse" />
              )}
            </div>
          ) : (
            <div className="text-[13px] leading-[1.7] text-surface-800 whitespace-pre-wrap">
              {content}
            </div>
          )}

          {hasSources && reindexedSources.length > 0 && !isStreaming && (
            <div className="mt-3 pt-3 border-t border-surface-200 animate-fade-in">
              <span className="text-[10px] font-semibold text-surface-400 uppercase tracking-widest block mb-1.5">
                Sources
              </span>
              <div className="flex flex-wrap gap-1.5">
                {reindexedSources.map((source, idx) => {
                  const label = idx + 1;
                  return (
                    <button
                      key={`source-${source.id || label}-${idx}`}
                      type="button"
                      onClick={() => onSourceClick?.(source, reindexedSources)}
                      title={
                        source.regulation_topic
                          ? `Topic: ${source.regulation_topic}`
                          : 'View cited text'
                      }
                      className={[
                        'inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md transition-all duration-200',
                        'bg-surface-50 border border-surface-200',
                        'text-[10px] font-mono text-surface-500',
                        'hover:text-brand-600 hover:border-brand-300 hover:bg-brand-50',
                        'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-brand-600',
                        onSourceClick ? 'cursor-pointer' : 'cursor-default',
                      ].join(' ')}
                    >
                      <FileSearch className="w-2.5 h-2.5 opacity-60" />
                      {label}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
