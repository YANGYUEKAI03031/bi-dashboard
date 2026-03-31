// frontend/bi-dashboard/src/services/pipelineService.ts
import { AuthService } from './authService';
import { API_BASE_URL } from '../config/apiBaseUrl';

/**
 * 解析 FastAPI 错误响应：
 * - 422 验证错误：{ detail: [{ loc, msg, type }] } → "字段 xxx: 错误信息"
 * - 普通错误：{ detail: "消息文字" } → 原样返回
 * - 其他：返回 fallback
 */
async function parseApiError(response: Response, fallback: string): Promise<string> {
  try {
    const data = await response.json();
    if (data && Array.isArray(data.detail)) {
      // FastAPI 422 验证错误列表
      return data.detail
        .map((err: { loc?: string[]; msg?: string }) => {
          const loc = (err.loc ?? []).slice(1).join('.'); // 去掉 "body" 前缀
          return loc ? `${loc}: ${err.msg ?? '格式错误'}` : (err.msg ?? '格式错误');
        })
        .join('；');
    }
    return (data?.detail as string) || fallback;
  } catch {
    return fallback;
  }
}

export interface PipelineNode {
  id?: string;
  name: string;
  type: string;
  sql: string;
  order: number;
  upstream?: string[];
  position?: { x: number; y: number };
  merge_type?: 'union' | 'left_join' | 'right_join' | 'full_join';
  config?: Record<string, any>;
}

export interface PipelineCreateRequest {
  name: string;
  description?: string;
  source_data_source_id: number;
  nodes: PipelineNode[];
  variables?: Record<string, any>;
  config?: Record<string, any>;
  is_public?: boolean;
}

export interface PipelineUpdateRequest {
  name?: string;
  description?: string;
  nodes?: PipelineNode[];
  variables?: Record<string, any>;
  config?: Record<string, any>;
  is_active?: boolean;
  is_public?: boolean;
  /** 与源节点所选业务库同步（首个 source 节点的 config.source_data_source_id） */
  source_data_source_id?: number;
}

export interface PipelineResponse {
  id: number;
  name: string;
  description?: string;
  source_data_source_id: number;
  nodes: PipelineNode[];
  variables?: Record<string, any>;
  config?: Record<string, any>;
  is_active: boolean;
  created_by: number;
  is_public: boolean;
  created_at: string;
  updated_at: string;
}

export interface PipelineListResponse {
  items: PipelineResponse[];
  total: number;
  skip: number;
  limit: number;
}

export interface ExecutionResponse {
  id: number;
  pipeline_id: number;
  status: string;
  temp_table_name?: string;
  completed_steps: Record<string, any>[];
  config?: Record<string, any>;
  result_summary?: Record<string, any>;
  error_message?: string;
  total_rows: number;
  execution_time_ms?: number;
  logs: Record<string, any>[];
  retention_minutes: number;
  expires_at?: string;
  started_at?: string;
  completed_at?: string;
  /** 当前执行到的步骤，如 step_0 */
  current_step_id?: string | null;
  /** 当前步骤已写入行数（SQL 执行阶段为 0，fetchmany 写入后才有值） */
  current_step_rows?: number;
  /** 各步骤进度详情 */
  step_progress?: Record<string, {
    status?: string;
    rows?: number;
    phase?: string;
    phase_message?: string;
    started_at?: string;
    completed_at?: string;
    error?: string;
  }>;
}

export interface StepPreviewResponse {
  step_id: string;
  columns: string[];
  rows: Record<string, any>[];
  total: number;
  has_more: boolean;
}

export interface StepSchemaResponse {
  step_id: string;
  schema: { name: string; type: string }[];
}

export interface ExecutionProgress {
  execution_id: number;
  status: string;
  current_step_id: string | null;
  current_step_rows: number;
  total_rows: number | null;
  step_progress: Record<string, {
    status: string;
    rows?: number;
    started_at?: string;
    completed_at?: string;
    error?: string;
  }>;
  completed_steps: Record<string, any>[];
  started_at: string | null;
  completed_at: string | null;
  execution_time_ms: number | null;
  error_message: string | null;
}

