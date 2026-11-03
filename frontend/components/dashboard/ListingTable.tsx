'use client';

import { useState, useRef, useEffect } from 'react';
import { Listing, ListingStatus } from '@/lib/types/listing';
import { formatDateString } from '@/lib/utils/formatting';
import {
  Trash2,
  MoreVertical,
  FileText,
  Archive,
  Globe,
  PlayCircle,
  MessageSquare,
  MapPin,
  RefreshCw,
  AlertTriangle,
  Loader2,
  Map,
} from 'lucide-react';
import Link from 'next/link';
import { ENABLE_LISTING_MARKETPLACE } from '@/lib/utils/constants';
import type { ReportStatus } from '@/lib/types/listing';

interface ListingTableProps {
  listings: Listing[];
  onDelete?: (id: string) => void;
  onGenerateReport?: (id: string) => Promise<void>;
  onStatusChange?: (id: string, newStatus: ListingStatus) => void;
}

function getMetadata(listing: Listing): string {
  const parts: string[] = [];
  if (listing.aduType) parts.push(listing.aduType.replace(/_/g, ' '));
  if (listing.sqft) parts.push(`${listing.sqft.toLocaleString()} ft²`);
  if (listing.bedrooms != null) {
    parts.push(listing.bedrooms === 0 ? 'Studio' : `${listing.bedrooms} bd`);
  }
  return parts.join(' · ');
}

function getEffectiveReportStatus(listing: Listing): ReportStatus {
  if (!listing.hasReport) return 'not_generated';
  return listing.reportStatus ?? 'current';
}

function shouldShowOutdatedReportMenu(reportStatus: ReportStatus): boolean {
  return reportStatus === 'outdated';
}

