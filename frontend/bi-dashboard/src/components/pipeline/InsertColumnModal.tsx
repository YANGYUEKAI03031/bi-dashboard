/**
 * InsertColumnModal - 插入新列配置弹窗
 * 支持7种方法：计算列、分列、函数、查找替换、排名、分类分组、区间提取
 */
import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  Modal,
  Tabs,
  Form,
  Input,
  Select,
  InputNumber,
  Button,
  Table,
  Space,
  Card,
  Typography,
  Divider,
  Alert,
  Tooltip,
  Tag,
} from 'antd';
import {
  PlusOutlined,
  DeleteOutlined,
  CalculatorOutlined,
  ScissorOutlined,
  FunctionOutlined,
  SwapOutlined,
  SortAscendingOutlined,
  FolderOutlined,
  BarChartOutlined,
  InfoCircleOutlined,
} from '@ant-design/icons';

const { Text, Paragraph } = Typography;
const { TextArea } = Input;

export interface InsertedColumnConfig {
  /** 编辑时的唯一标识 */
  id?: string;
  name: string;
  method: InsertedColumnMethod;
  sourceColumn: string;
  config: Record<string, unknown>;
}

export type InsertedColumnMethod = 'calculation' | 'split' | 'function' | 'lookup' | 'rank' | 'category' | 'bin';

export interface InsertColumnModalProps {
  visible: boolean;
  columns: string[];
  /** 要编辑的已有配置（传入则弹窗标题变为「编辑列」） */
  editConfig?: InsertedColumnConfig;
  onCancel: () => void;
  /** 新增或更新 */
  onConfirm: (config: InsertedColumnConfig) => void;
  /** 仅编辑模式下可用：删除该列 */
  onDelete?: (configId: string) => void;
}

// 计算列配置
interface CalculationFormProps {
  columns: string[];
  onValuesChange: (values: Record<string, unknown>) => void;
}

const CalculationForm: React.FC<CalculationFormProps> = ({ columns, onValuesChange }) => {
  const [expression, setExpression] = useState('');

  useEffect(() => {
    onValuesChange({ expression });
  }, [expression, onValuesChange]);

  const insertColumn = (col: string) => {
    setExpression((prev) => prev + ` ${col} `);
  };

  return (
    <div>
      <Alert
        message="使用说明"
        description="在表达式中使用列名，点击列名按钮可快速插入。支持加减乘除运算符: + - * / ( )"
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
      />
      <Form layout="vertical">
        <Form.Item label="新列名">
          <Input placeholder="输入新列名，如: 总价" />
        </Form.Item>
        <Form.Item label="表达式">
          <TextArea
            value={expression}
            onChange={(e) => setExpression(e.target.value)}
            rows={4}
            placeholder="例如: (销售额 + 税额) * 0.9"
            style={{ fontFamily: 'monospace' }}
          />
        </Form.Item>
        <Form.Item label="插入列名到表达式">
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {columns.map((col) => (
              <Tag
                key={col}
                onClick={() => insertColumn(col)}
                style={{ cursor: 'pointer' }}
                color="blue"
              >
                {col}
              </Tag>
            ))}
          </div>
        </Form.Item>
        <Form.Item label="运算符">
          <Space>
            {['+', '-', '*', '/', '(', ')'].map((op) => (
              <Button key={op} onClick={() => setExpression((prev) => prev + op)}>
                {op}
              </Button>
            ))}
            <Button onClick={() => setExpression((prev) => prev + ' MOD ')}>MOD</Button>
          </Space>
        </Form.Item>
      </Form>
    </div>
  );
};

// 分列配置
interface SplitFormProps {
  columns: string[];
  onValuesChange: (values: Record<string, unknown>) => void;
}

