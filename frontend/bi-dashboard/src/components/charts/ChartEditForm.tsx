// e:\bi-dashboard\frontend\bi-dashboard\src\components\charts\ChartEditForm.tsx
import React, { useState } from 'react';
import { Form, Input, Select, Button, Space, message } from 'antd';
// ChartData 类型定义
interface ChartData {
  id?: number;
  name: string;
  chart_type: string;
  dataset_query: any;
  visualization_settings: any;
  database_id: number;
  creator_id?: number;
}

const { Option } = Select;

interface ChartEditFormProps {
  chart: ChartData;
  onEdit: (updatedData: Partial<ChartData>) => void;
  onCancel: () => void;
}

export const ChartEditForm: React.FC<ChartEditFormProps> = ({ chart, onEdit, onCancel }) => {
  const [form] = Form.useForm();
  
  // 初始化表单数据
  const initialValues = {
    name: chart.name,
    chart_type: chart.chart_type,
    database_id: chart.database_id.toString(),
  };

  const handleFinish = (values: any) => {
    const updatedData: Partial<ChartData> = {
      name: values.name,
      chart_type: values.chart_type,
      database_id: parseInt(values.database_id, 10),
    };
    
    onEdit(updatedData);
  };

  const handleCancel = () => {
    form.resetFields();
    onCancel();
  };

  return (
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
          <Button onClick={handleCancel}>
            取消
          </Button>
        </Space>
      </Form.Item>
    </Form>
  );
};

export default ChartEditForm;