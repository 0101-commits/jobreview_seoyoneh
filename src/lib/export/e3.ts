import {
  ApiResult,
  CollectedExport,
  ExportRow,
  TARGET_LABELS,
  TaskRow,
  byKorean,
  collect,
  db,
  fetchByIds,
  loadFteFacts,
  loadJobs,
  loadScope,
  loadTaskSuggestions,
  loadTasks,
  mean,
  packed,
  round2,
  sheetOf,
  str,
  suggestionKey,
} from './shared';

// E3 직무기술서 원천 4시트 — 계약 2-(2) JD · 23면 직무기술서 구성항목
// ────────────────────────────────────────────────────────────────────

/**
 * E3(§9). 시트 4장(job_description / task_activity / skill / requirements) — 시트명은 §9 문언 그대로 영문.
 *
 * "검토 반영(승인) 기준"이라 FTE 비중은 항상 승인된 검토(approved_at IS NOT NULL)만으로 집계한다.
 * E2 와 달리 기준 토글이 없다(계약 hasBasisToggle=false).
 * 승인 검토가 없는 직무도 행은 남기고 비중·응답 수만 빈칸으로 둔다 — 행을 빼면 받는 쪽이
 * "그 직무가 없는 것"과 "아직 승인 전인 것"을 구분할 수 없다(계약 E3 주석).
 *
 * 쿼리 8종(+페이지·청크): 직무 1 · 배정 1 · 과업 1 · 세부활동 1 · Skill 1 · 수행요건 1 · 신규 제안 1 · FTE 1.
 */
