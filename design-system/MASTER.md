# CrazyValue(미친가치) — 디자인 기준파일 (단일 Source of Truth)

> 이 파일이 모든 UI 결정의 기준이다. 페이지별 예외는 `design-system/pages/[page].md`가 있을 때만 이 파일을 오버라이드한다.
> 생성: 2026-07-18, ui-ux-pro-max 산출 + 기획안 §6 확정 토큰. **아래 [최상단 오버라이드]가 스킬 권고보다 항상 우선한다.**

## 최상단 오버라이드 — 기획안 §6 확정 (변경 금지)

| 토큰 | 값 |
|---|---|
| Navy `--color-navy` | `#0F2A43` — 헤더·하단 탭 바탕 |
| Ink `--color-ink` | `#1A2332` — 본문 텍스트 |
| Paper `--color-paper` | `#FAFAF8` — 배경(순백 금지) |
| Accent `--color-accent` | `#2456A6` — 최저가·CTA·D-day·픽 배지 (단일 강조색) |
| 상태색 | 색만으로 전달 금지 — 반드시 텍스트 라벨 병기 |
| 폰트 | **Pretendard**(npm 셀프호스팅, `font-display: swap`) — 외부 CDN 금지 |
| 본문 | 15px, line-height 1.5~1.7 |
| 숫자 | 금액·D-day·건수 전부 `tabular-nums` 필수 |
| 톤 | 신뢰성 있는 컨설팅 톤 — 단정형, 설명 2문장 이내. "미친"은 브랜드명·픽 배지 한정 |
| 픽 배지 | Accent 바탕 + 흰 글자 텍스트 배지 "미친가치 픽" — 아이콘·이모지 불사용 |
| 아이콘 | lucide-react 라인 아이콘 단일 세트 |
| 금지 | 이모지 아이콘 · 그라데이션 · 과잉 애니메이션(펄스·캐러셀 자동재생 포함) · 과장 수식어 · 느낌표 |
| 접근성 | WCAG AA — 대비 4.5:1 · `role="alert"` · `focus-visible` 가시 · 터치 ≥44px · `prefers-reduced-motion` 존중 |

### 스킬 권고 중 무효 처리 (§6 충돌)
- 색: Trust teal(#0F766E 계열) → **미사용** (§6 4색 체계로 대체)
- 폰트: Cinzel·Josefin Sans + Google Fonts CDN @import → **미사용** (Pretendard 셀프호스팅)
- 패턴: App Store 랜딩(스타 평점·QR·다운로드 CTA) → **미사용** (본 제품은 랜딩이 아니라 도구형 PWA)
- 효과: metric pulse·certificate carousel → **미사용** (과잉 애니메이션 금지)

## 스킬 산출 채택분 (§6와 정합)

### 스타일 방향
- **Trust & Authority**: 근거 있는 수치 표기(데이터 기준일·픽 기준 공개), 출처·법적 고지 상시 노출이 곧 신뢰 장치다.

### 간격 스케일
| 토큰 | 값 | 용도 |
|---|---|---|
| xs | 4px | 밀착 간격 |
| sm | 8px | 아이콘·인라인 |
| md | 16px | 표준 패딩(카드 내부) |
| lg | 24px | 섹션 패딩 |
| xl | 32px | 큰 구분 |

### 그림자 (절제)
- 카드: `0 1px 2px rgba(15,42,67,0.06)` — 미세 lift만. lg/xl 그림자·글로우 미사용.
- 시트/모달: `0 8px 24px rgba(15,42,67,0.14)` + 오버레이 `rgba(15,42,67,0.4)`(blur 미사용).

### 컴포넌트 규격
- 버튼(주): Accent 바탕·흰 글자·높이 ≥48px(홈 결과 버튼 52px 고정)·radius 10px·`transition-colors 200ms`. hover는 색 농도 변화만(레이아웃 이동 금지).
- 버튼(보조): 투명 바탕·Ink 글자·1px 테두리 `#D8D9D4`.
- 카드: 흰 바탕(`#FFFFFF`) on Paper·radius 12px·테두리 `#E7E8E3`·패딩 16px. hover 이동 없음, 탭 피드백은 배경 농도.
- 입력·칩: 높이 ≥44px·radius 8px·선택 상태는 Accent 배경+흰 글자(+체크 라벨).
- 포커스: `:focus-visible { outline: 2px solid #2456A6; outline-offset: 2px }` 전역.
- z-index 스케일: 시트 50 · 하단 탭 40 · 고정 바 30 · 카드 0.

### 안티패턴 (게이트 차단 연동)
- AI 보라·핑크 그라데이션 히어로 · glassmorphism blur 남발 · 이모지 아이콘 · scale hover로 레이아웃 이동 · 저대비 본문(gray-300/400) · 무전환 즉시 상태 변화 · 보이지 않는 포커스.

### 납품 전 체크(게이트 --check와 동일 축)
- [ ] 이모지 아이콘 0 · 그라데이션 0 · 과장 수식어/느낌표 0
- [ ] 본문 대비 4.5:1 · focus-visible 가시 · 터치 ≥44px · reduced-motion 존중
- [ ] 숫자 tabular-nums · 상태색 텍스트 라벨 병기 · 고정 요소에 콘텐츠 가림 없음
- [ ] 375px 기준 가로 스크롤 없음(모바일 온리)
