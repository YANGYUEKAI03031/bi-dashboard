# app/services/data_source_service.py
import aiomysql
from typing import List
from app.schemas.data_source import DataSource, TableInfo, ColumnInfo, QueryResponse
import os
from dotenv import load_dotenv

load_dotenv()

class DataSourceService:
    def __init__(self):
        # 从环境变量读取MySQL配置
        self.data_sources = {
            "mysql_db": {
                "host": os.getenv("MYSQL_HOST", "localhost"),
                "port": int(os.getenv("MYSQL_PORT", 3306)),
                "user": os.getenv("MYSQL_USER", "root"),
                "password": os.getenv("MYSQL_PASSWORD", ""),
                "database": os.getenv("MYSQL_DATABASE", "test")
            }
        }
    
    async def get_connection(self, data_source_id: str):
        """获取数据库连接"""
        if data_source_id not in self.data_sources:
            raise ValueError(f"数据源 {data_source_id} 不存在")
        
        config = self.data_sources[data_source_id]
        try:
            connection = await aiomysql.connect(
                host=config["host"],
                port=config["port"],
                user=config["user"],
                password=config["password"],
                db=config["database"],
                autocommit=True
            )
            return connection
        except Exception as e:
            raise Exception(f"数据库连接失败: {str(e)}")
    
    def get_data_sources(self) -> List[DataSource]:
        """获取所有数据源"""
        return [
            DataSource(
                id=data_source_id,
                name=f"{config['database']} ({config['host']})",
                type="mysql"
            )
            for data_source_id, config in self.data_sources.items()
        ]
    
    async def get_tables(self, data_source_id: str) -> List[TableInfo]:
        """获取表列表及字段信息"""
        connection = await self.get_connection(data_source_id)
        try:
            async with connection.cursor(aiomysql.DictCursor) as cursor:
                # 获取所有表名
                await cursor.execute("SHOW TABLES")
                tables_result = await cursor.fetchall()
                
                table_prefix = f"Tables_in_{self.data_sources[data_source_id]['database']}"
                tables = []
                
                for table_row in tables_result:
                    table_name = table_row[table_prefix]
                    
                    # 获取表的字段信息
                    await cursor.execute(f"DESCRIBE `{table_name}`")
                    columns_result = await cursor.fetchall()
                    
                    columns = [
                        ColumnInfo(
                            name=col['Field'],
                            type=col['Type'],
                            is_nullable=col['Null'] == 'YES',
                            default_value=col['Default']
                        )
                        for col in columns_result
                    ]
                    
                    tables.append(TableInfo(name=table_name, columns=columns))
                
                return tables
        except Exception as e:
            raise Exception(f"获取表信息失败: {str(e)}")
        finally:
            connection.close()
    
    async def execute_preview_query(self, data_source_id: str, query: str) -> QueryResponse:
        """执行预览查询"""
        # 安全检查
        query_upper = query.strip().upper()
        if not query_upper.startswith('SELECT'):
            raise ValueError("只允许执行SELECT查询")
        
        # 检查危险关键字
        dangerous_keywords = ['DROP', 'DELETE', 'UPDATE', 'INSERT', 'CREATE', 'ALTER', 'TRUNCATE']
        if any(keyword in query_upper for keyword in dangerous_keywords):
            raise ValueError("查询包含不允许的操作")
        
        connection = await self.get_connection(data_source_id)
        try:
            async with connection.cursor(aiomysql.DictCursor) as cursor:
                await cursor.execute(query)
                rows = await cursor.fetchall()
                
                # 获取列名
                columns = list(rows[0].keys()) if rows else []
                
                return QueryResponse(
                    columns=columns,
                    rows=rows,
                    row_count=len(rows)
                )
        except Exception as e:
            raise Exception(f"查询执行失败: {str(e)}")
        finally:
            connection.close()