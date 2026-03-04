// e:\bi-dashboard\frontend\bi-dashboard\src\components\charts\ChartEditModal.tsx
import React, { useState, useEffect } from 'react';
import { Modal, Form, Input, Select, Button, Space, message, Spin } from 'antd';
import { ChartFactory } from './ChartFactory';

const { Option } = Select;

interface ChartData {
  id?: number;
  name: string;
  chart_type: string;
  dataset_query: any;
  visualization_settings: any;
  database_id: number;
  creator_id?: number;
}

interface ChartEditModalProps {
  chart: ChartData;
  visible: boolean;
  onEdit: (updatedData: Partial<ChartData>) => void;
  onCancel: () => void;
}

export const ChartEditModal: React.FC<ChartEditModalProps> = ({ 
  chart, 
  visible, 
  onEdit, 
  onCancel 
}) => {
  const [form] = Form.useForm();
  const [previewData, setPreviewData] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  // 初始化表单数据
  const initialValues = {
    name: chart.name,
    chart_type: chart.chart_type,
    database_id: chart.database_id.toString(),
  };

  // 模拟数据预览
  useEffect(() => {
    if (visible) {
      const mockData = [
        { category: 'A', value1: 10, value2: 20 },
        { category: 'B', value1: 15, value2: 25 },
        { category: 'C', value1: 20, value2: 30 },
        { category: 'D', value1: 25, value2: 35 },
      ];
      setPreviewData(mockData);
    }
  }, [visible]);

  const handleFinish = (values: any) => {
    const updatedData: Partial<ChartData> = {
      name: values.name,
      chart_type: values.chart_type,
      database_id: parseInt(values.database_id, 10),
    };
    
    onEdit(updatedData);
  };

  // 构建图表配置
  const getChartConfig = () => {
    return {
      type: chart.chart_type,
      xField: 'category',
      yFields: ['value1'],
      // 示例预览中默认使用求和聚合
      y_agg_method: 'sum' as const,
      title: chart.name,
      xAxis: { name: '类别' },
      yAxis: { name: '数值' },
      legend: { show: true },
      tooltip: { trigger: 'axis' },
      // 预览不再手写 grid，交给 ChartFactory 统一控制网格与居中布局
      series: [{
        data: previewData.map(item => item.value1),
        type: chart.chart_type,
        name: '数值1'
      }]
    };
  };

  return (
    <Modal
      title="编辑图表"
      open={visible}
      footer={null}
      onCancel={onCancel}
      width={900}
      destroyOnClose
    >
      <div style={{ display: 'flex', gap: 24 }}>
        {/* 左侧：配置表单 */}
        <div style={{ flex: 1, minWidth: 300 }}>
          <Form
            form={form}
            layout="vertical"
            initialValues={initialValues}
            onFinish={handleFinish}
            style={{ maxWidth: 600 }}
          >
            <Form.Item
              label="图表名称"
              name="name"
              rules={[{ required: true, message: '请输入图表名称' }]}
            >
              <Input placeholder="请输入图表名称" />
            </Form.Item>

            <Form.Item
              label="图表类型"
              name="chart_type"
              rules={[{ required: true, message: '请选择图表类型' }]}
            >
              <Select placeholder="请选择图表类型">
                <Option value="bar">柱状图</Option>
                <Option value="line">折线图</Option>
                <Option value="area">面积图</Option>
                <Option value="pie">饼图</Option>
                <Option value="scatter">散点图</Option>
              </Select>
            </Form.Item>

            <Form.Item
              label="数据源"
              name="database_id"
              rules={[{ required: true, message: '请选择数据源' }]}
            >
              <Select placeholder="请选择数据源">
                <Option value="1">数据库 #1</Option>
                <Option value="2">数据库 #2</Option>
                <Option value="3">数据库 #3</Option>
              </Select>
            </Form.Item>

            <Form.Item>
              <Space>
                <Button type="primary" htmlType="submit">
                  保存修改
                </Button>
                <Button onClick={onCancel}>
                  取消
                </Button>
              </Space>
            </Form.Item>
          </Form>
        </div>

        {/* 右侧：图表预览 */}
        <div style={{ flex: 1 }}>
          <h3>图表预览</h3>
          {loading ? (
            <div style={{ textAlign: 'center', padding: '40px' }}>
              <Spin size="large" />
            </div>
          ) : (
            <div style={{ height: 400, border: '1px solid #d9d9d9', borderRadius: '4px', padding: '10px' }}>
              <ChartFactory 
                config={getChartConfig()}
                data={previewData}
              />
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
};

export default ChartEditModal;