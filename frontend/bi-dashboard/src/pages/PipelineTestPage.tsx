// frontend/bi-dashboard/src/pages/PipelineTestPage.tsx
import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import {
  Card, Button, Table, Modal, Form, Input, Space, Tag, message,
  Popconfirm, Drawer, Descriptions, Tabs, Divider, Alert, Tooltip,
} from 'antd';
import {
  PlusOutlined, PlayCircleOutlined, DeleteOutlined, EyeOutlined,
  ReloadOutlined, CheckCircleOutlined, CloseCircleOutlined, SyncOutlined,
  ClockCircleOutlined, EditOutlined
} from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import { PipelineService, PipelineResponse, ExecutionResponse, PipelineNode } from '../services/pipelineService';
import { DataSourceService } from '../services/dataSourceService';
import { PipelineFlowEditor, PipelineFlowEditorHandle } from '../components/pipeline/PipelineFlowEditor';
import {
  getFirstSourceDataSourceId,
  hydrateSourceNodesWithPipelineDataSource,
} from '../utils/pipelineDataSourceUtils';

/**
 * 从节点列表中提取第一个启用了自动触发的源节点配置
 * 返回触发器配置，如果没有启用自动触发的节点则返回 null
 */
function extractTriggerConfig(nodes: PipelineNode[]): {
  source_table: string;
  watermark_field: string;
  poll_interval_seconds: number;
  enabled: boolean;
} | null {
  // 找到第一个 type 为 source 且启用了 autoTriggerEnabled 的节点
  const sourceNode = nodes.find(
    (n) => n.type === 'source' && n.config?.autoTriggerEnabled
  );
  if (!sourceNode) return null;

  const tableName = sourceNode.config?.tableName;
  const watermarkField = sourceNode.config?.triggerWatermarkField;

  if (!tableName || !watermarkField) return null;

  return {
    source_table: tableName,
    watermark_field: watermarkField,
    poll_interval_seconds: sourceNode.config?.pollIntervalSeconds || 300,
    enabled: true,
  };
}

interface DataSource {
  id: string;
  name: string;
  type: string;
}

const { TabPane } = Tabs;

const statusColors: Record<string, string> = {
  pending: 'orange',
  running: 'blue',
  completed: 'green',
  failed: 'red',
  cancelled: 'default',
  expired: 'default',
};

const statusIcons: Record<string, React.ReactNode> = {
  pending: <ClockCircleOutlined />,
  running: <SyncOutlined spin />,
  completed: <CheckCircleOutlined />,
  failed: <CloseCircleOutlined />,
  cancelled: <ClockCircleOutlined />,
  expired: <ClockCircleOutlined />,
};

