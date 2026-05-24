// frontend/bi-dashboard/src/services/pipelineService.ts
import { ApiClient, ApiError } from './apiClient';

/**
 * 解析 FastAPI 错误响应：
 * - 422 验证错误：{ detail: [{ loc, msg, type }] } → "字段 xxx: 错误信息"
 * - 普通错误：{ detail: "消息文字" } → 原样返回
 * - 其他：返回 fallback
 */
function parseApiErrorMessage(error: ApiError, fallback: string): string {
  if (error.message && error.message !== '') {
    return error.message;
  }
  return fallback;
}

export interface PipelineNode {
  id?: string;
  name: string;
  type: string;
  sql: string;
  order: number;
  upstream?: string[];
  position?: { x: number; y: number };
  merge_type?: 'union' | 'union_all';
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

export interface PipelineTrigger {
  id: number;
  pipeline_id: number;
  source_table: string;
  watermark_field: string;
  poll_interval_seconds: number;
  enabled: boolean;
  last_check_at: string | null;
  last_watermark_value: string | null;
  created_at: string;
  updated_at: string;
}

export class PipelineService {
  static async createPipeline(pipelineData: PipelineCreateRequest): Promise<PipelineResponse> {
    try {
      return await ApiClient.post<PipelineResponse>('/pipeline/', pipelineData);
    } catch (error) {
      throw new Error(parseApiErrorMessage(error as ApiError, '创建管道失败'));
    }
  }

  static async getPipelines(skip = 0, limit = 20): Promise<PipelineListResponse> {
    try {
      return await ApiClient.get<PipelineListResponse>(`/pipeline/?skip=${skip}&limit=${limit}`);
    } catch (error) {
      throw new Error(parseApiErrorMessage(error as ApiError, '获取管道列表失败'));
    }
  }

  static async getPipeline(pipelineId: number): Promise<PipelineResponse> {
    try {
      return await ApiClient.get<PipelineResponse>(`/pipeline/${pipelineId}`);
    } catch (error) {
      throw new Error(parseApiErrorMessage(error as ApiError, '获取管道详情失败'));
    }
  }

  static async updatePipeline(pipelineId: number, updateData: PipelineUpdateRequest): Promise<PipelineResponse> {
    try {
      return await ApiClient.put<PipelineResponse>(`/pipeline/${pipelineId}`, updateData);
    } catch (error) {
      throw new Error(parseApiErrorMessage(error as ApiError, '更新管道失败'));
    }
  }

  static async deletePipeline(pipelineId: number): Promise<void> {
    try {
      await ApiClient.delete(`/pipeline/${pipelineId}`);
    } catch (error) {
      throw new Error(parseApiErrorMessage(error as ApiError, '删除管道失败'));
    }
  }

  static async runPipeline(pipelineId: number): Promise<{ execution_id: number; pipeline_id: number; status: string; message: string }> {
    try {
      return await ApiClient.post<{ execution_id: number; pipeline_id: number; status: string; message: string }>(`/pipeline/${pipelineId}/run`);
    } catch (error) {
      throw new Error(parseApiErrorMessage(error as ApiError, '触发管道运行失败'));
    }
  }

  static async getPipelineExecutions(pipelineId: number, skip = 0, limit = 20): Promise<{ items: ExecutionResponse[]; total: number }> {
    try {
      return await ApiClient.get<{ items: ExecutionResponse[]; total: number }>(`/pipeline/${pipelineId}/executions?skip=${skip}&limit=${limit}`);
    } catch (error) {
      throw new Error(parseApiErrorMessage(error as ApiError, '获取执行历史失败'));
    }
  }

  static async getExecution(executionId: number): Promise<ExecutionResponse> {
    try {
      return await ApiClient.get<ExecutionResponse>(`/pipeline/executions/${executionId}`);
    } catch (error) {
      throw new Error(parseApiErrorMessage(error as ApiError, '获取执行记录失败'));
    }
  }

  static async getLatestExecution(pipelineId: number): Promise<ExecutionResponse> {
    try {
      return await ApiClient.get<ExecutionResponse>(`/pipeline/${pipelineId}/executions/latest`);
    } catch (error) {
      throw new Error(parseApiErrorMessage(error as ApiError, '获取最新执行记录失败'));
    }
  }

  static async getPipelineStats(pipelineId: number): Promise<PipelineStats> {
    try {
      return await ApiClient.get<PipelineStats>(`/pipeline/${pipelineId}/stats`);
    } catch (error) {
      throw new Error(parseApiErrorMessage(error as ApiError, '获取管道统计失败'));
    }
  }

