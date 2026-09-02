/*
 * PostgREST 페이지 나눔 공용 헬퍼 (기획안 dcab2660 §7 아키텍처 D1).
 *
 * ▣ 왜 필요한가
 *   Supabase의 PostgREST는 응답을 db-max-rows(기본 1,000행)에서 자른다. 자를 때 오류가 아니라
 *   "그만큼만" 돌려주므로, 페이지를 나누지 않은 조회는 조용히 일부만 읽는다.
 *   이 앱에서 그 결과는 숫자가 아니라 판단이 된다 — 배정 1,001번째 행이 잘리면 그 SME는 화면에
 *   "미배정"으로 보이고, 잘린 FTE 행은 합계를 낮춰 워크숍 대상 판정을 바꾼다.
 *
 *   같은 순회 코드가 exportApi(fetchAll)·assignmentApi(fetchAllPages)·durationApi·snapshotApi에
 *   네 벌 있었고, 관리자 조회 네 곳은 아직 순회가 없었다. 규칙을 한곳에 둔다.
 *
 * ▣ 정렬을 강제하는 이유
 *   ORDER BY 없는 LIMIT/OFFSET의 행 순서는 PostgreSQL도 PostgREST도 보장하지 않는다.
 *   정렬 없이 range()를 두 번 부르면 같은 행이 두 페이지에 오거나(중복) 어느 페이지에도 안 온다(누락).
 *   특히 task_fte_allocations는 자동저장이 DELETE+INSERT로 다시 쓰는 표라 튜플이 물리적으로 옮겨 다닌다.
 *   그래서 이 헬퍼는 언제나 정렬 키를 덧붙인다. 표시 순서를 따로 걸어 둔 조회는 그 정렬이 먼저 오고
 *   여기서 붙는 키가 동률만 가르는 2차 키가 된다(supabase-js의 order는 이어 붙는다).
 */

/** 한 번에 읽는 행 수. PostgREST db-max-rows의 Supabase 기본값과 같다. */
export const PAGE = 1000;

/** in() 한 번에 넘기는 id 수. URL 길이 한계(대략 2KB 헤더)를 넘기지 않는 값이다. */
export const IN_CHUNK = 100;

/** 페이지 경계를 고정하는 기본 정렬 키. 기본 키가 유일·불변이라 이 목적에 맞는다. */
export const PAGE_ORDER_KEY = 'id';

/** 순회에 필요한 최소 모양. supabase-js의 쿼리 빌더가 구조적으로 여기에 들어맞는다. */
export interface Pageable {
  order(column: string, options: { ascending: boolean }): Pageable;
  range(from: number, to: number): PromiseLike<{ data: unknown; error: { message: string } | null }>;
}

export type PageRow = Record<string, unknown>;

/**
 * 조회를 끝까지 읽는다. build()는 부를 때마다 새 빌더를 만들어야 한다
 * (supabase-js 빌더는 한 번 await 하면 재사용할 수 없다).
 *
 * 실패는 { error }로 돌려준다 — 던지는 파일(exportApi)과 ApiResult를 쓰는 파일(adminApi)이
 * 같은 헬퍼를 쓰게 하려면 오류 처리 방식을 호출부가 정해야 한다.
 */
export async function fetchAllPages(
  build: () => Pageable,
  orderBy: string = PAGE_ORDER_KEY,
): Promise<{ rows: PageRow[]; error: string | null }> {
  const out: PageRow[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build()
      .order(orderBy, { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) return { rows: out, error: error.message };
    const rows = (data as PageRow[] | null) ?? [];
    out.push(...rows);
    // 마지막 장은 PAGE보다 짧다. 정확히 PAGE면 한 장 더 확인한다(빈 응답으로 끝난다).
    if (rows.length < PAGE) return { rows: out, error: null };
  }
}

/** 값 목록을 청크로 자른다. in() 조회를 나눌 때 쓴다. */
export function chunk<T>(values: T[], size: number = IN_CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < values.length; i += size) out.push(values.slice(i, i + size));
  return out;
}

/**
 * id 목록으로 거르는 조회를 청크로 나눠 부르고 결과를 합친다. 각 청크는 끝까지 순회한다
 * — 청크 하나가 1,000행을 넘길 수 있기 때문이다(한 검토에 배분 행이 여럿 붙는 표가 그렇다).
 * 빈 목록이면 왕복하지 않는다.
 */
export async function fetchPagesByIds(
  ids: string[],
  build: (chunkIds: string[]) => Pageable,
  orderBy: string = PAGE_ORDER_KEY,
): Promise<{ rows: PageRow[]; error: string | null }> {
  if (ids.length === 0) return { rows: [], error: null };
  const out: PageRow[] = [];
  for (const part of chunk(ids)) {
    const { rows, error } = await fetchAllPages(() => build(part), orderBy);
    out.push(...rows);
    if (error) return { rows: out, error };
  }
  return { rows: out, error: null };
}