const SplitForm: React.FC<SplitFormProps> = ({ columns, onValuesChange }) => {
  const [values, setValues] = useState({
    split_type: 'delimiter',
    delimiter: ',',
    regex: '',
    position: 1,
  });

  useEffect(() => {
    onValuesChange(values);
  }, [values, onValuesChange]);

  return (
    <div>
      <Alert
        message="分列说明"
        description="按分隔符或正则表达式提取字符串的指定部分"
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
      />
      <Form layout="vertical">
        <Form.Item label="新列名">
          <Input placeholder="输入新列名" />
        </Form.Item>
        <Form.Item label="源列">
          <Select
            options={columns.map((c) => ({ label: c, value: c }))}
            placeholder="选择要分列的列"
          />
        </Form.Item>
        <Form.Item label="分列方式">
          <Select
            value={values.split_type}
            onChange={(v) => setValues((prev) => ({ ...prev, split_type: v }))}
            options={[
              { label: '分隔符', value: 'delimiter' },
              { label: '正则表达式', value: 'regex' },
              { label: '固定宽度', value: 'fixed' },
            ]}
          />
        </Form.Item>
        {values.split_type === 'delimiter' && (
          <Form.Item label="分隔符">
            <Input
              value={values.delimiter}
              onChange={(e) => setValues((prev) => ({ ...prev, delimiter: e.target.value }))}
              placeholder="如: , 或 | 或 \\t"
            />
          </Form.Item>
        )}
        {values.split_type === 'regex' && (
          <Form.Item label="正则表达式">
            <Input
              value={values.regex}
              onChange={(e) => setValues((prev) => ({ ...prev, regex: e.target.value }))}
              placeholder="如: \\d+ 提取数字"
            />
          </Form.Item>
        )}
        <Form.Item label="提取第几部分 (从1开始)">
          <InputNumber
            min={1}
            value={values.position}
            onChange={(v) => setValues((prev) => ({ ...prev, position: v || 1 }))}
            style={{ width: 200 }}
          />
          <Text type="secondary" style={{ marginLeft: 8 }}>
            1=第一部分, -1=最后一部分
          </Text>
        </Form.Item>
      </Form>
    </div>
  );
};

// 函数配置
interface FunctionFormProps {
  columns: string[];
  onValuesChange: (values: Record<string, unknown>) => void;
}

const FUNCTIONS = [
  { label: '字符串函数', options: [
    { label: 'CONCAT - 拼接字符串', value: 'CONCAT' },
    { label: 'SUBSTRING - 截取字符串', value: 'SUBSTRING' },
    { label: 'TRIM - 去除首尾空格', value: 'TRIM' },
    { label: 'LTRIM - 去除左侧空格', value: 'LTRIM' },
    { label: 'RTRIM - 去除右侧空格', value: 'RTRIM' },
    { label: 'UPPER - 转大写', value: 'UPPER' },
    { label: 'LOWER - 转小写', value: 'LOWER' },
    { label: 'LENGTH - 字符串长度', value: 'LENGTH' },
    { label: 'CHAR_LENGTH - 字符数', value: 'CHAR_LENGTH' },
  ]},
  { label: '数值函数', options: [
    { label: 'ROUND - 四舍五入', value: 'ROUND' },
    { label: 'ABS - 绝对值', value: 'ABS' },
    { label: 'FLOOR - 向下取整', value: 'FLOOR' },
    { label: 'CEIL - 向上取整', value: 'CEIL' },
  ]},
  { label: '日期函数', options: [
    { label: 'YEAR - 提取年份', value: 'YEAR' },
    { label: 'MONTH - 提取月份', value: 'MONTH' },
    { label: 'DAY - 提取日期', value: 'DAY' },
    { label: 'DATE - 转为日期', value: 'DATE' },
    { label: 'DATE_FORMAT - 日期格式化', value: 'DATE_FORMAT' },
  ]},
  { label: '逻辑函数', options: [
    { label: 'IF - 条件判断', value: 'IF' },
    { label: 'COALESCE - 返回首个非空值', value: 'COALESCE' },
    { label: 'CAST - 类型转换', value: 'CAST' },
  ]},
];

