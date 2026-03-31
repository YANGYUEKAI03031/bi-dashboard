/**
 * 关联节点持久化 SQL：与 PipelineEngine._build_step_sql 占位符 {upstream_table_0/1} 一致，供创建/执行校验。
 */

function escIdent(name: string): string {
  return name.replace(/`/g, '``');
}

/** 对称差 UNION 每列：输出别名 + 左/右子查询中的列名（按位置对齐） */
export interface SymmetricUnionPlanRow {
  out: string;
  L?: string | null;
  R?: string | null;
}

const COLLATE_UNIFY = 'utf8mb4_unicode_ci';

/** 按左右预览列名位置 zip，用于生成统一 COLLATE 的 UNION 列清单 */
export function buildSymmetricUnionPlan(leftCols: string[], rightCols: string[]): SymmetricUnionPlanRow[] {
  const n = Math.max(leftCols.length, rightCols.length);
  const rows: SymmetricUnionPlanRow[] = [];
  for (let i = 0; i < n; i++) {
    const L = leftCols[i];
    const R = rightCols[i];
    const out = L || R || `col_${i}`;
    rows.push({ out, L: L ?? null, R: R ?? null });
  }
  return rows;
}

function symmetricDiffPersistedSql(
  onClause: string,
  rk0: string,
  lk0: string,
  plan: SymmetricUnionPlanRow[] | undefined
): string {
  const cast = (side: 'a' | 'b', col: string | null | undefined, alias: string) => {
    const a = escIdent(alias);
    if (!col) {
      return `CAST(NULL AS CHAR CHARACTER SET utf8mb4) COLLATE ${COLLATE_UNIFY} AS \`${a}\``;
    }
    const c = escIdent(col);
    const pref = side === 'a' ? 'a' : 'b';
    return `CAST(${pref}.\`${c}\` AS CHAR CHARACTER SET utf8mb4) COLLATE ${COLLATE_UNIFY} AS \`${a}\``;
  };

  let rows = plan?.filter(r => r.out || r.L || r.R) ?? [];
  if (rows.length === 0) {
    rows = [{ out: lk0 || rk0 || 'k', L: lk0 || null, R: rk0 || null }];
  }

  const selL = rows
    .map(r => {
      const alias = r.out || r.L || r.R || 'col';
      return cast('a', r.L ?? null, alias);
    })
    .join(', ');
  const selR = rows
    .map(r => {
      const alias = r.out || r.L || r.R || 'col';
      return cast('b', r.R ?? null, alias);
    })
    .join(', ');

  return (
    `SELECT ${selL} FROM {upstream_table_0} AS a LEFT JOIN {upstream_table_1} AS b ON ${onClause} WHERE b.\`${rk0}\` IS NULL ` +
    `UNION ALL ` +
    `SELECT ${selR} FROM {upstream_table_0} AS a RIGHT JOIN {upstream_table_1} AS b ON ${onClause} WHERE a.\`${lk0}\` IS NULL`
  );
}

export function buildJoinPersistedSql(
  joinType: string,
  keys: Array<{ leftCol?: string; rightCol?: string }>,
  symmetricUnionPlan?: SymmetricUnionPlanRow[]
): string {
  const valid = keys.filter(k => k.leftCol && k.rightCol);
  if (valid.length === 0) {
    return 'SELECT * FROM {upstream_table_0} AS a INNER JOIN {upstream_table_1} AS b ON 1=0';
  }
  const onClause = valid
          .map(
            k =>
              `a.\`${escIdent(String(k.leftCol))}\` COLLATE utf8mb4_unicode_ci = b.\`${escIdent(String(k.rightCol))}\` COLLATE utf8mb4_unicode_ci`
          )
          .join(' AND ');
  const rk0 = escIdent(String(valid[0].rightCol));
  const lk0 = escIdent(String(valid[0].leftCol));

  switch (joinType) {
    case 'left_anti':
      return `SELECT a.* FROM {upstream_table_0} AS a LEFT JOIN {upstream_table_1} AS b ON ${onClause} WHERE b.\`${rk0}\` IS NULL`;
    case 'right_anti':
      return `SELECT b.* FROM {upstream_table_0} AS a RIGHT JOIN {upstream_table_1} AS b ON ${onClause} WHERE a.\`${lk0}\` IS NULL`;
    case 'symmetric_diff':
      return symmetricDiffPersistedSql(onClause, rk0, lk0, symmetricUnionPlan);
    case 'full':
      return (
        `SELECT * FROM {upstream_table_0} AS a LEFT JOIN {upstream_table_1} AS b ON ${onClause} ` +
        `UNION ALL ` +
        `SELECT * FROM {upstream_table_0} AS a RIGHT JOIN {upstream_table_1} AS b ON ${onClause} WHERE a.\`${lk0}\` IS NULL`
      );
    default: {
      const jtMap: Record<string, string> = {
        inner: 'INNER JOIN',
        left: 'LEFT JOIN',
        right: 'RIGHT JOIN',
      };
      const jt = jtMap[joinType] || 'INNER JOIN';
      return `SELECT * FROM {upstream_table_0} AS a ${jt} {upstream_table_1} AS b ON ${onClause}`;
    }
  }
}

export type JoinVennRegions = { left: boolean; inner: boolean; right: boolean };

export type JoinDerivedType =
  | 'inner'
  | 'left'
  | 'right'
  | 'full'
  | 'left_anti'
  | 'right_anti'
  | 'symmetric_diff';

export function regionsToJoinType(r: JoinVennRegions): JoinDerivedType {
  const { left: L, inner: I, right: R } = r;
  if (!L && !I && !R) return 'inner';
  if (L && I && R) return 'full';
  if (L && I && !R) return 'left';
  if (!L && I && R) return 'right';
  if (!L && I && !R) return 'inner';
  if (L && !I && !R) return 'left_anti';
  if (!L && !I && R) return 'right_anti';
  if (L && !I && R) return 'symmetric_diff';
  return 'inner';
}

export function joinTypeToRegions(t: string): JoinVennRegions {
  switch (t) {
    case 'left':
      return { left: true, inner: true, right: false };
    case 'right':
      return { left: false, inner: true, right: true };
    case 'full':
      return { left: true, inner: true, right: true };
    case 'left_anti':
      return { left: true, inner: false, right: false };
    case 'right_anti':
      return { left: false, inner: false, right: true };
    case 'symmetric_diff':
      return { left: true, inner: false, right: true };
    case 'inner':
    default:
      return { left: false, inner: true, right: false };
  }
}
