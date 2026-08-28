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
    <select
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
