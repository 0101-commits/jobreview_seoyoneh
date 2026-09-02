/*
 * 업로드 화면의 상수·문언 (v2 D5 파일 분해).
 * 화면(UploadPage)과 표시 조각(parts)이 같은 값을 봐야 하는 것만 둔다 —
 * 두 파일에 같은 문장을 두면 한쪽만 고쳐지는 순간 화면이 서로 다른 말을 한다.
 */
import { FileSpreadsheet, ListChecks, Settings2, Upload } from 'lucide-react';

/** 업로드 4단계. 화면의 진행 표시(ProgressTracker)와 단계 계산이 같은 목록을 본다. */
export const STEPS = [
  { label: '파일 선택', icon: FileSpreadsheet },
  { label: '데이터 검증', icon: ListChecks },
  { label: '저장 방식 선택', icon: Settings2 },
  { label: '최종 업로드', icon: Upload },
] as const;

/** 저장은 서버 RPC 한 번으로 끝나므로 건별 진행률 대신 두 단계로만 알립니다. */
export const SAVE_PHASES = ['회사 정보 확인 중', '직무정보 전송 및 반영 중'] as const;
/** 조직 마스터 Sheet가 있을 때만 붙는 단계. 없으면 기존과 똑같이 2단계입니다. */
export const ORG_SAVE_PHASE = '조직 마스터 반영 중';
/** SME 명부 Sheet가 있을 때만 붙는 단계. 조직 마스터가 먼저 저장돼야 조직코드를 풀 수 있습니다. */
export const SME_SAVE_PHASE = 'SME 명부 연결 중';

/** 시트 ④의 범위 한계를 화면·코드 양쪽에 같은 문장으로 남깁니다. */
export const SME_SHEET_NOTICE =
  '명부는 이미 등록된 계정의 소속 조직·배정직무만 반영하며 계정 생성은 SME 계정 관리 화면에서 합니다';

/** 못 찾은 이메일·조직코드·직무명을 화면에 나열할 때 앞쪽 몇 개만 보여 주고 나머지는 건수로 줄입니다. */
const NAME_LIST_LIMIT = 10;

export function listPreview(items: string[]): string {
  const head = items.slice(0, NAME_LIST_LIMIT).join(', ');
  return items.length > NAME_LIST_LIMIT ? `${head} 외 ${items.length - NAME_LIST_LIMIT}건` : head;
}
