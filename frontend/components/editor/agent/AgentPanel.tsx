'use client';

import { useState, useRef, useEffect } from 'react';
import { Send, Sparkles, Building2, ClipboardList } from 'lucide-react';
import { ValidationChecklist } from './ValidationChecklist';
import {
  AgentMessage,
  getOpeningMessage,
  FIELD_PROMPTS,
  QUICK_ACTIONS,
  getQuickActionResponse,
  getFieldConfirmation,
  getPublishReadyMessage,
  type QuickActionId,
} from '@/lib/mock/agent-responses';
import {
  REQUIRED_FIELDS,
  OPTIONAL_FIELDS,
  FIELD_LABELS,
  ListingDraft,
  ListingFieldKey,
} from '@/lib/types/listing';
import { getAuthHeaders } from '@/lib/utils/supabase/authHeaders';
import { redirectToLogin } from '@/lib/utils/authRedirect';

const RAG_API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

function generateId() {
  return Math.random().toString(36).substring(2, 12);
}

// ── Backend LLM Integration ──

interface ParsedUpdate {
  field: string;
  value: any;
}

function buildConfirmationMessage(updates: ParsedUpdate[]): string {
  if (updates.length === 0) return '';
  const lines = updates.map((u) => {
    const displayLabel = FIELD_LABELS[u.field as ListingFieldKey] || u.field;
    let displayVal = u.value;
    if (typeof u.value === 'boolean') displayVal = u.value ? 'Yes' : 'No';
    else if (
      typeof u.value === 'number' &&
      (u.field === 'monthlyRent' || u.field === 'securityDeposit' || u.field === 'constructionCost')
    ) {
      displayVal = `$${u.value.toLocaleString()}`;
    }
    return `✅ ${displayLabel} → ${displayVal}`;
  });
  return `Updated ${updates.length} field${updates.length > 1 ? 's' : ''} on your listing:\n\n${lines.join('\n')}`;
}

// ── Component ──

interface AgentPanelProps {
  listingId: string;
  listing: ListingDraft;
  autoFilledCount: number;
  requiredMissingCount: number;
  optionalMissingCount: number;
  isPublishReady: boolean;
  nextMissingField: ListingFieldKey | null;
  onFieldUpdate: (fieldKey: string, value: any) => void;
  onFieldClick?: (fieldKey: string) => void;
}

function isFieldFilled(value: any): boolean {
  if (value === null || value === undefined || value === '') return false;
  if (Array.isArray(value) && value.length === 0) return false;
  return true;
}

function getChatStorageKey(id: string) {
  return `adu-agent-chat-${id}`;
}
function getMsgCounterKey(id: string) {
  return `adu-agent-msg-counter-${id}`;
}

function loadChatHistory(id: string): AgentMessage[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(getChatStorageKey(id));
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveChatHistory(id: string, messages: AgentMessage[]) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(getChatStorageKey(id), JSON.stringify(messages));
  } catch {}
}

function loadMsgCounter(id: string): number {
  if (typeof window === 'undefined') return 0;
  try {
    const raw = localStorage.getItem(getMsgCounterKey(id));
    return raw ? parseInt(raw) : 0;
  } catch {
    return 0;
  }
}

function saveMsgCounter(id: string, n: number) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(getMsgCounterKey(id), n.toString());
  } catch {}
}

let messageIdCounter = 0;

