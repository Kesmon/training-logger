import { useState } from 'react'
import {
  SET_TYPES,
  displayToKg,
  fmtEffort,
  kgToDisplay,
  setTypeLabel,
  setTypeShort,
  weightLabel,
} from '../core/format'
import type { PrFlags } from '../core/metrics'
import type { Exercise, SetEntry, SetType, Settings } from '../db/schema'
import { IconCheck, IconTrash } from './Icons'
import { NumberField } from './NumberField'

const RPE_STEPS = [6, 6.5, 7, 7.5, 8, 8.5, 9, 9.5, 10]
const RIR_STEPS = [5, 4, 3, 2, 1, 0]

export function SetRow({
  set,
  exercise,
  settings,
  prs,
  onChange,
  onToggleComplete,
  onDelete,
}: {
  set: SetEntry
  exercise: Exercise
  settings: Settings
  /** Records this set broke, computed once per session by the parent. */
  prs?: PrFlags
  onChange: (patch: Partial<SetEntry>) => void
  onToggleComplete: () => void
  onDelete: () => void
}) {
  const [open, setOpen] = useState(false)
  const { unit } = settings
  const fields = exercise.fields
  const assisted = exercise.equipment === 'assisted'

  // Assistance is stored negative but typed and shown as a positive number.
  const shownWeight =
    set.weightKg === undefined ? undefined : kgToDisplay(assisted ? -set.weightKg : set.weightKg, unit)

  function setWeight(v: number | undefined) {
    if (v === undefined) return onChange({ weightKg: undefined })
    const kg = displayToKg(v, unit)
    onChange({ weightKg: assisted ? -Math.abs(kg) : kg })
  }

  const effortType = set.effortType ?? exercise.defaultEffortType ?? settings.defaultEffortType
  const tag = setTypeShort(set.setType)

  return (
    <div className={`setrow${set.isComplete ? ' setrow--done' : ''}`}>
      <div className="setrow__main">
        <button
          className={`setrow__n${tag ? ' setrow__n--tagged' : ''}`}
          onClick={() => setOpen((o) => !o)}
          aria-label={`Set ${set.setNumber}, ${setTypeLabel(set.setType)}. Tap for options`}
          aria-expanded={open}
        >
          {tag || set.setNumber}
        </button>

        {fields.includes('weight') && (
          <div className="setrow__weight">
            <NumberField
              value={shownWeight}
              onChange={setWeight}
              decimal
              min={0}
              placeholder={weightLabel(exercise.equipment, unit)}
              ariaLabel={`Weight, ${unit}`}
            />
          </div>
        )}

        {fields.includes('weight') && fields.includes('reps') && <span className="setrow__x">×</span>}

        {fields.includes('reps') && (
          <div className="setrow__reps">
            <NumberField
              value={set.reps}
              onChange={(reps) => onChange({ reps })}
              min={0}
              placeholder="reps"
              ariaLabel="Reps"
            />
          </div>
        )}

        {fields.includes('time') && !fields.includes('reps') && (
          <div className="setrow__reps">
            <NumberField
              value={set.timeSec}
              onChange={(timeSec) => onChange({ timeSec })}
              min={0}
              placeholder="sec"
              ariaLabel="Seconds"
            />
          </div>
        )}

        {fields.includes('effort') && (
          <button
            className={`setrow__effort${set.effortValue !== undefined ? ' setrow__effort--set' : ''}`}
            onClick={() => setOpen((o) => !o)}
            aria-label="Effort"
          >
            {set.effortValue !== undefined ? fmtEffort(effortType ?? 'rpe', set.effortValue) : '–'}
          </button>
        )}

        <button
          className={`setrow__check${set.isComplete ? ' setrow__check--on' : ''}`}
          onClick={onToggleComplete}
          aria-label={set.isComplete ? 'Mark set incomplete' : 'Mark set complete'}
          aria-pressed={!!set.isComplete}
        >
          <IconCheck />
        </button>
      </div>

      {prs?.any && (
        <div className="setrow__pr">
          {prs.weight && <span className="badge badge--pr">Weight PR</span>}
          {prs.reps && <span className="badge badge--pr">Rep PR</span>}
          {prs.e1rm && <span className="badge badge--pr">e1RM PR</span>}
        </div>
      )}

      {open && (
        <div className="setrow__more">
          {fields.includes('effort') && (
            <div>
              <div className="fieldlabel">
                {effortType === 'rir' ? 'Reps in reserve' : 'RPE'}
                <button
                  className="chip chip--sm"
                  style={{ float: 'right', marginTop: -8 }}
                  onClick={() =>
                    onChange({
                      effortType: effortType === 'rir' ? 'rpe' : 'rir',
                      effortValue: undefined,
                    })
                  }
                >
                  Use {effortType === 'rir' ? 'RPE' : 'RIR'}
                </button>
              </div>
              <div className="chips">
                {(effortType === 'rir' ? RIR_STEPS : RPE_STEPS).map((v) => (
                  <button
                    key={v}
                    className={`chip${set.effortValue === v ? ' chip--on' : ''}`}
                    onClick={() =>
                      onChange({
                        effortType: effortType ?? 'rpe',
                        effortValue: set.effortValue === v ? undefined : v,
                      })
                    }
                  >
                    {v}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div>
            <div className="fieldlabel">Set type</div>
            <div className="chips">
              {SET_TYPES.map((t) => (
                <button
                  key={t}
                  className={`chip chip--sm${set.setType === t ? ' chip--on' : ''}`}
                  onClick={() => onChange({ setType: t as SetType })}
                >
                  {setTypeLabel(t)}
                </button>
              ))}
            </div>
          </div>

          {(fields.includes('tempo') ||
            fields.includes('time') ||
            fields.includes('distance') ||
            fields.includes('band')) && (
            <div className="row" style={{ alignItems: 'flex-end', gap: 8 }}>
              {fields.includes('tempo') && (
                <div style={{ flex: 1 }}>
                  <div className="fieldlabel">Tempo</div>
                  <input
                    className="numfield"
                    value={set.tempo ?? ''}
                    placeholder="3-1-1-0"
                    inputMode="numeric"
                    onChange={(e) => onChange({ tempo: e.target.value || undefined })}
                  />
                </div>
              )}
              {fields.includes('time') && fields.includes('reps') && (
                <div style={{ flex: 1 }}>
                  <div className="fieldlabel">Time (s)</div>
                  <NumberField
                    value={set.timeSec}
                    onChange={(timeSec) => onChange({ timeSec })}
                    min={0}
                  />
                </div>
              )}
              {fields.includes('distance') && (
                <div style={{ flex: 1 }}>
                  <div className="fieldlabel">Distance (m)</div>
                  <NumberField
                    value={set.distanceM}
                    onChange={(distanceM) => onChange({ distanceM })}
                    decimal
                    min={0}
                  />
                </div>
              )}
              {fields.includes('band') && (
                <div style={{ flex: 1 }}>
                  <div className="fieldlabel">Band</div>
                  <input
                    className="numfield"
                    value={set.bandColor ?? ''}
                    placeholder="colour"
                    onChange={(e) => onChange({ bandColor: e.target.value || undefined })}
                  />
                </div>
              )}
            </div>
          )}

          <div>
            <div className="fieldlabel">Note</div>
            <input
              value={set.notes ?? ''}
              placeholder="Felt heavy, belt on…"
              onChange={(e) => onChange({ notes: e.target.value || undefined })}
            />
          </div>

          <button className="btn btn--sm btn--danger" onClick={onDelete} style={{ alignSelf: 'flex-start' }}>
            <IconTrash /> Delete set
          </button>
        </div>
      )}
    </div>
  )
}
