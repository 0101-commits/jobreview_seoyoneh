// 회사 선택 드롭다운 — 관리자(ADMIN) 검토 현황 / SME 계정 관리 화면이 함께 사용한다.

export function CompanyFilterDropdown({
  companies,
  value,
  onChange,
}: {
  companies: { id: string; name: string }[];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    // 시각 라벨 대신 aria-label을 쓴다 — 이 드롭다운은 아홉 개 화면의 헤더 우측에 단독으로 놓여
    // 있어(대시보드·검토 현황·설정 등) 앞에 라벨 글자를 넣으면 그 줄의 정렬이 화면마다 달라진다.
    // 이름이 없으면 스크린리더가 "콤보 상자"로만 읽어 무엇을 고르는 칸인지 알 수 없다.
    <select
      aria-label="회사 필터"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="rounded-md border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-700 outline-none focus:border-primary"
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
