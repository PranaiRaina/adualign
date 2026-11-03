'use client';

import { Fragment, cloneElement, useState, useEffect, isValidElement, type ReactNode } from 'react';
import { useParams, useRouter } from 'next/navigation';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { CheckCircle2, FileText, Printer, Loader2, MessageSquare, Trash2 } from 'lucide-react';
import { Header } from '@/components/layout/Header';
import { getAuthHeaders } from '@/lib/utils/supabase/authHeaders';
import { redirectToLogin } from '@/lib/utils/authRedirect';
import { buildPlanningDraftScopeKey, clearPlanningDraft } from '@/lib/planningDraft';
import { BlockingSessionEntryModal } from '@/components/BlockingSessionEntryModal';

const INVALID_PROJECT_MODAL_TITLE = 'This project is no longer available';
const INVALID_PROJECT_MODAL_DESCRIPTION =
  'This project no longer exists or is no longer available. Leave now to avoid stale project state.';

interface ReportResponseData {
  id: string;
  project_id: string;
  version: number;
  visible?: {
    executive_summary?: string | null;
    property_overview?: string | null;
    zoning_analysis?: string | null;
    financial_snapshot?: string | null;
    recommendations?: string | null;
  } | null;
  created_at: string;
  last_modified: string;
}

interface ProjectResponseData {
  address?: string | null;
  has_draft?: boolean;
}