export const PipelineTestPage: React.FC = () => {
  const [pipelines, setPipelines] = useState<PipelineResponse[]>([]);
  const [loading, setLoading] = useState(false);
  const [createModalVisible, setCreateModalVisible] = useState(false);
  const [runModalVisible, setRunModalVisible] = useState(false);
  const [detailDrawerVisible, setDetailDrawerVisible] = useState(false);
  const [previewDrawerVisible, setPreviewDrawerVisible] = useState(false);
  const [selectedPipeline, setSelectedPipeline] = useState<PipelineResponse | null>(null);
  const [selectedExecution, setSelectedExecution] = useState<ExecutionResponse | null>(null);
  const [executions, setExecutions] = useState<ExecutionResponse[]>([]);
  const [dataSources, setDataSources] = useState<DataSource[]>([]);
  const [previewData, setPreviewData] = useState<{ columns: string[]; rows: any[] }>({ columns: [], rows: [] });
  const [previewLoading, setPreviewLoading] = useState(false);
  const [running, setRunning] = useState<number | null>(null);
  const [editorNodes, setEditorNodes] = useState<PipelineNode[]>([]);
  const [editingPipelineId, setEditingPipelineId] = useState<number | null>(null);
  const [form] = Form.useForm();
  const [runForm] = Form.useForm();
  /** 拉取画布当前节点（弹窗「创建/保存」时与工具栏「保存」一致，避免父 state 未同步） */
  const flowEditorRef = useRef<PipelineFlowEditorHandle>(null);

  /** 与数据源管理页一致：多库时首条为系统默认，管道选其余业务库；仅有一个库时可用该库 */
  const pipelineDataSources = useMemo(() => {
    if (dataSources.length === 0) return [];
    if (dataSources.length === 1) return dataSources;
    return dataSources.slice(1);
  }, [dataSources]);

  /** 从图中源节点 config 解析管道级数据源 ID（用于预览回退等） */
  const pipelineDsFromNodes = useMemo(
    () => getFirstSourceDataSourceId(editorNodes),
    [editorNodes]
  );

  useEffect(() => {
    loadPipelines();
    loadDataSources();
  }, []);

  const loadPipelines = async () => {
    setLoading(true);
    try {
      const res = await PipelineService.getPipelines(0, 100);
      setPipelines(res.items);
    } catch (error: any) {
      message.error(error.message || '加载管道列表失败');
    } finally {
      setLoading(false);
    }
  };

  const loadDataSources = async () => {
    try {
      const res = await DataSourceService.getDataSources();
      setDataSources(res);
    } catch (error: any) {
      message.error(error.message || '加载数据源列表失败');
    }
  };

  const handleEditorSave = (nodes: PipelineNode[], _edges: import('../utils/graphUtils').GraphEdge[]) => {
    setEditorNodes(nodes);
  };

  const handleDeletePipeline = async (pipelineId: number) => {
    try {
      await PipelineService.deletePipeline(pipelineId);
      message.success('管道删除成功');
      loadPipelines();
    } catch (error: any) {
      message.error(error.message || '删除管道失败');
    }
  };

  const handleRunPipeline = async (pipelineId: number) => {
    setRunning(pipelineId);
    try {
      const res = await PipelineService.runPipeline(pipelineId);
      message.success(res.message);
      setRunModalVisible(false);
      runForm.resetFields();
      // 刷新执行记录
      if (selectedPipeline?.id === pipelineId) {
        loadExecutions(pipelineId);
      }
    } catch (error: any) {
      message.error(error.message || '触发管道运行失败');
    } finally {
      setRunning(null);
    }
  };

  /** 当 detailDrawerVisible 打开时，每 2 秒轮询一次执行列表（便于 running 时看到实时进度） */
  useEffect(() => {
    if (!detailDrawerVisible || !selectedPipeline) return;
    const pid = selectedPipeline.id;
    const id = window.setInterval(() => {
      void loadExecutions(pid);
    }, 2000);
    return () => clearInterval(id);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detailDrawerVisible, selectedPipeline]);

  const loadExecutions = useCallback(async (pipelineId: number) => {
    try {
      const res = await PipelineService.getPipelineExecutions(pipelineId, 0, 20);
      setExecutions(res.items);
      // 同时更新当前选中执行记录的实时状态（running 时需要刷新）
      setSelectedExecution((prev) => {
        if (!prev) return prev;
        const updated = res.items.find((e) => e.id === prev.id);
        return updated ?? prev;
      });
    } catch (error: any) {
      message.error(error.message || '加载执行记录失败');
    }
  }, []);

  const openDetailDrawer = async (pipeline: PipelineResponse) => {
    setSelectedPipeline(pipeline);
    setDetailDrawerVisible(true);
    await loadExecutions(pipeline.id);
    // 加载最新执行记录
    try {
      const latest = await PipelineService.getLatestExecution(pipeline.id);
      setSelectedExecution(latest);
    } catch {
      setSelectedExecution(null);
    }
  };

  const openPreviewDrawer = async (pipeline: PipelineResponse, execution: ExecutionResponse) => {
    setSelectedPipeline(pipeline);
    setSelectedExecution(execution);
    setPreviewDrawerVisible(true);
    // 自动加载第一个步骤预览
    if (execution.completed_steps.length > 0) {
      const firstStep = execution.completed_steps[0];
      await loadStepPreview(pipeline.id, firstStep.step_id);
    }
  };

  const loadStepPreview = async (pipelineId: number, stepId: string) => {
    setPreviewLoading(true);
    try {
      const res = await PipelineService.previewStep(pipelineId, stepId);
      setPreviewData({ columns: res.columns, rows: res.rows });
    } catch (error: any) {
      message.error(error.message || '加载预览数据失败');
      setPreviewData({ columns: [], rows: [] });
    } finally {
      setPreviewLoading(false);
    }
  };

  const pipelineColumns: ColumnsType<PipelineResponse> = [
    { title: 'ID', dataIndex: 'id', key: 'id', width: 60 },
    { title: '名称', dataIndex: 'name', key: 'name' },
    { title: '描述', dataIndex: 'description', key: 'description', ellipsis: true },
    {
      title: '节点数',
      key: 'nodes_count',
      width: 80,
      render: (_, record) => record.nodes?.length || 0,
    },
    {
      title: '状态',
      key: 'is_active',
      width: 80,
      render: (_, record) => (
        <Tag color={record.is_active ? 'green' : 'default'}>
          {record.is_active ? '启用' : '禁用'}
        </Tag>
      ),
    },
    {
      title: '创建时间',
      dataIndex: 'created_at',
      key: 'created_at',
      width: 180,
      render: (text) => new Date(text).toLocaleString('zh-CN'),
    },
    {
      title: '操作',
      key: 'actions',
      width: 160,
      render: (_, record) => (
        <Space size="small">
          <Button
            type="primary"
            icon={<PlayCircleOutlined />}
            size="small"
            onClick={() => {
              setSelectedPipeline(record);
              setRunModalVisible(true);
            }}
            loading={running === record.id}
          >
            运行
          </Button>
          <Button
            icon={<EyeOutlined />}
            size="small"
            onClick={() => openDetailDrawer(record)}
          >
            详情
          </Button>
        </Space>
      ),
    },
  ];

  const executionColumns: ColumnsType<ExecutionResponse> = [
    { title: 'ID', dataIndex: 'id', key: 'id', width: 60 },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 100,
      render: (status: string) => (
        <Tag color={statusColors[status] || 'default'} icon={statusIcons[status]}>
          {status}
        </Tag>
      ),
    },
    // running / pending 时显示当前步骤 + 行数提示
    {
      title: '进度',
      key: 'live_progress',
      width: 180,
      render: (_: unknown, record: ExecutionResponse) => {
        if (record.status !== 'running' && record.status !== 'pending') return '—';
        const sid = record.current_step_id;
        const rows = record.current_step_rows ?? 0;
        const hint = sid && record.step_progress?.[sid]?.phase_message;
        if (sid && rows > 0) return `${sid} · 已写入 ${rows} 行`;
        if (hint) return `${sid ?? ''} · ${hint}`;
        return sid ? `${sid} · 查询中…` : '排队中…';
      },
    },
    {
      title: '错误原因',
      dataIndex: 'error_message',
      key: 'error_message',
      ellipsis: true,
      render: (text: string | undefined, record) => {
        if (!text) return record.status === 'failed' ? '（无详情）' : '-';
        const short = text.length > 80 ? `${text.slice(0, 80)}…` : text;
        return (
          <Tooltip title={<pre style={{ margin: 0, whiteSpace: 'pre-wrap', maxWidth: 480 }}>{text}</pre>}>
            <span style={{ color: '#cf1322', cursor: 'help' }}>{short}</span>
          </Tooltip>
        );
      },
    },
    { title: '行数', dataIndex: 'total_rows', key: 'total_rows', width: 80 },
    {
      title: '耗时',
      dataIndex: 'execution_time_ms',
      key: 'execution_time_ms',
      width: 100,
      render: (ms?: number) => ms ? `${(ms / 1000).toFixed(2)}s` : '-',
    },
    {
      title: '开始时间',
      dataIndex: 'started_at',
      key: 'started_at',
      width: 180,
      render: (text) => text ? new Date(text).toLocaleString('zh-CN') : '-',
    },
    {
      title: '完成时间',
      dataIndex: 'completed_at',
      key: 'completed_at',
      width: 180,
      render: (text) => text ? new Date(text).toLocaleString('zh-CN') : '-',
    },
    {
      title: '操作',
      key: 'actions',
      width: 120,
      render: (_, record) => (
        <Space>
          {record.status === 'completed' && (
            <Button
              size="small"
              onClick={() => selectedPipeline && openPreviewDrawer(selectedPipeline, record)}
            >
              预览
            </Button>
          )}
          {record.status === 'running' && (
            <Popconfirm
              title="确定要取消执行吗？"
              onConfirm={async () => {
                try {
                  await PipelineService.cancelExecution(record.id);
                  message.success('执行已取消');
                  loadExecutions(record.pipeline_id);
                } catch (error: any) {
                  message.error(error.message || '取消失败');
                }
              }}
              okText="确定"
              cancelText="取消"
            >
              <Button danger size="small">取消</Button>
            </Popconfirm>
          )}
        </Space>
      ),
    },
  ];

  return (
    <div style={{ padding: 24 }}>
      <Card
        title="数据管道测试"
        extra={
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={() => {
              setEditingPipelineId(null);
              form.resetFields();
              setEditorNodes([]);
              setCreateModalVisible(true);
            }}
          >
            创建管道
          </Button>
        }
      >
        <Table
          columns={pipelineColumns}
          dataSource={pipelines}
          rowKey="id"
          loading={loading}
          pagination={{ pageSize: 10 }}
        />
      </Card>

      {/* 创建/编辑管道弹窗 */}
      <Modal
        title={editingPipelineId ? '编辑管道' : '创建管道'}
        open={createModalVisible}
        onCancel={() => {
          setCreateModalVisible(false);
          setEditorNodes([]);
          setEditingPipelineId(null);
          form.resetFields();
        }}
        footer={null}
        width="min(1400px, 96vw)"
        style={{ top: 12, paddingBottom: 0 }}
        styles={{ body: { padding: 0, height: 'min(92vh, calc(100vh - 64px))', display: 'flex', flexDirection: 'column', overflow: 'hidden' } }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, flex: 1 }}>
          <Form form={form} layout="vertical" style={{ padding: '16px 24px', flexShrink: 0 }}>
          <Space style={{ width: '100%', marginBottom: 12 }} size="large">
            <Form.Item
              name="name"
              label="管道名称"
              rules={[{ required: true, message: '请输入管道名称' }]}
              style={{ flex: 1, marginBottom: 0 }}
            >
              <Input placeholder="请输入管道名称" />
            </Form.Item>
            <Form.Item
              name="description"
              label="描述"
              style={{ flex: 1, marginBottom: 0 }}
            >
              <Input placeholder="请输入描述（可选）" />
            </Form.Item>
          </Space>
          </Form>
        <div
          style={{
            flex: 1,
            minHeight: 0,
            borderTop: '1px solid #e8e8e8',
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
          }}
        >
          <PipelineFlowEditor
            key={editingPipelineId ?? 'new'}
            ref={flowEditorRef}
            nodes={editorNodes}
            pipelineDataSourceId={pipelineDsFromNodes ?? undefined}
            onSave={handleEditorSave}
            onCancel={() => {
              setCreateModalVisible(false);
              setEditorNodes([]);
              setEditingPipelineId(null);
              form.resetFields();
            }}
          />
        </div>
        <div style={{ padding: '12px 24px', borderTop: '1px solid #e8e8e8', textAlign: 'right', flexShrink: 0, background: '#fff' }}>
          <Space>
            <Button
              onClick={() => {
                setCreateModalVisible(false);
                setEditorNodes([]);
                setEditingPipelineId(null);
                form.resetFields();
              }}
            >
              取消
            </Button>
            <Button
              type="primary"
              onClick={async () => {
                const values = form.getFieldsValue();
                if (!values.name) {
                  message.error('请输入管道名称');
                  return;
                }
                if (!pipelineDataSources.length && !editingPipelineId) {
                  message.error('请先在数据源管理中配置至少一个数据源');
                  return;
                }
                const snap = flowEditorRef.current?.getPipelineSnapshot();
                const nodesPayload = snap?.nodes ?? editorNodes;
                if (nodesPayload.length === 0) {
                  message.error('请至少添加一个节点');
                  return;
                }
                const pipelineDsId = getFirstSourceDataSourceId(nodesPayload);
                if (pipelineDsId == null) {
                  message.error('请在数据源节点中选择业务数据源（业务库）');
                  return;
                }

                // 提取触发器配置
                const triggerConfig = extractTriggerConfig(nodesPayload);

                try {
                  let savedPipeline: PipelineResponse;

                  if (editingPipelineId) {
                    await PipelineService.updatePipeline(editingPipelineId, {
                      name: values.name,
                      description: values.description,
                      nodes: nodesPayload,
                      source_data_source_id: pipelineDsId,
                    });
                    savedPipeline = await PipelineService.getPipeline(editingPipelineId);
                    message.success('管道更新成功');
                  } else {
                    savedPipeline = await PipelineService.createPipeline({
                      name: values.name,
                      description: values.description,
                      source_data_source_id: pipelineDsId,
                      nodes: nodesPayload,
                      is_public: false,
                    });
                    message.success('管道创建成功');
                  }

                  // 同步触发器配置到数据库
                  if (triggerConfig) {
                    try {
                      await PipelineService.savePipelineTrigger(savedPipeline.id, triggerConfig);
                      message.info('触发器配置已同步');
                    } catch (triggerErr: any) {
                      console.error('触发器同步失败:', triggerErr);
                      message.warning('触发器配置同步失败: ' + triggerErr.message);
                    }
                  } else {
                    // 如果之前有触发器配置但现在没有启用，则删除
                    try {
                      const existingTrigger = await PipelineService.getPipelineTrigger(savedPipeline.id);
                      if (existingTrigger) {
                        await PipelineService.deletePipelineTrigger(savedPipeline.id);
                      }
                    } catch {
                      // 忽略删除失败的错误
                    }
                  }

                  setCreateModalVisible(false);
                  setEditorNodes([]);
                  setEditingPipelineId(null);
                  form.resetFields();
                  loadPipelines();
                  if (editingPipelineId) {
                    setDetailDrawerVisible(false);
                  }
                } catch (error: any) {
                  message.error(error.message || (editingPipelineId ? '更新管道失败' : '创建管道失败'));
                }
              }}
            >
              {editingPipelineId ? '保存更新' : '创建'}
            </Button>
          </Space>
        </div>
        </div>
      </Modal>

      {/* 运行确认弹窗 */}
      <Modal
        title="运行管道"
        open={runModalVisible}
        onCancel={() => { setRunModalVisible(false); runForm.resetFields(); }}
        footer={null}
      >
        {selectedPipeline && (
          <div>
            <Alert
              message={`确定要运行管道 "${selectedPipeline.name}" 吗？`}
              description="管道将在后台异步执行，执行结果可在详情页查看。"
              type="info"
              showIcon
              style={{ marginBottom: 16 }}
            />
            <Space style={{ width: '100%', justifyContent: 'flex-end' }}>
              <Button onClick={() => { setRunModalVisible(false); runForm.resetFields(); }}>取消</Button>
              <Button
                type="primary"
                icon={<PlayCircleOutlined />}
                loading={running === selectedPipeline.id}
                onClick={() => handleRunPipeline(selectedPipeline.id)}
              >
                确认运行
              </Button>
            </Space>
          </div>
        )}
      </Modal>

      {/* 详情抽屉 */}
      <Drawer
        title="管道详情"
        placement="right"
        width={800}
        onClose={() => setDetailDrawerVisible(false)}
        open={detailDrawerVisible}
        extra={
          <Space>
            <Popconfirm
              title="确定要删除此管道吗？"
              onConfirm={async () => {
                if (selectedPipeline) {
                  await handleDeletePipeline(selectedPipeline.id);
                  setDetailDrawerVisible(false);
                }
              }}
              okText="删除"
              cancelText="取消"
              okButtonProps={{ danger: true }}
            >
              <Button danger icon={<DeleteOutlined />}>
                删除
              </Button>
            </Popconfirm>
            <Button
              icon={<EditOutlined />}
              onClick={() => {
                if (selectedPipeline) {
                  form.setFieldsValue({
                    name: selectedPipeline.name,
                    description: selectedPipeline.description,
                  });
                  setEditingPipelineId(selectedPipeline.id);
                  setEditorNodes(
                    hydrateSourceNodesWithPipelineDataSource(
                      selectedPipeline.nodes || [],
                      selectedPipeline.source_data_source_id
                    )
                  );
                  setDetailDrawerVisible(false);
                  setCreateModalVisible(true);
                }
              }}
            >
              编辑
            </Button>
            <Button
              type="primary"
              icon={<PlayCircleOutlined />}
              loading={running === selectedPipeline?.id}
              onClick={() => selectedPipeline && handleRunPipeline(selectedPipeline.id)}
            >
              运行
            </Button>
          </Space>
        }
      >
        {selectedPipeline && (
          <Tabs defaultActiveKey="info">
            <TabPane tab="基本信息" key="info">
              <Descriptions column={2} bordered size="small">
                <Descriptions.Item label="ID">{selectedPipeline.id}</Descriptions.Item>
                <Descriptions.Item label="名称">{selectedPipeline.name}</Descriptions.Item>
                <Descriptions.Item label="描述" span={2}>{selectedPipeline.description || '-'}</Descriptions.Item>
                <Descriptions.Item label="数据源ID">{selectedPipeline.source_data_source_id}</Descriptions.Item>
                <Descriptions.Item label="节点数">{selectedPipeline.nodes?.length || 0}</Descriptions.Item>
                <Descriptions.Item label="状态">
                  <Tag color={selectedPipeline.is_active ? 'green' : 'default'}>
                    {selectedPipeline.is_active ? '启用' : '禁用'}
                  </Tag>
                </Descriptions.Item>
                <Descriptions.Item label="公开">
                  <Tag color={selectedPipeline.is_public ? 'blue' : 'default'}>
                    {selectedPipeline.is_public ? '是' : '否'}
                  </Tag>
                </Descriptions.Item>
                <Descriptions.Item label="创建时间" span={2}>
                  {new Date(selectedPipeline.created_at).toLocaleString('zh-CN')}
                </Descriptions.Item>
                <Descriptions.Item label="更新时间" span={2}>
                  {new Date(selectedPipeline.updated_at).toLocaleString('zh-CN')}
                </Descriptions.Item>
                <Descriptions.Item label="节点配置" span={2}>
                  <pre style={{ maxHeight: 300, overflow: 'auto', background: '#f5f5f5', padding: 8, borderRadius: 4 }}>
                    {JSON.stringify(selectedPipeline.nodes, null, 2)}
                  </pre>
                </Descriptions.Item>
              </Descriptions>
            </TabPane>
            <TabPane tab="执行历史" key="executions">
              {executions.length > 0 ? (
                <Table
                  columns={executionColumns}
                  dataSource={executions}
                  rowKey="id"
                  size="small"
                  pagination={{ pageSize: 5 }}
                  onRow={(record) => ({
                    onClick: () => setSelectedExecution(record),
                    style: {
                      cursor: 'pointer',
                      ...(selectedExecution?.id === record.id
                        ? { background: '#e6f4ff' }
                        : {}),
                    },
                  })}
                />
              ) : (
                <Alert message="暂无执行记录，请点击「运行」按钮执行管道。" type="info" showIcon />
              )}
            </TabPane>
            {selectedExecution &&
              (selectedExecution.status === 'completed' ||
                selectedExecution.status === 'failed' ||
                selectedExecution.status === 'running' ||
                selectedExecution.status === 'pending') && (
              <TabPane tab="执行详情" key="logs">
                {(selectedExecution.status === 'running' || selectedExecution.status === 'pending') && (
                  <>
                    <Alert
                      type="info"
                      message="执行进行中（每 2 秒自动刷新）"
                      description={
                        <span>
                          当前步骤：<b>{selectedExecution.current_step_id ?? '—'}</b>
                          {' '}，已写入行数：<b>{selectedExecution.current_step_rows ?? 0}</b>
                          {' '}。
                          若长期停在此页面且无行数变化，说明 SQL 查询耗时较长（大数据量 / 缺少索引 / 网络延迟）。
                        </span>
                      }
                      showIcon
                      style={{ marginBottom: 16 }}
                    />
                    <Descriptions column={1} bordered size="small" style={{ marginBottom: 12 }}>
                      <Descriptions.Item label="当前步骤">{selectedExecution.current_step_id ?? '—'}</Descriptions.Item>
                      <Descriptions.Item label="已写入行数">{selectedExecution.current_step_rows ?? 0}</Descriptions.Item>
                      <Descriptions.Item label="阶段">
                        {(() => {
                          const sid = selectedExecution.current_step_id;
                          const sp = sid ? selectedExecution.step_progress?.[sid] : undefined;
                          return sp?.phase_message || (sp?.rows && sp.rows > 0 ? '正在分批写入临时表' : 'SQL 查询中（请耐心等待）');
                        })()}
                      </Descriptions.Item>
                    </Descriptions>
                    <Divider plain>各步骤进度（实时）</Divider>
                    <pre style={{ maxHeight: 240, overflow: 'auto', background: '#f5f5f5', padding: 12, borderRadius: 4, fontSize: 12 }}>
                      {JSON.stringify(selectedExecution.step_progress ?? {}, null, 2)}
                    </pre>
                  </>
                )}
                {selectedExecution.status === 'failed' && (
                  <Alert
                    type="error"
                    message="执行失败"
                    description={
                      <pre
                        style={{
                          margin: 0,
                          whiteSpace: 'pre-wrap',
                          wordBreak: 'break-word',
                          fontSize: 12,
                        }}
                      >
                        {selectedExecution.error_message || '未记录具体错误信息，请查看下方日志。'}
                      </pre>
                    }
                    showIcon
                    style={{ marginBottom: 16 }}
                  />
                )}
                <Divider plain>
                  日志
                </Divider>
                <pre
                  style={{
                    maxHeight: 500,
                    overflow: 'auto',
                    background: '#f5f5f5',
                    padding: 12,
                    borderRadius: 4,
                    fontSize: 12,
                  }}
                >
                  {JSON.stringify(selectedExecution.logs ?? [], null, 2)}
                </pre>
                {selectedExecution.status === 'completed' && selectedExecution.result_summary && (
                  <>
                    <Divider>结果摘要</Divider>
                    <pre style={{ background: '#f5f5f5', padding: 12, borderRadius: 4, fontSize: 12 }}>
                      {JSON.stringify(selectedExecution.result_summary, null, 2)}
                    </pre>
                  </>
                )}
              </TabPane>
            )}
          </Tabs>
        )}
      </Drawer>

      {/* 预览抽屉 */}
      <Drawer
        title="步骤预览"
        placement="right"
        width={900}
        onClose={() => setPreviewDrawerVisible(false)}
        open={previewDrawerVisible}
        extra={
          <Button icon={<ReloadOutlined />} onClick={() => {
            if (selectedExecution?.completed_steps.length) {
              loadStepPreview(selectedPipeline!.id, selectedExecution.completed_steps[0].step_id);
            }
          }}>
            刷新
          </Button>
        }
      >
        {selectedExecution && selectedExecution.completed_steps.length > 0 && (
          <Tabs
            defaultActiveKey={selectedExecution.completed_steps[0]?.step_id}
            onChange={(activeKey) => selectedPipeline && loadStepPreview(selectedPipeline.id, activeKey)}
          >
            {selectedExecution.completed_steps.map((step) => (
              <TabPane tab={step.step_name || step.step_id} key={step.step_id}>
                <div style={{ marginBottom: 8 }}>
                  <Tag>总行数: {step.rows || 0}</Tag>
                </div>
                <Table
                  dataSource={previewData.rows}
                  columns={previewData.columns.map(col => ({ title: col, dataIndex: col, key: col }))}
                  loading={previewLoading}
                  rowKey={(_, index) => index?.toString() || '0'}
                  size="small"
                  scroll={{ x: 'max-content' }}
                  pagination={{ pageSize: 20, showSizeChanger: true }}
                />
              </TabPane>
            ))}
          </Tabs>
        )}
      </Drawer>
    </div>
  );
};
