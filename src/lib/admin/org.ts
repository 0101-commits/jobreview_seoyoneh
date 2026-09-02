import {
  ApiResult,
  NO_DB,
  Row,
  byKorean,
  fail,
  ok,
  str,
  supabase,
} from './shared';

// ────────────────────────────────────────────────────────────────────
// 1. 조직 트리 (§6-3 ⓐ 진행 매트릭스의 행)
// ────────────────────────────────────────────────────────────────────

export interface OrgUnit {
  id: string;
  parentId: string | null;
  code: string;
  name: string;
  active: boolean;
}

/** 트리 노드. depth는 0부터(들여쓰기용). */
export interface OrgNode extends OrgUnit {
  children: OrgNode[];
  depth: number;
}

/**
 * parent_id가 가리키는 부모가 목록에 없거나(고아), 자기 자신이거나, 부모를 따라 올라가다
 * 자기에게 돌아오면(순환) 그 노드를 뿌리로 올린다. 업로드 실수 한 줄 때문에 그 아래 조직이
 * 통째로 사라지거나 렌더링이 무한히 도는 것을 막는다 — 데이터를 감추지 않고 위치만 바꾼다.
 */
export function buildOrgTree(units: OrgUnit[]): OrgNode[] {
  const byId = new Map<string, OrgNode>();
  for (const u of units) byId.set(u.id, { ...u, children: [], depth: 0 });

  const isAncestorOfSelf = (node: OrgNode, parent: OrgNode): boolean => {
    const seen = new Set<string>([node.id]);
    let cur: OrgNode | undefined = parent;
    while (cur) {
      if (seen.has(cur.id)) return true; // node로 되돌아왔거나, 부모들 사이에 이미 순환이 있다
      seen.add(cur.id);
      cur = cur.parentId ? byId.get(cur.parentId) : undefined;
    }
    return false;
  };

  const roots: OrgNode[] = [];
  for (const node of byId.values()) {
    const parent = node.parentId ? byId.get(node.parentId) : undefined;
    if (!parent || parent.id === node.id || isAncestorOfSelf(node, parent)) {
      roots.push(node);
      continue;
    }
    parent.children.push(node);
  }

  const walk = (node: OrgNode, depth: number) => {
    node.depth = depth;
    node.children.sort((a, b) => byKorean(a.name, b.name));
    for (const child of node.children) walk(child, depth + 1);
  };
  roots.sort((a, b) => byKorean(a.name, b.name));
  for (const root of roots) walk(root, 0);
  return roots;
}

/** 트리를 화면 행 순서(부모 → 자식)로 편다. 진행 매트릭스의 행 순서가 이것이다. */
export function flattenOrgTree(roots: OrgNode[]): OrgNode[] {
  const out: OrgNode[] = [];
  const walk = (node: OrgNode) => {
    out.push(node);
    for (const child of node.children) walk(child);
  };
  for (const root of roots) walk(root);
  return out;
}

/**
 * 조직 트리. 진행 매트릭스(§6-3 ⓐ)의 행과 조직 선택 UI가 쓴다.
 * 쿼리 1회. active=false 조직도 함께 준다 — 숨기면 그 조직 소속 SME의 응답이 화면에서 사라진다.
 * 화면이 active를 보고 회색 처리하거나 접으면 된다.
 */
export async function fetchOrgTree(companyId?: string | null): Promise<ApiResult<OrgNode[]>> {
  if (!supabase) return fail('조직 트리 조회', NO_DB);
  let query = supabase.from('org_units').select('id, parent_id, code, name, active').order('name');
  if (companyId) query = query.eq('company_id', companyId);

  const { data, error } = await query;
  if (error) return fail('조직 트리 조회', error.message);

  const units: OrgUnit[] = (data || []).map((raw) => {
    const r = raw as Row;
    return {
      id: str(r.id),
      parentId: str(r.parent_id) || null,
      code: str(r.code),
      name: str(r.name),
      active: r.active !== false,
    };
  });
  return ok(buildOrgTree(units));
}
