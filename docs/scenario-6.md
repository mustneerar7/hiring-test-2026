# Scenario 6: Session Invalidation on Role Change

## Goal
Immediately and forcefully invalidate a user's session when they are removed from the clinic by the owner, ensuring secure access termination.

## Implementation Details

### 1. Decision: Option A (Token Revocation)
Chosen Option A (`admin.auth().revokeRefreshTokens(uid)`) as documented inside `DECISIONS.md`. It balances implementation simplicity with strong centralized security controls without inflating the Firestore cost vector native to Option B.

### 2. Client-Side Implementation
Linked the previously mocked UI client-side call `revokeUserSession(userId)` inside `src/services/auth.ts` to directly trigger the backend Cloud Function:
```typescript
await auth().app.functions('us-central1').httpsCallable('revokeUserSession')({ userId });
```

### 3. Server-Side Execution
Augmented the `removeStaffMember` HTTPS endpoint inside `checkout.ts` to automatically append the Firebase Admin `revokeRefreshTokens(uid)` action alongside disconnecting the staff member's Firestore doc and globally nullifying their `clinicId`. In addition, I exposed a standalone `revokeUserSession` endpoint in case the UI needed explicit direct access to trigger this flow unilaterally in the future.
