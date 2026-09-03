/*
 * 응답자 용어집 — 기획서 GUIDE v4 §7 (기획안 §1-1 모듈 B "용어집(SME·FTE)"의 이행분).
 *
 * 이 앱의 응답자는 HR 용어를 모르는 현업이고, 이 도구를 평생 한두 번 쓴다. 화면에 나오는 낱말의
 * 절반은 HR 실무 용어이고 나머지 절반은 이 도구 안에서만 통하는 말이라(「개선 필요사항」과
 * 「수정 제안」의 차이 같은 것) 되짚을 곳이 없으면 아무 데서도 뜻을 알 수 없다.
 *
 * 문체 규칙(GUIDE v4 §4-1 P8) — 이 파일의 모든 문장이 지킨다.
 *  1. 경어체 통일. 종결은 `~합니다`·`~하세요`·`~해 주세요`. `~어요/~예요`는 쓰지 않는다.
 *     (착수보고 고정 문언이 합쇼체라 톤이 갈라지지 않게 맞춘 것이다.)
 *  2. short는 25자 이내 한 줄, long은 2문장 이내.
 *  3. 첫 문장은 "무엇을 하면 되는지". 이유·배경은 필요할 때만 뒤에 한 문장.
 *  4. 문장을 하나 지우고도 할 일을 알 수 있으면 그 문장은 지운다.
 *
 * 문언 단일 원천(copy.ts 상단 규칙)은 여기에도 적용된다. 화면 컴포넌트가 용어 설명을 직접
 * 지어 쓰면 같은 낱말이 화면마다 다르게 설명되고, 그 순간 용어집이 진실이 아니게 된다.
 *
 * 런타임 의존이 없다. 어느 화면에서 불러도 안전하다.
 */

/** 용어 묶음 — 용어집 페이지의 소제목이자, 사용자가 "어디서 쓰는 말인지"로 찾아가는 축이다. */
export type TermGroup = 'survey' | 'jobdata' | 'screen';

export const TERM_GROUPS: readonly { key: TermGroup; title: string }[] = [
  { key: 'survey', title: '조사에 관한 말' },
  { key: 'jobdata', title: '직무 자료에 관한 말' },
  { key: 'screen', title: '화면에서 쓰는 말' },
] as const;

export interface Term {
  id: TermId;
  group: TermGroup;
  /** 화면에 보이는 그대로의 낱말. TermHint 버튼 이름("{term} 설명 보기")에도 이 값이 들어간다. */
  term: string;
  /** 한 줄 정의(25자 이내). 목록에서 펼치지 않고도 읽힌다. */
  short: string;
  /** 자세한 설명(2문장 이내). */
  long: string;
}

/**
 * 용어 id. 유니온으로 두어 부착 지점에서 오타를 컴파일 때 잡는다 —
 * 문자열이면 `TermHint id="requiremnt"`가 조용히 아무것도 안 그리는 채로 배포된다.
 */
export type TermId =
  // 조사
  | 'sme'
  | 'draft'
  | 'assignment'
  | 'review-status'
  | 'deadline'
  // 직무 자료
  | 'job'
  | 'job-definition'
  | 'task'
  | 'activity'
  | 'hard-skill'
  | 'soft-skill'
  | 'requirement'
  | 'fte'
  // 화면
  | 'suitability'
  | 'fit-ok'
  | 'fit-partial'
  | 'fit-no'
  | 'comment'
  | 'suggestion'
  | 'remove'
  | 'new-suggestion'
  | 'autosave'
  | 'save-vs-submit'
  | 'lock'
  | 'rereview'
  | 'inquiry';

