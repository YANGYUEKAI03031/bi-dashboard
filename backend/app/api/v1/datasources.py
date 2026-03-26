from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine
from sqlalchemy import text, select, asc
from typing import List, Dict, Any, Optional
from app.db.session import get_db
from pydantic import BaseModel
import logging
import re

from app.models.visualization import Database
from app.core.security import get_current_user_id

router = APIRouter(tags=["visualization-datasources"])

logger = logging.getLogger(__name__)


class DataSourceInfo(BaseModel):
    """前端使用的数据源信息结构"""
    id: str
    name: str
    type: str  # mysql / postgres / etc.


class ColumnInfo(BaseModel):
    name: str
    type: str
    is_nullable: bool
    default_value: Optional[str] = None


class TableInfo(BaseModel):
    name: str
    columns: List[ColumnInfo] = []


class QueryRequest(BaseModel):
    """通用查询请求体"""
    data_source_id: str
    query: str


def _build_mysql_url(db_model: Database) -> str:
    """根据Database记录构建异步MySQL连接URL"""
    return (
        f"mysql+aiomysql://{db_model.username}:{db_model.password}"
        f"@{db_model.host}:{db_model.port}/{db_model.database_name}"
    )


def _validate_safe_select_sql(sql: str, max_rows: int = 5000) -> str:
    """
    基础安全校验：只允许单条 SELECT 语句，并自动追加/收紧 LIMIT
    """
    if not sql:
        raise HTTPException(status_code=400, detail="查询语句不能为空")

    raw = sql.strip().rstrip(";")

    # 只允许 SELECT 开头
    if not raw.lower().startswith("select"):
        raise HTTPException(status_code=400, detail="当前接口仅支持只读的 SELECT 查询")

    # 禁止危险关键字（简单兜底）
    forbidden = ["insert ", "update ", "delete ", "drop ", "alter ", "truncate ", "create "]
    lowered = raw.lower()
    if any(kw in lowered for kw in forbidden):
        raise HTTPException(status_code=400, detail="查询中包含不安全关键字，仅允许只读查询")

    # 如果已存在 LIMIT，则收紧到 max_rows
    limit_match = re.search(r"limit\s+(\d+)", lowered)
    if limit_match:
        try:
            current_limit = int(limit_match.group(1))
            if current_limit > max_rows:
                # 将原来的 LIMIT 替换为更小的 max_rows
                raw = re.sub(r"limit\s+\d+", f"LIMIT {max_rows}", raw, flags=re.IGNORECASE)
        except ValueError:
            # 无法解析就直接覆盖
            raw = re.sub(r"limit\s+\S+", f"LIMIT {max_rows}", raw, flags=re.IGNORECASE)
    else:
        raw = f"{raw} LIMIT {max_rows}"

    return raw


@router.get("/", response_model=List[DataSourceInfo])
async def get_visualization_datasources(db: AsyncSession = Depends(get_db)):
    """
    获取可视化可用的数据源列表

    直接基于现有 users.databases 表（对应模型 Database），不再使用环境变量。
    """
    try:
        stmt = (
            select(Database)
            .where(Database.is_active == True)  # noqa: E712
            .order_by(asc(Database.id))
        )
        result = await db.execute(stmt)
        databases: List[Database] = list(result.scalars().all())

        datasources: List[DataSourceInfo] = []
        for d in databases:
            # 目前主要支持 mysql，引擎字段可以直接复用
            ds_type = (d.engine or "mysql").lower()
            datasources.append(
                DataSourceInfo(
                    id=str(d.id),
                    name=d.name or f"{ds_type.upper()} - {d.database_name}",
                    type=ds_type,
                )
            )

        logger.info("返回 %d 个可视化数据源", len(datasources))
        return datasources

    except Exception as e:
        logger.error("获取数据源列表失败: %s", e)
        raise HTTPException(status_code=500, detail=f"获取数据源列表失败: {str(e)}")


async def _get_database_or_404(db: AsyncSession, data_source_id: str) -> Database:
    """根据 data_source_id 获取 Database 记录"""
    try:
        ds_id_int = int(data_source_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="无效的数据源ID")

    db_model = await db.get(Database, ds_id_int)
    if not db_model or not db_model.is_active:
        raise HTTPException(status_code=404, detail="数据源不存在或已停用")

    return db_model