export async function collectE3(companyId: string | null): Promise<ApiResult<CollectedExport>> {
  return collect('E3 직무기술서 원천 조회', async () => {
    const [jobs, scope] = await Promise.all([loadJobs(companyId), loadScope(companyId)]);
    const jobIds = jobs.map((j) => j.id);

    const approved = scope.filter((s) => s.reviewId && s.approvedAt);
    const approvedReviewIds = approved.map((s) => s.reviewId);
    const jobByReview = new Map(approved.map((s) => [s.reviewId, s.jobId]));

    const tasks = await loadTasks(jobIds);
    const activeTaskIds = tasks.filter((t) => t.active).map((t) => t.id);

    const [activities, skills, requirements, suggestions, activityNotes] = await Promise.all([
      fetchByIds('세부활동 조회', activeTaskIds, (ids) =>
        db()
          .from('task_activities')
          .select('id, job_task_id, activity_name, sort_order')
          .in('job_task_id', ids)
          .eq('active', true)
          .order('sort_order'),
      ),
      fetchByIds('필요 Skill 조회', jobIds, (ids) =>
        db()
          .from('job_skills')
          .select('job_id, name, skill_type, description, sort_order')
          .in('job_id', ids)
          .eq('active', true)
          .order('sort_order'),
      ),
      fetchByIds('수행요건 조회', jobIds, (ids) =>
        db().from('job_requirements').select('job_id, education, major, certifications').in('job_id', ids),
      ),
      loadTaskSuggestions(approvedReviewIds),
      // 세부활동 의견(결정 D2). 승인된 검토의 것만 싣는다 — E3의 다른 열과 같은 모집단이다.
      fetchByIds('세부활동 의견 조회', approvedReviewIds, (ids) =>
        db().from('activity_feedback').select('activity_id, comment, delete_requested').in('review_id', ids),
      ),
    ]);

    const suggestionNameById = new Map(suggestions.map((s) => [str(s.id), str(s.name)]));
    const facts = await loadFteFacts(approvedReviewIds, new Map(tasks.map((t) => [t.id, t.name])), suggestionNameById);

    // 승인 응답의 비중을 (직무, 과업키)로 모은다. E2 '직무×과업 집계'의 승인 기준 값과 같은 수다.
    const pctByJobTask = new Map<string, number[]>();
    for (const f of facts) {
      const jobId = jobByReview.get(f.reviewId);
      if (!jobId) continue;
      const key = `${jobId}|${f.taskKey}`;
      const list = pctByJobTask.get(key);
      if (list) list.push(f.pct);
      else pctByJobTask.set(key, [f.pct]);
    }

    // 승인 검토 수·최종 승인 일시.
    const approvedCount = new Map<string, number>();
    const lastApprovedAt = new Map<string, string>();
    for (const s of approved) {
      approvedCount.set(s.jobId, (approvedCount.get(s.jobId) ?? 0) + 1);
      const previous = lastApprovedAt.get(s.jobId) ?? '';
      if (s.approvedAt > previous) lastApprovedAt.set(s.jobId, s.approvedAt);
    }

    // ── 시트 1: job_description ──
    const descriptionRows: ExportRow[] = jobs.map((job) => ({
      '직무 ID': job.id,
      직군: job.group_name,
      직렬: job.series_name,
      직무: job.name,
      직무정의: '', // 아래에서 채운다(fetchAllJobsResult 에는 definition 이 없다)
      '승인 검토 수': approvedCount.get(job.id) ?? 0,
      '최종 승인 일시': lastApprovedAt.get(job.id) ?? '',
    }));

    // definition 은 jobs 테이블에서 따로 읽는다. 쿼리 1회.
    const definitions = await fetchByIds('직무정의 조회', jobIds, (ids) =>
      db().from('jobs').select('id, definition').in('id', ids),
    );
    const definitionById = new Map(definitions.map((d) => [str(d.id), str(d.definition)]));
    for (const row of descriptionRows) row['직무정의'] = definitionById.get(String(row['직무 ID'])) ?? '';

    // ── 시트 2: task_activity ──
    const activitiesByTask = new Map<string, { id: string; name: string }[]>();
    for (const a of activities) {
      const taskId = str(a.job_task_id);
      const entry = { id: str(a.id), name: str(a.activity_name) };
      const list = activitiesByTask.get(taskId);
      if (list) list.push(entry);
      else activitiesByTask.set(taskId, [entry]);
    }

    /*
      세부활동 의견(결정 D2). 여러 SME가 같은 줄에 의견을 남길 수 있으므로 문장을 이어 붙이고,
      삭제 제안은 앞에 표시를 붙인다. 배분 값은 건드리지 않는다 — 배분 단위는 여전히 과업이다.
    */
    const notesByActivity = new Map<string, string[]>();
    for (const n of activityNotes) {
      const id = str(n.activity_id);
      const text = str(n.comment).trim();
      const parts: string[] = [];
      if (n.delete_requested === true) parts.push('[삭제 제안]');
      if (text) parts.push(text);
      if (parts.length === 0) continue;
      const list = notesByActivity.get(id) ?? [];
      list.push(parts.join(' '));
      notesByActivity.set(id, list);
    }

    const tasksByJob = new Map<string, TaskRow[]>();
    for (const t of tasks) {
      if (!t.active) continue;
      const list = tasksByJob.get(t.jobId);
      if (list) list.push(t);
      else tasksByJob.set(t.jobId, [t]);
    }

    /** 승인 검토에서 나온 신규 제안 과업. 이름이 같으면 한 과업으로 본다(§9 E3 "신규 제안이 반영된 과업"). */
    const suggestedByJob = new Map<string, Map<string, string>>();
    for (const s of suggestions) {
      const jobId = jobByReview.get(str(s.review_id));
      if (!jobId) continue;
      const name = str(s.name);
      const map = suggestedByJob.get(jobId) ?? new Map<string, string>();
      map.set(suggestionKey(name), name);
      suggestedByJob.set(jobId, map);
    }

    const taskRows: ExportRow[] = [];
    const fteCell = (jobId: string, taskKey: string) => {
      const values = pctByJobTask.get(`${jobId}|${taskKey}`);
      return {
        // 승인 응답이 없으면 빈칸이다. 0% 로 적으면 "그 과업에 시간을 쓰지 않는다"는 다른 사실이 된다.
        'FTE 비중(%)': values && values.length ? round2(mean(values) ?? 0) : null,
        '응답 수': values && values.length ? values.length : null,
      };
    };

    for (const job of jobs) {
      for (const task of tasksByJob.get(job.id) ?? []) {
        const cells = fteCell(job.id, `task:${task.id}`);
        const activityList = activitiesByTask.get(task.id) ?? [];
        // 세부활동이 여러 개면 과업 단위 비중이 같은 값으로 반복된다 — 합산하지 말 것(계약 시트 주석).
        const list = activityList.length ? activityList : [{ id: '', name: '' }];
        for (const activity of list) {
          taskRows.push({
            '직무 ID': job.id,
            직군: job.group_name,
            직렬: job.series_name,
            직무: job.name,
            주요과업: task.name,
            세부활동: activity.name,
            '세부활동 의견': (notesByActivity.get(activity.id) ?? []).join(' / '),
            '과업 구분': TARGET_LABELS.EXISTING,
            ...cells,
          });
        }
      }
      for (const [key, name] of suggestedByJob.get(job.id) ?? []) {
        taskRows.push({
          '직무 ID': job.id,
          직군: job.group_name,
          직렬: job.series_name,
          직무: job.name,
          주요과업: name,
          세부활동: '', // 신규 제안에는 아직 세부활동이 없다
          '세부활동 의견': '',
          '과업 구분': TARGET_LABELS.SUGGESTED,
          ...fteCell(job.id, key),
        });
      }
    }

    // ── 시트 3: skill ──
    const jobById = new Map(jobs.map((j) => [j.id, j]));
    const skillRows: ExportRow[] = [];
    for (const s of skills) {
      const job = jobById.get(str(s.job_id));
      if (!job) continue;
      skillRows.push({
        '직무 ID': job.id,
        직군: job.group_name,
        직렬: job.series_name,
        직무: job.name,
        'Skill 구분': str(s.skill_type),
        Skill: str(s.name),
        'Skill 설명': str(s.description),
      });
    }
    skillRows.sort((a, b) => byKorean(String(a['직무']), String(b['직무'])));

    // ── 시트 4: requirements ──
    const requirementByJob = new Map(requirements.map((r) => [str(r.job_id), r]));
    const requirementRows: ExportRow[] = jobs.map((job) => {
      const r = requirementByJob.get(job.id);
      return {
        '직무 ID': job.id,
        직군: job.group_name,
        직렬: job.series_name,
        직무: job.name,
        '요구 학력': str(r?.education),
        '관련 전공': str(r?.major),
        '관련 자격증/면허': str(r?.certifications),
      };
    });

    return packed('E3', [
      sheetOf('E3', 'job_description', descriptionRows),
      sheetOf('E3', 'task_activity', taskRows),
      sheetOf('E3', 'skill', skillRows),
      sheetOf('E3', 'requirements', requirementRows),
    ]);
  });
}

// ────────────────────────────────────────────────────────────────────
