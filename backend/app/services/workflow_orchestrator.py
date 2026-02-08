from typing import Dict, Any, List, Optional, Callable
from enum import Enum
import asyncio
import logging
from datetime import datetime
from dataclasses import dataclass
from abc import ABC, abstractmethod

import pandas as pd
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.data_source import ProcessedDataset
from app.core.cache import cache_service

logger = logging.getLogger(__name__)

class NodeType(Enum):
    """处理节点类型"""
    DATA_SOURCE = "data_source"
    QUERY = "query"
    FILTER = "filter"
    AGGREGATE = "aggregate"
    TRANSFORM = "transform"
    JOIN = "join"
    CACHE = "cache"
    OUTPUT = "output"

class NodeStatus(Enum):
    """节点状态"""
    PENDING = "pending"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"
    SKIPPED = "skipped"

@dataclass
class ProcessingNode:
    """处理节点"""
    id: str
    type: NodeType
    name: str
    config: Dict[str, Any]
    dependencies: List[str]  # 依赖的节点ID列表
    status: NodeStatus = NodeStatus.PENDING
    result: Optional[Any] = None
    error: Optional[str] = None
    execution_time: Optional[float] = None
    started_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None

class ProcessingNodeHandler(ABC):
    """处理节点处理器抽象基类"""
    
    @abstractmethod
    async def execute(self, node: ProcessingNode, context: Dict[str, Any]) -> Any:
        """执行节点处理逻辑"""
        pass
    
    @abstractmethod
    def validate_config(self, config: Dict[str, Any]) -> bool:
        """验证节点配置"""
        pass

class DataSourceHandler(ProcessingNodeHandler):
    """数据源节点处理器"""
    
    async def execute(self, node: ProcessingNode, context: Dict[str, Any]) -> pd.DataFrame:
        import pandas as pd
        from sqlalchemy import create_engine, text
        
        config = node.config
        connection_config = config['connection_config']
        
        # 根据数据库类型构建连接字符串
        if connection_config['type'] == 'mysql':
            connection_string = (
                f"mysql+pymysql://{connection_config['username']}:"
                f"{connection_config['password']}@{connection_config['host']}:"
                f"{connection_config['port']}/{connection_config['database']}"
            )
        elif connection_config['type'] == 'postgresql':
            connection_string = (
                f"postgresql://{connection_config['username']}:"
                f"{connection_config['password']}@{connection_config['host']}:"
                f"{connection_config['port']}/{connection_config['database']}"
            )
        else:
            raise ValueError(f"Unsupported database type: {connection_config['type']}")
        
        engine = create_engine(connection_string)
        
        query = config.get('query', 'SELECT * FROM your_table LIMIT 1000')
        
        with engine.connect() as conn:
            result = conn.execute(text(query))
            df = pd.DataFrame(result.fetchall(), columns=result.keys())
        
        return df
    
    def validate_config(self, config: Dict[str, Any]) -> bool:
        required_fields = ['connection_config']
        return all(field in config for field in required_fields)

class QueryHandler(ProcessingNodeHandler):
    """查询节点处理器"""
    
    async def execute(self, node: ProcessingNode, context: Dict[str, Any]) -> pd.DataFrame:
        # 从前一个节点获取数据
        input_data = context.get('input_data')
        if input_data is None:
            raise ValueError("No input data provided")
        
        if not isinstance(input_data, pd.DataFrame):
            input_data = pd.DataFrame(input_data)
        
        config = node.config
        query_text = config.get('query')
        
        if query_text:
            # 执行SQL查询（如果支持的话）
            # 这里简化处理，实际应该使用适当的查询引擎
            pass
        
        return input_data
    
    def validate_config(self, config: Dict[str, Any]) -> bool:
        return True

class FilterHandler(ProcessingNodeHandler):
    """过滤节点处理器"""
    
    async def execute(self, node: ProcessingNode, context: Dict[str, Any]) -> pd.DataFrame:
        input_data = context.get('input_data')
        if input_data is None:
            raise ValueError("No input data provided")
        
        if not isinstance(input_data, pd.DataFrame):
            input_data = pd.DataFrame(input_data)
        
        config = node.config
        conditions = config.get('conditions', [])
        join_logic = config.get('join_logic', 'AND').upper()
        
        if not conditions:
            return input_data
        
        condition_strings = []
        for condition in conditions:
            field = condition['field']
            operator = condition['operator']
            value = condition['value']
            
            if operator == '=':
                condition_str = f"`{field}` == '{value}'"
            elif operator == '!=':
                condition_str = f"`{field}` != '{value}'"
            elif operator == '>':
                condition_str = f"`{field}` > {value}"
            elif operator == '<':
                condition_str = f"`{field}` < {value}"
            elif operator == '>=':
                condition_str = f"`{field}` >= {value}"
            elif operator == '<=':
                condition_str = f"`{field}` <= {value}"
            elif operator == 'LIKE':
                condition_str = f"`{field}`.str.contains('{value}', na=False)"
            elif operator == 'NOT LIKE':
                condition_str = f"~(`{field}`.str.contains('{value}', na=False))"
            else:
                continue
                
            condition_strings.append(condition_str)
        
        if condition_strings:
            combined_condition = f" {join_logic} ".join(condition_strings)
            filtered_df = input_data.query(combined_condition)
            return filtered_df
        
        return input_data
    
    def validate_config(self, config: Dict[str, Any]) -> bool:
        return 'conditions' in config

