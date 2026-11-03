'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { createClient } from '@/lib/utils/supabase/client';
import { useAuth } from './useAuth';
import { normalizeProjectStatus, type ProjectStatus } from '@/lib/types/listing';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

export type WorkflowState = 'unsaved' | 'saved' | 'has_report' | 'has_draft' | 'loading' | 'error';

export interface ProjectStatusInfo {
  workflowState: WorkflowState;
  projectStatus: ProjectStatus | null;
  address: string | null;
  hasReport: boolean;
  hasDraft: boolean;
  refresh: () => void;
}

export function useProjectStatus(projectId: string | undefined): ProjectStatusInfo {
  const { isLoggedIn, isLoading: isAuthLoading } = useAuth();
  const [workflowState, setWorkflowState] = useState<WorkflowState>(
    projectId ? 'loading' : 'unsaved',
  );
  const [projectStatus, setProjectStatus] = useState<ProjectStatus | null>(null);
  const [address, setAddress] = useState<string | null>(null);
  const [hasReport, setHasReport] = useState(false);
  const [hasDraft, setHasDraft] = useState(false);
  const fetchedIdRef = useRef<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const fetchProject = useCallback(async (id: string) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setWorkflowState('loading');

    try {
      const {
        data: { session },
      } = await createClient().auth.getSession();
      const token = session?.access_token;
      if (!token) {
        setWorkflowState('unsaved');
        return;
      }

      const res = await fetch(`${API_URL}/projects/${encodeURIComponent(id)}`, {
        headers: { Authorization: `Bearer ${token}` },
        signal: controller.signal,
      });

      if (controller.signal.aborted) return;

      if (!res.ok) {
        setWorkflowState(res.status === 404 ? 'unsaved' : 'error');
        return;
      }

      const data = await res.json();
      fetchedIdRef.current = id;
      setProjectStatus(normalizeProjectStatus(data.status));
      setAddress(data.address ?? null);
      setHasReport(Boolean(data.has_report));
      setHasDraft(Boolean(data.has_draft));

      if (data.has_draft) {
        setWorkflowState('has_draft');
      } else if (data.has_report) {
        setWorkflowState('has_report');
      } else {
        setWorkflowState('saved');
      }
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      setWorkflowState('error');
    }
  }, []);

  useEffect(() => {
    if (isAuthLoading) return;

    if (!projectId || !isLoggedIn) {
      setWorkflowState('unsaved');
      setProjectStatus(null);
      setAddress(null);
      setHasReport(false);
      setHasDraft(false);
      fetchedIdRef.current = null;
      return;
    }

    if (fetchedIdRef.current === projectId) return;

    fetchProject(projectId);

    return () => {
      abortRef.current?.abort();
    };
  }, [projectId, isLoggedIn, isAuthLoading, fetchProject]);

  const refresh = useCallback(() => {
    if (!projectId || !isLoggedIn) return;
    fetchedIdRef.current = null;
    fetchProject(projectId);
  }, [projectId, isLoggedIn, fetchProject]);

  return { workflowState, projectStatus, address, hasReport, hasDraft, refresh };
}