const FunctionForm: React.FC<FunctionFormProps> = ({ columns, onValuesChange }) => {
  const [values, setValues] = useState({
    function_name: '',
    arguments: [''],
    extraArg: '',
  });

  useEffect(() => {
    const args = values.arguments.filter((a) => a !== '');
    onValuesChange({
      function_name: values.function_name,
      arguments: [...args, values.extraArg].filter((a) => a !== ''),
    });
  }, [values, onValuesChange]);

  const addArg = () => {
    setValues((prev) => ({ ...prev, arguments: [...prev.arguments, ''] }));
  };

  const updateArg = (index: number, value: string) => {
    setValues((prev) => {
      const newArgs = [...prev.arguments];
      newArgs[index] = value;
      return { ...prev, arguments: newArgs };
    });
  };

  return (
    <div>
      <Alert
        message="函数说明"
        description="选择函数并配置参数，部分参数可选择列名"
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
      />
      <Form layout="vertical">
        <Form.Item label="新列名">
          <Input placeholder="输入新列名" />
        </Form.Item>
        <Form.Item label="函数">
          <Select
            showSearch
            options={FUNCTIONS}
            value={values.function_name || undefined}
            onChange={(v) => setValues((prev) => ({ ...prev, function_name: v }))}
            placeholder="选择函数"
            filterOption={(input, option) =>
              (option?.label ?? '').toLowerCase().includes(input.toLowerCase())
            }
          />
        </Form.Item>
        <Form.Item label="参数 (选择列或输入值)">
          {values.arguments.map((arg, index) => (
            <div key={index} style={{ marginBottom: 8 }}>
              <Text type="secondary">参数 {index + 1}:</Text>
              <Space.Compact style={{ width: '100%', marginTop: 4 }}>
                <Select
                  style={{ width: '50%' }}
                  options={columns.map((c) => ({ label: c, value: c }))}
                  value={columns.includes(arg) ? arg : undefined}
                  onChange={(v) => updateArg(index, v)}
                  placeholder="选择列"
                  allowClear
                />
                <Input
                  style={{ width: '50%' }}
                  value={columns.includes(arg) ? '' : arg}
                  onChange={(e) => updateArg(index, e.target.value)}
                  placeholder="或输入值"
                />
              </Space.Compact>
            </div>
          ))}
          {values.function_name === 'SUBSTRING' && values.arguments.length < 2 && (
            <Button type="dashed" onClick={addArg} icon={<PlusOutlined />}>
              添加参数
            </Button>
          )}
          {values.function_name === 'IF' && (
            <Paragraph type="secondary" style={{ marginTop: 8 }}>
              IF 语法: IF(条件, 真值, 假值)
            </Paragraph>
          )}
          {values.function_name === 'DATE_FORMAT' && (
            <Form.Item label="日期格式" style={{ marginTop: 8 }}>
              <Select
                options={[
                  { label: '%Y-%m-%d', value: '%Y-%m-%d' },
                  { label: '%Y-%m-%d %H:%i:%s', value: '%Y-%m-%d %H:%i:%s' },
                  { label: '%Y年%m月%d日', value: '%Y年%m月%d日' },
                  { label: '%m/%d/%Y', value: '%m/%d/%Y' },
                ]}
                placeholder="选择日期格式"
                onChange={(v) => setValues((prev) => ({ ...prev, extraArg: v }))}
              />
            </Form.Item>
          )}
        </Form.Item>
      </Form>
    </div>
  );
};

// 查找替换配置
interface LookupFormProps {
  columns: string[];
  onValuesChange: (values: Record<string, unknown>) => void;
}

interface LookupItem {
  key: string;
  value: string;
}