class AggregateHandler(ProcessingNodeHandler):
    """聚合节点处理器"""
    
    async def execute(self, node: ProcessingNode, context: Dict[str, Any]) -> pd.DataFrame:
        input_data = context.get('input_data')
        if input_data is None:
            raise ValueError("No input data provided")
        
        if not isinstance(input_data, pd.DataFrame):
            input_data = pd.DataFrame(input_data)
        
        config = node.config
        group_by = config.get('group_by', [])
        aggregations = config.get('aggregations', [])
        
        if not aggregations:
            return input_data
        
        # 准备聚合函数
        agg_dict = {}
        for agg in aggregations:
            field = agg['field']
            func_name = agg['function'].lower()
            alias = agg.get('alias', f"{field}_{func_name}")
            
            if func_name == 'count':
                agg_dict[field] = ('count', alias)
            elif func_name == 'sum':
                agg_dict[field] = ('sum', alias)
            elif func_name == 'avg':
                agg_dict[field] = ('mean', alias)
            elif func_name == 'min':
                agg_dict[field] = ('min', alias)
            elif func_name == 'max':
                agg_dict[field] = ('max', alias)
            elif func_name == 'std':
                agg_dict[field] = ('std', alias)
        
        if group_by:
            # 分组聚合
            grouped = input_data.groupby(group_by).agg({k: v[0] for k, v in agg_dict.items()})
            result_df = grouped.reset_index()
            # 重命名列
            new_columns = group_by + [v[1] for v in agg_dict.values()]
            result_df.columns = new_columns
        else:
            # 全局聚合
            agg_result = input_data.agg({k: v[0] for k, v in agg_dict.items()})
            result_df = pd.DataFrame([agg_result.to_dict()])
            # 重命名列
            result_df.columns = [v[1] for v in agg_dict.values()]
        
        return result_df
    
    def validate_config(self, config: Dict[str, Any]) -> bool:
        return 'aggregations' in config

class TransformHandler(ProcessingNodeHandler):
    """转换节点处理器"""
    
    async def execute(self, node: ProcessingNode, context: Dict[str, Any]) -> pd.DataFrame:
        input_data = context.get('input_data')
        if input_data is None:
            raise ValueError("No input data provided")
        
        if not isinstance(input_data, pd.DataFrame):
            input_data = pd.DataFrame(input_data)
        
        config = node.config
        transform_type = config.get('type')
        field = config.get('field')
        
        result_df = input_data.copy()
        
        if transform_type == 'formula':
            expression = config.get('expression')
            new_field = config.get('new_field')
            if expression and new_field:
                result_df[new_field] = result_df.eval(expression)
                
        elif transform_type == 'rename':
            new_field = config.get('new_field')
            if field and new_field:
                result_df = result_df.rename(columns={field: new_field})
                
        elif transform_type == 'cast':
            target_type = config.get('target_type')
            if field and target_type:
                if target_type.lower() == 'int':
                    result_df[field] = pd.to_numeric(result_df[field], errors='coerce').astype('Int64')
                elif target_type.lower() == 'float':
                    result_df[field] = pd.to_numeric(result_df[field], errors='coerce')
                elif target_type.lower() == 'str':
                    result_df[field] = result_df[field].astype(str)
                elif target_type.lower() == 'datetime':
                    result_df[field] = pd.to_datetime(result_df[field], errors='coerce')
        
        return result_df
    
    def validate_config(self, config: Dict[str, Any]) -> bool:
        required_fields = ['type']
        return all(field in config for field in required_fields)

