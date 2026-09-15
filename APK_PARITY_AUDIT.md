# APK-to-Web Parity Audit — Phase 5

## Baseline
- Sole functional baseline: `app-release_cp_019.apk`
- APK app name: `복권 정산`
- APK version: `1.0.2`
- Android package: `com.app.lotterysettlementapp`
- Verified APK SHA-256 (uploaded baseline): `abd4a3615724d6408c74a2f8e705549148a0eb6303546e861a27891d99ac06e7`

## Verified APK screen/workflow structure
- Bottom tabs: 홈 / 내역 / 재고 / 관리
- Home: current user and role, pairing/sync status for employees, today's work, pre-shift start or resume, saved count, pending count, quick menu, latest settlement, offline/sync notice, settings link.
- Pre-shift: start report, opening cash/safe context, handover, printed-lottery opening inventory by product/draw, opening prize payout value, evidence photos, save.
- Post-shift: closing lottery report, printed-lottery inventory and returns/receipts, closing inventory, prize payout closing value, bank transfer, closing safe, validation, discrepancy reason, evidence photos, handover, submit/approve flow.
- History: newest records with status and amounts; role-sensitive record visibility.
- Inventory: current stock by product/draw based on settlement records.
- Admin: dashboard summary, employee management, registered device management, pending employee settlements, detail/evidence review, approve/reject.
- Settlement detail: pre/post inputs, returns/inventory, amount breakdown, bank transfers, evidence photos, handover, approval history.

## Web implementation audit
- Web bottom navigation is 홈 / 내역 / 재고 / 관리.
- Web currently contains server-backed pre-shift draft save/resume rather than relying only on browser localStorage; localStorage is retained only as a fallback/cache.
- Printed-lottery inventory is represented by product + draw and separates opening stock, pre-shift return, in-duty receipt/return, and ending stock.
- Pre-shift return calculation is `opening stock - pre-shift return`; return quantity is carried in settlement data and is not added to sales amount.
- Approval/history/detail paths use settlement status and updated timestamp ordering with newest records first.
- Admin-only approval, staff management, and device-management controls are role gated.
- Evidence upload is capped at 8 photos and detail view supports zoom.

## Remaining verification gate
1. Full APK-to-web screen/order comparison on the uploaded APK.
2. Live verification of pre-shift save -> post-shift resume across a second browser/device.
3. Live verification of return -> inventory -> settlement detail -> approval -> history reflection.
4. Live verification of employee add/delete and role-specific visibility.
5. Live verification after refresh/re-login and after admin approval.
6. Render deployment verification on the dedicated test service.

## Safety rules
- Do not modify `main`.
- Do not modify the Android APK or any existing Android code.
- Do not modify production services.
- Make parity changes on the Phase 5 parity branch and verify on the Render test service.
- Do not mark a feature parity-complete until menu visibility, click behavior, save/reload, data reflection, and role-specific visibility are verified against the APK.

## Governing parity rule
- **The verified Android APK is the sole source of truth.**
- Menus, screens, order, buttons, workflow, permissions, save/edit/delete behavior, returns, inventory, approval, history, and settlement detail must follow the APK.
- Browser-specific differences are limited to technical presentation/input differences such as photo selection.
- If a mismatch is found, modify the web only. Android APK and existing Android code are never modified.
- Do not invent APK-absent business menus or redesign already-validated settlement processes.
