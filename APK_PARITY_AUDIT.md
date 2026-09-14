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

## Current web parity status (2026-09-14 audit)
1. Admin home: partially corrected (admin quick actions and sync entry added), but full APK dashboard metrics/latest-settlement/active-work resume still need parity verification.
2. Admin settlement workflow: controls for 근무 전 / 근무 후 / 승인 were added, but the underlying separate pre/post data flow must still be verified end-to-end.
3. Navigation: web screen grouping still requires a full APK bottom-tab parity check for 홈 / 내역 / 재고 / 관리.
4. Inventory: product/draw and return UI exists, and Lotto645 is absent from the current web strings, but dedicated APK-style inventory presentation and record-derived stock verification remain open.
5. Home metrics: saved count, pending count, latest settlement, active-work resume and offline/sync status require explicit end-to-end parity verification.
6. Admin management: 직원 관리, 등록기기 관리 and 등록삭제 were added; each action still requires live API verification.
7. Settlement detail: photo zoom was added; complete pre/post, return/inventory, amount, handover and approval-history parity remains open.
8. Printed-lottery pre/post: return-related UI exists, but the full pre-shift/post-shift inventory workflow must be verified against actual saved settlement data.
9. Employee mode: employee home, pairing/sync state, pre/post workflow, approval request and newest-first history remain open for parity verification.
10. Regression gate: no feature is parity-complete until menu visibility, click behavior, save/reload, data reflection and role-specific visibility are all verified.

## Safety rules
- Do not modify `main`.
- Do not modify the Android APK.
- Do not modify production services.
- Make parity changes only on `web-phase5-apk-source-parity`, then test on the Render test service.
- Do not mark a feature as parity-complete until its web behavior is verified against the APK baseline.
