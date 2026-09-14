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

## Current web parity failures verified before editing
1. Admin home can be blank because the current web hides the only create card for admins and has no APK-style admin home dashboard.
2. Current web uses one combined `새 정산` form instead of separate APK `근무 전 정산` and `근무 후 정산` workflows.
3. Current web top navigation does not match the APK tab structure.
4. Current web has no dedicated inventory screen equivalent to the APK inventory tab.
5. Current web does not reproduce the APK home metrics, active-shift resume logic, latest settlement card, or offline-first status.
6. Current web admin management is reduced to a staff list and does not yet match the APK employee/device management dashboard.
7. Current web settlement detail is reduced and does not yet expose the full APK pre/post, amount, handover, evidence and approval-history structure.
8. Printed-lottery inventory/returns are represented as a generic repeated form and are not yet organized as the APK's dedicated pre/post inventory workflow.

## Safety rules
- Do not modify `main`.
- Do not modify the Android APK.
- Do not modify production services.
- Make parity changes only on `web-phase5-apk-source-parity`, then test on the Render test service.
- Do not mark a feature as parity-complete until its web behavior is verified against the APK baseline.
