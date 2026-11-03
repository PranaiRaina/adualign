'use client';

import { Send, ArrowLeft, ArrowRight, Loader2, CheckCircle2, X, AlertTriangle } from 'lucide-react';
import { type FormEvent, type ReactNode, useRef, useEffect } from 'react';
import { AI_DISCLAIMER_TEXT } from '@/components/disclaimers';

export interface GuidedModeConfig {
  isActive: boolean;
  canSubmit: boolean;
  onSubmit: () => void;
  submitLabel: string;
  canGoBack: boolean;
  onBack: () => void;
  isSubmitting: boolean;
  onExit?: () => void;
  content?: ReactNode;
  needsClarification?: {
    questionIndex: number;
    questionPrompt: string;
    clarificationPrompt: string;
  } | null;
  onJumpToClarification?: (questionIndex: number) => void;
}

interface ChatInputProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: (e: FormEvent) => void;
  isLoading: boolean;
  placeholder?: string;
  suggestions?: string[];
  onSuggestionClick?: (question: string) => void;
  budgetExhausted?: boolean;
  guidedMode?: GuidedModeConfig;
}

export function ChatInput({
  value,
  onChange,
  onSubmit,
  isLoading,
  placeholder,
  suggestions = [],
  onSuggestionClick,
  budgetExhausted = false,
  guidedMode,
}: ChatInputProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const isGuided = guidedMode?.isActive ?? false;

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 120) + 'px';
    }
  }, [value]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (isGuided) {
        if (guidedMode?.canSubmit && !guidedMode.isSubmitting) {
          guidedMode.onSubmit();
        }
      } else if (value.trim() && !isLoading) {
        onSubmit(e as unknown as FormEvent);
      }
    }
  };

  const handleFormSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (isGuided) {
      if (guidedMode?.canSubmit && !guidedMode.isSubmitting) {
        guidedMode.onSubmit();
      }
    } else {
      onSubmit(e);
    }
  };

  const effectivePlaceholder = isGuided
    ? 'Or describe in your own words…'
    : budgetExhausted
      ? 'The lifetime AI service budget has been reached. Contact support to continue.'
      : (placeholder ?? 'Ask about ADU regulations, requirements, permits...');

  return (
    <div className="shrink-0 px-1 pb-4 pt-3">
      {!isGuided && suggestions.length > 0 && (
        <div
          className="flex flex-row gap-2 overflow-x-auto pb-2 mb-1"
          style={{ scrollbarWidth: 'none' }}
        >
          {suggestions.map((q, i) => (
            <button
              key={i}
              type="button"
              onClick={() => onSuggestionClick?.(q)}
              disabled={isLoading || budgetExhausted}
              className="shrink-0 text-xs px-3.5 py-1.5 rounded-full border border-surface-200 text-surface-500 hover:text-surface-800 hover:border-brand-300 hover:bg-brand-50 disabled:opacity-40 disabled:cursor-not-allowed transition-all duration-200 cursor-pointer whitespace-nowrap animate-fade-in-up"
              style={{ animationDelay: `${i * 50}ms` }}
            >
              {q}
            </button>
          ))}
        </div>
      )}

      <form onSubmit={handleFormSubmit} className="relative">
        <div className="relative group">
          <div
            className={`bg-surface-0 border border-surface-200 rounded-2xl overflow-hidden transition-all duration-200 group-focus-within:border-brand-600/40 group-focus-within:shadow-[0_0_0_3px_rgba(22,163,74,0.08)] ${
              isGuided ? 'shadow-sm' : ''
            }`}
          >
            {isGuided && guidedMode?.content && (
              <div className="border-b border-surface-100 animate-fade-in-up">
                {guidedMode.content}
              </div>
            )}

            {isGuided && guidedMode?.needsClarification && (
              <button
                type="button"
                onClick={() =>
                  guidedMode.onJumpToClarification?.(guidedMode.needsClarification!.questionIndex)
                }
                className="w-full flex items-start gap-2.5 px-4 py-2.5 bg-amber-50 border-b border-amber-100 hover:bg-amber-100 transition-colors cursor-pointer text-left animate-fade-in-up"
              >
                <AlertTriangle className="w-3.5 h-3.5 text-amber-600 shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0">
                  <p className="text-[11px] font-bold uppercase tracking-wider text-amber-700">
                    Needs clarification
                  </p>
                  <p className="text-xs text-amber-800 mt-0.5 line-clamp-2 leading-snug">
                    {guidedMode.needsClarification.clarificationPrompt ||
                      guidedMode.needsClarification.questionPrompt}
                  </p>
                </div>
                <span className="shrink-0 text-[11px] font-semibold text-amber-700 self-center whitespace-nowrap">
                  Review →
                </span>
              </button>
            )}

            <div className="flex items-end gap-3 px-4 py-3">
              {/* Back / Exit buttons — only in guided mode */}
              {isGuided && (guidedMode?.canGoBack || guidedMode?.onExit) && (
                <>
                  {guidedMode?.canGoBack && (
                    <button
                      type="button"
                      onClick={guidedMode.onBack}
                      disabled={guidedMode.isSubmitting}
                      className="shrink-0 flex items-center gap-1 px-2 py-1 mb-0.5 rounded-md text-xs font-medium text-surface-400 hover:text-surface-700 hover:bg-surface-100 disabled:opacity-40 transition-colors cursor-pointer"
                    >
                      <ArrowLeft className="w-3 h-3" />
                      Back
                    </button>
                  )}
                  {guidedMode?.onExit && (
                    <button
                      type="button"
                      onClick={guidedMode.onExit}
                      disabled={guidedMode.isSubmitting}
                      aria-label="Exit guided questions"
                      className="shrink-0 flex items-center justify-center w-6 h-6 mb-0.5 rounded-md text-surface-400 hover:text-surface-700 hover:bg-surface-100 disabled:opacity-40 transition-colors cursor-pointer"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                  <div className="w-px h-5 bg-surface-200 self-center shrink-0" />
                </>
              )}

              <textarea
                ref={textareaRef}
                value={value}
                onChange={(e) => onChange(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={effectivePlaceholder}
                rows={1}
                className="flex-1 bg-transparent text-sm text-surface-900 placeholder:text-surface-400 resize-none outline-none min-h-[24px] max-h-[120px] leading-relaxed"
                disabled={budgetExhausted && !isGuided}
              />

              {isGuided ? (
                <button
                  type="submit"
                  disabled={!guidedMode?.canSubmit || guidedMode?.isSubmitting}
                  className="shrink-0 flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-sm font-semibold bg-brand-600 text-white hover:bg-brand-700 disabled:opacity-30 disabled:cursor-not-allowed transition-colors duration-150 cursor-pointer whitespace-nowrap"
                >
                  {guidedMode?.isSubmitting ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      Saving…
                    </>
                  ) : guidedMode?.submitLabel === 'Finish' ? (
                    <>
                      {guidedMode.submitLabel}
                      <CheckCircle2 className="w-3.5 h-3.5" />
                    </>
                  ) : (
                    <>
                      {guidedMode?.submitLabel ?? 'Next question'}
                      <ArrowRight className="w-3.5 h-3.5" />
                    </>
                  )}
                </button>
              ) : (
                <button
                  type="submit"
                  disabled={!value.trim() || isLoading || budgetExhausted}
                  className="shrink-0 flex items-center justify-center w-8 h-8 rounded-lg bg-brand-600 text-white hover:bg-brand-700 disabled:opacity-30 disabled:cursor-not-allowed transition-colors duration-150 cursor-pointer"
                  aria-label={budgetExhausted ? 'Budget exhausted' : 'Send message'}
                >
                  <Send className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>
        </div>

        <p className="text-center text-[11px] text-surface-400 mt-2">{AI_DISCLAIMER_TEXT}</p>
      </form>
    </div>
  );
}
