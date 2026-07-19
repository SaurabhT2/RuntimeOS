/**
 * Thrown by `getActiveRuntimeProfile`/`setTenantRuntimeProfile` when a
 * `RuntimeProfileId` (whether a tenant override, a configured deployment
 * default, or an explicit `upsertProfile`/lookup argument) has no
 * registered `RuntimeProfile` — the same never-silent-failure rationale as
 * `capability-registry`'s and `execution-profile-registry`'s resolution
 * errors (architecture §19.3).
 */
export class RuntimeProfileResolutionError extends Error {
  readonly profileId: string;

  constructor(profileId: string) {
    super(
      `No RuntimeProfile registered for id "${profileId}". Register one via ` +
        `RuntimeProfileRegistry.upsertProfile() before it can be assigned or resolved.`,
    );
    this.name = "RuntimeProfileResolutionError";
    this.profileId = profileId;
  }
}
