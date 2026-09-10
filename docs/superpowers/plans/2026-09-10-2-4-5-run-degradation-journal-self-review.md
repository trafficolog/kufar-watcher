# 2.4.5 implementation plan — self-review addendum

Date: 2026-09-10
Status: required by implementation plan
Parent plan: `docs/superpowers/plans/2026-09-10-2-4-5-run-degradation-journal.md`
Spec: `docs/superpowers/specs/2026-09-10-2-4-5-run-degradation-journal-design.md`

This addendum closes two acceptance gaps found during the plan self-review. Both checks are mandatory parts of Task 3 and must be implemented with RED/GREEN evidence before documentation closure.

## A. Warning failure after durable degradation persistence

Add a focused executor test in `tests/unit/scheduled-monitor-run.test.ts` where the run-scoped degradation sink successfully updates `Run.degradedLevel = 'html-fallback'`, then `onSourceDegradation` rejects.

The test must prove:

- the first `run.update` targets the current running `runId` and writes only `degradedLevel: 'html-fallback'`;
- the warning callback is awaited and its failure reaches the executor error path;
- the later error-finalization update contains the existing safe error fields but does not contain `degradedLevel`;
- therefore the durable `html-fallback` marker survives the warning failure.

Do not change `KufarResilientSource` sink-failure classification in this task; its existing tests already own wrapping source-sink failures as `KufarResilientSourceError(stage='degradation-event')`.

## B. Different Runs keep independent degradation state

Add a focused executor test in `tests/unit/scheduled-monitor-run.test.ts` using two sequential scheduled executions with different created Run ids, for example `9001` and `9002`.

For each execution, invoke its own captured degradation sink twice. The test must prove:

- `createRunAdapters` receives a fresh sink for every scheduled Run;
- Run `9001` gets exactly one degradation update;
- Run `9002` gets exactly one degradation update;
- the application warning callback is invoked exactly once per Run, twice total;
- the idempotency flag from the first Run cannot suppress degradation in the second Run.

These checks complete the approved spec requirements for sticky persistence and Run isolation. They introduce no new production interface beyond the parent plan.
