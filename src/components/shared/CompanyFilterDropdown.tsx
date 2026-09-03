// 회사 선택 드롭다운 — 관리자(ADMIN) 화면 12곳이 함께 사용한다.
// 업로드 화면처럼 대상이 하나여야 하는 곳은 label을 주고 '전체 회사'를 고른 상태를 화면에서 막는다(v2 F4).
import { useEffect, useRef } from 'react';

export function CompanyFilterDropdown({
  companies,
  value,
  onChange,
  label = '회사 필터',
  className = '',
}: {
  companies: { id: string; name: string }[];
  value: string;
  onChange: (v: string) => void;
  /** 스크린리더가 읽을 이름. 화면에 라벨 글자를 두지 않는 자리라 aria-label로만 준다. */
  label?: string;
  className?: string;
}) {
  /*
   * 계열사가 하나뿐이면 그 회사를 골라 두고 칸 자체를 감춘다.
   * 파일럿은 서연이화 한 곳만 진행한다(2026-09-03 결정). 선택지가 '전체 회사'와 '서연이화'
   * 둘뿐이면 고를 것이 없는데도 두 값이 서로 다르게 동작한다 — '전체 회사'는 companyId가 null이라
   * 마감일(survey_settings는 회사 1행)처럼 회사를 하나로 못 합치는 지표가 빈칸으로 나온다.
   * 회사가 늘면 조건이 저절로 풀려 드롭다운이 다시 나타나므로 되돌리는 작업이 없다.
   */
  const only = companies.length === 1 ? companies[0].id : null;
  // 한 번만 시도한다. 설정 화면의 onChange는 저장 안 한 변경이 있으면 확인 대화상자를 띄우고
  // 사용자가 취소하면 값을 그대로 두는데(SettingsPage.onPickCompany), 그때 다시 부르면
  // 대화상자가 끝없이 다시 뜬다.
  const picked = useRef<string | null>(null);
  useEffect(() => {
    if (!only) {
      picked.current = null;
      return;
    }
    if (picked.current === only || value === only) return;
    picked.current = only;
    onChange(only);
  }, [only, value, onChange]);

  if (only) return null;

  return (
    // 시각 라벨 대신 aria-label을 쓴다 — 이 드롭다운은 아홉 개 화면의 헤더 우측에 단독으로 놓여
    // 있어(대시보드·검토 현황·설정 등) 앞에 라벨 글자를 넣으면 그 줄의 정렬이 화면마다 달라진다.
    // 이름이 없으면 스크린리더가 "콤보 상자"로만 읽어 무엇을 고르는 칸인지 알 수 없다.
    <select
      aria-label={label}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={`input min-h-control-md w-auto py-2.5 ${className}`}
    >
      <option value="all">전체 회사</option>
      {companies.map((c) => (
        <option key={c.id} value={c.id}>
          {c.name}
        </option>
      ))}
    </select>
  );
}
