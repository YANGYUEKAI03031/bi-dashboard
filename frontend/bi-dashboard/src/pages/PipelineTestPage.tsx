// frontend/bi-dashboard/src/pages/PipelineTestPage.tsx
import React, { useState, useEffect, useMemo } from 'react';
import {
  Card, Button, Table, Modal, Form, Input, Select, Space, Tag, message,
  Popconfirm, Drawer, Descriptions, Tabs, Divider, Alert
} from 'antd';
import {
  PlusOutlined, PlayCircleOutlined, DeleteOutlined, EyeOutlined,
  ReloadOutlined, CheckCircleOutlined, CloseCircleOutlined, SyncOutlined,
  ClockCircleOutlined, EditOutlined
} from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import { PipelineService, PipelineResponse, ExecutionResponse, PipelineNode } from '../services/pipelineService';
import { DataSourceService } from '../services/dataSourceService';
import { PipelineFlowEditor } from '../components/pipeline/PipelineFlowEditor';
import { GraphEdge } from '../utils/graphUtils';

interface DataSource {
  id: string;
  name: string;
  type: string;
}

const { TextArea } = Input;
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
  const [editorEdges, setEditorEdges] = useState<GraphEdge[]>([]);
  const [editingPipelineId, setEditingPipelineId] = useState<number | null>(null);
  const [form] = Form.useForm();
  const [runForm] = Form.useForm();
  const watchedPipelineSourceId = Form.useWatch('source_data_source_id', form);

  /** 与数据源管理页一致：列表按 ID 升序，首条为系统默认库；管道仅允许选其余业务库 */
  const pipelineDataSources = useMemo(() => {
    if (dataSources.length <= 1) return [];
    return dataSources.slice(1);
  }, [dataSources]);

  const showLegacySourceOption = useMemo(() => {
    if (!editingPipelineId || !selectedPipeline) return false;
    return !pipelineDataSources.some(ds => parseInt(ds.id, 10) === selectedPipeline.source_data_source_id);
  }, [editingPipelineId, selectedPipeline, pipelineDataSources]);

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

  const handleCreatePipeline = async (values: any) => {
    try {
      if (editorNodes.length === 0) {
        message.error('请至少配置一个节点');
        return;
      }
      await PipelineService.createPipeline({
        name: values.name,
        description: values.description,
        source_data_source_id: parseInt(values.source_data_source_id),
        nodes: editorNodes,
        is_public: false,
      });
      message.success('管道创建成功');
      setCreateModalVisible(false);
      setEditorNodes([]);
      setEditorEdges([]);
      form.resetFields();
      loadPipelines();
    } catch (error: any) {
      message.error(error.message || '创建管道失败');
    }
  };

  const handleEditorSave = (nodes: PipelineNode[], edges: GraphEdge[]) => {
    setEditorNodes(nodes);
    setEditorEdges(edges);
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

  const loadExecutions = async (pipelineId: number) => {
    try {
      const res = await PipelineService.getPipelineExecutions(pipelineId, 0, 20);
      setExecutions(res.items);
    } catch (error: any) {
      message.error(error.message || '加载执行记录失败');
    }
  };

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
      width: 200,
      render: (_, record) => (
        <Space>
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
          <Popconfirm
            title="确定要删除此管道吗？"
            onConfirm={() => handleDeletePipeline(record.id)}
            okText="删除"
            cancelText="取消"
            okButtonProps={{ danger: true }}
          >
            <Button danger icon={<DeleteOutlined />} size="small">
              删除
            </Button>
          </Popconfirm>
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
              setEditorEdges([]);
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
          setEditorEdges([]);
          setEditingPipelineId(null);
          form.resetFields();
        }}
        footer={null}
        width={1100}
        style={{ top: 20 }}
        bodyStyle={{ padding: 0, height: '70vh' }}
      >
        <Form form={form} layout="vertical" style={{ padding: '16px 24px' }}>
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
            <Form.Item
              name="source_data_source_id"
              label="数据源（业务库）"
              extra="须选择除系统默认库以外的数据源；源节点将从该库选表生成查询。"
              rules={[{ required: true, message: '请选择业务数据源' }]}
              style={{ flex: 1, marginBottom: 0 }}
            >
              <Select
                placeholder={pipelineDataSources.length ? '请选择业务数据源' : '请先在数据源管理中新增业务库'}
                disabled={!pipelineDataSources.length && !showLegacySourceOption}
                notFoundContent={pipelineDataSources.length ? undefined : '暂无可用业务数据源'}
              >
                {pipelineDataSources.map(ds => (
                  <Select.Option key={ds.id} value={parseInt(ds.id, 10)}>
                    {ds.name} ({ds.type})
                  </Select.Option>
                ))}
                {showLegacySourceOption && selectedPipeline && (
                  <Select.Option value={selectedPipeline.source_data_source_id}>
                    当前绑定 #{selectedPipeline.source_data_source_id}（请尽快改为业务库）
                  </Select.Option>
                )}
              </Select>
            </Form.Item>
          </Space>
        </Form>
        <div style={{ height: 'calc(70vh - 140px)', borderTop: '1px solid #e8e8e8' }}>
          <PipelineFlowEditor
            nodes={editorNodes}
            pipelineDataSourceId={watchedPipelineSourceId}
            onSave={handleEditorSave}
            onCancel={() => {
              setCreateModalVisible(false);
              setEditorNodes([]);
              setEditorEdges([]);
              setEditingPipelineId(null);
              form.resetFields();
            }}
          />
        </div>
        <div style={{ padding: '12px 24px', borderTop: '1px solid #e8e8e8', textAlign: 'right' }}>
          <Space>
            <Button
              onClick={() => {
                setCreateModalVisible(false);
                setEditorNodes([]);
                setEditorEdges([]);
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
                if (!values.source_data_source_id) {
                  message.error('请选择业务数据源');
                  return;
                }
                if (!pipelineDataSources.length && !editingPipelineId) {
                  message.error('请先在数据源管理中配置至少一个业务数据源（除默认库外）');
                  return;
                }
                if (editorNodes.length === 0) {
                  message.error('请至少添加一个节点');
                  return;
                }
                try {
                  if (editingPipelineId) {
                    await PipelineService.updatePipeline(editingPipelineId, {
                      name: values.name,
                      description: values.description,
                      nodes: editorNodes,
                    });
                    message.success('管道更新成功');
                    setCreateModalVisible(false);
                    setEditorNodes([]);
                    setEditorEdges([]);
                    setEditingPipelineId(null);
                    form.resetFields();
                    loadPipelines();
                    setDetailDrawerVisible(false);
                  } else {
                    await PipelineService.createPipeline({
                      name: values.name,
                      description: values.description,
                      source_data_source_id: parseInt(values.source_data_source_id),
                      nodes: editorNodes,
                      is_public: false,
                    });
                    message.success('管道创建成功');
                    setCreateModalVisible(false);
                    setEditorNodes([]);
                    setEditorEdges([]);
                    form.resetFields();
                    loadPipelines();
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
            <Button
              icon={<EditOutlined />}
              onClick={() => {
                if (selectedPipeline) {
                  form.setFieldsValue({
                    name: selectedPipeline.name,
                    description: selectedPipeline.description,
                    source_data_source_id: selectedPipeline.source_data_source_id,
                  });
                  setEditingPipelineId(selectedPipeline.id);
                  setEditorNodes(selectedPipeline.nodes || []);
                  setEditorEdges([]);
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
                />
              ) : (
                <Alert message="暂无执行记录，请点击「运行」按钮执行管道。" type="info" showIcon />
              )}
            </TabPane>
            {selectedExecution && selectedExecution.status === 'completed' && (
              <TabPane tab="执行日志" key="logs">
                <pre style={{ maxHeight: 500, overflow: 'auto', background: '#f5f5f5', padding: 12, borderRadius: 4, fontSize: 12 }}>
                  {JSON.stringify(selectedExecution.logs, null, 2)}
                </pre>
                {selectedExecution.result_summary && (
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
