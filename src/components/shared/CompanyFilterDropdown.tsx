// 회사 선택 드롭다운 — 관리자(ADMIN) 화면 12곳이 함께 사용한다.
// 업로드 화면처럼 대상이 하나여야 하는 곳은 label을 주고 '전체 회사'를 고른 상태를 화면에서 막는다(v2 F4).

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