export interface WatermarkInfo {
  node_id: string;
  watermark_field: string;
  last_value: string | null;
  last_processed_at: string | null;
}

export interface PipelineWatermarks {
  pipeline_id: number;
  watermarks: WatermarkInfo[];
}

export interface PipelineStats {
  pipeline_id: number;
  total_executions: number;
  successful_executions: number;
  failed_executions: number;
  avg_execution_time_ms?: number;
  last_execution?: string;
}

export class PipelineService {
  static async createPipeline(pipelineData: PipelineCreateRequest): Promise<PipelineResponse> {
    const token = AuthService.getAuthToken();
    if (!token) throw new Error('用户未认证');

    const response = await fetch(`${API_BASE_URL}/pipeline/`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(pipelineData),
    });
    if (!response.ok) {
      throw new Error(await parseApiError(response, '创建管道失败'));
    }
    return response.json();
  }

  static async getPipelines(skip = 0, limit = 20): Promise<PipelineListResponse> {
    const token = AuthService.getAuthToken();
    if (!token) throw new Error('用户未认证');

    const response = await fetch(`${API_BASE_URL}/pipeline/?skip=${skip}&limit=${limit}`, {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    });
    if (!response.ok) {
      throw new Error(await parseApiError(response, '获取管道列表失败'));
    }
    return response.json();
  }

  static async getPipeline(pipelineId: number): Promise<PipelineResponse> {
    const token = AuthService.getAuthToken();
    if (!token) throw new Error('用户未认证');

    const response = await fetch(`${API_BASE_URL}/pipeline/${pipelineId}`, {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    });
    if (!response.ok) {
      throw new Error(await parseApiError(response, '获取管道详情失败'));
    }
    return response.json();
  }

  static async updatePipeline(pipelineId: number, updateData: PipelineUpdateRequest): Promise<PipelineResponse> {
    const token = AuthService.getAuthToken();
    if (!token) throw new Error('用户未认证');

    const response = await fetch(`${API_BASE_URL}/pipeline/${pipelineId}`, {
      method: 'PUT',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(updateData),
    });
    if (!response.ok) {
      throw new Error(await parseApiError(response, '更新管道失败'));
    }
    return response.json();
  }

  static async deletePipeline(pipelineId: number): Promise<void> {
    const token = AuthService.getAuthToken();
    if (!token) throw new Error('用户未认证');

    const response = await fetch(`${API_BASE_URL}/pipeline/${pipelineId}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    });
    if (!response.ok) {
      throw new Error(await parseApiError(response, '删除管道失败'));
    }
  }

  static async runPipeline(pipelineId: number): Promise<{ execution_id: number; pipeline_id: number; status: string; message: string }> {
    const token = AuthService.getAuthToken();
    if (!token) throw new Error('用户未认证');

    const response = await fetch(`${API_BASE_URL}/pipeline/${pipelineId}/run`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    });
    if (!response.ok) {
      throw new Error(await parseApiError(response, '触发管道运行失败'));
    }
    return response.json();
  }

  static async getPipelineExecutions(pipelineId: number, skip = 0, limit = 20): Promise<{ items: ExecutionResponse[]; total: number }> {
    const token = AuthService.getAuthToken();
    if (!token) throw new Error('用户未认证');

    const response = await fetch(`${API_BASE_URL}/pipeline/${pipelineId}/executions?skip=${skip}&limit=${limit}`, {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    });
    if (!response.ok) {
      throw new Error(await parseApiError(response, '获取执行历史失败'));
    }
    return response.json();
  }

  static async getExecution(executionId: number): Promise<ExecutionResponse> {
    const token = AuthService.getAuthToken();
    if (!token) throw new Error('用户未认证');

    const response = await fetch(`${API_BASE_URL}/pipeline/executions/${executionId}`, {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    });
    if (!response.ok) {
      throw new Error(await parseApiError(response, '获取执行记录失败'));
    }
    return response.json();
  }

  static async getLatestExecution(pipelineId: number): Promise<ExecutionResponse> {
    const token = AuthService.getAuthToken();
    if (!token) throw new Error('用户未认证');

    const response = await fetch(`${API_BASE_URL}/pipeline/${pipelineId}/executions/latest`, {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    });
    if (!response.ok) {
      throw new Error(await parseApiError(response, '获取最新执行记录失败'));
    }
    return response.json();
  }

  static async getPipelineStats(pipelineId: number): Promise<PipelineStats> {
    const token = AuthService.getAuthToken();
    if (!token) throw new Error('用户未认证');

    const response = await fetch(`${API_BASE_URL}/pipeline/${pipelineId}/stats`, {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    });
    if (!response.ok) {
      throw new Error(await parseApiError(response, '获取管道统计失败'));
    }
    return response.json();
  }

  static async previewStep(pipelineId: number, stepId: string, limit = 100, offset = 0): Promise<StepPreviewResponse> {
    const token = AuthService.getAuthToken();
    if (!token) throw new Error('用户未认证');

    const response = await fetch(`${API_BASE_URL}/pipeline/${pipelineId}/preview/${stepId}?limit=${limit}&offset=${offset}`, {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    });
    if (!response.ok) {
      throw new Error(await parseApiError(response, '预览步骤数据失败'));
    }
    return response.json();
  }

  static async getStepSchema(pipelineId: number, stepId: string): Promise<StepSchemaResponse> {
    const token = AuthService.getAuthToken();
    if (!token) throw new Error('用户未认证');

    const response = await fetch(`${API_BASE_URL}/pipeline/${pipelineId}/schema/${stepId}`, {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    });
    if (!response.ok) {
      throw new Error(await parseApiError(response, '获取步骤模式失败'));
    }
    return response.json();
  }

  static async getAllSteps(pipelineId: number): Promise<{ steps: { step_id: string; rows: number; created_at: string }[] }> {
    const token = AuthService.getAuthToken();
    if (!token) throw new Error('用户未认证');

    const response = await fetch(`${API_BASE_URL}/pipeline/${pipelineId}/steps`, {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    });
    if (!response.ok) {
      throw new Error(await parseApiError(response, '获取所有步骤失败'));
    }
    return response.json();
  }

  static async cancelExecution(executionId: number): Promise<void> {
    const token = AuthService.getAuthToken();
    if (!token) throw new Error('用户未认证');

    const response = await fetch(`${API_BASE_URL}/pipeline/executions/${executionId}/cancel`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    });
    if (!response.ok) {
      throw new Error(await parseApiError(response, '取消执行失败'));
    }
  }

  static async getExecutionProgress(executionId: number): Promise<ExecutionProgress> {
    const token = AuthService.getAuthToken();
    if (!token) throw new Error('用户未认证');

    const response = await fetch(`${API_BASE_URL}/pipeline/executions/${executionId}/progress`, {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    });
    if (!response.ok) {
      throw new Error(await parseApiError(response, '获取执行进度失败'));
    }
    return response.json();
  }

  static async getPipelineWatermarks(pipelineId: number): Promise<PipelineWatermarks> {
    const token = AuthService.getAuthToken();
    if (!token) throw new Error('用户未认证');

    const response = await fetch(`${API_BASE_URL}/pipeline/${pipelineId}/watermarks`, {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    });
    if (!response.ok) {
      throw new Error(await parseApiError(response, '获取水位线失败'));
    }
    return response.json();
  }

  static async deleteWatermark(pipelineId: number, nodeId: string): Promise<void> {
    const token = AuthService.getAuthToken();
    if (!token) throw new Error('用户未认证');

    const response = await fetch(`${API_BASE_URL}/pipeline/${pipelineId}/watermarks/${encodeURIComponent(nodeId)}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    });
    if (!response.ok) {
      throw new Error(await parseApiError(response, '删除水位线失败'));
    }
  }
}
