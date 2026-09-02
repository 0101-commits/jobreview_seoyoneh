import {
  ApiResult,
  CollectedExport,
  EXPORT_MAX_REVIEWS,
  ExportRow,
  JobSignalInput,
  ReviewStatus,
  Row,
  Suitability,
  byKorean,
  collect,
  computeJobSignals,
  db,
  fetchByIds,
  fetchWorkshopFlags,
  isComparableReview,
  loadJobs,
  loadProfileNames,
  loadTaskSuggestions,
  num,
  one,
  packed,
  qfail,
  round1,
  round2,
  sheetOf,
  str,
  suggestionKey,
} from './shared';

// E4 워크숍 대상 직무 목록 — 13면
// ────────────────────────────────────────────────────────────────────

/** 저장된 결정 없이 자동 규칙에만 걸린 직무의 '플래그 여부' 값(계약 E4 · workshopRules 의 AUTO_PENDING). */
const AUTO_PENDING_LABEL = '자동 후보(지정 전)';

/**
 * E4(§9). 시트 1장. 저장된 플래그가 있는 직무(수동 해제 포함) + 자동 규칙에 지금 걸린 직무 —
 * "대상 최소화"(13면)를 어떻게 판단했는지의 이력과 아직 판단하지 않은 후보가 함께 근거가 된다.
 *
 * 저장된 플래그만 실으면 이 목록은 "관리자가 워크벤치에서 저장을 누른 직무"가 된다. 자동 규칙에
 * 걸려 있어도 비교 뷰를 한 번도 열지 않은 직무는 job_workshop_flags 에 줄이 없어 통째로 빠지고,
 * 그러면 §6-3 ⓑ 가 말한 전수 판별 근거가 아니다. 그래서 회사의 직무 전체를 훑어 자동 규칙을
 * 실측하고, 저장 전 직무는 '자동 후보(지정 전)'로 남긴다(workshopRules 의 AUTO_PENDING 과 같은 상태).
 *
 * 지표 4열은 §6-3 ⓑ 자동 규칙 ①~④와 1:1이다. 계산은 adminApi.computeJobSignals 를 그대로 쓴다 —
 * 제출 큐·비교 뷰·이 Export 가 서로 다른 수를 말하면 그 순간 근거가 아니라 분쟁거리가 된다.
 * 임계값은 workshopThresholds.ts 에 있고 §12 에서 조정될 수 있으므로 값을 여기 적지 않는다.
 *
 * 쿼리 8종(+페이지·청크): 직무 1 · 플래그 1 · 배정 1 · 판정 3 · FTE 1 · 신규 제안 1 · 지정자 이름 1.
 */
