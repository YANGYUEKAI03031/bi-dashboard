// frontend/bi-dashboard/src/components/charts/ChartConfigPanel.tsx
import React, { useState } from 'react';
import { Card, Form, Input, Select, Switch, Button, Space, Divider, Collapse } from 'antd';
import { SaveOutlined, UndoOutlined } from '@ant-design/icons';

const { Option } = Select;
const { Panel } = Collapse;

interface VisualizationSettings {
  "graph.dimensions"?: string[];
  "graph.metrics"?: string[];
  "graph.x_axis.title"?: string;
  "graph.y_axis.title"?: string;
  "graph.colors"?: string[];
  "graph.show_legend"?: boolean;
  "graph.legend_position"?: string;
  "graph.smooth_line"?: boolean; // 新增：平滑线条
  "graph.area_style"?: boolean; // 新增：面积图样式
  "graph.pie_radius"?: [string, string]; // 新增：饼图半径
  "graph.scatter_size"?: number; // 新增：散点大小
  "graph.bar_width"?: string; // 新增：柱状图宽度
  "graph.rotate_labels"?: boolean; // 新增：旋转标签
  "graph.show_grid"?: boolean; // 新增：显示网格
  "graph.animation"?: boolean; // 新增：动画效果
}

interface ChartConfigPanelProps {
  initialSettings: VisualizationSettings;
  availableFields: string[]; // 新增：可用字段列表
  onSave: (settings: VisualizationSettings) => void;
  onCancel: () => void;
}

export const ChartConfigPanel: React.FC<ChartConfigPanelProps> = ({
  initialSettings,
  availableFields = [],
  onSave,
  onCancel
}) => {
  const [form] = Form.useForm();
  const [settings] = useState<VisualizationSettings>(initialSettings);

  const handleSave = () => {
    form.validateFields().then(values => {
      const newSettings: VisualizationSettings = {
        "graph.dimensions": values.dimensions,
        "graph.metrics": values.metrics,
        "graph.x_axis.title": values.xAxisTitle,
        "graph.y_axis.title": values.yAxisTitle,
        "graph.colors": values.colors,
        "graph.show_legend": values.showLegend,
        "graph.legend_position": values.legendPosition,
        "graph.smooth_line": values.smoothLine,
        "graph.area_style": values.areaStyle,
        "graph.pie_radius": values.pieRadius,
        "graph.scatter_size": values.scatterSize,
        "graph.bar_width": values.barWidth,
        "graph.rotate_labels": values.rotateLabels,
        "graph.show_grid": values.showGrid,
        "graph.animation": values.animation
      };
      onSave(newSettings);
    });
  };

  return (
    <Card title="图表高级配置" size="small">
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
          legendPosition: settings["graph.legend_position"] || "right",
          smoothLine: settings["graph.smooth_line"] || false,
          areaStyle: settings["graph.area_style"] || false,
          pieRadius: settings["graph.pie_radius"] || ['40%', '70%'],
          scatterSize: settings["graph.scatter_size"] || 10,
          barWidth: settings["graph.bar_width"] || '60%',
          rotateLabels: settings["graph.rotate_labels"] || false,
          showGrid: settings["graph.show_grid"] !== false,
          animation: settings["graph.animation"] !== false
        }}
      >
        <Collapse accordion>
          <Panel header="基础配置" key="1">
            <Form.Item label="维度字段" name="dimensions">
              <Select mode="multiple" placeholder="选择维度字段">
                {availableFields.map(field => (
                  <Option key={field} value={field}>{field}</Option>
                ))}
              </Select>
            </Form.Item>

            <Form.Item label="度量字段" name="metrics">
              <Select mode="multiple" placeholder="选择度量字段">
                {availableFields.map(field => (
                  <Option key={field} value={field}>{field}</Option>
                ))}
              </Select>
            </Form.Item>

            <Divider>轴设置</Divider>

            <Form.Item label="X轴标题" name="xAxisTitle">
              <Input placeholder="输入X轴标题" />
            </Form.Item>

            <Form.Item label="Y轴标题" name="yAxisTitle">
              <Input placeholder="输入Y轴标题" />
            </Form.Item>
          </Panel>

          <Panel header="样式配置" key="2">
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
                <Option value="#73c0de">#73c0de</Option>
                <Option value="#3ba272">#3ba272</Option>
                <Option value="#fc8452">#fc8452</Option>
                <Option value="#9a60b4">#9a60b4</Option>
                <Option value="#ea7ccc">#ea7ccc</Option>
              </Select>
            </Form.Item>

            <Form.Item label="启用动画" name="animation" valuePropName="checked">
              <Switch />
            </Form.Item>
          </Panel>

          <Panel header="图表特有配置" key="3">
            {/* 折线图配置 */}
            <Form.Item label="平滑线条" name="smoothLine" valuePropName="checked">
              <Switch />
            </Form.Item>

            {/* 面积图配置 */}
            <Form.Item label="面积填充" name="areaStyle" valuePropName="checked">
              <Switch />
            </Form.Item>

            {/* 饼图配置 */}
            <Form.Item label="饼图内外半径" name="pieRadius">
              <Select>
                <Option value={['30%', '60%']}>小饼图</Option>
                <Option value={['40%', '70%']}>中等饼图</Option>
                <Option value={['50%', '80%']}>大饼图</Option>
                <Option value={['60%', '90%']}>超大饼图</Option>
              </Select>
            </Form.Item>

            {/* 散点图配置 */}
            <Form.Item label="散点大小" name="scatterSize">
              <Select>
                <Option value={5}>小</Option>
                <Option value={10}>中</Option>
                <Option value={15}>大</Option>
                <Option value={20}>超大</Option>
              </Select>
            </Form.Item>

            {/* 柱状图配置 */}
            <Form.Item label="柱状图宽度" name="barWidth">
              <Select>
                <Option value="40%">细</Option>
                <Option value="60%">中</Option>
                <Option value="80%">粗</Option>
                <Option value="90%">超粗</Option>
              </Select>
            </Form.Item>
          </Panel>

          <Panel header="显示优化" key="4">
            <Form.Item label="旋转标签" name="rotateLabels" valuePropName="checked">
              <Switch />
            </Form.Item>

            <Form.Item label="显示网格线" name="showGrid" valuePropName="checked">
              <Switch defaultChecked />
            </Form.Item>
          </Panel>
        </Collapse>

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