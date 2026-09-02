/*
 * 산출물 Export 공개 API (배럴) — v2 D5 파일 분해.
 *
 * ▣ 왜 나눴나
 *   이 파일은 1,518줄이었다. E1~E5 수집기 다섯 개와 그들이 공유하는 조회·변환·계약 대조 헬퍼가
 *   한 파일에 있어서, 산출물 하나를 고치려면 전체를 읽어야 했고 어떤 헬퍼가 어느 수집기에
 *   쓰이는지 눈으로 확인할 방법이 없었다(기획안 §7 D5).
 *
 * ▣ 어떻게 나눴나
 *   src/lib/export/shared.ts     — 조회 헬퍼(청크+페이지)·값 변환·계약 대조·공통 라벨·loader 7종
 *   src/lib/export/e1.ts … e5.ts — 산출물별 수집기 하나씩
 *   이 파일 — 화면이 쓰는 것만 다시 내보내는 배럴. 호출부(ExportsPage·durationApi 등)는 그대로다.
 *
 * ▣ 이 목록이 계약이다
 *   화면·다른 모듈이 쓸 수 있는 것은 아래 export뿐이다. shared.ts는 폴더 안에서만 쓰는 내부
 *   공용 모듈이라, 밖에서 필요해지면 여기에 한 줄을 더하는 것이 "공개하기로 정했다"는 표시가 된다.
 */
import type { ApiResult } from './jobApi';
import type { ExportId } from './exportSchema';
import { collectE1 } from './export/e1';
import { collectE2 } from './export/e2';
import { collectE3 } from './export/e3';
import { collectE4 } from './export/e4';
import { collectE5 } from './export/e5';
import type { CollectOptions, CollectedExport } from './export/shared';

export type { CollectOptions, CollectedExport } from './export/shared';
export {
  // 대용량 확인 임계값 — 화면이 "계속할까요?"를 묻는 기준(ExportsPage).
  EXPORT_ROW_WARNING,
  // 한 번에 다루는 검토 수 상한(E2 토글이 쓴다).
  EXPORT_MAX_REVIEWS,
  // 소요 실측의 구간 상한(분). durationApi가 같은 값을 써야 대시보드와 E5가 갈리지 않는다.
  SESSION_CAP_MINUTES,
  // 중앙값. durationApi가 공유한다(사본을 두지 않는다).
  median,
} from './export/shared';
export { collectE1, collectE2, collectE3, collectE4, collectE5 };

/**
 * Export ID → 조회 함수. 화면이 카드 5장을 같은 방식으로 다루게 한다.
 * opts 를 실제로 보는 것은 E2 하나뿐이라(§9 에서 토글이 있는 Export 가 E2 뿐이다) 나머지 넷은
 * 인자를 하나만 받는다 — 넘겨도 무시된다.
 */
export const EXPORT_COLLECTORS: Record<
  ExportId,
  (companyId: string | null, opts?: CollectOptions) => Promise<ApiResult<CollectedExport>>
> = {
  E1: collectE1,
  E2: collectE2,
  E3: collectE3,
  E4: collectE4,
  E5: collectE5,
};

/*
 * buildExport(id, {companyId, basis}) 어댑터는 두었다가 지웠다.
 * 두 화면 모두 EXPORT_COLLECTORS 를 직접 부른다 — 시트만 돌려주는 어댑터로는 rowCounts·totalRows 가
 * 버려져서, 대용량 확인(EXPORT_ROW_WARNING)과 완료 표시의 행 수를 화면이 다시 세야 했기 때문이다.
 * 아무도 부르지 않는데 "화면이 쓰는 유일한 진입점"이라 적힌 주석만 남으면 다음 사람이 그 말을 믿는다.
 */