export async function collectE4(companyId: string | null): Promise<ApiResult<CollectedExport>> {
  return collect('E4 워크숍 대상 직무 목록 조회', async () => {
    const [jobs, flagResult] = await Promise.all([loadJobs(companyId), fetchWorkshopFlags(companyId)]);
    if (!flagResult.ok) qfail('워크숍 플래그 조회', flagResult.error);
    const flags = flagResult.data;
    const jobById = new Map(jobs.map((j) => [j.id, j]));
    const flagByJob = new Map(flags.map((f) => [f.jobId, f]));
    // 훑을 범위 = 이 회사의 직무 전체 + 목록에 없는 플래그 직무(비활성화된 직무의 이력도 남긴다).
    const scanJobIds = [...new Set([...jobs.map((j) => j.id), ...flags.map((f) => f.jobId)])];

    // 제출된 검토만 신호 계산에 넣는다(adminApi.isComparableReview 와 같은 판정).
    const assignments = await fetchByIds('워크숍 후보 검토 조회', scanJobIds, (ids) =>
      db().from('review_assignments').select('job_id, reviews(id, status)').eq('active', true).in('job_id', ids),
    );

    const reviewToJob = new Map<string, string>();
    const reviewIdsByJob = new Map<string, string[]>();
    for (const a of assignments) {
      const review = one(a.reviews);
      const reviewId = str(review.id);
      const jobId = str(a.job_id);
      if (!reviewId || !jobId) continue;
      if (!isComparableReview((str(review.status) as ReviewStatus) || null)) continue;
      reviewToJob.set(reviewId, jobId);
      const list = reviewIdsByJob.get(jobId);
      if (list) list.push(reviewId);
      else reviewIdsByJob.set(jobId, [reviewId]);
    }
    const reviewIds = [...reviewToJob.keys()];
    // 범위를 직무 전체로 넓혔으므로 다른 Export 와 같은 상한을 여기에도 건다(조용히 자르지 않는다).
    if (reviewIds.length > EXPORT_MAX_REVIEWS) {
      qfail(
        '워크숍 후보 검토 조회',
        `대상 검토가 ${reviewIds.length.toLocaleString()}건으로 한 번에 다룰 수 있는 상한(${EXPORT_MAX_REVIEWS.toLocaleString()}건)을 넘습니다. 계열사를 선택해 범위를 좁혀 주세요.`,
      );
    }

    const [jobFb, taskFb, skillFb, fte, suggestions, decidedBy] = await Promise.all([
      fetchByIds('직무 판정 조회', reviewIds, (ids) =>
        db().from('job_feedback').select('review_id, section, suitability').in('review_id', ids),
      ),
      fetchByIds('과업 판정 조회', reviewIds, (ids) =>
        db().from('task_feedback').select('review_id, task_id, suitability').in('review_id', ids),
      ),
      fetchByIds('Skill 판정 조회', reviewIds, (ids) =>
        db().from('skill_feedback').select('review_id, skill_id, suitability').in('review_id', ids),
      ),
      fetchByIds('투입 비중 조회', reviewIds, (ids) =>
        db()
          .from('task_fte_allocations')
          .select('review_id, target_type, task_id, suggestion_id, pct')
          .in('review_id', ids),
      ),
      loadTaskSuggestions(reviewIds),
      loadProfileNames([...new Set(flags.map((f) => f.decidedBy).filter((id): id is string => Boolean(id)))]),
    ]);

    const inputs = new Map<string, JobSignalInput>();
    for (const jobId of scanJobIds) {
      inputs.set(jobId, { reviewIds: reviewIdsByJob.get(jobId) ?? [], suitability: [], fte: [], newTasks: [] });
    }
    const inputOf = (reviewId: string) => {
      const jobId = reviewToJob.get(reviewId);
      return jobId ? inputs.get(jobId) : undefined;
    };

    const suggestionNameById = new Map<string, string>();
    for (const s of suggestions) {
      suggestionNameById.set(str(s.id), str(s.name));
      inputOf(str(s.review_id))?.newTasks.push({ reviewId: str(s.review_id), name: str(s.name) });
    }
    const pushSuitability = (rows: Row[], keyOf: (r: Row) => string) => {
      for (const r of rows) {
        inputOf(str(r.review_id))?.suitability.push({
          key: keyOf(r),
          name: '',
          reviewId: str(r.review_id),
          value: (str(r.suitability) as Suitability) || null,
        });
      }
    };
    pushSuitability(jobFb, (r) => `job:${str(r.section)}`);
    pushSuitability(taskFb, (r) => `task:${str(r.task_id)}`);
    pushSuitability(skillFb, (r) => `skill:${str(r.skill_id)}`);

    for (const r of fte) {
      const suggested = str(r.target_type) === 'SUGGESTED';
      const name = suggested ? suggestionNameById.get(str(r.suggestion_id)) ?? '' : '';
      inputOf(str(r.review_id))?.fte.push({
        key: suggested ? suggestionKey(name) : `task:${str(r.task_id)}`,
        name,
        targetType: suggested ? 'SUGGESTED' : 'EXISTING',
        reviewId: str(r.review_id),
        pct: num(r.pct),
      });
    }

    /*
     * 실을 행 = 저장된 플래그가 있는 직무 + 자동 규칙에 지금 걸린 직무.
     * 자동 판정은 computeJobSignals 의 workshopReasons 를 그대로 쓴다 — 제출 큐·비교 뷰·이 Export 가
     * 서로 다른 수를 말하지 않게 셈법을 하나로 둔다(임계값은 workshopThresholds.ts).
     * 제출된 검토가 하나도 없는 직무는 사유가 만들어지지 않아 여기 들어오지 않는다(판정 불가 ≠ 후보).
     */
    const candidates = scanJobIds
      .map((jobId) => {
        const input = inputs.get(jobId) ?? { reviewIds: [], suitability: [], fte: [], newTasks: [] };
        return { jobId, flag: flagByJob.get(jobId), input, signals: computeJobSignals(input) };
      })
      .filter((c) => c.flag || c.signals.workshopReasons.length > 0);

    const nameOf = (jobId: string, fallback: string) => jobById.get(jobId)?.name ?? fallback;
    const rows: ExportRow[] = candidates
      .sort((a, b) => byKorean(nameOf(a.jobId, a.flag?.jobName ?? ''), nameOf(b.jobId, b.flag?.jobName ?? '')))
      .map(({ jobId, flag, input, signals }) => {
        const job = jobById.get(jobId);
        // computeJobSignals 는 판정이 하나도 없을 때도 비율 0 을 준다. 0% 와 "판정 없음"은 다른 사실이라
        // 판정 수를 여기서 따로 세어 빈칸과 구분한다.
        const judged = input.suitability.filter((s) => s.value).length;
        const maxGap = signals.fteRows.length ? Math.max(...signals.fteRows.map((r) => r.maxGap)) : null;
        return {
          '직무 ID': jobId,
          직군: job?.group_name ?? '',
          직렬: job?.series_name ?? '',
          직무: job?.name ?? flag?.jobName ?? '',
          // 저장된 결정이 없는 행은 '자동 후보(지정 전)'. '대상'과 섞으면 아직 아무도 판단하지 않은 직무가
          // 이미 확정된 워크숍 대상으로 읽힌다.
          '플래그 여부': flag ? (flag.flagged ? '대상' : '해제') : AUTO_PENDING_LABEL,
          '지정 구분': flag ? (flag.source === 'MANUAL' ? '수동' : '자동') : '',
          // 저장된 사유가 있으면 그것을, 없으면 지금 실측한 자동 규칙 사유를 적는다.
          '플래그 사유': (flag ? flag.reasons : signals.workshopReasons).join(' · '),
          'SME 응답 수': signals.smeCount,
          '부적합 판정 비율(%)': judged > 0 ? round1(signals.unsuitableRatio * 100) : null,
          'FTE 1위 과업 불일치': signals.topTaskMismatch ? 'Y' : '',
          '최대 FTE 비중 차(%p)': maxGap === null ? null : round2(maxGap),
          '신규 제안 과업 수': signals.newTaskCount,
          // 자동 지정이면 decided_by 가 비어 있다(계약 '지정자' 주석).
          지정자: flag?.decidedBy ? decidedBy.get(flag.decidedBy)?.name ?? flag.decidedBy : '',
          '최종 갱신 일시': flag?.updatedAt ?? '',
        } satisfies ExportRow;
      });

    return packed('E4', [sheetOf('E4', '워크숍 대상 직무', rows)]);
  });
}

// ────────────────────────────────────────────────────────────────────