export const TERMS: readonly Term[] = [
  // ── ① 조사에 관한 말 ──────────────────────────────────────────────
  {
    id: 'sme',
    group: 'survey',
    term: 'SME(업무전문가)',
    short: '이 직무를 직접 하시는 분입니다',
    long: '직무마다 1~2분께 확인을 부탁드립니다. 시험이나 평가가 아닙니다.',
  },
  {
    id: 'draft',
    group: 'survey',
    term: '초안',
    short: '저희가 미리 적어 둔 내용입니다',
    long: '실제와 맞는지만 봐 주시면 됩니다.',
  },
  {
    id: 'assignment',
    group: 'survey',
    term: '배정',
    short: '담당자가 정해 둔 검토 대상입니다',
    long: '목록에 있는 직무만 검토하실 수 있습니다.',
  },
  {
    id: 'review-status',
    group: 'survey',
    term: '검토 상태',
    short: '지금 어디까지 왔는지 보여 줍니다',
    long: '미시작 → 작성 중 → 제출 완료 순입니다.',
  },
  {
    id: 'deadline',
    group: 'survey',
    term: '마감',
    short: '언제까지 부탁드리는 날짜입니다',
    long: '지나도 제출은 됩니다.',
  },

  // ── ② 직무 자료에 관한 말 ─────────────────────────────────────────
  {
    id: 'job',
    group: 'jobdata',
    term: '직무',
    short: '비슷한 일을 묶어 부르는 이름입니다',
    long: '부서 이름이나 직급과는 다릅니다.',
  },
  {
    id: 'job-definition',
    group: 'jobdata',
    term: '직무정의',
    short: '이 직무가 하는 일을 적은 문장입니다',
    long: '사람이 아니라 자리를 설명합니다.',
  },
  {
    id: 'task',
    group: 'jobdata',
    term: '주요과업',
    short: '직무가 하는 큰 일 하나입니다',
    long: '예를 들면 「월간 실적 집계·분석」입니다. 한 직무에 보통 5~15개입니다.',
  },
  {
    id: 'activity',
    group: 'jobdata',
    term: '세부활동',
    short: '과업 안의 작은 단계입니다',
    long: '비중은 나누지 않습니다. 고칠 점만 적어 주세요.',
  },
  {
    id: 'hard-skill',
    group: 'jobdata',
    term: '지식/기술(Hard Skill)',
    short: '배워서 익히는 능력입니다',
    long: '자격증·프로그램·설비 조작 같은 것입니다.',
  },
  {
    id: 'soft-skill',
    group: 'jobdata',
    term: '역량(Soft Skill)',
    short: '일하는 태도와 방식입니다',
    long: '소통·조율·꼼꼼함 같은 것입니다.',
  },
  {
    id: 'requirement',
    group: 'jobdata',
    term: '수행요건',
    short: '새로 맡을 사람에게 필요한 조건입니다',
    long: '학력·전공·자격증을 봅니다. 지금 하시는 분의 스펙이 아닙니다.',
  },
  {
    /*
     * 유일하게 long이 두 문단인 항목이다. 앞 문단은 착수보고 11면 Step 2의 고정 문언이라
     * 줄이거나 바꿀 수 없다(copy.ts GUIDE_CARD_FTE와 같은 문장). 뒤 문단이 이 파일의 몫이다.
     * 두 문단은 화면에서 나뉘어 보이도록 줄바꿈 두 개로 가른다.
     */
    id: 'fte',
    group: 'jobdata',
    term: '투입 비중(FTE)',
    short: '시간을 100으로 놓고 나눈 숫자입니다',
    long:
      '투입 비중(FTE)은 지난 1년 기준, 이 직무 수행에 실제로 들어간 시간의 상대적 비중을 과업별로 ' +
      '배분하는 것입니다. 직무 단위 합계가 100%가 되면 됩니다. 개인별 소요 시간을 실측하는 방식이 ' +
      '아니므로, 시계를 재실 필요가 없습니다.\n\n' +
      '큰 것부터 어림수로 적으시면 됩니다. 겸직 중이시면 이 직무에 쓴 시간만 100으로 보십시오.',
  },

  // ── ③ 화면에서 쓰는 말 ────────────────────────────────────────────
  {
    /*
     * 세 선택지의 뜻을 이 한 항목이 함께 진다. 물음표를 세 버튼에 따로 붙이면 radiogroup 안에
     * 라디오가 아닌 요소가 셋 끼어들고, 화면에도 같은 아이콘이 항목마다 세 개씩 늘어선다.
     * 응답자가 가장 먼저 막히는 자리라 여기만 long을 두 문단으로 둔다.
     */
    id: 'suitability',
    group: 'screen',
    term: '적합성',
    short: '지금 적힌 내용이 맞는지 고릅니다',
    long:
      '적합 — 그대로 맞습니다.\n일부 수정 필요 — 한두 군데만 다릅니다.\n부적합 — 이 직무가 하지 않는 일입니다.\n\n' +
      '셋 중 하나를 고르면 그 항목은 끝납니다.',
  },
  {
    id: 'fit-ok',
    group: 'screen',
    term: '적합',
    short: '그대로 맞습니다',
    long: '아래 칸은 비워 두셔도 됩니다.',
  },
  {
    id: 'fit-partial',
    group: 'screen',
    term: '일부 수정 필요',
    short: '한두 군데만 다릅니다',
    long: '어디가 다른지 한 줄 적어 주세요.',
  },
  {
    id: 'fit-no',
    group: 'screen',
    term: '부적합',
    short: '이 직무가 하지 않는 일입니다',
    long: '왜 그런지 한 줄 적어 주세요.',
  },
  {
    id: 'comment',
    group: 'screen',
    term: '개선 필요사항',
    short: '무엇이 다른지 적는 칸입니다',
    long: '한 줄이면 충분합니다.',
  },
  {
    id: 'suggestion',
    group: 'screen',
    term: '수정 제안',
    short: '어떻게 고치면 되는지 적는 칸입니다',
    long: '「개선 필요사항」과 둘 중 하나만 적으셔도 됩니다.',
  },
  {
    id: 'remove',
    group: 'screen',
    term: '삭제 제안',
    short: '하지 않는 일이면 체크하십시오',
    long: '바로 지워지지 않고 담당자가 확인합니다.',
  },
  {
    id: 'new-suggestion',
    group: 'screen',
    term: '신규 제안',
    short: '빠진 일을 추가합니다',
    long: '없으면 비워 두셔도 됩니다. 이름만 적으면 저장됩니다.',
  },
  {
    id: 'autosave',
    group: 'screen',
    term: '자동 저장',
    short: '따로 저장하지 않으셔도 됩니다',
    long: '입력을 멈추면 자동으로 저장됩니다.',
  },
  {
    id: 'save-vs-submit',
    group: 'screen',
    term: '임시저장과 최종 제출',
    short: '제출은 마지막에 한 번만 하십니다',
    long: '임시저장은 하던 데까지 남기는 것입니다. 제출하면 화면이 잠깁니다.',
  },
  {
    id: 'lock',
    group: 'screen',
    term: '제출 후 잠금',
    short: '제출 후에는 수정하실 수 없습니다',
    long: '고칠 곳이 생기면 「문의하기」로 알려 주십시오.',
  },
  {
    id: 'rereview',
    group: 'screen',
    term: '재검토 요청',
    short: '담당자가 다시 봐 달라고 한 상태입니다',
    long: '화면이 다시 열립니다. 사유는 화면 위에 표시됩니다.',
  },
  {
    id: 'inquiry',
    group: 'screen',
    term: '문의하기',
    short: '막히면 여기로 남겨 주십시오',
    long: '보고 계신 직무와 단계가 함께 전달됩니다.',
  },
] as const;

/** id → 용어. 목록 순회로 찾지 않는다(한 화면에 물음표가 열 개 넘게 붙는다). */
const BY_ID = new Map<TermId, Term>(TERMS.map((t) => [t.id, t]));

export const findTerm = (id: TermId): Term | undefined => BY_ID.get(id);

/** 용어집 페이지의 앵커 id. TermHint의 「용어집에서 보기」가 이 규칙으로 링크를 만든다. */
export const termAnchor = (id: TermId) => `term-${id}`;

/** TermHint 버튼의 접근 가능한 이름. 물음표만 있으면 낭독기가 "버튼"으로만 읽는다. */
export const termHintLabel = (term: string) => `${term} 설명 보기`;

/** 용어집으로 보내는 링크의 문구. */
export const TERM_MORE_LINK = '용어집에서 보기';

/** 용어집 페이지 제목·안내. */
export const GLOSSARY_TITLE = '용어 설명';
export const GLOSSARY_INTRO = '화면에 나오는 말을 모아 두었습니다. 모르는 말이 있으면 여기서 찾아보세요.';