export function ListingTable({
  listings,
  onDelete,
  onGenerateReport,
  onStatusChange,
}: ListingTableProps) {
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [generatingReportId, setGeneratingReportId] = useState<string | null>(null);
  const [reportErrorId, setReportErrorId] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpenMenuId(null);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  async function handleGenerateReportClick(projectId: string) {
    setGeneratingReportId(projectId);
    setReportErrorId(null);
    try {
      await onGenerateReport?.(projectId);
      setOpenMenuId(null);
    } catch (error) {
      console.error('Failed to generate report:', error);
      setReportErrorId(projectId);
    } finally {
      setGeneratingReportId(null);
    }
  }

  if (listings.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 bg-surface-0 rounded-2xl border border-dashed border-surface-200 text-center">
        <div className="w-12 h-12 bg-surface-50 border border-surface-200 rounded-xl flex items-center justify-center mb-4">
          <MapPin className="w-5 h-5 text-surface-400" />
        </div>
        <p className="text-sm font-bold text-surface-900 mb-1">Nothing here yet</p>
        <p className="text-xs text-surface-500 max-w-[240px] leading-relaxed">
          Projects saved from the ADU Advisor will appear here.
        </p>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="bg-surface-0 rounded-2xl border border-surface-200 shadow-[0_1px_3px_rgba(0,0,0,0.04)] divide-y divide-surface-100"
    >
      {listings.map((listing) => {
        const metadata = getMetadata(listing);
        const reportStatus = getEffectiveReportStatus(listing);
        const isGeneratingReport = generatingReportId === listing.id;
        const showsOutdatedReportMenu = shouldShowOutdatedReportMenu(reportStatus);
        const isOutdatedReport = reportStatus === 'outdated';
        const reportActionClassName = isOutdatedReport
          ? 'hidden sm:inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-amber-700 bg-amber-50 border border-amber-200 rounded-lg hover:bg-amber-100 transition-colors disabled:cursor-not-allowed disabled:opacity-60'
          : 'hidden sm:inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-blue-700 bg-blue-50 border border-blue-200 rounded-lg hover:bg-blue-100 transition-colors disabled:cursor-not-allowed disabled:opacity-60';

        const reportAction =
          reportStatus === 'current' ? (
            <Link
              href={`/report/${listing.id}`}
              className="hidden sm:inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-brand-700 bg-brand-50 border border-brand-200 rounded-lg hover:bg-brand-100 transition-colors"
            >
              <FileText className="w-3.5 h-3.5" />
              View Report
            </Link>
          ) : (
            <button
              type="button"
              disabled={isGeneratingReport}
              onClick={() => handleGenerateReportClick(listing.id)}
              className={reportActionClassName}
            >
              {isGeneratingReport ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <RefreshCw className="w-3.5 h-3.5" />
              )}
              {reportStatus === 'outdated' ? 'Regenerate Report' : 'Generate Report'}
            </button>
          );

        return (
          <div
            key={`${listing.status}-${listing.id}`}
            className="flex items-center gap-4 px-6 py-4 hover:bg-surface-50 transition-colors group first:rounded-t-2xl last:rounded-b-2xl"
          >
            {/* Property info */}
            <div className="flex-1 min-w-0">
              <p className="font-semibold text-surface-900 text-sm truncate leading-snug">
                {listing.address}
              </p>
              {metadata && (
                <p className="text-xs text-surface-400 mt-0.5 truncate capitalize">{metadata}</p>
              )}
              {listing.updatedAt && (
                <p className="text-[10px] text-surface-400 mt-0.5">
                  {formatDateString(listing.updatedAt)}
                </p>
              )}
            </div>

            {/* Actions */}
            <div className="flex items-center gap-2 shrink-0">
              <Link
                href={`/map?projectId=${listing.id}`}
                className="hidden sm:inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-surface-700 bg-surface-0 border border-surface-200 rounded-lg hover:bg-surface-50 transition-colors"
              >
                <Map className="w-3.5 h-3.5" />
                Return to Map
              </Link>
              <Link
                href={`/adu-chat?projectId=${listing.id}`}
                className="hidden sm:inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-surface-700 bg-surface-0 border border-surface-200 rounded-lg hover:bg-surface-50 transition-colors"
              >
                <MessageSquare className="w-3.5 h-3.5" />
                Return to Chat
              </Link>
              {reportAction}

              {/* Overflow menu */}
              <div className="relative">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setOpenMenuId(openMenuId === listing.id ? null : listing.id);
                  }}
                  className={`flex items-center justify-center w-8 h-8 rounded-lg transition-colors cursor-pointer ${
                    openMenuId === listing.id
                      ? 'bg-surface-100 text-surface-900'
                      : 'text-surface-400 hover:text-surface-800 hover:bg-surface-100'
                  }`}
                >
                  <MoreVertical className="w-4 h-4" />
                </button>

                {openMenuId === listing.id && (
                  <div
                    className="absolute right-0 top-full mt-2 w-52 bg-surface-0 rounded-xl shadow-[0_8px_30px_rgba(0,0,0,0.12)] ring-1 ring-surface-200 py-1.5 z-[100]"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {showsOutdatedReportMenu && (
                      <>
                        <div className="flex items-center gap-2 px-3.5 py-2 text-xs font-semibold text-amber-700">
                          <AlertTriangle className="h-4 w-4" />
                          Report outdated
                        </div>
                        <Link
                          href={`/report/${listing.id}`}
                          onClick={() => setOpenMenuId(null)}
                          className="flex items-center gap-2.5 px-3.5 py-2.5 text-sm text-surface-700 hover:bg-surface-50 transition-colors font-medium cursor-pointer"
                        >
                          <FileText className="w-4 h-4 text-surface-400" />
                          View existing report
                        </Link>
                        <button
                          disabled={isGeneratingReport}
                          onClick={() => handleGenerateReportClick(listing.id)}
                          className="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-sm text-brand-700 hover:bg-brand-50 transition-colors font-medium cursor-pointer disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          {isGeneratingReport ? (
                            <Loader2 className="w-4 h-4 animate-spin" />
                          ) : (
                            <RefreshCw className="w-4 h-4" />
                          )}
                          Regenerate report
                        </button>
                        {reportErrorId === listing.id && (
                          <p className="px-3.5 pb-2 text-xs text-red-600">
                            Report generation failed. Try again.
                          </p>
                        )}
                        {/* Below sm the nav items follow directly; their divider precedes Delete */}
                        <div className="h-px bg-surface-100 my-1 mx-2 max-sm:hidden" />
                      </>
                    )}

                    {/* Row actions collapse into the menu below sm */}
                    <div className="sm:hidden">
                      <Link
                        href={`/map?projectId=${listing.id}`}
                        onClick={() => setOpenMenuId(null)}
                        className="flex items-center gap-2.5 px-3.5 py-2.5 text-sm text-surface-700 hover:bg-surface-50 transition-colors font-medium cursor-pointer"
                      >
                        <Map className="w-4 h-4 text-surface-400" />
                        Return to map
                      </Link>
                      <Link
                        href={`/adu-chat?projectId=${listing.id}`}
                        onClick={() => setOpenMenuId(null)}
                        className="flex items-center gap-2.5 px-3.5 py-2.5 text-sm text-surface-700 hover:bg-surface-50 transition-colors font-medium cursor-pointer"
                      >
                        <MessageSquare className="w-4 h-4 text-surface-400" />
                        Return to chat
                      </Link>
                      {!showsOutdatedReportMenu &&
                        (reportStatus === 'current' ? (
                          <Link
                            href={`/report/${listing.id}`}
                            onClick={() => setOpenMenuId(null)}
                            className="flex items-center gap-2.5 px-3.5 py-2.5 text-sm text-surface-700 hover:bg-surface-50 transition-colors font-medium cursor-pointer"
                          >
                            <FileText className="w-4 h-4 text-surface-400" />
                            View report
                          </Link>
                        ) : (
                          <button
                            disabled={isGeneratingReport}
                            onClick={() => handleGenerateReportClick(listing.id)}
                            className="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-sm text-brand-700 hover:bg-brand-50 transition-colors font-medium cursor-pointer disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            {isGeneratingReport ? (
                              <Loader2 className="w-4 h-4 animate-spin" />
                            ) : (
                              <RefreshCw className="w-4 h-4" />
                            )}
                            Generate report
                          </button>
                        ))}
                      {!showsOutdatedReportMenu && reportErrorId === listing.id && (
                        <p className="px-3.5 pb-2 text-xs text-red-600">
                          Report generation failed. Try again.
                        </p>
                      )}
                      <div className="h-px bg-surface-100 my-1 mx-2" />
                    </div>

                    {/* Marketplace: published → archive */}
                    {ENABLE_LISTING_MARKETPLACE && listing.status === 'published' && (
                      <>
                        <button
                          onClick={() => {
                            setOpenMenuId(null);
                            onStatusChange?.(listing.id, 'archived');
                          }}
                          className="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-sm text-surface-700 hover:bg-surface-50 transition-colors font-medium cursor-pointer"
                        >
                          <Archive className="w-4 h-4 text-surface-400" />
                          Archive
                        </button>
                        <div className="h-px bg-surface-100 my-1 mx-2" />
                      </>
                    )}

                    {/* Marketplace: archived → republish */}
                    {ENABLE_LISTING_MARKETPLACE && listing.status === 'archived' && (
                      <>
                        <button
                          onClick={() => {
                            setOpenMenuId(null);
                            onStatusChange?.(listing.id, 'published');
                          }}
                          className="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-sm text-brand-700 hover:bg-brand-50 transition-colors font-medium cursor-pointer"
                        >
                          <PlayCircle className="w-4 h-4 text-brand-600" />
                          Republish
                        </button>
                        <div className="h-px bg-surface-100 my-1 mx-2" />
                      </>
                    )}

                    {/* Marketplace: draft → publish */}
                    {ENABLE_LISTING_MARKETPLACE && listing.status === 'draft' && (
                      <>
                        <button
                          onClick={() => {
                            setOpenMenuId(null);
                            onStatusChange?.(listing.id, 'published');
                          }}
                          className="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-sm text-brand-700 hover:bg-brand-50 transition-colors font-medium cursor-pointer"
                        >
                          <Globe className="w-4 h-4 text-brand-600" />
                          Publish
                        </button>
                        <div className="h-px bg-surface-100 my-1 mx-2" />
                      </>
                    )}

                    <button
                      onClick={() => {
                        setOpenMenuId(null);
                        if (onDelete && confirm('Delete this project? This cannot be undone.')) {
                          onDelete(listing.id);
                        }
                      }}
                      className="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-sm text-red-600 hover:bg-red-50 transition-colors font-medium cursor-pointer"
                    >
                      <Trash2 className="w-4 h-4 text-red-500" />
                      Delete
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