export function AgentPanel({
  listingId,
  listing,
  autoFilledCount,
  requiredMissingCount,
  optionalMissingCount,
  isPublishReady,
  nextMissingField,
  onFieldUpdate,
  onFieldClick,
}: AgentPanelProps) {
  // Start empty to match SSR, hydrate from localStorage after mount
  const [messages, setMessages] = useState<AgentMessage[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [showChecklist, setShowChecklist] = useState(false);
  const [isTyping, setIsTyping] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const initializedRef = useRef(false);

  // Hydrate chat from localStorage after mount
  useEffect(() => {
    // Restore message counter
    const savedCounter = loadMsgCounter(listingId);
    if (savedCounter) messageIdCounter = savedCounter;
    else messageIdCounter = 0; // Reset for new/different listings

    // Restore chat history
    const saved = loadChatHistory(listingId);
    if (saved.length > 0) {
      setMessages(saved);
      initializedRef.current = true; // skip opening message
    } else {
      setMessages([]);
      initializedRef.current = false;
    }
  }, [listingId]);

  // Save chat to localStorage on every change
  useEffect(() => {
    if (messages.length > 0) {
      saveChatHistory(listingId, messages);
    }
  }, [messages, listingId]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, isTyping]);

  // Show opening message only if no saved history
  useEffect(() => {
    if (initializedRef.current) return;
    initializedRef.current = true;

    const openingMsg = getOpeningMessage(
      autoFilledCount,
      requiredMissingCount,
      optionalMissingCount,
    );

    setTimeout(() => {
      setMessages([
        {
          id: `msg-${++messageIdCounter}`,
          role: 'agent',
          content: openingMsg,
          timestamp: Date.now(),
        },
      ]);
      saveMsgCounter(listingId, messageIdCounter);
    }, 600);
  }, [listingId, autoFilledCount, requiredMissingCount, optionalMissingCount]);

  // Keep the initial status message in sync with the latest draft completion
  // (e.g. after accepting report merge changes).
  useEffect(() => {
    const OPENING_PREFIX = "Your listing draft is ready. Here's where things stand:";
    setMessages((prev) => {
      if (prev.length === 0) return prev;
      const first = prev[0];
      if (first.role !== 'agent' || !first.content.startsWith(OPENING_PREFIX)) {
        return prev;
      }
      const refreshed = getOpeningMessage(
        autoFilledCount,
        requiredMissingCount,
        optionalMissingCount,
      );
      if (first.content === refreshed) return prev;
      const next = [...prev];
      next[0] = { ...first, content: refreshed };
      return next;
    });
  }, [autoFilledCount, requiredMissingCount, optionalMissingCount]);

  const addAgentMessage = (content: string) => {
    const newMsg: AgentMessage = {
      id: generateId(),
      role: 'agent',
      content,
      timestamp: Date.now(),
    };
    saveMsgCounter(listingId, messageIdCounter + 1);
    setMessages((prev) => [...prev, newMsg]);
  };

  const handleSend = async () => {
    if (!inputValue.trim() || isTyping) return;

    const userText = inputValue.trim();
    const userMsg: AgentMessage = {
      id: generateId(),
      role: 'user',
      content: userText,
      timestamp: Date.now(),
    };
    saveMsgCounter(listingId, messageIdCounter + 1);
    setMessages((prev) => [...prev, userMsg]);
    setInputValue('');
    setIsTyping(true);

    const currentHistory = messages.map((m) => ({ role: m.role, content: m.content }));

    try {
      const payload = {
        message: userText,
        history: currentHistory,
        listing_state: listing,
      };

      const res = await fetch(`${RAG_API_URL}/editor/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(await getAuthHeaders()),
        },
        body: JSON.stringify(payload),
      });

      if (res.status === 401) {
        redirectToLogin();
        return;
      }
      if (!res.ok) throw new Error('API request failed');

      const data = await res.json();
      const updates = data.updates || [];

      // Execute the updates directly to the canvas parent component state
      if (updates.length > 0) {
        for (const update of updates) {
          onFieldUpdate(update.field, update.value);
        }
      }

      // Show successful updates along with LLM confirmation
      if (updates.length > 0) {
        const confirmation = buildConfirmationMessage(updates);
        addAgentMessage(`${confirmation}\n\n${data.answer}`);
      } else {
        addAgentMessage(data.answer);
      }

      // After responding, prompt for next missing field if any
      if (nextMissingField && FIELD_PROMPTS[nextMissingField]) {
        const justUpdatedKeys = updates.map((p: any) => p.field);
        if (!justUpdatedKeys.includes(nextMissingField)) {
          setTimeout(() => {
            addAgentMessage(`Next up — ${FIELD_PROMPTS[nextMissingField]}`);
          }, 1000);
        }
      }
    } catch (error) {
      console.error('Agent chat error:', error);
      addAgentMessage(
        `I ran into a server error processing that request.\n\n` +
          `*(${error instanceof Error ? error.message : 'Connection Error'})*`,
      );
    } finally {
      setIsTyping(false);
    }
  };

  const handleQuickAction = (actionId: QuickActionId) => {
    const userMsg: AgentMessage = {
      id: `msg-${++messageIdCounter}`,
      role: 'user',
      content: QUICK_ACTIONS.find((a) => a.id === actionId)?.label || actionId,
      timestamp: Date.now(),
    };
    saveMsgCounter(listingId, messageIdCounter + 1);
    setMessages((prev) => [...prev, userMsg]);

    const response = getQuickActionResponse(actionId, {
      monthlyRent: listing.monthlyRent || undefined,
      aduType: listing.aduType || undefined,
      city: listing.city || undefined,
      neighborhood: listing.neighborhood || undefined,
      sqft: listing.sqft || undefined,
      permitStatus: listing.permitStatus || undefined,
    });
    addAgentMessage(response);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="w-[400px] bg-white border-l border-surface-200 flex flex-col shrink-0 z-10 shadow-[-4px_0_24px_rgba(0,0,0,0.02)]">
      {/* Header */}
      <div className="p-4 border-b border-surface-100 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-brand-100 flex items-center justify-center">
            <Sparkles className="w-4 h-4 text-brand-600" />
          </div>
          <h2 className="font-bold text-surface-900 tracking-tight text-sm">Listing Agent</h2>
        </div>
        <button
          onClick={() => setShowChecklist(!showChecklist)}
          className={`p-2 rounded-lg transition-colors cursor-pointer ${
            showChecklist ? 'bg-brand-50 text-brand-600' : 'text-surface-400 hover:bg-surface-50'
          }`}
          title="Toggle validation checklist"
        >
          <ClipboardList className="w-4 h-4" />
        </button>
      </div>

      {/* Quick Actions */}
      <div className="p-3 border-b border-surface-50 flex gap-2 overflow-x-auto no-scrollbar">
        {QUICK_ACTIONS.map((action) => (
          <button
            key={action.id}
            onClick={() => handleQuickAction(action.id)}
            className="whitespace-nowrap px-3 py-1.5 rounded-full bg-surface-50 text-surface-600 font-bold text-xs hover:bg-brand-50 hover:text-brand-700 transition-colors border border-surface-100 hover:border-brand-200 cursor-pointer"
          >
            {action.label}
          </button>
        ))}
      </div>

      {/* Content Area - Chat or Checklist */}
      {showChecklist ? (
        <div className="flex-1 overflow-y-auto p-5 custom-scrollbar">
          <ValidationChecklist listing={listing} onFieldClick={onFieldClick} />
        </div>
      ) : (
        <div ref={scrollRef} className="flex-1 overflow-y-auto p-5 space-y-4 custom-scrollbar">
          {messages.map((msg) =>
            msg.role === 'agent' ? (
              <div key={msg.id} className="flex gap-3">
                <div className="w-7 h-7 rounded-full bg-brand-100 border border-brand-200 flex items-center justify-center shrink-0">
                  <Building2 className="w-3.5 h-3.5 text-brand-600" />
                </div>
                <div className="bg-surface-50 border border-surface-100 rounded-2xl rounded-tl-sm p-4 text-sm text-surface-700 font-medium leading-relaxed whitespace-pre-line max-w-[calc(100%-44px)]">
                  {msg.content}
                </div>
              </div>
            ) : (
              <div key={msg.id} className="flex gap-3 flex-row-reverse">
                <div className="bg-brand-600 text-white rounded-2xl rounded-tr-sm p-4 text-sm shadow-sm font-medium leading-relaxed max-w-[85%] whitespace-pre-line">
                  {msg.content}
                </div>
              </div>
            ),
          )}

          {isTyping && (
            <div className="flex gap-3">
              <div className="w-7 h-7 rounded-full bg-brand-100 border border-brand-200 flex items-center justify-center shrink-0">
                <Building2 className="w-3.5 h-3.5 text-brand-600" />
              </div>
              <div className="bg-surface-50 border border-surface-100 rounded-2xl rounded-tl-sm p-4 py-5 text-sm text-surface-700 shadow-sm flex items-center">
                <div className="flex items-center gap-1">
                  <span className="w-1.5 h-1.5 bg-brand-500 rounded-full animate-bounce" />
                  <span className="w-1.5 h-1.5 bg-brand-500 rounded-full animate-bounce [animation-delay:0.2s]" />
                  <span className="w-1.5 h-1.5 bg-brand-500 rounded-full animate-bounce [animation-delay:0.4s]" />
                </div>
              </div>
            </div>
          )}

          {isPublishReady && messages.length > 1 && (
            <div className="bg-brand-50 border border-brand-200 rounded-xl p-4 text-sm">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-brand-600 font-bold">✅ Ready to Publish</span>
              </div>
              <p className="text-brand-700 font-medium text-xs leading-relaxed">
                All required fields are complete. Hit the Publish button in the toolbar to go live.
              </p>
            </div>
          )}
        </div>
      )}

      {/* Input */}
      <div className="p-4 border-t border-surface-200 bg-surface-50">
        <div className="relative">
          <textarea
            className="w-full bg-white border border-surface-300 shadow-sm rounded-xl pr-12 pl-4 py-3 text-sm font-medium resize-none focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500 transition-shadow"
            rows={2}
            placeholder='e.g. "3 bed 2 bath, full kitchen, $2800/mo"'
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={handleKeyDown}
          />
          <button
            onClick={handleSend}
            disabled={!inputValue.trim()}
            className="absolute right-3 bottom-3 w-8 h-8 rounded-full bg-brand-600 text-white flex items-center justify-center hover:bg-brand-700 transition-colors shadow-sm cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Send className="w-4 h-4 -ml-0.5" />
          </button>
        </div>
        <div className="text-center mt-2">
          <span className="text-[10px] font-bold uppercase tracking-widest text-surface-400">
            Type field values to auto-populate the listing
          </span>
        </div>
      </div>
    </div>
  );
}
