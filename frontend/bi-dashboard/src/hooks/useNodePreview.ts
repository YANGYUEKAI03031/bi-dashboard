/**
 * useNodePreview - Hook for fetching preview data for a pipeline node.
 * Handles debouncing, caching, and error states.
 * Supports both single-node and chained (graph-collapse) preview modes.
 */
import { useState, useCallback, useRef } from 'react';
import { GraphNode, buildEdgesFromUpstream } from '../utils/graphUtils';
import { PipelineNode } from '../services/pipelineService';
import { API_BASE_URL } from '../config/apiBaseUrl';
import { AuthService } from '../services/authService';
import { mergeTypeForPreviewApi } from '../utils/pipelineMergeSql';

export interface PreviewData {
  columns: string[];
  /** 链式预览在列投影前的完整列名（与 columns 可能不同，供列选择器展示） */
  allColumns?: string[];
  columnTypes?: string[];
  rows: Record<string, unknown>[];
  total: number;
  hasMore: boolean;
  sqlGenerated?: string;
}

interface LoadPreviewParams {
  node: GraphNode;
  allNodes: GraphNode[];
  pipelineDataSourceId?: number;
  limit?: number;
}

export function useNodePreview() {
  const [previewData, setPreviewData] = useState<PreviewData | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cacheRef = useRef<Record<string, PreviewData>>({});

  const loadPreview = useCallback(
    async (params: LoadPreviewParams, immediate = false): Promise<PreviewData | null> => {
      const { node, allNodes, pipelineDataSourceId, limit = 100 } = params;
      if (!pipelineDataSourceId) {
        if (debounceRef.current) clearTimeout(debounceRef.current);
        setPreviewLoading(false);
        setPreviewData(null);
        setPreviewError(null);
        return null;
      }

      const pipelineNode = node.data.pipelineNode as PipelineNode;
      const cacheKey = `${node.id}-${JSON.stringify(pipelineNode)}`;
      if (!immediate && cacheRef.current[cacheKey]) {
        const cached = cacheRef.current[cacheKey];
        setPreviewLoading(false);
        setPreviewData(cached);
        setPreviewError(null);
        return cached;
      }

      if (debounceRef.current) clearTimeout(debounceRef.current);
      setPreviewLoading(true);
      setPreviewError(null);

      return new Promise<PreviewData | null>((resolve) => {
        const delay = immediate ? 0 : 750;
        debounceRef.current = setTimeout(async () => {
          try {
            const token = AuthService.getAuthToken();

            const graph_nodes = allNodes.map((n: GraphNode) => {
              const pn = n.data.pipelineNode as PipelineNode;
              const baseCfg =
                pn.config && typeof pn.config === 'object' ? { ...pn.config } : {};
              if (typeof pn.sql === 'string' && pn.sql.trim()) {
                baseCfg.sql = pn.sql;
              }
              return {
                id: n.id,
                type: pn.type,
                config: baseCfg,
                merge_type: mergeTypeForPreviewApi(pn),
              };
            });
            const graph_edges = buildEdgesFromUpstream(allNodes).map((e) => ({
              source: e.source,
              target: e.target,
            }));

            const body = {
              node_type: pipelineNode.type,
              config: pipelineNode.config || {},
              source_data_source_id: pipelineDataSourceId,
              limit,
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
              const detail = err.detail;
              const msg =
                typeof detail === 'string'
                  ? detail
                  : Array.isArray(detail)
                    ? detail.map((x: { msg?: string }) => x?.msg || '').filter(Boolean).join('; ')
                    : '预览请求失败';
              throw new Error(msg || '预览请求失败');
            }

            const data = await response.json();
            const ac = data.all_columns;
            const result: PreviewData = {
              columns: data.columns || [],
              allColumns: Array.isArray(ac) && ac.length > 0 ? ac : undefined,
              columnTypes: data.column_types || [],
              rows: data.rows || [],
              total: data.total ?? data.rows?.length ?? 0,
              hasMore: data.has_more ?? false,
              sqlGenerated: data.sql_generated || '',
            };
            cacheRef.current[cacheKey] = result;
            setPreviewData(result);
            setPreviewError(null);
            resolve(result);
          } catch (err: unknown) {
            setPreviewData(null);
            setPreviewError(err instanceof Error ? err.message : '预览加载失败');
            resolve(null);
          } finally {
            setPreviewLoading(false);
          }
        }, delay);
      });
    },
    []
  );

  const clearPreview = useCallback(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    setPreviewLoading(false);
    setPreviewData(null);
    setPreviewError(null);
  }, []);

  return { previewData, previewLoading, previewError, loadPreview, clearPreview };
}
