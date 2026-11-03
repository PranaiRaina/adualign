'use client';

import { useState, useEffect } from 'react';
import { useAuth } from '@/lib/hooks/useAuth';
import { ListingTable } from '@/components/dashboard/ListingTable';
import { MapPin } from 'lucide-react';
import Link from 'next/link';
import {
  normalizeMarketplaceAduType,
  normalizeProjectStatus,
  type Listing,
  type ListingStatus,
  type ProjectOut,
} from '@/lib/types/listing';
import { getAuthHeaders } from '@/lib/utils/supabase/authHeaders';
import { redirectToLogin } from '@/lib/utils/authRedirect';
import { ENABLE_LISTING_MARKETPLACE } from '@/lib/utils/constants';
import { buildPlanningDraftScopeKey, clearPlanningDraft } from '@/lib/planningDraft';

const API_URL = process.env.NEXT_PUBLIC_API_URL || '';
const MARKETPLACE_STATUSES: ListingStatus[] = ['published', 'draft', 'archived'];

async function getProjectRequestHeaders(): Promise<Record<string, string>> {
  return { 'Content-Type': 'application/json', ...(await getAuthHeaders()) };
}

async function generateAndFetchProject(projectId: string): Promise<ProjectOut | null> {
  const headers = await getProjectRequestHeaders();
  const generated = await fetch(`${API_URL}/projects/${projectId}/report/generate`, {
    method: 'POST',
    headers,
    body: '{}',
  });
  if (generated.status === 401) {
    redirectToLogin();
    return null;
  }
  if (!generated.ok) throw new Error('Failed to generate report');

  const project = await fetch(`${API_URL}/projects/${projectId}`, { headers });
  if (!project.ok) throw new Error('Failed to refresh project');
  return (await project.json()) as ProjectOut;
}

const FILTER_TABS: { label: string; value: ListingStatus | 'all' }[] = [
  { label: 'All Projects', value: 'all' },
  { label: 'Reports', value: 'report' as ListingStatus },
  ...(ENABLE_LISTING_MARKETPLACE
    ? [
        { label: 'Published', value: 'published' as ListingStatus },
        { label: 'Drafts', value: 'draft' as ListingStatus },
        { label: 'Archived', value: 'archived' as ListingStatus },
      ]
    : []),
];

function projectToListingShape(p: ProjectOut, statusOverride?: ListingStatus): Listing {
  const effectiveStatus: ListingStatus = statusOverride || (p.status as ListingStatus);
  return {
    id: p.id,
    projectId: p.id,
    status: effectiveStatus,
    hasReport: p.has_report,
    reportStatus: p.report_status,
    heroImage: p.draft_hero_image || '',
    headline: p.address || 'Untitled Project',
    aduType: normalizeMarketplaceAduType(p.adu_type),
    constructionStatus: null,
    address: p.address || 'Untitled Project',
    city: '',
    state: 'CA',
    zipCode: '',
    neighborhood: '',
    apn: '',
    lat: null,
    lng: null,
    bedrooms: p.draft_bedrooms ?? null,
    bathrooms: p.draft_bathrooms ?? null,
    sqft: p.adu_sqft || null,
    privateEntrance: null,
    unitLevel: '',
    kitchenType: null,
    inUnitLaundry: null,
    permitStatus: null,
    certificateOfOccupancy: null,
    zoningDesignation: '',
    legalRentalStatus: null,
    hoaRestrictions: '',
    shortTermRentalAllowed: null,
    monthlyRent: p.draft_monthly_rent ?? null,
    securityDeposit: null,
    leaseTerm: null,
    utilitiesStrategy: null,
    capRate: null,
    grossYield: null,
    paybackPeriod: null,
    constructionCost: null,
    floorPlanImage: '',
    imageGallery: [],
    videoTourUrl: '',
    sellerType: null,
    contactPreference: null,
    responseTime: '',
    sellerName: '',
    sellerId: p.user_id,
    outdoorSpace: '',
    parkingDetails: '',
    climateControl: null,
    neighborhoodInfo: '',
    investorMetrics: '',
    smartHomeFeatures: '',
    furnished: null,
    proximityToEmployers: '',
    petPolicy: '',
    images: [],
    amenities: [],
    availableDate: '',
    utilitiesIncluded: [],
    parkingIncluded: false,
    petsAllowed: undefined,
    viewCount: 0,
    saveCount: 0,
    description: '',
    seoTitle: p.address || 'Untitled Project',
    createdAt: p.created_at,
    updatedAt: p.updated_at,
  };
}