const LookupForm: React.FC<LookupFormProps> = ({ columns, onValuesChange }) => {
  const [items, setItems] = useState<LookupItem[]>([{ key: '', value: '' }]);
  const [defaultValue, setDefaultValue] = useState('');

  useEffect(() => {
    onValuesChange({
      lookup_table: items.filter((i) => i.key !== ''),
      default_value: defaultValue,
    });
  }, [items, defaultValue, onValuesChange]);

  const updateItem = (index: number, field: 'key' | 'value', val: string) => {
    setItems((prev) => {
      const newItems = [...prev];
      newItems[index] = { ...newItems[index], [field]: val };
      return newItems;
    });
  };

  const addItem = () => {
    setItems((prev) => [...prev, { key: '', value: '' }]);
  };

  const removeItem = (index: number) => {
    setItems((prev) => prev.filter((_, i) => i !== index));
  };

  return (
    <div>
      <Alert
        message="查找替换说明"
        description="将源列中的值映射为新值，未匹配的值保持不变或使用默认值"
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
      />
      <Form layout="vertical">
        <Form.Item label="新列名">
          <Input placeholder="输入新列名" />
        </Form.Item>
        <Form.Item label="源列">
          <Select
            options={columns.map((c) => ({ label: c, value: c }))}
            placeholder="选择要查找替换的列"
          />
        </Form.Item>
        <Form.Item label="映射表">
          <Table
            size="small"
            pagination={false}
            dataSource={items.map((item, index) => ({ ...item, index }))}
            columns={[
              {
                title: '原值',
                dataIndex: 'key',
                width: '40%',
                render: (_, record) => (
                  <Input
                    value={record.key}
                    onChange={(e) => updateItem(record.index, 'key', e.target.value)}
                    placeholder="原值"
                  />
                ),
              },
              {
                title: '新值',
                dataIndex: 'value',
                width: '40%',
                render: (_, record) => (
                  <Input
                    value={record.value}
                    onChange={(e) => updateItem(record.index, 'value', e.target.value)}
                    placeholder="新值"
                  />
                ),
              },
              {
                title: '',
                width: '20%',
                render: (_, record) => (
                  <Button
                    type="text"
                    danger
                    icon={<DeleteOutlined />}
                    onClick={() => removeItem(record.index)}
                  />
                ),
              },
            ]}
          />
          <Button
            type="dashed"
            onClick={addItem}
            icon={<PlusOutlined />}
            style={{ marginTop: 8, width: '100%' }}
          >
            添加映射
          </Button>
        </Form.Item>
        <Form.Item label="默认值 (未匹配时)">
          <Input
            value={defaultValue}
            onChange={(e) => setDefaultValue(e.target.value)}
            placeholder="留空则保持原值"
          />
        </Form.Item>
      </Form>
    </div>
  );
};

// 排名配置
interface RankFormProps {
  columns: string[];
  onValuesChange: (values: Record<string, unknown>) => void;
}

const RankForm: React.FC<RankFormProps> = ({ columns, onValuesChange }) => {
  const [values, setValues] = useState({
    rank_type: 'ROW_NUMBER',
    partition_by: [] as string[],
    order_by: { column: '', direction: 'desc' },
  });

  useEffect(() => {
    onValuesChange(values);
  }, [values, onValuesChange]);

  return (
    <div>
      <Alert
        message="排名说明"
        description="添加排名列，支持分组排名和多种排名方式"
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
      />
      <Form layout="vertical">
        <Form.Item label="新列名">
          <Input placeholder="输入新列名，如: 排名" />
        </Form.Item>
        <Form.Item label="排名类型">
          <Select
            value={values.rank_type}
            onChange={(v) => setValues((prev) => ({ ...prev, rank_type: v }))}
            options={[
              { label: 'ROW_NUMBER - 连续排名', value: 'ROW_NUMBER' },
              { label: 'RANK - 并列跳跃', value: 'RANK' },
              { label: 'DENSE_RANK - 并列不跳跃', value: 'DENSE_RANK' },
            ]}
          />
          <Text type="secondary" style={{ display: 'block', marginTop: 4 }}>
            ROW_NUMBER: 1,2,3 | RANK: 1,1,3 | DENSE_RANK: 1,1,2
          </Text>
        </Form.Item>
        <Form.Item label="分区字段 (可选，不选则为全局排名)">
          <Select
            mode="multiple"
            options={columns.map((c) => ({ label: c, value: c }))}
            value={values.partition_by}
            onChange={(v) => setValues((prev) => ({ ...prev, partition_by: v }))}
            placeholder="选择分区字段"
            allowClear
          />
          <Text type="secondary" style={{ display: 'block', marginTop: 4 }}>
            按哪些字段分组，同一组内独立排名
          </Text>
        </Form.Item>
        <Form.Item label="排序字段">
          <Space.Compact>
            <Select
              style={{ width: '60%' }}
              options={columns.map((c) => ({ label: c, value: c }))}
              value={values.order_by.column || undefined}
              onChange={(v) =>
                setValues((prev) => ({ ...prev, order_by: { ...prev.order_by, column: v } }))
              }
              placeholder="选择排序字段"
            />
            <Select
              style={{ width: '40%' }}
              value={values.order_by.direction}
              onChange={(v) =>
                setValues((prev) => ({ ...prev, order_by: { ...prev.order_by, direction: v } }))
              }
              options={[
                { label: '降序 (大在前)', value: 'desc' },
                { label: '升序 (小在前)', value: 'asc' },
              ]}
            />
          </Space.Compact>
        </Form.Item>
      </Form>
    </div>
  );
};