  static async previewStep(pipelineId: number, stepId: string, limit = 100, offset = 0): Promise<StepPreviewResponse> {
    try {
      return await ApiClient.get<StepPreviewResponse>(`/pipeline/${pipelineId}/preview/${stepId}?limit=${limit}&offset=${offset}`);
    } catch (error) {
      throw new Error(parseApiErrorMessage(error as ApiError, '预览步骤数据失败'));
    }
  }

  static async getStepSchema(pipelineId: number, stepId: string): Promise<StepSchemaResponse> {
    try {
      return await ApiClient.get<StepSchemaResponse>(`/pipeline/${pipelineId}/schema/${stepId}`);
    } catch (error) {
      throw new Error(parseApiErrorMessage(error as ApiError, '获取步骤模式失败'));
    }
  }

  static async getAllSteps(pipelineId: number): Promise<{ steps: { step_id: string; rows: number; created_at: string }[] }> {
    try {
      return await ApiClient.get<{ steps: { step_id: string; rows: number; created_at: string }[] }>(`/pipeline/${pipelineId}/steps`);
    } catch (error) {
      throw new Error(parseApiErrorMessage(error as ApiError, '获取所有步骤失败'));
    }
  }

  static async cancelExecution(executionId: number): Promise<void> {
    try {
      await ApiClient.post(`/pipeline/executions/${executionId}/cancel`);
    } catch (error) {
      throw new Error(parseApiErrorMessage(error as ApiError, '取消执行失败'));
    }
  }

  static async getExecutionProgress(executionId: number): Promise<ExecutionProgress> {
    try {
      return await ApiClient.get<ExecutionProgress>(`/pipeline/executions/${executionId}/progress`);
    } catch (error) {
      throw new Error(parseApiErrorMessage(error as ApiError, '获取执行进度失败'));
    }
  }

  static async getPipelineWatermarks(pipelineId: number): Promise<PipelineWatermarks> {
    try {
      return await ApiClient.get<PipelineWatermarks>(`/pipeline/${pipelineId}/watermarks`);
    } catch (error) {
      throw new Error(parseApiErrorMessage(error as ApiError, '获取水位线失败'));
    }
  }

  static async deleteWatermark(pipelineId: number, nodeId: string): Promise<void> {
    try {
      await ApiClient.delete(`/pipeline/${pipelineId}/watermarks/${encodeURIComponent(nodeId)}`);
    } catch (error) {
      throw new Error(parseApiErrorMessage(error as ApiError, '删除水位线失败'));
    }
  }

  // ==================== 触发器管理 ====================

  static async savePipelineTrigger(
    pipelineId: number,
    triggerData: {
      source_table: string;
      watermark_field: string;
      poll_interval_seconds: number;
      enabled: boolean;
    }
  ): Promise<PipelineTrigger> {
    try {
      return await ApiClient.post<PipelineTrigger>(`/pipeline/${pipelineId}/trigger`, triggerData);
    } catch (error) {
      throw new Error(parseApiErrorMessage(error as ApiError, '保存触发器失败'));
    }
  }

  static async getPipelineTrigger(pipelineId: number): Promise<PipelineTrigger | null> {
    try {
      return await ApiClient.get<PipelineTrigger>(`/pipeline/${pipelineId}/trigger`);
    } catch (error) {
      if (error instanceof ApiError && error.isNotFound) {
        return null;
      }
      throw new Error(parseApiErrorMessage(error as ApiError, '获取触发器失败'));
    }
  }

  static async deletePipelineTrigger(pipelineId: number): Promise<void> {
    try {
      await ApiClient.delete(`/pipeline/${pipelineId}/trigger`);
    } catch (error) {
      throw new Error(parseApiErrorMessage(error as ApiError, '删除触发器失败'));
    }
  }

  static async testPipelineTrigger(pipelineId: number): Promise<{
    source_table: string;
    watermark_field: string;
    current_max_value: string | null;
    last_watermark_value: string | null;
    has_new_data: boolean;
  }> {
    try {
      return await ApiClient.post<{
        source_table: string;
        watermark_field: string;
        current_max_value: string | null;
        last_watermark_value: string | null;
        has_new_data: boolean;
      }>(`/pipeline/${pipelineId}/trigger/test`);
    } catch (error) {
      throw new Error(parseApiErrorMessage(error as ApiError, '测试触发器失败'));
    }
  }
}
