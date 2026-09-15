# APK-to-Web Parity Audit — Phase 5

## Baseline
- Sole functional baseline: `app-release_cp_019.apk`
- APK app name: `복권 정산`
- APK version: `1.0.2`
- Android package: `com.app.lotterysettlementapp`
- The previously archived React Native source has matching app name, version, package and Expo configuration, so it is used only to inspect the screen/workflow structure corresponding to the APK baseline.

## Verified APK screen/workflow structure
- Bottom tabs: 홈 / 내역 / 재고 / 관리
- Home: current user and role, pairing/sync status for employees, today's work, pre-shift start or resume, saved count, pending count, quick menu, latest settlement, offline/sync notice, settings link.
- Pre-shift: start report, opening cash/safe context, handover, printed-lottery opening inventory by product/draw, opening prize payout value, evidence photos, save.
- Post-shift: closing lottery report, printed-lottery inventory and returns/receipts, closing inventory, prize payout closing value, bank transfer, closing safe, validation, discrepancy reason, evidence photos, handover, submit/approve flow.
- History: newest records with status and amounts; role-sensitive record visibility.
- Inventory: current stock by product/draw based on settlement records.
- Admin: dashboard summary, employee management, registered device management, pending employee settlements, detail/evidence review, approve/reject.
- Settlement detail: pre/post inputs, returns/inventory, amount breakdown, bank transfers, evidence photos, handover, approval history.

## Current web parity status
1. Admin home: partially corrected (admin quick actions and sync entry added), but full APK dashboard metrics/latest-settlement/active-work resume still need live parity verification.
2. Admin settlement workflow: controls for 근무 전 / 근무 후 / 승인 exist; underlying separate pre/post data flow still requires live end-to-end verification.
3. Navigation: web has 홈 / 내역 / 재고 / 관리; exact APK click/visibility behavior still requires live verification.
4. Inventory: product/draw and return UI exists. Inventory now derives each product/draw from the latest approved settlement state instead of cumulatively adding historical settlements. Dedicated APK-style presentation and live record verification remain open.
5. Printed-lottery return flow: web now explicitly relates product + draw + return quantity and displays the resulting adjusted/current stock. Server validation also persists `preWorkReturns` and `onDutyReturns`; return quantities do not enter sales quantity. Live APK comparison remains required.
6. Home metrics: saved count, pending count, latest settlement, active-work resume and offline/sync status require live verification.
7. Admin management: 직원 관리, 등록기기 관리 and 등록삭제 exist. Employee count is limited to 4 active employees, matching the administrator + 4 employees target. Live API verification remains open.
8. Settlement detail: photo zoom exists; complete pre/post, return/inventory, amount, handover and approval-history parity remains open.
9. Photo evidence: web/server limit is 8 images, matching the current requirement.
10. Employee mode: employee home, pairing/sync state, pre/post workflow, approval request and newest-first history remain open for live parity verification.
11. Regression gate: no feature is parity-complete until menu visibility, click behavior, save/reload, data reflection and role-specific visibility are verified.

## Current data-flow checks
- Web login/session uses server-side `web_users` and `web_sessions`.
- Web settlement writes use the authenticated staff identity as the canonical `createdBy` identity rather than trusting an arbitrary browser-supplied name.
- Settlement writes validate printed-lottery quantities and the flow `originalStock -> preWorkReturn -> adjustedStock -> restock -> onDutyReturn -> availableStock -> endingStock`.
- Attachments are limited to 8 images and validated as image data URLs.
- Employee settlement editing is restricted to the employee's own draft; submitted/approved/rejected records are locked for employee editing.
- Admin approval/rejection and cross-device propagation still require live verification.

## Safety rules
- Do not modify `main`.
- Do not modify the Android APK.
- Do not modify production services.
- Make parity changes only on `web-phase5-apk-source-parity`, then test on the Render test service when the workspace is available.
- Do not mark a feature as parity-complete until its web behavior is verified against the APK baseline.
- Render workspace is currently unavailable; do not attempt Render operations until the user makes it available.

## Governing parity rule
- **기준은 검증 완료된 Android APK 하나로 고정한다.** 웹은 독립적인 제품 사양이나 기존 웹 구조를 기준으로 판단하지 않는다.
- 메뉴, 화면, 버튼, 표시 순서, 업무 흐름, 권한별 노출, 저장/수정/삭제 동작, 반품·재고·승인 데이터 반영은 APK 동작을 기준값으로 한다.
- 웹 전용 기능은 APK 기준 업무 기능과 충돌하지 않는 기술적 표현 차이(브라우저 사진 선택 등)만 허용한다. APK에 없는 별도 업무 메뉴를 임의로 추가하지 않는다.
- 차이가 발견되면 APK를 바꾸는 것이 아니라 **웹을 수정한다. Android APK와 기존 Android 코드는 변경 금지**.
- 이전에 검토 완료된 정산 프로세스는 재설계하지 않고 APK 구현을 그대로 웹에 맞춘다.