function getDashboardListingStatus(project: ProjectOut): ListingStatus {
  const status = normalizeProjectStatus(project.status);
  if (MARKETPLACE_STATUSES.includes(status as ListingStatus)) {
    return status as ListingStatus;
  }
  return 'project';
}

export default function SellerListingsPage() {
  const { user, isLoading } = useAuth();
  const [activeFilter, setActiveFilter] = useState<ListingStatus | 'all'>('all');
  const [projects, setProjects] = useState<ProjectOut[]>([]);
  const [projectsLoaded, setProjectsLoaded] = useState(false);

  useEffect(() => {
    const fetchProjects = async () => {
      try {
        const res = await fetch(`${API_URL}/projects`, {
          headers: await getAuthHeaders(),
        });
        if (res.status === 401) {
          redirectToLogin();
          return;
        }
        if (!res.ok) throw new Error('Failed to fetch projects');
        const data = await res.json();
        setProjects(data);
      } catch (err) {
        console.error('Failed to fetch projects:', err);
      } finally {
        setProjectsLoaded(true);
      }
    };
    if (user) fetchProjects();
  }, [user]);

  if (isLoading || !user) {
    return (
      <div className="flex h-[400px] items-center justify-center">
        <div className="text-surface-400 text-sm">
          {isLoading ? 'Loading...' : 'Redirecting...'}
        </div>
      </div>
    );
  }

  if (!projectsLoaded) {
    return <ProjectsSkeleton />;
  }

  const normalizedProjects = Array.from(new Map(projects.map((p) => [p.id, p])).values());
  const allListings: Listing[] = normalizedProjects.map((p) =>
    projectToListingShape(p, getDashboardListingStatus(p)),
  );
  const publishedListings = allListings.filter((listing) => listing.status === 'published');
  const projectListings = allListings.filter((listing) => listing.status === 'project');
  const draftListings = allListings.filter((listing) => listing.status === 'draft');
  const archivedListings = allListings.filter((listing) => listing.status === 'archived');
  const reportListings = allListings.filter((listing) => listing.hasReport);

  const filteredListings =
    activeFilter === 'all'
      ? allListings
      : activeFilter === 'report'
        ? reportListings
        : activeFilter === 'project'
          ? projectListings
          : activeFilter === 'draft'
            ? draftListings
            : activeFilter === 'published'
              ? publishedListings
              : archivedListings;

  const counts: Record<string, number> = {
    all: allListings.length,
    project: projectListings.length,
    published: publishedListings.length,
    draft: draftListings.length,
    archived: archivedListings.length,
    report: reportListings.length,
  };

  const handleDelete = async (id: string) => {
    try {
      const res = await fetch(`${API_URL}/projects/${id}`, {
        method: 'DELETE',
        headers: await getAuthHeaders(),
      });
      if (res.status === 401) {
        redirectToLogin();
        return;
      }
      if (!res.ok && res.status !== 404) throw new Error('Failed to delete project');
      clearPlanningDraft(buildPlanningDraftScopeKey(id), 'project-deleted');
      setProjects((prev) => prev.filter((p) => p.id !== id));
    } catch (err) {
      console.error('Failed to delete project:', err);
    }
  };

  const handleStatusChange = async (id: string, newStatus: ListingStatus) => {
    try {
      const headers = await getProjectRequestHeaders();

      let endpoint = '';
      if (newStatus === 'published') endpoint = `${API_URL}/projects/${id}/publish`;
      else if (newStatus === 'archived') endpoint = `${API_URL}/projects/${id}/archive`;
      else if (newStatus === 'project') endpoint = `${API_URL}/projects/${id}/unpublish`;

      if (endpoint) {
        const res = await fetch(endpoint, { method: 'POST', headers });
        if (res.status === 401) {
          redirectToLogin();
          return;
        }
        if (!res.ok) throw new Error('Failed to change status');
        const updated = await res.json();
        setProjects((prev) =>
          prev.map((p) => (p.id === id ? { ...p, status: updated.status } : p)),
        );
      }
    } catch (err) {
      console.error('Failed to change status:', err);
    }
  };

  const handleGenerateReport = async (id: string) => {
    const updatedProject = await generateAndFetchProject(id);
    if (!updatedProject) return;
    setProjects((current) =>
      current.map((project) => (project.id === id ? updatedProject : project)),
    );
  };

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Page header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-widest text-surface-400 mb-2">
            My Work
          </p>
          <p className="text-2xl font-bold text-surface-900 tracking-tight">Projects</p>
          <p className="text-sm text-surface-500 mt-1">
            {counts.all === 0
              ? 'No projects yet'
              : `${counts.all} saved project${counts.all !== 1 ? 's' : ''}`}
          </p>
        </div>
        <Link
          href="/map"
          className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold text-white bg-brand-600 hover:bg-brand-700 rounded-lg transition-colors shadow-sm shrink-0"
        >
          <MapPin className="w-4 h-4" />
          Analyze a Property
        </Link>
      </div>

      {/* Horizontal filter strip */}
      <div className="flex items-center gap-1 p-1 bg-surface-100 rounded-xl w-fit">
        {FILTER_TABS.map((tab) => {
          const isActive = activeFilter === tab.value;
          const count = counts[tab.value] ?? 0;
          return (
            <button
              key={tab.value}
              onClick={() => setActiveFilter(tab.value)}
              className={`flex items-center gap-2 px-3.5 py-1.5 text-sm font-semibold rounded-lg transition-all duration-200 cursor-pointer ${
                isActive
                  ? 'bg-surface-0 text-surface-900 shadow-[0_1px_3px_rgba(0,0,0,0.08)]'
                  : 'text-surface-500 hover:text-surface-700'
              }`}
            >
              {tab.label}
              <span
                className={`text-[11px] font-bold min-w-[18px] text-center px-1.5 py-0.5 rounded-full leading-none ${
                  isActive ? 'bg-surface-100 text-surface-700' : 'bg-surface-200 text-surface-500'
                }`}
              >
                {count}
              </span>
            </button>
          );
        })}
      </div>

      {/* Content */}
      {filteredListings.length > 0 ? (
        <ListingTable
          listings={filteredListings}
          onDelete={handleDelete}
          onGenerateReport={handleGenerateReport}
          onStatusChange={handleStatusChange}
        />
      ) : (
        <EmptyProjectsState />
      )}
    </div>
  );
}

