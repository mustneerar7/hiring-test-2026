# Scenario 4: Payment Failure and Grace Period

## Goal
Gracefully handle invoice payment failures by entering a defined grace period, preventing new staff from being added while retaining access for existing users. When the grace period concludes, forcefully drop the plan to Free tier and automatically deactivate any excess staff members.

## Implementation Details

### 1. Grace Period Defined
The system allocates a standard **7-Day Grace Period**, defined implicitly in `GRACE_PERIOD_DAYS` within `webhook.ts`. During this period, the clinic is marked logically with `"status": "grace_period"`.

### 2. Rule Enforcement (`firestore.rules`)
- **Retention of Features:** The `clinicIsActive()` global helper rule explicitly tolerates both `"active"` and `"grace_period"`. Any standard reads, updates to appointments, and usage of clinic systems operate unhindered during this stage.
- **Halting Expansions:** The dedicated rules block responsible for enforcing maximum seats explicitly demands `status == 'active'`. So although `clinicIsActive()` keeps other systems running, adding *new* staff predictably fails the explicit `active` lock.

### 3. Grace Period Expiry (`webhook.ts`)
The true expiry of the grace period is elegantly punted to Stripe's native "Smart Retries" timeline, which systematically attempts to salvage the invoice until the schedule completes.
When it does complete and cancel, `handleSubscriptionDeleted` fires. I augmented this function to:
- Iterate asynchronously across all `active == true` nested `members` for that clinic.
- Systematically deactivate all staff EXCEPT one (typically preserving the original `owner` to avoid locking the clinic irreparably).
- Atomically commit these status revocations utilizing Firestore bulk `batch`.
- Accurately revert `seats.used` back to `1` matching a Free plan's limits to keep the core DB strictly synchronous.
