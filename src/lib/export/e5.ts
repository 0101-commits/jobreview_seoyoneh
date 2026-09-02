import {
  ApiResult,
  CollectedExport,
  ExportRow,
  collect,
  db,
  fetchAll,
  fetchByIds,
  isComparableReview,
  loadDurations,
  loadJobs,
  loadProfileNames,
  loadScope,
  mean,
  median,
  packed,
  round1,
  sheetOf,
  str,
} from './shared';

// E5 검토 이력·감사 로그 — 검수 대응 · 11면 ○○분 확정 근거
// ────────────────────────────────────────────────────────────────────

/** review_history.action → §9 E5 '행위' 열의 한국어. RPC 가 넣는 값 그대로를 옮긴다. */
const HISTORY_ACTION_LABELS: Record<string, string> = {
  SUBMITTED: '제출',
  RESUBMITTED: '재제출',
  REVIEW_REQUESTED: '재검토 요청',
  APPROVED: '승인',
  REJECTED: '반려',
};

/** 소요 실측 요약 마지막 행의 직무 칸(§9 E5 "직무당 중앙값 N분"의 전 직무 값). */
const DURATION_TOTAL_LABEL = '전체';

/**
 * 소요 실측 요약 '구분' 열. 마지막 합계 행이 데이터 행 사이에 섞여 있어, 표시가 없으면
 * CSV·JSON 을 받은 쪽이 '응답 수'를 그냥 더해 실제 검토 수의 두 배를 얻는다(빈 직무 ID 는
 * 사람 눈에만 단서다). 시트 주석은 파일에 실리지 않으므로 열로 싣는다.
 */
const DURATION_KIND_JOB = '직무';
const DURATION_KIND_TOTAL = '합계';

/**
 * E5(§9). 시트 3장: '상태 전이 이력' · '관리자 행위 로그' · '소요 실측 요약'.
 *
 * 반려 사유는 별도 시트로 떼지 않는다 — review_history.note 가 곧 반려 사유이고(decide_review 가
 * 그렇게 적는다), 전이와 떼면 어느 반려의 사유인지 다시 이어 붙여야 한다(계약 E5 주석).
 *
 * 감사 로그(audit_logs)에는 회사 구분 컬럼이 없다. 그래서 이 시트에는 계열사 필터가 걸리지 않고
 * 관리자가 볼 수 있는 기록 전체가 실린다. 회사별로 나눠 담은 척하지 않는다 —
 * §8 S5 의 감사 기록은 본래 전사 단위 증빙이다.
 * 그 사실은 코드 주석으로 끝내지 않는다: exportSchema 의 E5_AUDIT_SCOPE_NOTE 가 화면 카드와
 * 파일 첫 시트('대상 회사' 값)에 함께 실려, 받는 쪽이 라벨만 보고 단일 계열사 자료로 읽지 않게 한다.
 *
 * 쿼리 6종(+페이지·청크): 직무 1 · 배정 1 · 상태 전이 1 · 감사 로그 1 · 행위자 이름 1 · 세션 1.
 */