function EmptyProjectsState() {
  return (
    <div className="flex flex-col items-center justify-center py-20 bg-surface-0 rounded-2xl border border-dashed border-surface-200 text-center">
      <div className="w-14 h-14 bg-surface-50 border border-surface-200 rounded-2xl flex items-center justify-center mb-5 shadow-[0_1px_3px_rgba(0,0,0,0.06)]">
        <MapPin className="w-6 h-6 text-surface-400" />
      </div>
      <p className="text-base font-bold text-surface-900 mb-1.5">No projects yet</p>
      <p className="text-sm text-surface-500 max-w-xs mb-6 leading-relaxed">
        Check your lot&apos;s ADU feasibility and save the results here.
      </p>
      <Link
        href="/map"
        className="inline-flex items-center gap-2 px-5 py-2.5 bg-brand-600 hover:bg-brand-700 text-white text-sm font-semibold rounded-lg transition-colors shadow-sm"
      >
        <MapPin className="w-4 h-4" />
        Analyze a Property
      </Link>
    </div>
  );
}

function ProjectsSkeleton() {
  return (
    <div className="space-y-6 animate-pulse">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-2">
          <div className="h-3 w-16 bg-surface-200 rounded" />
          <div className="h-7 w-32 bg-surface-200 rounded" />
          <div className="h-4 w-24 bg-surface-100 rounded" />
        </div>
        <div className="h-9 w-40 bg-surface-200 rounded-lg" />
      </div>
      <div className="h-10 w-56 bg-surface-100 rounded-xl" />
      <div className="bg-surface-0 rounded-2xl border border-surface-200 divide-y divide-surface-100">
        {[1, 2, 3].map((i) => (
          <div key={i} className="flex items-center gap-4 px-5 py-4">
            <div className="w-10 h-10 rounded-xl bg-surface-100 shrink-0" />
            <div className="flex-1 space-y-1.5">
              <div className="h-4 w-48 bg-surface-100 rounded" />
              <div className="h-3 w-24 bg-surface-100 rounded" />
            </div>
            <div className="hidden md:flex flex-col items-end gap-1.5">
              <div className="h-4 w-16 bg-surface-100 rounded-full" />
              <div className="h-3 w-20 bg-surface-100 rounded" />
            </div>
            <div className="h-7 w-24 bg-surface-100 rounded-lg" />
          </div>
        ))}
      </div>
    </div>
  );
}
