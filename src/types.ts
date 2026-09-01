// 공용 도메인 타입 — 관리자(ADMIN) 화면과 SME 화면이 함께 사용한다.
// App.tsx 상단에 있던 타입 선언을 그대로 옮긴 것이다(내용 변경 없음).

export type Role = 'admin' | 'sme';
export type Status = '미시작' | '작성 중' | '제출 완료' | '재검토 요청' | '재제출 완료';
export type Suitability = '적합' | '일부 수정 필요' | '부적합' | '';

export type Task = { id: string; name: string; description: string };
export type Skill = { id: string; name: string; description: string };
export type Job = {
  id: string;
  group: string;
  series: string;
  name: string;
  definition: string;
  tasks: Task[];
  skills: Skill[];
};

export type Feedback = { suitability: Suitability; comment: string; suggestion: string; remove?: boolean };
export type User = {
  id: string;
  name: string;
  email: string;
  organization: string;
  title: string;
  role: Role;
  company_id?: string | null;
  company_name?: string;
  /** true면 첫 로그인 상태다 — 비밀번호를 바꾸기 전에는 어떤 화면에도 들어갈 수 없다(§8 S2). */
  must_change_password: boolean;
  /**
   * 시작 가이드 통과 시각(§6-1). SME는 이 값이 null이면 가이드를 먼저 봐야 한다.
   * undefined는 "profiles에 컬럼이 없다"는 뜻이라 게이트를 걸지 않는다 —
   * 통과 시각을 기록할 곳이 없는 DB에서 가이드를 강제하면 영원히 빠져나올 수 없다.
   */
  guide_completed_at?: string | null;
};

// ── SME List Item Type ───────────────────────────────────────────────
export interface SmeListItem {
  id: string;
  name: string;
  email: string;
  organization: string;
  title: string;
  active: boolean;
  created_at: string;
  company_id: string | null;
  company_name: string;
  employee_number: string;
}
