import {
  ApiResult,
  CELL_STATUS_LABELS,
  CollectedExport,
  ExportRow,
  ITEM_NEW_SKILL,
  ITEM_NEW_TASK,
  ITEM_SKILL,
  ITEM_TASK,
  SECTION_LABELS,
  Suitability,
  byKorean,
  cellStatusOf,
  collect,
  db,
  fetchByIds,
  loadDurations,
  loadFteFacts,
  loadJobs,
  loadOrgUnits,
  loadScope,
  loadTaskSuggestions,
  loadTasks,
  packed,
  round1,
  sheetOf,
  str,
  suggestionKey,
  toSuitabilityLabel,
} from './shared';

// E1 업무조사 응답 원본 — 계약 1-(2) · 1-(3) · 23면 현황진단 행
// ────────────────────────────────────────────────────────────────────

/**
 * E1(§9). 시트 2장: '검토 목록'(검토 1건 = 1행) · '항목 응답'(항목 1개 = 1행), 검토 ID 로 잇는다.
 *
 * 쿼리 10종(+페이지·청크): 직무 1 · 배정 1 · 조직 1 · 과업 1 · Skill 1 · 피드백 3 · 제안 2 · FTE 1 · 세션 1.
 * SME 수·직무 수와 무관하다.
 *
 * 승인 여부로 거르지 않는다 — E1 은 "응답 원본"이라 작성 중·반려된 응답까지 그대로 담아야
 * 23면 현황진단의 근거가 된다. 승인 기준으로 좁힌 산출물은 E2·E3 다.
 */
