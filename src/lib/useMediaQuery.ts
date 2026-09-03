import { useEffect, useState } from 'react';

/*
 * 뷰포트 폭을 값으로 읽는다(v3 T3·T5).
 *
 * 왜 필요한가: CSS로 숨기는 것과 렌더하지 않는 것은 다르다. DataTable은 표와 목록 두 트리를
 * 둘 다 그려 놓고 hidden/sm:block으로 하나만 보여 줬다 — 행이 DOM에 두 벌 있었다.
 * 조직×직무 매트릭스처럼 수백 행이 오는 화면에서 초기 렌더가 그만큼 무겨웠고,
 * 보이지 않는 트리도 낭독기 탐색 대상이 됐다.
 *
 * 서버 렌더가 없는 앱이라 첫 값도 matchMedia로 바로 읽는다(깜빡임 없음).
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(
    () => typeof window !== 'undefined' && window.matchMedia(query).matches,
  );

  useEffect(() => {
    const mq = window.matchMedia(query);
    const sync = () => setMatches(mq.matches);
    sync(); // query가 바뀌었을 때 첫 값을 맞춘다.
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, [query]);

  return matches;
}

/*
 * 브레이크포인트의 뜻(v3 T5). 값은 Tailwind 기본을 그대로 쓰고 의미만 여기서 고정한다.
 *   sm 640  — 손가락에서 포인터로 넘어가는 선. 터치 타깃 44px 보장을 여기서 해제한다.
 *   md 768  — 표를 그려도 되는 선. montage가 "767px 이하는 모바일"로 가르는 그 선이다.
 *   lg 1024 — 사이드바가 상주하는 선.
 *   xl 1280 — 본문 옆에 보조 패널을 둘 수 있는 선.
 */
export const BP = {
  sm: '(min-width: 640px)',
  md: '(min-width: 768px)',
  lg: '(min-width: 1024px)',
  xl: '(min-width: 1280px)',
} as const;
