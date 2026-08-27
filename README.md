# Job Review

관리자와 SME가 직무정보를 함께 검토하고 피드백을 관리하는 반응형 웹 애플리케이션입니다.

## 제공 기능

- 이메일·비밀번호 로그인 및 ADMIN / SME 역할 분리
- 관리자 대시보드와 검토 상태 요약
- SME 계정 관리 화면
- 직무정보 Excel 업로드, 필수 열 검증, 미리보기
- 직무정보 업로드 양식 다운로드
- 직군 → 직렬 → 직무 종속 선택
- 직무정의, Task, Skill별 적합성 평가와 의견 작성
- 임시저장, 최종 제출 확인, 검토 이력
- 제출 결과 Excel 다운로드
- Supabase PostgreSQL 기반 테이블과 Row Level Security

## 실행

1. 의존성 설치

```bash
npm install
```

2. 환경변수 설정

`.env.example`을 참고해 Supabase 프로젝트 접속 정보를 설정합니다. 이 프로젝트는 Supabase PostgreSQL과 Supabase Auth를 사용합니다.

3. 실행

```bash
npm run dev
```

4. 배포용 확인

```bash
npm run typecheck
npm run build
```

## 테스트 계정

화면 확인용 테스트 계정은 로그인 화면의 테스트 계정 버튼에서 사용할 수 있습니다.

- 관리자: `admin@jobreview.local` / `admin1234`
- SME: `sme@jobreview.local` / `sme1234`

테스트 계정은 개발 화면 확인을 위한 계정입니다. 실제 운영 전에는 운영용 계정을 사용하고 비밀번호를 변경해야 합니다.

Supabase Auth를 사용하는 운영 계정은 이메일·비밀번호 방식으로 생성하고, `profiles` 테이블의 역할을 ADMIN 또는 SME로 설정해야 합니다. 관리자 권한은 인증 토큰의 변경 불가능한 앱 메타데이터 역할을 기준으로 서버에서 다시 확인해야 합니다.

## 데이터베이스

Supabase에 `create_job_review_system` 마이그레이션이 적용되어 있습니다. 주요 테이블은 다음과 같습니다.

- `profiles`
- `job_groups`, `job_series`, `jobs`
- `job_tasks`, `job_skills`
- `review_assignments`, `reviews`
- `job_feedback`, `task_feedback`, `skill_feedback`
- `new_task_suggestions`, `new_skill_suggestions`
- `review_history`, `upload_history`

직무 원문은 버전 값을 기준으로 보관하고 피드백이 원래 직무·Task·Skill을 참조하도록 설계해, 이후 Excel을 다시 올려도 제출 이력이 끊어지지 않도록 했습니다.

## Excel 업로드 양식

필수 열은 `직군`, `직렬`, `직무`, `직무정의`, `Task`, `Skill_Name`입니다. 선택 열은 `Task_ID`, `Task_Description`, `Skill_ID`, `Skill_Description`입니다.

같은 직무가 여러 행에 반복되는 형식으로 Task와 Skill을 등록할 수 있습니다. 화면에서 빈 필수 열, 필수 값 누락, 파일 형식 오류를 확인합니다.

## 보안

- 비밀번호는 Supabase Auth가 안전하게 처리합니다.
- 애플리케이션 데이터에는 Row Level Security가 활성화되어 있습니다.
- SME는 본인에게 배정된 검토만 조회할 수 있습니다.
- 관리자 기능은 ADMIN 역할로 서버 측에서 제한됩니다.
- 제출 후에는 재검토 요청 상태에서만 수정할 수 있도록 확장할 수 있습니다.
GitHub sync test