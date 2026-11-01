# TiffinLoop: Normalization and Fallback Rules (Draft)

A draft to compare against your own decisions. Build your own version in code, and log every decision you make, since the brief grades how you reason as well as what the tool does.

Ground rules: keep the raw files untouched. Every normalization happens in code, and each raw row should be traceable from the output back to its source row.

## 1. Normalization rules

**Cities.** Map to Bengaluru, Mumbai, or Pune. Case-insensitive lookup, with these aliases:
- Bengaluru: Bangalore, BLR, Blr
- Mumbai: MUM, Bombay
- Pune: PUNE, pune

Check after mapping: every subscriber's city should match their assigned cook's city. In the seed data it does, so keep that check as a regression test.

**Order status.** Lowercase and strip, then map:
- delivered, completed: delivered
- pending: pending
- in progress, in-progress: in_progress
- cancelled: cancelled
- refunded: refunded
- cook_dropout, cook no show, cook no-show, cancelled - cook unavailable: cook_failure
- no show: ambiguous. The label does not say whether the cook or the subscriber failed to show. Flag it and do not count it as a cook failure without a decision from you.

**Cook status.** active, on_leave, inactive. Treat on_leave and inactive as unavailable for backups.

**Dates.** Order dates appear as ISO (YYYY-MM-DD) or DD/MM/YYYY. Parse slash dates as day first. Verify the parser on rows where the day is greater than 12. Cook status_since appears as ISO, DD/MM/YYYY, and DD-Mon-YYYY, so use one parser for all of them.

**Phones.** Strip spaces, hyphens, and a leading +91 or 0, then check for 10 digits. A blank or invalid number means the subscriber cannot be messaged by phone, so route them to an ops call instead of marking the message as sent.

**Subscribers and duplicates.** Match on IDs, never names. Flag likely duplicates such as the two Tariq records (SUB0511 and SUB0512), which share a cook, plan, and diet. Do not auto-merge or auto-cancel. Show the duplicate to ops, since it may explain the double reminders.

**Meal plans vs orders.** Plans imply about 640 meal slots per day, but orders show about 230. Use the order log as the source of truth for what is actually due, and surface the gap in the leadership view as a data-quality note.

## 2. Dropout event intake

A dropout can come from the sheet or from the WhatsApp group. Record the source on the event.

- If the source is WhatsApp and the sheet is not yet updated, act on it anyway, because the cutoff is close. Mark the event as "reported, sheet not updated" until ops confirms.
- Ignore messages that are not dropouts (the Meena Nair "on track" message, the Anil Joshi lateness message). Anil Joshi's record is ambiguous, so flag it for ops.
- Make intake idempotent: a repeated report for the same cook, date, and meal should not create a second event.

## 3. Fallback matching

For each affected order (same cook, same date, meal not yet delivered, cancelled, or refunded):

1. **Check the cutoff.** Lunch window opens 12:30 PM, dinner 7:30 PM. Compute minutes remaining. If the window has already opened, skip re-cooking and go straight to a refund or delay option, and label it as late.
2. **Find eligible backups.** All of these must hold:
   - Status is active.
   - Same normalized city as the subscriber.
   - Serves the subscriber's diet. Veg needs "Veg" in serves. Jain needs "Jain" in serves. Non-Veg needs "Non-Veg" in serves.
   - Not the dropped cook, and not another cook in this same event.
3. **Compute headroom.** max_daily_orders minus the cook's count of live orders for that meal today. Headroom at or below zero means ineligible.
4. **Rank backups.** Prefer a cuisine match with the subscriber's preference, then the most headroom, then the lowest current load. Document the ranking so judges can see the reasoning.
5. **Assign in urgency order.** Process the soonest-due orders first, decrementing headroom as you assign so you never double-book a cook.
6. **Outcome per order.** One of: reassigned (with the new cook named), no backup available (offer refund or a delayed meal, and log which one), or needs ops decision (ambiguous cases, duplicates, missing phone).

## 4. Notifications

Compose one message per affected subscriber containing: the meal and its window, what changed (new cook name, or the refund or delay option), and what they should do if anything is wrong. Send it before the cutoff and record the timestamp. Log each message as sent, not sent (no phone), or failed, so the traceability criterion is met.

## 5. Traceability log

Append-only. For each event, record: who reported it and when, the source, the affected orders, each decision with its reason, each notification with its status and timestamp, and any ops override. Ops should be able to answer "who was affected, what was decided, and was everyone told" from this log alone.

## 6. Test scenarios to run

Use the seed data as given, plus a separate test harness for scenarios the data does not cover. Do not edit the seed files.

1. Today as it stands: Lakshmi Iyer and Geeta Rao are on leave in the sheet, and Sunita Kulkarni is reported only via WhatsApp. Expect 24 affected orders, with backups found for all of them.
2. Jain subscriber whose cook drops out in a city with no remaining Jain-capable backup. Expect a no-backup outcome.
3. Backup cook also drops out during the same event. Expect re-matching, with no double-booking.
4. Dropout reported after the lunch window has opened. Expect a late flag and no re-cook.
5. Subscriber with no phone. Expect an ops-call outcome, not a sent message.
6. Duplicate subscriber (Tariq). Expect a flag, not a merge.
7. Same cook dropping out for both lunch and dinner. Expect separate handling per meal.

## Open decisions for you

- Does "no show" count as a cook failure? Pick a rule and defend it.
- Refund versus delay when no backup exists. What does the subscriber get, and who approves it?
- How much of the ranking should be automated, and how much should go to an ops person?