@router.get("/{data_source_id}/tables", response_model=List[TableInfo])
async def get_tables(data_source_id: str, db: AsyncSession = Depends(get_db)):
    """
    获取指定数据源的表列表

    data_source_id 来自 users.databases.id
    """
    try:
        db_model = await _get_database_or_404(db, data_source_id)

        # 仅支持 MySQL（后续可以按 engine 拓展）
        if (db_model.engine or "").lower() != "mysql":
            raise HTTPException(status_code=400, detail=f"暂不支持的数据源类型: {db_model.engine}")

        db_url = _build_mysql_url(db_model)
        temp_engine = create_async_engine(db_url)

        try:
            table_infos: List[TableInfo] = []
            async with temp_engine.connect() as conn:
                # SHOW TABLES
                result = await conn.execute(text("SHOW TABLES"))
                tables = result.fetchall()

                for table in tables:
                    table_name = table[0]

                    # DESCRIBE `table_name`
                    describe_result = await conn.execute(text(f"DESCRIBE `{table_name}`"))
                    columns_info = describe_result.fetchall()

                    columns: List[ColumnInfo] = []
                    for col in columns_info:
                        columns.append(
                            ColumnInfo(
                                name=col[0],
                                type=col[1],
                                is_nullable=col[2] == "YES",
                                default_value=col[4],
                            )
                        )

                    table_infos.append(TableInfo(name=table_name, columns=columns))

            return table_infos
        finally:
            await temp_engine.dispose()

    except HTTPException:
        raise
    except Exception as e:
        logger.error("获取表列表失败: %s", e)
        raise HTTPException(status_code=500, detail=f"获取表列表失败: {str(e)}")


@router.get("/{data_source_id}/tables/{table_name}/columns", response_model=List[ColumnInfo])
async def get_table_columns(
    data_source_id: str,
    table_name: str,
    db: AsyncSession = Depends(get_db),
):
    """获取指定数据源中某个表的列信息"""
    try:
        db_model = await _get_database_or_404(db, data_source_id)

        if (db_model.engine or "").lower() != "mysql":
            raise HTTPException(status_code=400, detail=f"暂不支持的数据源类型: {db_model.engine}")

        db_url = _build_mysql_url(db_model)
        temp_engine = create_async_engine(db_url)

        try:
            async with temp_engine.connect() as conn:
                result = await conn.execute(text(f"DESCRIBE `{table_name}`"))
                columns_info = result.fetchall()

                columns: List[ColumnInfo] = []
                for col in columns_info:
                    columns.append(
                        ColumnInfo(
                            name=col[0],
                            type=col[1],
                            is_nullable=col[2] == "YES",
                            default_value=col[4],
                        )
                    )

                return columns
        finally:
            await temp_engine.dispose()

    except HTTPException:
        raise
    except Exception as e:
        logger.error("获取列信息失败: %s", e)
        raise HTTPException(status_code=500, detail=f"获取列信息失败: {str(e)}")


@router.post("/query")
async def execute_query(payload: QueryRequest, db: AsyncSession = Depends(get_db)):
    """
    针对指定 data_source_id 执行只读 SQL 查询

    - 只允许 SELECT 语句
    - 自动追加/收紧 LIMIT，防止一次性拉太多数据
    """
    try:
        db_model = await _get_database_or_404(db, payload.data_source_id)

        if (db_model.engine or "").lower() != "mysql":
            raise HTTPException(status_code=400, detail=f"暂不支持的数据源类型: {db_model.engine}")

        safe_sql = _validate_safe_select_sql(payload.query)
        db_url = _build_mysql_url(db_model)
        temp_engine = create_async_engine(db_url)

        try:
            async with temp_engine.connect() as conn:
                result = await conn.execute(text(safe_sql))
                rows = result.fetchall()

                # 列名
                column_names = list(result.keys()) if result.keys() else [
                    f"column_{i}" for i in range(len(rows[0]) if rows else 0)
                ]

                # 转为行字典
                result_rows: List[Dict[str, Any]] = []
                for row in rows:
                    row_dict: Dict[str, Any] = {}
                    for i, value in enumerate(row):
                        col_name = column_names[i] if i < len(column_names) else f"column_{i}"
                        row_dict[col_name] = value
                    result_rows.append(row_dict)

                return {
                    "columns": column_names,
                    "rows": result_rows,
                    "row_count": len(result_rows),
                }
        finally:
            await temp_engine.dispose()

    except HTTPException:
        raise
    except Exception as e:
        logger.error("查询执行失败: %s", e)
        raise HTTPException(status_code=500, detail=f"查询执行失败: {str(e)}")


class ConnectionTestRequest(BaseModel):
    """测试连接请求：可以直接传配置，也可以传已有 data_source_id"""
    data_source_id: Optional[str] = None
    name: Optional[str] = None
    engine: Optional[str] = "mysql"
    host: Optional[str] = None
    port: Optional[int] = None
    username: Optional[str] = None
    password: Optional[str] = None
    database_name: Optional[str] = None