export default function ReportPage() {
  // Next 16: the params prop is a Promise; useParams gives sync access.
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [reportData, setReportData] = useState<ReportResponseData | null>(null);
  const [title, setTitle] = useState('ADU Feasibility Report');
  const [isDeleting, setIsDeleting] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isProjectInvalid, setIsProjectInvalid] = useState(false);

  const handleDeleteProject = async () => {
    if (!confirm('Delete this project and its report? This cannot be undone.')) return;
    setIsDeleting(true);
    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/projects/${id}`, {
        method: 'DELETE',
        headers: await getAuthHeaders(),
      });
      if (res.status === 401) {
        redirectToLogin();
        return;
      }
      if (!res.ok && res.status !== 404) throw new Error('Failed to delete project');
      clearPlanningDraft(buildPlanningDraftScopeKey(id), 'project-deleted');
      router.push('/projects');
    } catch (err) {
      console.error('Delete failed:', err);
      alert('Failed to delete project. Please try again.');
      setIsDeleting(false);
    }
  };
  const handleInvalidProjectLeave = () => {
    router.replace('/projects');
  };

  useEffect(() => {
    async function fetchReport() {
      try {
        const headers = await getAuthHeaders();
        const [projectRes, reportRes] = await Promise.all([
          fetch(`${process.env.NEXT_PUBLIC_API_URL}/projects/${id}`, { headers }),
          fetch(`${process.env.NEXT_PUBLIC_API_URL}/projects/${id}/report`, { headers }),
        ]);

        if (projectRes.status === 401 || reportRes.status === 401) {
          redirectToLogin();
          return;
        }
        if (projectRes.status === 404) {
          clearPlanningDraft(buildPlanningDraftScopeKey(id), 'project-not-found');
          setIsProjectInvalid(true);
          return;
        }
        if (!projectRes.ok || !reportRes.ok) throw new Error('Failed to fetch report');

        const projectData = (await projectRes.json()) as ProjectResponseData;
        const data = (await reportRes.json()) as ReportResponseData;

        if (projectData.address) {
          setTitle(`ADU Report — ${projectData.address}`);
        }

        setReportData(data);
      } catch (err) {
        console.error('Error loading report:', err);
      } finally {
        setIsLoading(false);
      }
    }

    fetchReport();
  }, [id]);

  if (isProjectInvalid) {
    return (
      <BlockingSessionEntryModal
        title={INVALID_PROJECT_MODAL_TITLE}
        description={INVALID_PROJECT_MODAL_DESCRIPTION}
        onLeave={handleInvalidProjectLeave}
      />
    );
  }

  if (isLoading) {
    return (
      <div className="min-h-screen bg-surface-50 flex flex-col">
        <div className="print:hidden">
          <Header />
        </div>
        <ReportShell
          title={title}
          projectId={id}
          router={router}
          isDeleting={isDeleting}
          onDelete={handleDeleteProject}
        >
          <ReportSkeleton />
        </ReportShell>
      </div>
    );
  }

  if (!reportData?.visible) {
    return (
      <div className="min-h-screen bg-surface-50 flex flex-col">
        <div className="print:hidden">
          <Header />
        </div>
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center space-y-4">
            <div className="w-16 h-16 bg-surface-100 rounded-2xl flex items-center justify-center mx-auto">
              <FileText className="w-8 h-8 text-surface-400" />
            </div>
            <p className="text-xl font-bold text-surface-900 tracking-tight">Report not found</p>
            <p className="text-surface-500 max-w-sm text-sm leading-relaxed">
              This report may have expired from your session. Generate a new one from the ADU
              Advisor.
            </p>
            <button
              onClick={() => router.push('/projects')}
              className="mt-4 px-6 py-2.5 bg-brand-600 text-white rounded-lg font-semibold text-sm hover:bg-brand-700 transition-colors shadow-sm cursor-pointer"
            >
              Back to My Projects
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="report-print-page min-h-screen bg-surface-50 flex flex-col print:bg-white">
      <div className="print:hidden">
        <Header />
      </div>
      <ReportShell
        title={title}
        projectId={id}
        router={router}
        isDeleting={isDeleting}
        onDelete={handleDeleteProject}
      >
        <StructuredReport visible={reportData.visible} />
      </ReportShell>
    </div>
  );
}

function ReportShell({
  children,
  isDeleting,
  onDelete,
  projectId,
  router,
  title,
}: {
  children: ReactNode;
  isDeleting: boolean;
  onDelete: () => void;
  projectId: string;
  router: ReturnType<typeof useRouter>;
  title: string;
}) {
  return (
    <>
      <div className="bg-surface-0 border-b border-surface-200 shadow-sm print:hidden">
        <div className="container mx-auto max-w-5xl px-4 h-14 flex items-center gap-3">
          <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-surface-100 text-surface-600 shrink-0">
            Report
          </span>
          <span className="font-medium text-surface-900 text-sm truncate">{title}</span>
          <div className="flex-1" />
          <button
            onClick={onDelete}
            disabled={isDeleting}
            className="p-2 text-surface-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors cursor-pointer disabled:opacity-50"
            aria-label="Delete project"
          >
            <Trash2 className="w-4 h-4" />
          </button>
          <button
            onClick={() => window.print()}
            className="p-2 text-surface-400 hover:text-surface-800 hover:bg-surface-100 rounded-lg transition-colors cursor-pointer"
            aria-label="Print report"
          >
            <Printer className="w-4 h-4" />
          </button>
          <div className="h-5 w-px bg-surface-200 shrink-0" />
          <button
            type="button"
            onClick={() => router.push(`/adu-chat?fromReport=1&projectId=${projectId}`)}
            className="hidden sm:inline-flex items-center gap-2 shrink-0 whitespace-nowrap px-3.5 py-1.5 text-sm font-medium text-surface-700 border border-surface-200 bg-surface-0 rounded-lg hover:bg-surface-50 transition-colors cursor-pointer"
          >
            <MessageSquare className="h-3.5 w-3.5 shrink-0 text-surface-500" aria-hidden />
            <span>Continue Chatting</span>
          </button>
          <button
            onClick={() => router.push('/projects')}
            className="flex items-center gap-1.5 px-4 py-1.5 text-sm font-semibold text-white bg-brand-600 rounded-lg hover:bg-brand-700 transition-colors cursor-pointer shadow-sm"
          >
            <CheckCircle2 className="w-3.5 h-3.5" />
            Finish
          </button>
        </div>
      </div>
      <main className="report-print-shell flex-1 py-8 px-4 print:flex-none print:p-0">
        <div className="report-print-container container mx-auto max-w-5xl print:max-w-none print:px-0">
          {children}
        </div>
      </main>
    </>
  );
}

function StructuredReport({ visible }: { visible: NonNullable<ReportResponseData['visible']> }) {
  return (
    <article id="report-print-root" className="space-y-4 print:space-y-4">
      <ReportSection title="Executive Summary" content={visible.executive_summary} featured />
      <PropertyOverviewSection content={visible.property_overview} />
      <ReportSection title="Zoning & Regulatory Analysis" content={visible.zoning_analysis} />
      <ReportSection title="Financial Snapshot" content={visible.financial_snapshot} />
      <ReportSection title="Recommendations" content={visible.recommendations} />
    </article>
  );
}

const PROPERTY_OVERVIEW_FOOTNOTE_PREFIX = '*Overall footprint describes';

function renderWithRedAsterisks(text: string): ReactNode {
  if (!text.includes('*')) {
    return text;
  }

  const segments = text.split('*');
  return segments.map((segment, index) => (
    <Fragment key={index}>
      {index > 0 ? <span className="font-semibold text-red-600">*</span> : null}
      {segment}
    </Fragment>
  ));
}

function renderNodeWithRedAsterisks(node: ReactNode): ReactNode {
  if (typeof node === 'string') {
    return renderWithRedAsterisks(node);
  }

  if (Array.isArray(node)) {
    return node.map((child, index) => (
      <Fragment key={index}>{renderNodeWithRedAsterisks(child)}</Fragment>
    ));
  }

  if (isValidElement(node) && node.props.children != null) {
    return cloneElement(node, {
      children: renderNodeWithRedAsterisks(node.props.children),
    });
  }

  return node;
}

const propertyOverviewMarkdownComponents = {
  th: ({ children }: { children?: ReactNode }) => <th>{renderNodeWithRedAsterisks(children)}</th>,
  td: ({ children }: { children?: ReactNode }) => <td>{renderNodeWithRedAsterisks(children)}</td>,
};

function splitPropertyOverviewContent(content: string) {
  const markerIndex = content.indexOf(`\n\n${PROPERTY_OVERVIEW_FOOTNOTE_PREFIX}`);
  if (markerIndex === -1) {
    return { body: content, footnote: null };
  }

  return {
    body: content.slice(0, markerIndex),
    footnote: content.slice(markerIndex + 2),
  };
}

function PropertyOverviewSection({ content }: { content?: string | null }) {
  const trimmed = content?.trim();
  if (!trimmed) {
    return <ReportSection title="Property Overview" content={null} />;
  }

  const { body, footnote } = splitPropertyOverviewContent(trimmed);
  const proseClassName =
    'prose max-w-none prose-p:text-surface-600 prose-p:leading-relaxed prose-li:text-surface-600 prose-strong:text-surface-900 prose-table:text-sm prose-th:bg-surface-50 prose-th:border-surface-200 prose-th:px-4 prose-th:py-2.5 prose-th:text-left prose-th:font-bold prose-th:text-surface-700 prose-td:border-surface-200 prose-td:px-4 prose-td:py-2.5 prose-td:text-surface-600';

  return (
    <section className="rounded-2xl border bg-surface-0 border-surface-100 shadow-[0_1px_3px_rgba(0,0,0,0.04)] p-6 sm:p-8 print:shadow-none print:rounded-none print:border-surface-200">
      <p className="text-xl font-bold text-surface-900 tracking-tight mb-4">Property Overview</p>
      <div className={proseClassName}>
        <ReactMarkdown remarkPlugins={[remarkGfm]} components={propertyOverviewMarkdownComponents}>
          {body}
        </ReactMarkdown>
        {footnote ? (
          <p className="!mt-3 !mb-0 text-sm leading-relaxed text-surface-500">
            {renderWithRedAsterisks(footnote)}
          </p>
        ) : null}
      </div>
    </section>
  );
}

function ReportSection({
  title,
  content,
  featured,
}: {
  title: string;
  content?: string | null;
  featured?: boolean;
}) {
  return (
    <section
      className={`rounded-2xl border p-6 sm:p-8 print:shadow-none print:rounded-none print:border-surface-200 ${
        featured
          ? 'bg-brand-50 border-brand-100'
          : 'bg-surface-0 border-surface-100 shadow-[0_1px_3px_rgba(0,0,0,0.04)]'
      }`}
    >
      <p className="text-xl font-bold text-surface-900 tracking-tight mb-4">{title}</p>
      {content?.trim() ? (
        <div className="prose max-w-none prose-p:text-surface-600 prose-p:leading-relaxed prose-li:text-surface-600 prose-strong:text-surface-900 prose-table:text-sm prose-th:bg-surface-50 prose-th:border-surface-200 prose-th:px-4 prose-th:py-2.5 prose-th:text-left prose-th:font-bold prose-th:text-surface-700 prose-td:border-surface-200 prose-td:px-4 prose-td:py-2.5 prose-td:text-surface-600">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
        </div>
      ) : (
        <p className="text-sm text-surface-400">
          This section will fill in as more project details are saved.
        </p>
      )}
    </section>
  );
}

function ReportSkeleton() {
  return (
    <div className="space-y-4">
      {[
        'Executive Summary',
        'Property Overview',
        'Zoning & Regulatory Analysis',
        'Financial Snapshot',
        'Recommendations',
      ].map((title, i) => (
        <section
          key={title}
          className={`rounded-2xl border p-6 sm:p-8 ${
            i === 0
              ? 'bg-brand-50 border-brand-100'
              : 'bg-surface-0 border-surface-100 shadow-[0_1px_3px_rgba(0,0,0,0.04)]'
          }`}
        >
          <div className="flex items-center gap-3 mb-4">
            <Loader2 className="w-4 h-4 text-brand-600 animate-spin" />
            <p className="text-xl font-bold text-surface-900 tracking-tight">{title}</p>
          </div>
          <div className="space-y-3">
            <div className="h-3 w-11/12 rounded bg-surface-200 animate-pulse" />
            <div className="h-3 w-9/12 rounded bg-surface-200 animate-pulse" />
            <div className="h-3 w-7/12 rounded bg-surface-200 animate-pulse" />
          </div>
        </section>
      ))}
    </div>
  );
}
