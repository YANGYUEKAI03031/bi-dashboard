/**
 * useNodePreview - Hook for fetching preview data for a pipeline node.
 * Handles debouncing, caching, and error states.
 * Supports both single-node and chained (graph-collapse) preview modes.
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
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cacheRef = useRef<Record<string, PreviewData>>({});

  const loadPreview = useCallback(async (params: LoadPreviewParams, immediate = false) => {
    const { node, allNodes, allEdges, pipelineDataSourceId, limit = 100 } = params;
    if (!pipelineDataSourceId) {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      setPreviewLoading(false);
      setPreviewData(null);
      return;
    }

    const pipelineNode = node.data.pipelineNode as PipelineNode;
    const cacheKey = `${node.id}-${JSON.stringify(pipelineNode)}`;
    if (!immediate && cacheRef.current[cacheKey]) {
      setPreviewLoading(false);
      setPreviewData(cacheRef.current[cacheKey]);
      return;
    }

    if (debounceRef.current) clearTimeout(debounceRef.current);
    setPreviewLoading(true);
    debounceRef.current = setTimeout(async () => {
      try {
        const token = AuthService.getAuthToken();

        // 构建图结构，供后端折叠上游子查询
        const graph_nodes = allNodes.map((n: GraphNode) => {
          const pn = n.data.pipelineNode as PipelineNode;
          return {
            id: n.id,
            type: pn.type,
            config: pn.config || {},
          };
        });
        const graph_edges = allEdges.map((e: GraphEdge) => ({
          source: e.source,
          target: e.target,
        }));

        const body = {
          node_type: pipelineNode.type,
          config: pipelineNode.config || {},
          source_data_source_id: pipelineDataSourceId,
          limit,
          // 链式折叠模式：传全图结构 + focus_id
          graph_nodes,
          graph_edges,
          focus_node_id: node.id,
        };

        const response = await fetch(`${API_BASE_URL}/pipeline/preview`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(body),
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
      } catch (_err: unknown) {
        setPreviewData(null);
      } finally {
        setPreviewLoading(false);
      }
    }, immediate ? 0 : 500);
  }, []);

  const clearPreview = useCallback(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    setPreviewLoading(false);
    setPreviewData(null);
  }, []);

  return { previewData, previewLoading, loadPreview, clearPreview };
}
