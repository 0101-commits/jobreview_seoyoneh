/*
 * 용어 설명 (/glossary) — 기획서 GUIDE v4 §5 G2.
 *
 * 기획안 §1-1 모듈 B가 약속한 "용어집(SME·FTE)"의 이행분이다. 화면 옆 물음표(TermHint)가
 * 지금 필요한 한 낱말을 말한다면, 이 화면은 "아까 그 말이 뭐였더라"를 되짚는 자리다.
 *
 * 문안은 짓지 않는다 — sme-review/glossary.ts가 유일한 원천이다.
 * 검색 칸을 두지 않는다. 스물여섯 개는 눈으로 훑는 편이 빠르고, 검색은 낱말을 정확히 알 때만
 * 쓸모가 있는데 여기 오는 사람은 그 낱말을 모른다.
 */
import { PageHeader } from '@/components/ui/PageHeader';
import {
  GLOSSARY_INTRO,
  GLOSSARY_TITLE,
  TERMS,
  TERM_GROUPS,
  termAnchor,
  type TermGroup,
} from '@/pages/sme-review/glossary';

export function GlossaryPage() {
  return (
    <>
      <PageHeader eyebrow="모르는 말이 있을 때" title={GLOSSARY_TITLE} />

      <p className="mb-6 t-label-reading text-foreground-muted">{GLOSSARY_INTRO}</p>

      <div className="space-y-8">
        {TERM_GROUPS.map((group) => (
          <section key={group.key} aria-labelledby={`group-${group.key}`}>
            <h3 id={`group-${group.key}`} className="mb-3 t-headline text-foreground">
              {group.title}
            </h3>
            <ul className="space-y-2">
              {TERMS.filter((t) => t.group === (group.key as TermGroup)).map((t) => (
                <li
                  key={t.id}
                  id={termAnchor(t.id)}
                  className="scroll-mt-24 rounded-element border border-border bg-card p-4"
                >
                  <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                    <h4 className="font-semibold text-foreground">{t.term}</h4>
                    <p className="t-label text-foreground-muted">{t.short}</p>
                  </div>
                  {/* FTE 항목만 두 문단이다(착수보고 고정 문언 + 덧붙임). 줄바꿈을 살린다. */}
                  <p className="mt-2 whitespace-pre-line t-label-reading text-foreground-muted">{t.long}</p>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </>
  );
}

export default GlossaryPage;