class CacheHandler(ProcessingNodeHandler):
    """缓存节点处理器"""
    
    async def execute(self, node: ProcessingNode, context: Dict[str, Any]) -> Any:
        input_data = context.get('input_data')
        config = node.config
        
        # 生成缓存键
        cache_key = config.get('cache_key')
        if not cache_key:
            # 基于输入数据生成缓存键
            import hashlib
            data_hash = hashlib.md5(str(input_data).encode()).hexdigest()
            cache_key = f"workflow_result:{data_hash}"
        
        ttl = config.get('ttl', 3600)
        
        # 缓存数据
        await cache_service.cache_dataset(cache_key, {
            'data': input_data,
            'metadata': config.get('metadata', {}),
            'node_id': node.id
        }, ttl)
        
        return input_data
    
    def validate_config(self, config: Dict[str, Any]) -> bool:
        return True

# 节点处理器注册表
NODE_HANDLERS = {
    NodeType.DATA_SOURCE: DataSourceHandler(),
    NodeType.QUERY: QueryHandler(),
    NodeType.FILTER: FilterHandler(),
    NodeType.AGGREGATE: AggregateHandler(),
    NodeType.TRANSFORM: TransformHandler(),
    NodeType.CACHE: CacheHandler()
}

class WorkflowOrchestrator:
    """工作流编排器 - 类似Metabase的处理管道"""
    
    def __init__(self):
        self.nodes: Dict[str, ProcessingNode] = {}
        self.execution_order: List[str] = []
        self.results: Dict[str, Any] = {}
        
    def add_node(self, node: ProcessingNode):
        """添加处理节点"""
        if not NODE_HANDLERS.get(node.type):
            raise ValueError(f"Unsupported node type: {node.type}")
        
        if not NODE_HANDLERS[node.type].validate_config(node.config):
            raise ValueError(f"Invalid configuration for node {node.id}")
        
        self.nodes[node.id] = node
        
    def build_execution_order(self):
        """构建执行顺序（拓扑排序）"""
        # 简化的拓扑排序实现
        visited = set()
        temp_visited = set()
        order = []
        
        def visit(node_id: str):
            if node_id in temp_visited:
                raise ValueError("Circular dependency detected")
            
            if node_id in visited:
                return
            
            temp_visited.add(node_id)
            
            node = self.nodes[node_id]
            for dep_id in node.dependencies:
                if dep_id in self.nodes:
                    visit(dep_id)
            
            temp_visited.remove(node_id)
            visited.add(node_id)
            order.append(node_id)
        
        # 访问所有没有被依赖的节点
        for node_id in self.nodes:
            if node_id not in visited:
                visit(node_id)
        
        self.execution_order = order
    
    async def execute_workflow(self, initial_context: Dict[str, Any] = None) -> Dict[str, Any]:
        """执行整个工作流"""
        if not self.execution_order:
            self.build_execution_order()
        
        context = initial_context or {}
        execution_results = {}
        
        for node_id in self.execution_order:
            node = self.nodes[node_id]
            node.status = NodeStatus.RUNNING
            node.started_at = datetime.now()
            
            try:
                handler = NODE_HANDLERS[node.type]
                result = await handler.execute(node, context)
                
                node.result = result
                node.status = NodeStatus.COMPLETED
                node.completed_at = datetime.now()
                execution_results[node_id] = result
                
                # 更新上下文供后续节点使用
                context['input_data'] = result
                context[f'node_{node_id}_result'] = result
                
                logger.info(f"Node {node_id} executed successfully")
                
            except Exception as e:
                node.status = NodeStatus.FAILED
                node.error = str(e)
                node.completed_at = datetime.now()
                logger.error(f"Node {node_id} failed: {e}")
                raise Exception(f"Workflow failed at node {node_id}: {e}")
        
        return {
            'results': execution_results,
            'final_result': context.get('input_data'),
            'execution_order': self.execution_order,
            'context': context
        }
    
    def get_workflow_status(self) -> Dict[str, Any]:
        """获取工作流状态"""
        return {
            'nodes': {
                node_id: {
                    'id': node.id,
                    'name': node.name,
                    'type': node.type.value,
                    'status': node.status.value,
                    'dependencies': node.dependencies,
                    'error': node.error,
                    'execution_time': node.execution_time
                }
                for node_id, node in self.nodes.items()
            },
            'execution_order': self.execution_order
        }

# 便捷的工厂方法
def create_workflow_from_config(workflow_config: Dict[str, Any]) -> WorkflowOrchestrator:
    """从配置创建工作流"""
    orchestrator = WorkflowOrchestrator()
    
    nodes_config = workflow_config.get('nodes', [])
    for node_config in nodes_config:
        node = ProcessingNode(
            id=node_config['id'],
            type=NodeType(node_config['type']),
            name=node_config.get('name', node_config['id']),
            config=node_config.get('config', {}),
            dependencies=node_config.get('dependencies', [])
        )
        orchestrator.add_node(node)
    
    return orchestrator