class CreateDataSourceRequest(BaseModel):
    """创建数据源请求体"""
    name: str
    engine: str = "mysql"
    host: str
    port: int
    username: str
    password: str
    database_name: str
    description: Optional[str] = None


@router.post("/datasources/test")
async def test_connection(payload: ConnectionTestRequest, db: AsyncSession = Depends(get_db)):
    """
    测试数据源连接

    - 如果提供 data_source_id，则基于数据库中的配置测试
    - 否则使用请求体中的 host/port/username/password/database_name 进行一次性测试
    """
    try:
        if payload.data_source_id:
            db_model = await _get_database_or_404(db, payload.data_source_id)
        else:
            # 使用临时配置
            if not all([payload.host, payload.port, payload.username, payload.password, payload.database_name]):
                raise HTTPException(status_code=400, detail="请提供完整的连接配置或已有的数据源ID")

            engine_name = (payload.engine or "mysql").lower()
            if engine_name != "mysql":
                raise HTTPException(status_code=400, detail="目前测试接口仅支持 MySQL")

            class _TmpDB:
                engine = engine_name
                host = payload.host
                port = payload.port
                username = payload.username
                password = payload.password
                database_name = payload.database_name

            db_model = _TmpDB()  # type: ignore

        if (db_model.engine or "").lower() != "mysql":
            raise HTTPException(status_code=400, detail=f"暂不支持的数据源类型: {db_model.engine}")

        db_url = _build_mysql_url(db_model)  # type: ignore[arg-type]
        temp_engine = create_async_engine(db_url)

        try:
            async with temp_engine.connect() as conn:
                # 简单执行 SELECT 1
                result = await conn.execute(text("SELECT 1"))
                ok = result.scalar() == 1

            if ok:
                return {"success": True, "message": "连接成功"}
            return {"success": False, "message": "连接测试失败"}
        finally:
            await temp_engine.dispose()

    except HTTPException:
        raise
    except Exception as e:
        logger.error("测试数据源连接失败: %s", e)
        raise HTTPException(status_code=500, detail=f"连接测试失败: {str(e)}")


@router.post("/datasources", response_model=DataSourceInfo)
async def create_datasource(
    payload: CreateDataSourceRequest,
    db: AsyncSession = Depends(get_db),
    user_id: int = Depends(get_current_user_id),
):
    """
    创建新的数据源配置（写入 databases 表）
    """
    try:
        # 目前主要支持 MySQL，其他类型后续可扩展
        engine_name = (payload.engine or "mysql").lower()
        if engine_name != "mysql":
            raise HTTPException(status_code=400, detail="当前仅支持 MySQL 数据源")

        db_model = Database(
            name=payload.name,
            engine=engine_name,
            host=payload.host,
            port=payload.port,
            username=payload.username,
            password=payload.password,
            database_name=payload.database_name,
            description=payload.description,
            is_active=True,
        )

        db.add(db_model)
        await db.commit()
        await db.refresh(db_model)

        return DataSourceInfo(
            id=str(db_model.id),
            name=db_model.name,
            type=(db_model.engine or "mysql").lower(),
        )
    except HTTPException:
        raise
    except Exception as e:
        await db.rollback()
        logger.error("创建数据源失败: %s", e)
        raise HTTPException(status_code=500, detail=f"创建数据源失败: {str(e)}")


@router.delete("/datasources/{data_source_id}")
async def delete_datasource(
    data_source_id: str,
    db: AsyncSession = Depends(get_db),
):
    """
    删除数据源配置

    约束：
    - 至少保留 1 个激活的数据源，最后一个视为“默认数据源”，不允许删除
    - 实际上是做软删除：将 is_active 置为 False
    """
    try:
        # 先获取目标数据源（含是否存在、是否已激活的检查）
        db_model = await _get_database_or_404(db, data_source_id)

        # 查询当前激活的数据源数量
        result = await db.execute(select(Database).where(Database.is_active == True))  # noqa: E712
        active_dbs = list(result.scalars().all())

        if len(active_dbs) <= 1:
            # 系统中仅剩的这个数据源视为“默认数据源”，不允许删除
            raise HTTPException(status_code=400, detail="默认数据源不允许删除")

        # 做软删除，避免影响历史可视化记录
        db_model.is_active = False
        await db.commit()

        return {"success": True}
    except HTTPException:
        raise
    except Exception as e:
        await db.rollback()
        logger.error("删除数据源失败: %s", e)
        raise HTTPException(status_code=500, detail=f"删除数据源失败: {str(e)}")