export async function collectE1(companyId: string | null): Promise<ApiResult<CollectedExport>> {
  return collect('E1 업무조사 응답 원본 조회', async () => {
    const [jobs, scope] = await Promise.all([loadJobs(companyId), loadScope(companyId)]);
    const jobById = new Map(jobs.map((j) => [j.id, j]));
    const jobIds = jobs.map((j) => j.id);
    const reviewIds = scope.map((s) => s.reviewId).filter(Boolean);

    const [orgUnits, tasks, skills, jobFb, taskFb, skillFb, taskSuggestions, skillSuggestions, durations] =
      await Promise.all([
        loadOrgUnits(companyId),
        loadTasks(jobIds),
        fetchByIds('필요 Skill 조회', jobIds, (ids) =>
          db().from('job_skills').select('id, job_id, name, skill_type, description, sort_order, active').in('job_id', ids),
        ),
        fetchByIds('직무 항목 응답 조회', reviewIds, (ids) =>
          db().from('job_feedback').select('review_id, section, suitability, comment, suggestion').in('review_id', ids),
        ),
        fetchByIds('과업 응답 조회', reviewIds, (ids) =>
          db()
            .from('task_feedback')
            .select('review_id, task_id, suitability, comment, suggestion, delete_requested')
            .in('review_id', ids),
        ),
        fetchByIds('Skill 응답 조회', reviewIds, (ids) =>
          db()
            .from('skill_feedback')
            .select('review_id, skill_id, suitability, comment, suggestion, delete_requested')
            .in('review_id', ids),
        ),
        loadTaskSuggestions(reviewIds),
        fetchByIds('신규 Skill 제안 조회', reviewIds, (ids) =>
          db()
            .from('new_skill_suggestions')
            .select('id, review_id, name, description, reason')
            .in('review_id', ids)
            .order('created_at'),
        ),
        loadDurations(reviewIds),
      ]);

    const taskNameById = new Map(tasks.map((t) => [t.id, t.name]));
    const skillNameById = new Map(skills.map((s) => [str(s.id), str(s.name)]));
    const suggestionNameById = new Map(taskSuggestions.map((s) => [str(s.id), str(s.name)]));
    const fteFacts = await loadFteFacts(reviewIds, taskNameById, suggestionNameById);

    // ── 시트 1: 검토 목록 ──
    const reviewRows: ExportRow[] = scope
      .slice()
      .sort(
        (a, b) =>
          byKorean(jobById.get(a.jobId)?.name ?? '', jobById.get(b.jobId)?.name ?? '') ||
          byKorean(a.smeName, b.smeName),
      )
      .map((s) => {
        const job = jobById.get(s.jobId);
        const org = s.orgUnitId ? orgUnits.get(s.orgUnitId) : undefined;
        const minutes = durations.get(s.reviewId);
        return {
          '검토 ID': s.reviewId,
          직군: job?.group_name ?? '',
          직렬: job?.series_name ?? '',
          직무: job?.name ?? '',
          'SME 성명': s.smeName,
          'SME 이메일': s.smeEmail,
          // 조직 미지정·이름을 찾지 못한 조직은 빈칸으로 둔다(계약 E1 '소속 조직명' 주석).
          '소속 조직코드': org?.code ?? '',
          '소속 조직명': org?.name ?? '',
          직급: s.smeTitle,
          상태: CELL_STATUS_LABELS[cellStatusOf(s.status, s.approvedAt || null)],
          '시작 일시': s.startedAt,
          '최종 저장 일시': s.lastSavedAt,
          '제출 일시': s.submittedAt,
          '승인 일시': s.approvedAt,
          '반려 사유': s.rejectedReason,
          // 기록이 없으면 빈칸이다. 0 분은 "즉시 끝냈다"는 거짓이 된다.
          '소요 분': minutes === undefined ? null : round1(minutes),
        } satisfies ExportRow;
      });

    // ── 시트 2: 항목 응답 ──
    const byReview = new Map(scope.filter((s) => s.reviewId).map((s) => [s.reviewId, s]));
    const items = new Map<string, ExportRow[]>();
    const push = (reviewId: string, row: ExportRow) => {
      const list = items.get(reviewId);
      if (list) list.push(row);
      else items.set(reviewId, [row]);
    };

    /** 이 검토의 공통 앞 3열. 시트 하나만 따로 봐도 읽히도록 매 행에 반복한다(계약 주석). */
    const head = (reviewId: string) => {
      const s = byReview.get(reviewId);
      return {
        '검토 ID': reviewId,
        직무: s ? jobById.get(s.jobId)?.name ?? '' : '',
        'SME 성명': s?.smeName ?? '',
      };
    };

    /** (검토, 과업) → FTE 비중. 항목 응답 행에 비중을 붙이는 데 쓴다. */
    const pctByReviewTask = new Map<string, number>();
    for (const f of fteFacts) pctByReviewTask.set(`${f.reviewId}|${f.taskKey}`, f.pct);

    for (const r of jobFb) {
      const reviewId = str(r.review_id);
      if (!byReview.has(reviewId)) continue;
      push(reviewId, {
        ...head(reviewId),
        '항목 구분': SECTION_LABELS[str(r.section)] ?? str(r.section),
        항목명: '', // 직무정의처럼 이름이 없는 항목(계약 E1 '항목명' 주석)
        '적합성 판정': toSuitabilityLabel(str(r.suitability) as Suitability | null),
        의견: str(r.comment),
        '수정 제안': str(r.suggestion),
        '삭제 제안': '',
        'FTE 비중(%)': null,
      });
    }

    /** 배분은 있는데 판정 행이 없는 과업을 뒤에 채우기 위한 표시. */
    const feedbackTaskKeys = new Set<string>();

    for (const r of taskFb) {
      const reviewId = str(r.review_id);
      if (!byReview.has(reviewId)) continue;
      const taskId = str(r.task_id);
      const key = `${reviewId}|task:${taskId}`;
      feedbackTaskKeys.add(key);
      push(reviewId, {
        ...head(reviewId),
        '항목 구분': ITEM_TASK,
        항목명: taskNameById.get(taskId) ?? '(삭제된 과업)',
        '적합성 판정': toSuitabilityLabel(str(r.suitability) as Suitability | null),
        의견: str(r.comment),
        '수정 제안': str(r.suggestion),
        '삭제 제안': r.delete_requested === true ? 'Y' : '',
        'FTE 비중(%)': pctByReviewTask.get(key) ?? null,
      });
    }

    /*
     * 판정 없이 비중만 배분된 과업. STEP 3(FTE)만 채우고 STEP 2(적합성)를 비워 둔 응답에서 나온다.
     * 이 행을 빼면 E1 의 비중 합계가 E2·서버 제출 게이트(합계 100%)와 어긋나
     * §10 P4 DoD ②(원본 수기 검산 일치)가 깨진다.
     */
    for (const f of fteFacts) {
      if (f.targetType !== 'EXISTING') continue; // 신규 제안은 아래 제안 행에서 비중을 싣는다
      const key = `${f.reviewId}|${f.taskKey}`;
      if (feedbackTaskKeys.has(key)) continue;
      if (!byReview.has(f.reviewId)) continue;
      push(f.reviewId, {
        ...head(f.reviewId),
        '항목 구분': ITEM_TASK,
        항목명: f.taskName,
        '적합성 판정': '',
        의견: '',
        '수정 제안': '',
        '삭제 제안': '',
        'FTE 비중(%)': f.pct,
      });
    }

    for (const r of skillFb) {
      const reviewId = str(r.review_id);
      if (!byReview.has(reviewId)) continue;
      push(reviewId, {
        ...head(reviewId),
        '항목 구분': ITEM_SKILL,
        항목명: skillNameById.get(str(r.skill_id)) ?? '(삭제된 Skill)',
        '적합성 판정': toSuitabilityLabel(str(r.suitability) as Suitability | null),
        의견: str(r.comment),
        '수정 제안': str(r.suggestion),
        '삭제 제안': r.delete_requested === true ? 'Y' : '',
        'FTE 비중(%)': null,
      });
    }

    // 신규 제안 행: 항목명=제안명 · 의견=제안 사유 · 수정 제안=설명(계약 E1 시트 주석 그대로).
    for (const r of taskSuggestions) {
      const reviewId = str(r.review_id);
      if (!byReview.has(reviewId)) continue;
      const name = str(r.name);
      push(reviewId, {
        ...head(reviewId),
        '항목 구분': ITEM_NEW_TASK,
        항목명: name,
        '적합성 판정': '', // 판정 대상이 아니다
        의견: str(r.reason),
        '수정 제안': str(r.description),
        '삭제 제안': '',
        'FTE 비중(%)': pctByReviewTask.get(`${reviewId}|${suggestionKey(name)}`) ?? null,
      });
    }
    for (const r of skillSuggestions) {
      const reviewId = str(r.review_id);
      if (!byReview.has(reviewId)) continue;
      push(reviewId, {
        ...head(reviewId),
        '항목 구분': ITEM_NEW_SKILL,
        항목명: str(r.name),
        '적합성 판정': '',
        의견: str(r.reason),
        '수정 제안': str(r.description),
        '삭제 제안': '',
        'FTE 비중(%)': null,
      });
    }

    // 검토 목록 시트와 같은 순서로 이어 붙인다. 두 시트를 나란히 놓고 읽을 수 있어야 한다.
    const itemRows: ExportRow[] = [];
    for (const row of reviewRows) {
      const reviewId = String(row['검토 ID'] ?? '');
      itemRows.push(...(items.get(reviewId) ?? []));
    }

    return packed('E1', [sheetOf('E1', '검토 목록', reviewRows), sheetOf('E1', '항목 응답', itemRows)]);
  });
}

// ────────────────────────────────────────────────────────────────────