// 分类分组配置
interface CategoryFormProps {
  columns: string[];
  onValuesChange: (values: Record<string, unknown>) => void;
}

interface RangeItem {
  from: number | null;
  to: number | null;
  label: string;
}

const CategoryForm: React.FC<CategoryFormProps> = ({ columns, onValuesChange }) => {
  const [ranges, setRanges] = useState<RangeItem[]>([
    { from: null, to: null, label: '' },
  ]);
  const [defaultLabel, setDefaultLabel] = useState('其他');

  useEffect(() => {
    onValuesChange({
      ranges: ranges.filter((r) => r.label !== ''),
      default_label: defaultLabel,
    });
  }, [ranges, defaultLabel, onValuesChange]);

  const updateRange = (index: number, field: keyof RangeItem, value: unknown) => {
    setRanges((prev) => {
      const newRanges = [...prev];
      newRanges[index] = { ...newRanges[index], [field]: value };
      return newRanges;
    });
  };

  const addRange = () => {
    setRanges((prev) => [...prev, { from: null, to: null, label: '' }]);
  };

  const removeRange = (index: number) => {
    setRanges((prev) => prev.filter((_, i) => i !== index));
  };

  return (
    <div>
      <Alert
        message="分类分组说明"
        description="将数值划分到不同的类别区间，为每个区间设置标签"
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
      />
      <Form layout="vertical">
        <Form.Item label="新列名">
          <Input placeholder="输入新列名，如: 等级" />
        </Form.Item>
        <Form.Item label="源列 (数值列)">
          <Select
            options={columns.map((c) => ({ label: c, value: c }))}
            placeholder="选择数值列"
          />
        </Form.Item>
        <Form.Item label="区间配置">
          <Table
            size="small"
            pagination={false}
            dataSource={ranges.map((r, i) => ({ ...r, index: i }))}
            columns={[
              {
                title: '起始值',
                dataIndex: 'from',
                width: '25%',
                render: (_, record) => (
                  <InputNumber
                    value={record.from ?? undefined}
                    onChange={(v) => updateRange(record.index, 'from', v)}
                    placeholder="从"
                    style={{ width: '100%' }}
                    controls={false}
                  />
                ),
              },
              {
                title: '结束值',
                dataIndex: 'to',
                width: '25%',
                render: (_, record) => (
                  <InputNumber
                    value={record.to ?? undefined}
                    onChange={(v) => updateRange(record.index, 'to', v)}
                    placeholder="到"
                    style={{ width: '100%' }}
                    controls={false}
                  />
                ),
              },
              {
                title: '标签',
                dataIndex: 'label',
                width: '35%',
                render: (_, record) => (
                  <Input
                    value={record.label}
                    onChange={(e) => updateRange(record.index, 'label', e.target.value)}
                    placeholder="标签名"
                  />
                ),
              },
              {
                title: '',
                width: '15%',
                render: (_, record) => (
                  <Button
                    type="text"
                    danger
                    icon={<DeleteOutlined />}
                    onClick={() => removeRange(record.index)}
                  />
                ),
              },
            ]}
          />
          <Button
            type="dashed"
            onClick={addRange}
            icon={<PlusOutlined />}
            style={{ marginTop: 8, width: '100%' }}
          >
            添加区间
          </Button>
        </Form.Item>
        <Form.Item label="默认值 (未匹配时)">
          <Input
            value={defaultLabel}
            onChange={(e) => setDefaultLabel(e.target.value)}
            placeholder="默认标签"
          />
        </Form.Item>
      </Form>
    </div>
  );
};

// 区间提取配置
interface BinFormProps {
  columns: string[];
  onValuesChange: (values: Record<string, unknown>) => void;
}

