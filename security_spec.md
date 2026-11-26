# Firestore Security Specification — Gather Studio

## 1. Data Invariants
1. **Default Deny**: All paths not explicitly matched are denied for both reads and writes (`match /{document=**}`).
2. **Strict Ownership & Email Verification**: Every read/write requires an authenticated Google user (`request.auth != null`) and every write requires `request.auth.token.email_verified == true`. No cross-user reads or writes exist; every collection is scoped to `/users/{uid}`.
3. **Master Gate Relational Sync**: Every subcollection write (`scenes`, `triggers`, `highlights`, `cloudClips`, `private`) verifies that the parent `/users/{uid}` document exists (`exists(/databases/$(database)/documents/users/$(uid))`), preventing orphaned records.
4. **PII Isolation**: User email and Drive folder IDs live in `/users/{uid}/private/info` and are strictly restricted to `isOwner(uid)` — never readable by any other authenticated user.
5. **Immutable Identity & Server Timestamps**: `ownerId`/`uid` and `createdAt` cannot change after creation; `createdAt` (on create) and `updatedAt` (on create/update) must equal `request.time`.
6. **Bounded Strings & Arrays**: Every string field enforces `.size()` limits matching `firebase-blueprint.json`; arrays (`participants <= 12`, `elements <= 24`) validate size and element type.
7. **Action-Based Updates & Terminal Protection**: Every `allow update` begins with `isValid[Entity](incoming())` and explicitly allowlists mutated keys with `incoming().diff(existing()).affectedKeys().hasOnly([...])`.
8. **Secure List Queries**: Every `allow list` validates `isOwner(uid) && resource.data.ownerId == request.auth.uid` with zero `get()`/`exists()` calls inside `allow list`.

## 2. The "Dirty Dozen" Adversarial Payloads (All Must Return `PERMISSION_DENIED`)
1. **Unauthenticated read** of `/users/userA/scenes/scene1`.
2. **Cross-user PII read** of `/users/userA/private/info` by `userB`.
3. **Unverified email write** (`email_verified: false`) creating `/users/userA`.
4. **Shadow field injection** on `/users/userA` adding `"isAdmin": true`.
5. **Identity spoofing** creating `/users/userA/scenes/s1` with `ownerId: "userB"`.
6. **ID poisoning** creating `/users/userA/scenes/../../evil!@#` or 200-char ID.
7. **Orphaned subcollection write** creating `/users/userA/cloudClips/c1` when `/users/userA` does not exist.
8. **Client-forged timestamp** creating `/users/userA/triggers/t1` with `createdAt` != `request.time`.
9. **Immutable field mutation** updating `/users/userA/scenes/s1` to change `ownerId` or `createdAt`.
10. **Value poisoning** updating `/users/userA/cloudClips/c1` with `syncStatus: "hacked"` or 1MB `label`.
11. **Unbounded array abuse** creating `/users/userA/scenes/s1` with 50 `participants` or non-string first element.
12. **Blanket collection scrape** attempting `list` on `/users` or `/users/userA/cloudClips` as `userB`.