export async function collectE5(companyId: string | null): Promise<ApiResult<CollectedExport>> {
  return collect('E5 검토 이력·감사 로그 조회', async () => {
    const [jobs, scope] = await Promise.all([loadJobs(companyId), loadScope(companyId)]);
    const jobById = new Map(jobs.map((j) => [j.id, j]));
    const withReview = scope.filter((s) => s.reviewId);
    const reviewIds = withReview.map((s) => s.reviewId);
    const scopeByReview = new Map(withReview.map((s) => [s.reviewId, s]));

    const [history, audit, durations] = await Promise.all([
      fetchByIds('상태 전이 이력 조회', reviewIds, (ids) =>
        db()
          .from('review_history')
          .select('review_id, actor_id, action, note, created_at')
          .in('review_id', ids)
          .order('created_at'),
      ),
      fetchAll('관리자 행위 로그 조회', () =>
        db()
          .from('audit_logs')
          .select('actor_id, action, entity, entity_id, meta, created_at')
          .order('created_at', { ascending: false }),
      ),
      loadDurations(reviewIds),
    ]);

    const actorIds = [
      ...new Set([...history, ...audit].map((r) => str(r.actor_id)).filter(Boolean)),
    ];
    const actors = await loadProfileNames(actorIds);

    // ── 시트 1: 상태 전이 이력 ──
    const transitionRows: ExportRow[] = history
      .slice()
      .sort((a, b) => str(a.created_at).localeCompare(str(b.created_at)))
      .map((h) => {
        const s = scopeByReview.get(str(h.review_id));
        const actorId = str(h.actor_id);
        const action = str(h.action);
        return {
          '발생 일시': str(h.created_at),
          '검토 ID': str(h.review_id),
          직무: s ? jobById.get(s.jobId)?.name ?? '' : '',
          'SME 성명': s?.smeName ?? '',
          // 아는 값만 옮긴다. 모르는 action 은 원문을 그대로 남긴다 — 지우면 이력이 사라진다.
          행위: HISTORY_ACTION_LABELS[action] ?? action,
          '사유·메모': str(h.note),
          행위자: actorId ? actors.get(actorId)?.name ?? actorId : '',
        } satisfies ExportRow;
      });

    // ── 시트 2: 관리자 행위 로그 ──
    const auditRows: ExportRow[] = audit.map((a) => {
      const actorId = str(a.actor_id);
      const actor = actorId ? actors.get(actorId) : undefined;
      return {
        '발생 일시': str(a.created_at),
        행위: str(a.action),
        대상: str(a.entity),
        '대상 ID': str(a.entity_id),
        // 이름을 못 찾으면 id 라도 남긴다. 지우면 "누가 했는지 모르는 기록"이 아니라 "아무도 안 한 기록"이 된다.
        행위자: actorId ? (actor ? `${actor.name} · ${actor.email}` : actorId) : '',
        상세: a.meta && typeof a.meta === 'object' ? JSON.stringify(a.meta) : '',
      } satisfies ExportRow;
    });

    // ── 시트 3: 소요 실측 요약 ──
    // 끝까지 마친 검토만 센다. 작성 중(IN_PROGRESS)인 검토는 STEP 1 만 열어 본 6분짜리도 섞여 들어와
    // 중앙값을 아래로 끌어내리는데, 이 시트의 '전체' 행은 착수보고 11면 "직무당 약 ○○분"
    // (§12 오픈이슈 1)의 확정 근거이므로 "완료까지 걸린 시간"이어야 한다.
    // 판정은 E2·E4 와 같은 것을 쓴다(adminApi.isComparableReview + 승인 시각).
    // 반려(REVIEW_REQUESTED)는 뺀다 — 재작성 대기 중이라 아직 끝나지 않은 검토이고, 재작성 시간이
    // 얹히면 이번에는 반대로 위로 부풀린다.
    const completed = withReview.filter((s) => isComparableReview(s.status) || Boolean(s.approvedAt));

    const minutesByJob = new Map<string, number[]>();
    const allMinutes: number[] = [];
    for (const s of completed) {
      const minutes = durations.get(s.reviewId);
      if (minutes === undefined) continue; // 기록이 없는 검토는 분모에서도 뺀다
      const list = minutesByJob.get(s.jobId);
      if (list) list.push(minutes);
      else minutesByJob.set(s.jobId, [minutes]);
      allMinutes.push(minutes);
    }

    const durationRows: ExportRow[] = jobs.map((job) => {
      const values = minutesByJob.get(job.id) ?? [];
      const med = median(values);
      const avg = mean(values);
      return {
        '직무 ID': job.id,
        직군: job.group_name,
        직렬: job.series_name,
        직무: job.name,
        '응답 수': values.length,
        '소요 중앙값(분)': med === null ? null : round1(med),
        '소요 평균(분)': avg === null ? null : round1(avg),
        구분: DURATION_KIND_JOB,
      } satisfies ExportRow;
    });

    // 마지막 행 = 전 직무 합산. 직무별 중앙값의 중앙값이 아니라 검토 전체의 중앙값이다 —
    // 착수보고 11면의 "SME 1인당 직무당 약 ○○분"은 SME 한 사람의 경험이지 직무의 평균이 아니다.
    const totalMedian = median(allMinutes);
    const totalMean = mean(allMinutes);
    durationRows.push({
      '직무 ID': '',
      직군: '',
      직렬: '',
      직무: DURATION_TOTAL_LABEL,
      '응답 수': allMinutes.length,
      '소요 중앙값(분)': totalMedian === null ? null : round1(totalMedian),
      '소요 평균(분)': totalMean === null ? null : round1(totalMean),
      구분: DURATION_KIND_TOTAL,
    });

    return packed('E5', [
      sheetOf('E5', '상태 전이 이력', transitionRows),
      sheetOf('E5', '관리자 행위 로그', auditRows),
      sheetOf('E5', '소요 실측 요약', durationRows),
    ]);
  });
}
