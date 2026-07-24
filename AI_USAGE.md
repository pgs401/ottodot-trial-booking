# AI usage

## Tools used

Claude Code, on Opus 4.8 and Sonnet 5, was the sole implementation tool
across all twelve milestones: the schema and its invariants, the domain
services, the mock payment fixture, the HTTP API, the UI, the test suite,
the README, and this document. Claude, in chat, was used beforehand for
architecture review: two rounds of adversarial review against the design,
one of which found a false claim in a planned code comment about lock
scope, described below. No Copilot, no ChatGPT, no other assistant.

The proportion of committed code the tool generated outright is not in
these notes, so it is left blank rather than estimated.

## Where AI moved me faster

The schema in `db/migrations/001_init.sql` was the biggest saving. Enum
declarations, foreign keys, index scaffolding and column boilerplate are
mechanical; I specified the two invariants, their exact constraint names,
and what each comment had to argue for, and the model produced the
structure around that.

The five route handlers in milestone six were the second: parse, call a
service, map an error, repetitive and low judgement, and the shared error
mapping helper meant one specification covered all five.

## Where I disagreed with AI output and what I did instead

The example I would most want to be asked about. An earlier draft, from
architecture review before any code existed, claimed that authorising
before the seat claim meant the locked section never held a row level lock
across an external network call. False: the lock is held later, across
`psp.capture`, regardless of when authorisation happens. The committed
comment in `booking.service.ts` now reads:

```
// Lock scope, honestly: once the seat is claimed at step 7 the
// trial_classes row lock is held until COMMIT, with psp.capture inside
// that window. Deliberate, seat and captured payment commit together or
// neither. Cost: concurrent confirmations for one class serialise behind
// a single payment round trip; immaterial at 4 seats, not at high volume,
// where the fix is to split claim and capture across two transactions
// with a reconciliation worker covering the window.
```

The original named the wrong call as the risk: authorising early avoids
charging a doomed booking, it does not avoid the lock.

Two smaller cases, both milestone three. My seed specification contradicted
itself, wanting a class with zero confirmed students and a confirmed
booking on it, impossible under the counter drift invariant; the model
flagged it, offered two fixes, and I took its own resolution instead. It
also added a fourth seeded family because the unique index forbids one
child twice in a class, correctly, and I asked for that to be stated in the
seed file, not left looking like padding.

## What I would change about my AI workflow

I steered rather than verified. The prompts specified the exact conditional
update statement, forbade retry loops and SERIALIZABLE isolation, and
required the race test to use an explicit barrier, not a delay, the three
places I expected plausible but wrong output. Each came back correct first
time.

The cost is I have evidence constraining the model worked, and none of what
it would have produced unsupervised. Next time I would give a looser brief
for the concurrency test first, see what came back, then apply the
constraint, testing my assumptions rather than assuming them. I would also
keep the notes file from the first prompt, not reconstruct it from the
transcript afterwards.

## How I verified the final implementation

Not by reading it. By three tests and one clean run.

Test seven writes a duplicate booking with raw SQL, bypassing the service
layer, and asserts Postgres rejects it by constraint name: the invariant
survives the application code being wrong. Test eight reproduces the last
seat race with a gated payment authorisation, not a delay, so the
interleaving is stated by the test, not timing; there is no sleep in it.
Test nine issues ten simultaneous confirmations on separate pool
connections and asserts exactly four confirmed and that the CHECK
constraint never fired, the update doing the arbitration, not the
backstop.

Each was confirmed to fail when its guarantee was removed. Dropping the
duplicate index let test seven's duplicate insert succeed silently.
Removing the capacity guard made test eight fail on the CHECK constraint
firing, and test nine fail with a seat lost count of zero instead of six.

Milestone nine cold cloned the repository and followed the README quick
start as written. It found `npm test` failing on the first attempt, every
file, because nothing created the test database automatically, now fixed
on cold start. Elapsed time from clone to green tests was about eighteen
seconds.

`npm test` passed identically, four files and ten tests, on six
invocations over three milestones, not one dedicated loop, stated plainly
rather than oversold.
