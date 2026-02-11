// frontend/bi-dashboard/src/components/charts/ChartConfigPanel.tsx
import React, { useState } from 'react';
import { Card, Form, Input, Select, Switch, Button, Space, Divider } from 'antd';
import { SaveOutlined, UndoOutlined } from '@ant-design/icons';

const { Option } = Select;

interface VisualizationSettings {
  "graph.dimensions"?: string[];
  "graph.metrics"?: string[];
  "graph.x_axis.title"?: string;
  "graph.y_axis.title"?: string;
  "graph.colors"?: string[];
  "graph.show_legend"?: boolean;
  "graph.legend_position"?: string;
}

interface ChartConfigPanelProps {
  initialSettings: VisualizationSettings;
  onSave: (settings: VisualizationSettings) => void;
  onCancel: () => void;
}

export const ChartConfigPanel: React.FC<ChartConfigPanelProps> = ({
  initialSettings,
  onSave,
  onCancel
}) => {
  const [form] = Form.useForm();
  const [settings, setSettings] = useState<VisualizationSettings>(initialSettings);

  const handleSave = () => {
    form.validateFields().then(values => {
      const newSettings: VisualizationSettings = {
        "graph.dimensions": values.dimensions,
        "graph.metrics": values.metrics,
        "graph.x_axis.title": values.xAxisTitle,
        "graph.y_axis.title": values.yAxisTitle,
        "graph.colors": values.colors,
        "graph.show_legend": values.showLegend,
        "graph.legend_position": values.legendPosition
      };
      onSave(newSettings);
    });
  };

  return (
    <Card title="图表配置" size="small">
      <Form
        form={form}
        layout="vertical"
        initialValues={{
          dimensions: settings["graph.dimensions"],
          metrics: settings["graph.metrics"],
          xAxisTitle: settings["graph.x_axis.title"],
          yAxisTitle: settings["graph.y_axis.title"],
          colors: settings["graph.colors"],
          showLegend: settings["graph.show_legend"] !== false,
          legendPosition: settings["graph.legend_position"] || "right"
        }}
      >
        <Form.Item label="维度字段" name="dimensions">
          <Select mode="multiple" placeholder="选择维度字段">
            <Option value="category">分类</Option>
            <Option value="date">日期</Option>
            <Option value="region">地区</Option>
          </Select>
        </Form.Item>

        <Form.Item label="度量字段" name="metrics">
          <Select mode="multiple" placeholder="选择度量字段">
            <Option value="value">数值</Option>
            <Option value="count">计数</Option>
            <Option value="sum">求和</Option>
            <Option value="average">平均值</Option>
          </Select>
        </Form.Item>

        <Divider>轴设置</Divider>

        <Form.Item label="X轴标题" name="xAxisTitle">
          <Input placeholder="输入X轴标题" />
        </Form.Item>

        <Form.Item label="Y轴标题" name="yAxisTitle">
          <Input placeholder="输入Y轴标题" />
        </Form.Item>

        <Divider>样式设置</Divider>

        <Form.Item label="显示图例" name="showLegend" valuePropName="checked">
          <Switch />
        </Form.Item>

        <Form.Item label="图例位置" name="legendPosition">
          <Select>
            <Option value="top">顶部</Option>
            <Option value="bottom">底部</Option>
            <Option value="left">左侧</Option>
            <Option value="right">右侧</Option>
          </Select>
        </Form.Item>

        <Form.Item label="颜色主题" name="colors">
          <Select mode="tags" placeholder="输入颜色值">
            <Option value="#5470c6">#5470c6</Option>
            <Option value="#91cc75">#91cc75</Option>
            <Option value="#fac858">#fac858</Option>
            <Option value="#ee6666">#ee6666</Option>
          </Select>
        </Form.Item>

        <Divider />
        
        <Space>
          <Button type="primary" icon={<SaveOutlined />} onClick={handleSave}>
            保存配置
          </Button>
          <Button icon={<UndoOutlined />} onClick={onCancel}>
            取消
          </Button>
        </Space>
      </Form>
    </Card>
  );
};