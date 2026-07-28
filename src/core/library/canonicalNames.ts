/**
 * The spellings the programme will use from Block 2 onward.
 *
 * These matter because merging is only half the repair: folding
 * `chest row   x6 @` into `chest row` fixes today, but the next routine written
 * as `Chest-supported row` would split the library again on import. Merging
 * straight onto the name the programme uses closes the loop.
 *
 * The list is a default, not a rule — the cleanup screen shows the resulting
 * name in an editable field, so nothing here is imposed silently.
 */
export const CANONICAL_EXERCISE_NAMES = [
  'Chest-supported row',
  'Face pull',
  'Plank',
  'Pallof press',
  'Dead bug',
  'Hip thrust',
  'Romanian Deadlift',
  'Seated Leg Curl',
  'Bulgarian Split Squat',
  'Back Extension',
  'Hip Abduction',
  'Leg Press',
  'Front Squat',
  'Leg Extension',
  'Barbell Back Squat',
  'Bodyweight Squat',
  'Single-Leg Glute Bridge',
  'Reverse Lunge',
]
