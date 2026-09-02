/*
 * 관리자 화면 조회·판정 API (배럴) — v2 D5 파일 분해.
 *
 * ▣ 왜 나눴나
 *   이 파일은 1,409줄이었다. 아홉 주제(조직 트리·진행 매트릭스·이견 신호·제출 큐·SME 비교·
 *   승인/반려·워크숍 플래그·문의·대시보드 지표)가 한 파일에 있어서, 문의 답변 한 줄을 고칠 때도
 *   신호 계산과 매트릭스 코드를 함께 스크롤해야 했다(기획안 §7 D5).
 *
 * ▣ 어떻게 나눴나
 *   src/lib/admin/shared.ts     — 실패 처리(ApiResult)·값 변환 등 공통 조각
 *   src/lib/admin/org.ts        — 조직 트리
 *   src/lib/admin/progress.ts   — 진행 현황 매트릭스(조직×직무)
 *   src/lib/admin/signals.ts    — 이견 신호·워크숍 자동 규칙 계산(순수 함수)
 *   src/lib/admin/queue.ts      — 제출 큐
 *   src/lib/admin/compare.ts    — 한 직무의 SME 응답 비교
 *   src/lib/admin/decide.ts     — 승인/반려
 *   src/lib/admin/workshop.ts   — 워크숍 대상 플래그
 *   src/lib/admin/inquiries.ts  — 문의 인박스
 *   src/lib/admin/dashboard.ts  — 대시보드 상단 지표
 *
 * ▣ 호출부는 그대로다
 *   화면·다른 모듈은 계속 '@/lib/adminApi'에서 가져온다. 아래 재수출이 그 경로를 유지한다.
 *   순수 함수(computeJobSignals·suggestionKey)는 vitest가 이 경로로 검증한다(adminApi.test.ts).
 */
export type { ApiResult } from './jobApi';

export * from './admin/org';
export * from './admin/progress';
export * from './admin/signals';
export * from './admin/queue';
export * from './admin/compare';
export * from './admin/decide';
export * from './admin/workshop';
export * from './admin/inquiries';
export * from './admin/dashboard';
