'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { AlertTriangle, CheckCircle, FileText, Loader2, Plus, RefreshCw, X } from 'lucide-react';
import { ListingCanvas } from '@/components/editor/canvas/ListingCanvas';
import { AgentPanel } from '@/components/editor/agent/AgentPanel';
import { useDraft } from '@/lib/hooks/useDraft';
import { ListingDetail } from '@/components/marketplace/ListingDetail';
import { Listing, FIELD_LABELS } from '@/lib/types/listing';
import { formatSqft } from '@/lib/utils/formatting';
import { ENABLE_LISTING_MARKETPLACE } from '@/lib/utils/constants';

interface MergeChange {
  field: string;
  type: 'new' | 'appended' | 'conflict';
  currentValue: string;
  incomingValue: string;
}

interface MergeProposal {
  proposedListing: Listing;
  proposedFieldMeta: Record<string, any>;
  changes: MergeChange[];
  reportTitle: string;
}

export default function EditorPage() {
  // Next 16: the params prop is a Promise; useParams gives sync access.
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [showPublishModal, setShowPublishModal] = useState(false);
  const [showPreviewModal, setShowPreviewModal] = useState(false);
  const [showPublishErrorModal, setShowPublishErrorModal] = useState(false);
  const [mergeProposal, setMergeProposal] = useState<MergeProposal | null>(null);

  const {
    listing,
    fieldMeta,
    updateField,
    replaceDraft,
    publishProject,
    autoFilledCount,
    requiredMissingCount,
    optionalMissingCount,
    isPublishReady,
    nextMissingField,
    requiredMissing,
    hydrated,
  } = useDraft(id);

  useEffect(() => {
    if (!ENABLE_LISTING_MARKETPLACE) {
      router.replace('/map');
    }
  }, [router]);

  useEffect(() => {
    if (!hydrated || typeof window === 'undefined') return;

    const proposalKey = `listing-merge-proposal-${id}`;
    const proposalRaw = sessionStorage.getItem(proposalKey);

    if (proposalRaw) {
      try {
        setMergeProposal(JSON.parse(proposalRaw));
      } catch {
        sessionStorage.removeItem(proposalKey);
      }
    }
  }, [hydrated, id]);

  if (!ENABLE_LISTING_MARKETPLACE) {
    return (
      <div className="h-dvh flex items-center justify-center bg-white">
        <div className="text-sm font-medium text-surface-400">
          Redirecting to lot feasibility...
        </div>
      </div>
    );
  }

  if (!hydrated || !listing) {
    return (
      <div className="h-dvh flex items-center justify-center bg-white">
        <div className="flex flex-col items-center gap-2 text-surface-400">
          <Loader2 className="w-8 h-8 animate-spin" />
          <p className="text-sm font-medium">Loading draft...</p>
        </div>
      </div>
    );
  }

  const previewListing: Listing = {
    ...listing,
    heroImage: listing.heroImage || '',
    images: listing.imageGallery || listing.images || [],
  } as unknown as Listing;

  return (
    <div className="h-dvh flex flex-col bg-white overflow-hidden font-sans">
      {/* Toolbar */}
      <header className="h-14 border-b border-surface-200 flex items-center justify-between px-6 bg-white shrink-0">
        <div className="flex items-center gap-3">
          <button
            onClick={() => router.push(ENABLE_LISTING_MARKETPLACE ? '/projects' : '/map')}
            className="text-surface-500 font-bold text-sm hover:text-surface-900 transition-colors cursor-pointer"
          >
            ← My Projects
          </button>
          {listing.projectId && (
            <>
              <span className="text-surface-200">|</span>
              <button
                onClick={() => router.push(`/report/${listing.projectId}`)}
                className="flex items-center gap-1.5 text-blue-600 font-bold text-sm hover:text-blue-800 transition-colors cursor-pointer"
              >
                <FileText className="w-3.5 h-3.5" />
                View Report
              </button>
            </>
          )}
        </div>
        <div className="flex items-center gap-3">
          <span className="font-bold text-surface-900 text-sm">
            {listing.address || 'New Listing'}
          </span>
          <span
            className={`text-xs px-2 py-1 rounded-md font-bold border ${
              isPublishReady
                ? 'bg-brand-50 text-brand-600 border-brand-200'
                : 'bg-surface-100 text-surface-600 border-surface-200'
            }`}
          >
            {isPublishReady ? 'Ready ✓' : `Draft · ${requiredMissingCount} fields needed`}
          </span>
        </div>
        <div className="flex gap-3">
          <button
            onClick={() => setShowPreviewModal(true)}
            className="px-4 py-2 text-sm font-bold text-surface-600 border border-surface-200 rounded-lg hover:bg-surface-50 transition-colors cursor-pointer"
          >
            Preview
          </button>
          <button
            onClick={() => {
              if (isPublishReady) {
                setShowPublishModal(true);
              } else {
                setShowPublishErrorModal(true);
              }
            }}
            className={`px-4 py-2 text-sm font-bold rounded-lg shadow-sm transition-all cursor-pointer ${
              isPublishReady
                ? 'text-white bg-brand-600 hover:bg-brand-700'
                : 'text-surface-500 bg-surface-200 hover:bg-surface-300'
            }`}
          >
            Publish Listing
          </button>
        </div>
      </header>

      <div className="flex-1 flex overflow-hidden">
        {/* Canvas Area */}
        <div className="flex-1 bg-surface-50 overflow-y-auto p-6 custom-scrollbar">
          <div className="max-w-2xl mx-auto">
            <ListingCanvas listing={listing} fieldMeta={fieldMeta} onFieldUpdate={updateField} />
          </div>
        </div>

        {/* Agent Panel */}
        <AgentPanel
          listingId={id}
          listing={listing}
          autoFilledCount={autoFilledCount}
          requiredMissingCount={requiredMissingCount}
          optionalMissingCount={optionalMissingCount}
          isPublishReady={isPublishReady}
          nextMissingField={nextMissingField}
          onFieldUpdate={updateField}
        />
      </div>

      {/* Preview Modal */}
      {showPreviewModal && (
        <div className="fixed inset-0 bg-white z-[60] flex flex-col overflow-hidden">
          <div className="h-14 border-b border-surface-200 flex items-center justify-between px-6 bg-white shrink-0 shadow-sm z-10">
            <h2 className="font-bold text-lg text-surface-900">Listing Preview</h2>
            <button
              onClick={() => setShowPreviewModal(false)}
              className="p-2 text-surface-500 hover:bg-surface-100 rounded-full transition-colors cursor-pointer flex items-center gap-2"
            >
              <span className="text-sm font-bold">Close Preview</span>
              <X className="w-5 h-5" />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto custom-scrollbar relative">
            <ListingDetail listing={previewListing} isPreview={true} />
          </div>
        </div>
      )}

      {/* Publish Confirmation Modal */}
      {showPublishModal && (
        <div className="fixed inset-0 bg-black/50 z-[70] flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-8 shadow-2xl">
            <h3 className="text-xl font-bold text-surface-900 mb-4">Publish Your Listing?</h3>
            <div className="bg-surface-50 rounded-xl p-4 mb-6 border border-surface-200">
              <p className="font-bold text-surface-900 text-sm">
                {listing.headline || listing.address}
              </p>
              <div className="flex items-center gap-3 mt-2 text-xs text-surface-500 font-medium">
                <span>💰 ${(listing.monthlyRent || 0).toLocaleString()}/mo</span>
                <span>·</span>
                <span>{listing.bedrooms || '?'} bed</span>
                <span>·</span>
                <span>{listing.bathrooms || '?'} bath</span>
                <span>·</span>
                <span>
                  {listing.sqft !== null && listing.sqft !== undefined
                    ? formatSqft(listing.sqft)
                    : '?'}
                </span>
              </div>
              <div className="flex items-center gap-2 mt-2 text-xs">
                <span className="bg-brand-50 text-brand-600 px-2 py-0.5 rounded-full font-bold border border-brand-200">
                  {listing.aduType || 'ADU'}
                </span>
                {listing.permitStatus === 'verified' && (
                  <span className="bg-brand-50 text-brand-600 px-2 py-0.5 rounded-full font-bold border border-brand-200">
                    Verified Permit
                  </span>
                )}
              </div>
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => setShowPublishModal(false)}
                className="flex-1 px-4 py-3 text-sm font-bold text-surface-600 border border-surface-200 rounded-xl hover:bg-surface-50 transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={async () => {
                  try {
                    await publishProject();
                    setShowPublishModal(false);
                    router.push(ENABLE_LISTING_MARKETPLACE ? '/projects' : '/map');
                  } catch (err) {
                    console.error('Publish failed:', err);
                    alert('Failed to publish. Please try again.');
                  }
                }}
                className="flex-1 px-4 py-3 text-sm font-bold text-white bg-brand-600 rounded-xl hover:bg-brand-700 shadow-sm transition-colors cursor-pointer"
              >
                Go Live 🚀
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Publish Error Modal */}
      {showPublishErrorModal && (
        <div className="fixed inset-0 bg-black/50 z-[70] flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-8 shadow-2xl">
            <div className="w-12 h-12 bg-red-100 rounded-full flex items-center justify-center mb-4 border border-red-200">
              <X className="w-6 h-6 text-red-600" />
            </div>
            <h3 className="text-xl font-bold text-surface-900 mb-2">Missing Required Fields</h3>
            <p className="text-sm text-surface-600 font-medium mb-6">
              You must fill out all required fields before you can publish your ADU to the
              marketplace. You are currently missing {requiredMissingCount} field(s):
            </p>
            <div className="bg-surface-50 rounded-xl p-4 mb-6 border border-surface-200 max-h-40 overflow-y-auto custom-scrollbar">
              <ul className="list-disc pl-5 text-sm text-surface-700 font-medium space-y-1">
                {(requiredMissing || []).map((field, idx) => (
                  <li key={idx} className="capitalize">
                    {FIELD_LABELS[field as keyof typeof FIELD_LABELS] ||
                      field.replace(/([A-Z])/g, ' $1').trim()}
                  </li>
                ))}
              </ul>
            </div>
            <button
              onClick={() => setShowPublishErrorModal(false)}
              className="w-full px-4 py-3 text-sm font-bold text-white bg-surface-900 rounded-xl hover:bg-surface-800 shadow-sm transition-colors cursor-pointer"
            >
              Got It
            </button>
          </div>
        </div>
      )}

      {mergeProposal &&
        mergeProposal.changes.length > 0 &&
        (() => {
          const newChanges = mergeProposal.changes.filter((c) => c.type === 'new');
          const appendedChanges = mergeProposal.changes.filter((c) => c.type === 'appended');
          const conflictChanges = mergeProposal.changes.filter((c) => c.type === 'conflict');

          return (
            <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/45 p-4">
              <div className="w-full max-w-2xl rounded-3xl bg-white shadow-2xl">
                <div className="border-b border-slate-100 px-6 py-5">
                  <div className="flex items-center gap-3">
                    <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-blue-100 text-blue-700">
                      <RefreshCw className="h-5 w-5" />
                    </div>
                    <div>
                      <h3 className="text-lg font-bold text-slate-900">Review report changes</h3>
                      <p className="text-sm text-slate-500">
                        {mergeProposal.changes.length} field(s) from your report can be applied to
                        this draft.
                        {conflictChanges.length > 0 &&
                          ` ${conflictChanges.length} conflict(s) will overwrite existing values.`}
                      </p>
                    </div>
                  </div>
                  <div className="mt-3 flex gap-2">
                    {newChanges.length > 0 && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 border border-emerald-200 px-2.5 py-0.5 text-[11px] font-bold text-emerald-700">
                        <Plus className="h-3 w-3" /> {newChanges.length} new
                      </span>
                    )}
                    {appendedChanges.length > 0 && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-blue-50 border border-blue-200 px-2.5 py-0.5 text-[11px] font-bold text-blue-700">
                        <CheckCircle className="h-3 w-3" /> {appendedChanges.length} appended
                      </span>
                    )}
                    {conflictChanges.length > 0 && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 border border-amber-200 px-2.5 py-0.5 text-[11px] font-bold text-amber-700">
                        <AlertTriangle className="h-3 w-3" /> {conflictChanges.length} conflict(s)
                      </span>
                    )}
                  </div>
                </div>

                <div className="max-h-[55vh] space-y-3 overflow-y-auto px-6 py-5">
                  {mergeProposal.changes.map((change) => {
                    const label =
                      FIELD_LABELS[change.field as keyof typeof FIELD_LABELS] ||
                      change.field.replace(/([A-Z])/g, ' $1').trim();

                    const borderColor =
                      change.type === 'new'
                        ? 'border-emerald-200'
                        : change.type === 'appended'
                          ? 'border-blue-200'
                          : 'border-amber-200';

                    const typeBadge =
                      change.type === 'new' ? (
                        <span className="ml-2 rounded-full bg-emerald-50 border border-emerald-200 px-2 py-0.5 text-[10px] font-bold text-emerald-700 uppercase">
                          New
                        </span>
                      ) : change.type === 'appended' ? (
                        <span className="ml-2 rounded-full bg-blue-50 border border-blue-200 px-2 py-0.5 text-[10px] font-bold text-blue-700 uppercase">
                          Appended
                        </span>
                      ) : (
                        <span className="ml-2 rounded-full bg-amber-50 border border-amber-200 px-2 py-0.5 text-[10px] font-bold text-amber-700 uppercase">
                          Conflict
                        </span>
                      );

                    const incomingBg =
                      change.type === 'new'
                        ? 'bg-emerald-50 border-emerald-200'
                        : change.type === 'appended'
                          ? 'bg-blue-50 border-blue-200'
                          : 'bg-amber-50 border-amber-200';

                    const incomingLabelColor =
                      change.type === 'new'
                        ? 'text-emerald-600'
                        : change.type === 'appended'
                          ? 'text-blue-600'
                          : 'text-amber-600';

                    return (
                      <div
                        key={change.field}
                        className={`rounded-2xl border ${borderColor} bg-slate-50/70 p-4`}
                      >
                        <div className="flex items-center text-sm font-bold text-slate-900">
                          {label}
                          {typeBadge}
                        </div>
                        <div className="mt-2 grid gap-3 md:grid-cols-2">
                          <div className="rounded-xl border border-slate-200 bg-white p-3">
                            <div className="text-[11px] font-bold uppercase tracking-wide text-slate-400">
                              Current Draft
                            </div>
                            <div className="mt-1 text-sm text-slate-700 whitespace-pre-wrap line-clamp-4">
                              {change.currentValue || (
                                <span className="italic text-slate-400">Empty</span>
                              )}
                            </div>
                          </div>
                          <div className={`rounded-xl border ${incomingBg} p-3`}>
                            <div
                              className={`text-[11px] font-bold uppercase tracking-wide ${incomingLabelColor}`}
                            >
                              {change.type === 'new'
                                ? 'New Value'
                                : change.type === 'appended'
                                  ? 'Merged Value'
                                  : 'Report Value'}
                            </div>
                            <div className="mt-1 text-sm text-slate-700 whitespace-pre-wrap line-clamp-4">
                              {change.incomingValue || (
                                <span className="italic text-slate-400">Empty</span>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>

                <div className="flex items-center justify-end gap-3 border-t border-slate-100 px-6 py-5">
                  <button
                    onClick={() => {
                      sessionStorage.removeItem(`listing-merge-proposal-${id}`);
                      setMergeProposal(null);
                    }}
                    className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50 cursor-pointer"
                  >
                    Dismiss
                  </button>
                  <button
                    onClick={() => {
                      replaceDraft(
                        mergeProposal.proposedListing as any,
                        mergeProposal.proposedFieldMeta as any,
                      );
                      sessionStorage.removeItem(`listing-merge-proposal-${id}`);
                      setMergeProposal(null);
                    }}
                    className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-bold text-white hover:bg-slate-800 cursor-pointer"
                  >
                    Accept All Changes ({mergeProposal.changes.length})
                  </button>
                </div>
              </div>
            </div>
          );
        })()}
    </div>
  );
}
