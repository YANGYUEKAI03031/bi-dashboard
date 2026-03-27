/**
 * useNodePreview - Hook for fetching preview data for a pipeline node.
 * Handles debouncing, caching, and error states.
 */
import { useState, useCallback, useRef } from 'react';
import { GraphNode, GraphEdge } from '../utils/graphUtils';
import { PipelineNode } from '../services/pipelineService';
import { API_BASE_URL } from '../config/apiBaseUrl';
import { AuthService } from '../services/authService';

export interface PreviewData {
  columns: string[];
  columnTypes?: string[];
  rows: Record<string, unknown>[];
  total: number;
  hasMore: boolean;
  sqlGenerated?: string;
}

interface LoadPreviewParams {
  node: GraphNode;
  allNodes: GraphNode[];
  allEdges: GraphEdge[];
  pipelineDataSourceId?: number;
  limit?: number;
}

export function useNodePreview() {
  const [previewData, setPreviewData] = useState<PreviewData | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cacheRef = useRef<Record<string, PreviewData>>({});

  const loadPreview = useCallback(async (params: LoadPreviewParams, immediate = false) => {
    const { node, pipelineDataSourceId, limit = 100 } = params;
    if (!pipelineDataSourceId) {
      setPreviewError('请先选择业务数据源');
      return;
    }

    const cacheKey = `${node.id}-${JSON.stringify(node.data.pipelineNode)}`;
    if (!immediate && cacheRef.current[cacheKey]) {
      setPreviewData(cacheRef.current[cacheKey]);
      return;
    }

    // Debounce
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      setPreviewLoading(true);
      setPreviewError(null);
      try {
        const token = AuthService.getAuthToken();
        const response = await fetch(`${API_BASE_URL}/pipeline/preview`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            node_type: (node.data.pipelineNode as PipelineNode).type,
            config: (node.data.pipelineNode as PipelineNode).config || {},
            source_data_source_id: pipelineDataSourceId,
            limit,
          }),
        });

        if (!response.ok) {
          const err = await response.json().catch(() => ({ detail: '预览请求失败' }));
          throw new Error(err.detail || '预览请求失败');
        }

        const data = await response.json();
        const result: PreviewData = {
          columns: data.columns || [],
          columnTypes: data.column_types || [],
          rows: data.rows || [],
          total: data.total ?? data.rows?.length ?? 0,
          hasMore: data.has_more ?? false,
          sqlGenerated: data.sql_generated || '',
        };
        cacheRef.current[cacheKey] = result;
        setPreviewData(result);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : '预览加载失败';
        setPreviewError(msg);
        setPreviewData(null);
      } finally {
        setPreviewLoading(false);
      }
    }, immediate ? 0 : 500);
  }, []);

  const clearPreview = useCallback(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    setPreviewData(null);
    setPreviewError(null);
  }, []);

  return { previewData, previewLoading, previewError, loadPreview, clearPreview };
}