const BinForm: React.FC<BinFormProps> = ({ columns, onValuesChange }) => {
  const [values, setValues] = useState({
    bin_type: 'fixed',
    bin_size: 10,
    custom_bins: [] as number[],
  });

  useEffect(() => {
    onValuesChange(values);
  }, [values, onValuesChange]);

  const generateBins = (size: number, count: number) => {
    return Array.from({ length: count }, (_, i) => i * size);
  };

  return (
    <div>
      <Alert
        message="区间提取说明"
        description="将连续数值离散化为固定大小的区间"
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
      />
      <Form layout="vertical">
        <Form.Item label="新列名">
          <Input placeholder="输入新列名，如: 区间" />
        </Form.Item>
        <Form.Item label="源列 (数值列)">
          <Select
            options={columns.map((c) => ({ label: c, value: c }))}
            placeholder="选择数值列"
          />
        </Form.Item>
        <Form.Item label="区间类型">
          <Select
            value={values.bin_type}
            onChange={(v) => setValues((prev) => ({ ...prev, bin_type: v }))}
            options={[
              { label: '固定区间大小', value: 'fixed' },
              { label: '自定义区间边界', value: 'custom' },
            ]}
          />
        </Form.Item>
        {values.bin_type === 'fixed' && (
          <>
            <Form.Item label="区间大小">
              <InputNumber
                value={values.bin_size}
                onChange={(v) => setValues((prev) => ({ ...prev, bin_size: v || 10 }))}
                min={0.01}
                style={{ width: 200 }}
              />
              <Text type="secondary" style={{ marginLeft: 8 }}>
                如: 10 → 0, 10, 20, 30...
              </Text>
            </Form.Item>
            <Form.Item label="快速生成">
              <Space>
                <Button onClick={() => setValues((prev) => ({ ...prev, bin_size: 5 }))}>5</Button>
                <Button onClick={() => setValues((prev) => ({ ...prev, bin_size: 10 }))}>10</Button>
                <Button onClick={() => setValues((prev) => ({ ...prev, bin_size: 50 }))}>50</Button>
                <Button onClick={() => setValues((prev) => ({ ...prev, bin_size: 100 }))}>100</Button>
                <Button onClick={() => setValues((prev) => ({ ...prev, bin_size: 1000 }))}>1000</Button>
              </Space>
            </Form.Item>
          </>
        )}
        {values.bin_type === 'custom' && (
          <>
            <Form.Item label="自定义边界">
              <Select
                mode="tags"
                value={values.custom_bins.map(String)}
                onChange={(v) =>
                  setValues((prev) => ({
                    ...prev,
                    custom_bins: v.map(Number).filter((n) => !isNaN(n)).sort((a, b) => a - b),
                  }))
                }
                placeholder="输入边界值，如: 0, 1000, 5000, 10000"
                tokenSeparators={[',']}
              />
              <Text type="secondary" style={{ display: 'block', marginTop: 4 }}>
                输入用逗号分隔的数字，如: 0, 1000, 5000, 10000
              </Text>
            </Form.Item>
            <Form.Item label="预设">
              <Space direction="vertical">
                <Space>
                  <Button onClick={() => setValues((prev) => ({ ...prev, custom_bins: generateBins(1000, 11) }))}>
                    1000 为区间
                  </Button>
                  <Button onClick={() => setValues((prev) => ({ ...prev, custom_bins: generateBins(100, 11) }))}>
                    100 为区间
                  </Button>
                </Space>
              </Space>
            </Form.Item>
          </>
        )}
      </Form>
    </div>
  );
};

