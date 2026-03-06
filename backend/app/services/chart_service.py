# backend/app/services/chart_service.py
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, update, delete, text
from sqlalchemy.exc import SQLAlchemyError
from typing import List, Optional, Dict, Any
from datetime import datetime
import json
import logging
from sqlalchemy.ext.asyncio import create_async_engine
import re

from app.models.visualization import VisualizationCard, Database
from app.schemas.chart import ChartCreate, ChartUpdate
from app.core.security import get_current_user_id

logger = logging.getLogger(__name__)

def _normalize_identifier_part(part: str) -> str:
    p = (part or "").strip()
    if p.startswith("`") and p.endswith("`") and len(p) >= 2:
        p = p[1:-1]
    return p

def _quote_mysql_identifier(identifier: str) -> str:
    """
    Quote MySQL identifiers safely.
    Supports schema-qualified names like db.table by quoting each segment: `db`.`table`.
    """
    raw = (identifier or "").strip()
    if not raw:
        raise ValueError("identifier is empty")

    parts = [p for p in re.split(r"\s*\.\s*", raw) if p]
    normalized = [_normalize_identifier_part(p) for p in parts]
    escaped = [p.replace("`", "``") for p in normalized]
    return ".".join(f"`{p}`" for p in escaped)

class ChartService:
    def __init__(self, db: AsyncSession):
        self.db = db
    
    async def create_chart(self, chart_data: ChartCreate, user_id: int) -> VisualizationCard:
        """创建新图表 - 适配现有表结构"""
        try:
            # 安全地提取SQL查询语句和表名
            query_sql = ""
            table_name = None
            try:
                # 处理dataset_query可能是字典的情况
                dataset_dict = chart_data.dataset_query.dict() if hasattr(chart_data.dataset_query, 'dict') else chart_data.dataset_query
                
                if isinstance(dataset_dict, dict) and 'native' in dataset_dict:
                    native_config = dataset_dict['native']
                    if isinstance(native_config, dict) and 'query' in native_config:
                        query_sql = native_config['query'] or ""
                        
                        # 提取表名（从SQL中解析）
                        import re
                        from_clause = re.search(r'FROM\s+([a-zA-Z0-9_]+)', query_sql, re.IGNORECASE)
                        if from_clause:
                            table_name = from_clause.group(1)
            except Exception as e:
                logger.warning(f"提取SQL查询时出错: {e}")
                query_sql = ""
            
            # 为所有必填字段提供默认值
            chart = VisualizationCard(
                name=chart_data.name,
                description=chart_data.description or '',
                chart_type=chart_data.chart_type,
                dataset_query=json.dumps(chart_data.dataset_query.dict() if hasattr(chart_data.dataset_query, 'dict') else chart_data.dataset_query),
                visualization_settings=json.dumps(chart_data.visualization_settings.dict() if hasattr(chart_data.visualization_settings, 'dict') else chart_data.visualization_settings),
                config={},  # 为config字段提供默认值
                query_sql=query_sql,  # 安全提取的SQL语句
                table_name=table_name,  # 新增：表名信息
                data_source_id=chart_data.database_id,
                created_by=user_id,
                is_public=chart_data.is_public if hasattr(chart_data, 'is_public') else False,
                archived=False,
                public_uuid=None,
                cache_enabled=chart_data.cache_enabled if hasattr(chart_data, 'cache_enabled') else True,
                cache_duration=chart_data.cache_duration if hasattr(chart_data, 'cache_duration') else 3600,
                last_cached_at=None
            )
            
            self.db.add(chart)
            await self.db.commit()
            await self.db.refresh(chart)
            
            logger.info(f"图表创建成功: {chart.name} (ID: {chart.id})")
            return chart
            
        except SQLAlchemyError as e:
            await self.db.rollback()
            logger.error(f"创建图表失败: {str(e)}")
            raise Exception(f"创建图表失败: {str(e)}")
        except Exception as e:
            await self.db.rollback()
            logger.error(f"创建图表时发生未预期错误: {str(e)}")
            raise Exception(f"创建图表失败: {str(e)}")
    
    async def get_chart(self, chart_id: int, user_id: int) -> Optional[VisualizationCard]:
        """获取单个图表"""
        try:
            stmt = select(VisualizationCard).where(
                VisualizationCard.id == chart_id,
                VisualizationCard.created_by == user_id,
                VisualizationCard.archived == False
            )
            result = await self.db.execute(stmt)
            return result.scalar_one_or_none()
        except SQLAlchemyError as e:
            logger.error(f"获取图表失败: {str(e)}")
            raise Exception(f"获取图表失败: {str(e)}")
    
    async def get_user_charts(self, user_id: int, skip: int = 0, limit: int = 100) -> List[VisualizationCard]:
        """获取用户的所有图表"""
        try:
            stmt = select(VisualizationCard).where(
                VisualizationCard.created_by == user_id,
                VisualizationCard.archived == False
            ).offset(skip).limit(limit)
            result = await self.db.execute(stmt)
            return list(result.scalars().all())
        except SQLAlchemyError as e:
            logger.error(f"获取用户图表列表失败: {str(e)}")
            raise Exception(f"获取用户图表列表失败: {str(e)}")
    
    async def update_chart(self, chart_id: int, update_data: ChartUpdate, user_id: int) -> Optional[VisualizationCard]:
        """更新图表"""
        try:
            chart = await self.get_chart(chart_id, user_id)
            if not chart:
                return None
            
            # 更新字段
            update_fields = {}
            if update_data.name is not None:
                update_fields[VisualizationCard.name] = update_data.name
            if update_data.description is not None:
                update_fields[VisualizationCard.description] = update_data.description
            if update_data.chart_type is not None:
                update_fields[VisualizationCard.chart_type] = update_data.chart_type
            if update_data.dataset_query is not None:
                update_fields[VisualizationCard.dataset_query] = json.dumps(update_data.dataset_query.dict() if hasattr(update_data.dataset_query, 'dict') else update_data.dataset_query)
                # 安全地提取并更新query_sql字段和table_name
                try:
                    dataset_dict = update_data.dataset_query.dict() if hasattr(update_data.dataset_query, 'dict') else update_data.dataset_query
                    if isinstance(dataset_dict, dict) and 'native' in dataset_dict:
                        native_config = dataset_dict['native']
                        if isinstance(native_config, dict) and 'query' in native_config:
                            update_fields[VisualizationCard.query_sql] = native_config['query'] or ""
                            
                            # 提取表名（从SQL中解析）
                            import re
                            from_clause = re.search(r'FROM\s+([a-zA-Z0-9_]+)', native_config['query'], re.IGNORECASE)
                            if from_clause:
                                update_fields[VisualizationCard.table_name] = from_clause.group(1)
                            else:
                                update_fields[VisualizationCard.table_name] = None
                except Exception as e:
                    logger.warning(f"更新时提取SQL查询时出错: {e}")
            if update_data.visualization_settings is not None:
                update_fields[VisualizationCard.visualization_settings] = json.dumps(update_data.visualization_settings.dict() if hasattr(update_data.visualization_settings, 'dict') else update_data.visualization_settings)
            if update_data.database_id is not None:
                update_fields[VisualizationCard.data_source_id] = update_data.database_id
            if hasattr(update_data, 'is_public') and update_data.is_public is not None:
                update_fields[VisualizationCard.is_public] = update_data.is_public
            if hasattr(update_data, 'cache_enabled') and update_data.cache_enabled is not None:
                update_fields[VisualizationCard.cache_enabled] = update_data.cache_enabled
            if hasattr(update_data, 'cache_duration') and update_data.cache_duration is not None:
                update_fields[VisualizationCard.cache_duration] = update_data.cache_duration
            
            # 更新时间戳
            update_fields[VisualizationCard.updated_at] = datetime.utcnow()
            
            if update_fields:
                stmt = update(VisualizationCard).where(
                    VisualizationCard.id == chart_id,
                    VisualizationCard.created_by == user_id
                ).values(**{col.name: val for col, val in update_fields.items()})
                
                await self.db.execute(stmt)
                await self.db.commit()
                await self.db.refresh(chart)
                
                logger.info(f"图表更新成功: {chart.name} (ID: {chart.id})")
            
            return chart
            
        except SQLAlchemyError as e:
            await self.db.rollback()
            logger.error(f"更新图表失败: {str(e)}")
            raise Exception(f"更新图表失败: {str(e)}")
    
    async def delete_chart(self, chart_id: int, user_id: int) -> bool:
        """删除图表（软删除）"""
        try:
            chart = await self.get_chart(chart_id, user_id)
            if not chart:
                return False
            
            # 软删除：标记为已归档
            stmt = update(VisualizationCard).where(
                VisualizationCard.id == chart_id,
                VisualizationCard.created_by == user_id
            ).values(
                archived=True,
                updated_at=datetime.utcnow()
            )
            
            await self.db.execute(stmt)
            await self.db.commit()
            
            logger.info(f"图表软删除成功: {chart.name} (ID: {chart.id})")
            return True
            
        except SQLAlchemyError as e:
            await self.db.rollback()
            logger.error(f"删除图表失败: {str(e)}")
            raise Exception(f"删除图表失败: {str(e)}")
    
    async def execute_chart_query(self, chart: VisualizationCard, filter_params: Dict[str, Any] = None) -> List[Dict]:
        """执行图表的SQL查询（支持筛选器参数 - 自动生成WHERE条件）"""
        try:
            filter_params = filter_params or {}

            logger.info(f"execute_chart_query 接收到的 filter_params: {filter_params}")

            # 解析dataset_query获取SQL
            dataset_query = chart.dataset_query
            if isinstance(dataset_query, str):
                dataset_query = json.loads(dataset_query)
            
            sql_query = dataset_query.get('native', {}).get('query', '')
            if not sql_query:
                return []
            
            # ========== 方案2: 自动生成 WHERE 条件 ==========
            # 构建WHERE子句
            where_conditions = []

            # 提取SQL中使用的所有字段（简单匹配）
            import re
            sql_field_pattern = re.compile(r'`?(\w+)`?\s*(?:AS\s+\w+)?(?:,|\s+FROM|\s+WHERE|\s+AND|\s+OR|\s+GROUP|\s+ORDER|\s+LIMIT|$)', re.IGNORECASE)
            # 更准确地提取字段名
            sql_fields = set()
            # 匹配 SELECT ... FROM 之间的字段
            select_match = re.search(r'SELECT\s+(.+?)\s+FROM', sql_query, re.IGNORECASE | re.DOTALL)
            if select_match:
                select_fields = select_match.group(1)
                # 提取字段名（忽略函数和表达式）
                for field in select_fields.split(','):
                    field = field.strip()
                    # 匹配 `field` 或 field 或 field AS alias
                    field_match = re.match(r'`?(\w+)`?(?:\s+AS|\s+|$)', field, re.IGNORECASE)
                    if field_match:
                        sql_fields.add(field_match.group(1).lower())

            logger.info(f"SQL中检测到的字段: {sql_fields}")

            for param_name, param_value in filter_params.items():
                if param_value is None or param_value == '':
                    continue

                # 处理 filterId_fieldName 格式的key，提取真正的字段名
                # 例如: "1_支付日期" -> "支付日期"
                actual_field_name = param_name
                if '_' in param_name:
                    # 检查是否是数字开头（filterId）
                    parts = param_name.split('_', 1)
                    if parts[0].isdigit() and len(parts) == 2:
                        actual_field_name = parts[1]
                        logger.info(f"解析筛选器参数: {param_name} -> {actual_field_name}")

                # 检查字段是否在SQL中使用
                if actual_field_name.lower() not in sql_fields:
                    logger.info(f"字段 '{actual_field_name}' 不在SQL中，跳过筛选条件")
                    continue

                # 处理日期范围 {start: '...', end: '...'}
                if isinstance(param_value, dict) and 'start' in param_value and 'end' in param_value:
                    start_value = param_value.get('start')
                    end_value = param_value.get('end')
                    if start_value and end_value:
                        # 日期范围: BETWEEN
                        condition = f"`{actual_field_name}` BETWEEN '{start_value}' AND '{end_value}'"
                        where_conditions.append(condition)
                    elif start_value:
                        # 只有开始日期: >=
                        condition = f"`{actual_field_name}` >= '{start_value}'"
                        where_conditions.append(condition)
                    elif end_value:
                        # 只有结束日期: <=
                        condition = f"`{actual_field_name}` <= '{end_value}'"
                        where_conditions.append(condition)
                # 处理多值列表 ['广东', '浙江']
                elif isinstance(param_value, list) and len(param_value) > 0:
                    values_str = "', '".join(str(v) for v in param_value)
                    condition = f"`{actual_field_name}` IN ('{values_str}')"
                    where_conditions.append(condition)
                # 处理单值 '广东'
                else:
                    condition = f"`{actual_field_name}` = '{param_value}'"
                    where_conditions.append(condition)
            
            # 将生成的WHERE条件拼接到SQL中
            if where_conditions:
                where_clause = " AND ".join(where_conditions)
                
                # 检查SQL是否已包含WHERE子句
                sql_upper = sql_query.upper().strip()
                if 'WHERE' in sql_upper:
                    # 已有WHERE子句，追加AND条件
                    # 找到WHERE关键字的位置，在其后面添加条件
                    import re
                    # 使用正则找到WHERE后面的位置
                    match = re.search(r'\bWHERE\b', sql_query, re.IGNORECASE)
                    if match:
                        insert_pos = match.end()
                        sql_query = sql_query[:insert_pos] + " " + where_clause + " AND" + sql_query[insert_pos:]
                else:
                    # 没有WHERE子句，需要正确插入位置
                    # SQL正确顺序: SELECT ... FROM ... [WHERE ...] [GROUP BY ...] [ORDER BY ...] [LIMIT ...]
                    # 需要找到 LIMIT/ORDER BY/GROUP BY 的位置，在它们之前插入 WHERE
                    import re
                    
                    # 查找各个子句的位置
                    limit_match = re.search(r'\bLIMIT\b', sql_query, re.IGNORECASE)
                    order_match = re.search(r'\bORDER\s+BY\b', sql_query, re.IGNORECASE)
                    group_match = re.search(r'\bGROUP\s+BY\b', sql_query, re.IGNORECASE)
                    
                    # 找到最早出现的位置
                    positions = []
                    if limit_match:
                        positions.append(limit_match.start())
                    if order_match:
                        positions.append(order_match.start())
                    if group_match:
                        positions.append(group_match.start())
                    
                    if positions:
                        # 在最早的关键字之前插入 WHERE
                        insert_pos = min(positions)
                        sql_query = sql_query[:insert_pos] + " WHERE " + where_clause + " " + sql_query[insert_pos:]
                    else:
                        # 没有找到任何关键字，直接在末尾添加（但要在;之前）
                        sql_query = sql_query.rstrip().rstrip(';') + " WHERE " + where_clause
            
            logger.info(f"执行SQL查询（自动生成WHERE后）: {sql_query[:200]}...")
            # ========== 方案2 结束 ==========
            
            # 获取数据源连接信息
            db_model = await self.db.get(Database, chart.data_source_id)
            if not db_model:
                raise Exception("数据源不存在")
            
            # 构建数据库连接URL
            db_url = f"mysql+aiomysql://{db_model.username}:{db_model.password}@{db_model.host}:{db_model.port}/{db_model.database_name}"
            
            # 创建临时连接执行查询
            temp_engine = create_async_engine(db_url)
            try:
                async with temp_engine.connect() as conn:
                    result = await conn.execute(text(sql_query))
                    rows = result.fetchall()
                    
                    # 转换为字典列表
                    columns = result.keys()
                    data = [dict(zip(columns, row)) for row in rows]
                    
                    return data
            finally:
                await temp_engine.dispose()
                
        except Exception as e:
            logger.error(f"执行查询失败: {str(e)}")
            raise Exception(f"查询执行失败: {str(e)}")

    async def get_filter_options(self, data_source_id: int, table_name: str, field_name: str, limit: int = 100) -> List[Any]:
        """获取筛选器的选项列表（从数据库查询唯一值）"""
        try:
            # 获取数据源连接信息
            db_model = await self.db.get(Database, data_source_id)
            if not db_model:
                raise Exception("数据源不存在")
            
            # 构建数据库连接URL
            db_url = f"mysql+aiomysql://{db_model.username}:{db_model.password}@{db_model.host}:{db_model.port}/{db_model.database_name}"
            
            # 构建查询SQL
            # 注意：这里是单表取唯一值；如果 field_name 带别名/前缀（如 t.col），只取最后一段 col
            base_field_name = (field_name or "").strip()
            if "." in base_field_name:
                base_field_name = base_field_name.split(".")[-1].strip()
            if not base_field_name:
                raise Exception("字段名为空")

            quoted_table = _quote_mysql_identifier(table_name)
            quoted_field = _quote_mysql_identifier(base_field_name)
            safe_limit = int(limit) if limit is not None else 100
            if safe_limit < 1:
                safe_limit = 1

            sql_query = (
                f"SELECT DISTINCT {quoted_field} AS value "
                f"FROM {quoted_table} "
                f"WHERE {quoted_field} IS NOT NULL "
                f"ORDER BY {quoted_field} "
                f"LIMIT {safe_limit}"
            )
            
            # 创建临时连接执行查询
            temp_engine = create_async_engine(db_url)
            try:
                async with temp_engine.connect() as conn:
                    result = await conn.execute(text(sql_query))
                    rows = result.fetchall()
                    
                    # 提取值
                    options = [row[0] for row in rows if row and row[0] is not None]
                    
                    return options
            finally:
                await temp_engine.dispose()
                
        except Exception as e:
            logger.error(f"获取筛选器选项失败: {str(e)}")
            raise Exception(f"获取筛选器选项失败: {str(e)}")