// 主组件
export const InsertColumnModal: React.FC<InsertColumnModalProps> = ({
  visible,
  columns,
  editConfig,
  onCancel,
  onConfirm,
  onDelete,
}) => {
  const isEdit = !!editConfig;
  const [activeTab, setActiveTab] = useState<InsertedColumnMethod>(editConfig?.method ?? 'calculation');
  const [formValues, setFormValues] = useState<Record<string, unknown>>(editConfig?.config ?? {});
  const [newColumnName, setNewColumnName] = useState(editConfig?.name ?? '');
  const [sourceColumn, setSourceColumn] = useState<string | undefined>(editConfig?.sourceColumn);
  const [form] = Form.useForm();

  const handleValuesChange = useCallback((values: Record<string, unknown>) => {
    setFormValues(values);
  }, []);

  const handleConfirm = useCallback(() => {
    if (!newColumnName.trim()) {
      return;
    }
    onConfirm({
      ...(editConfig?.id ? { id: editConfig.id } : {}),
      name: newColumnName,
      method: activeTab as InsertedColumnConfig['method'],
      sourceColumn: sourceColumn || columns[0] || '',
      config: formValues,
    });
  }, [newColumnName, editConfig, activeTab, sourceColumn, columns, formValues, onConfirm]);

  const resetForm = useCallback(() => {
    setNewColumnName('');
    setSourceColumn(undefined);
    setFormValues({});
    setActiveTab('calculation');
    form.resetFields();
  }, [form]);

  // 当 editConfig 变化时同步表单状态
  useEffect(() => {
    if (editConfig) {
      setNewColumnName(editConfig.name);
      setSourceColumn(editConfig.sourceColumn);
      setFormValues(editConfig.config ?? {});
      setActiveTab(editConfig.method);
    }
  }, [editConfig]);

  useEffect(() => {
    if (!visible) {
      resetForm();
    }
  }, [visible]);

  const tabItems: Array<{ key: InsertedColumnMethod; label: React.ReactNode; children: React.ReactNode }> = useMemo(() => [
    {
      key: 'calculation',
      label: (
        <span>
          <CalculatorOutlined /> 计算
        </span>
      ),
      children: <CalculationForm columns={columns} onValuesChange={handleValuesChange} />,
    },
    {
      key: 'split',
      label: (
        <span>
          <ScissorOutlined /> 分列
        </span>
      ),
      children: <SplitForm columns={columns} onValuesChange={handleValuesChange} />,
    },
    {
      key: 'function',
      label: (
        <span>
          <FunctionOutlined /> 函数
        </span>
      ),
      children: <FunctionForm columns={columns} onValuesChange={handleValuesChange} />,
    },
    {
      key: 'lookup',
      label: (
        <span>
          <SwapOutlined /> 查找替换
        </span>
      ),
      children: <LookupForm columns={columns} onValuesChange={handleValuesChange} />,
    },
    {
      key: 'rank',
      label: (
        <span>
          <SortAscendingOutlined /> 排名
        </span>
      ),
      children: <RankForm columns={columns} onValuesChange={handleValuesChange} />,
    },
    {
      key: 'category',
      label: (
        <span>
          <FolderOutlined /> 分类分组
        </span>
      ),
      children: <CategoryForm columns={columns} onValuesChange={handleValuesChange} />,
    },
    {
      key: 'bin',
      label: (
        <span>
          <BarChartOutlined /> 区间提取
        </span>
      ),
      children: <BinForm columns={columns} onValuesChange={handleValuesChange} />,
    },
  ], [columns, handleValuesChange]);

  return (
    <Modal
      title={
        <span>
          <PlusOutlined style={{ marginRight: 8 }} />
          {isEdit ? '编辑列' : '插入新列'}
        </span>
      }
      open={visible}
      onCancel={onCancel}
      onOk={handleConfirm}
      okText={isEdit ? '保存修改' : '确认添加'}
      cancelText="取消"
      width={700}
      destroyOnClose
      footer={
        isEdit && onDelete && editConfig?.id ? (
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <Button danger onClick={() => { onDelete(editConfig.id!); onCancel(); }}>
              删除此列
            </Button>
            <Space>
              <Button onClick={onCancel}>取消</Button>
              <Button type="primary" onClick={handleConfirm}>保存修改</Button>
            </Space>
          </div>
        ) : (
          undefined
        )
      }
    >
      <Form form={form} layout="vertical">
        <Form.Item
          label="新列名"
          required
          validateStatus={newColumnName.trim() ? 'success' : 'error'}
          help={!newColumnName.trim() ? '请输入新列名' : ''}
        >
          <Input
            value={newColumnName}
            onChange={(e) => setNewColumnName(e.target.value)}
            placeholder="输入新列名"
            style={{ width: 300 }}
          />
        </Form.Item>
      </Form>

      <Divider>选择生成方式</Divider>

      <Tabs
        activeKey={activeTab}
        onChange={(key) => setActiveTab(key as typeof activeTab)}
        items={tabItems}
        tabPosition="left"
        style={{ minHeight: 400 }}
      />
    </Modal>
  );
};

export default InsertColumnModal;
