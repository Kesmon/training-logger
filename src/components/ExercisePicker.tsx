import { useLiveQuery } from 'dexie-react-hooks'
import { useState } from 'react'
import { EQUIPMENT, equipmentLabel } from '../core/format'
import { createExercise, listExercises } from '../db/queries'
import type { Equipment, Exercise } from '../db/schema'
import { IconPlus } from './Icons'
import { Sheet } from './Sheet'

/**
 * Search-or-create picker. The library starts empty by design, so creating a
 * new exercise is a first-class path rather than a buried secondary action.
 */
export function ExercisePicker({
  onPick,
  onClose,
  excludeIds = [],
}: {
  onPick: (exercise: Exercise) => void
  onClose: () => void
  excludeIds?: string[]
}) {
  const [query, setQuery] = useState('')
  const [equipment, setEquipment] = useState<Equipment>('barbell')
  const [creating, setCreating] = useState(false)
  const all = useLiveQuery(() => listExercises(), [], [])

  const trimmed = query.trim()
  const key = trimmed.toLowerCase()
  const matches = (all ?? [])
    .filter((e) => !excludeIds.includes(e.id))
    .filter((e) => !key || e.nameLower.includes(key) || e.aliases.some((a) => a.includes(key)))
  const exactExists = (all ?? []).some((e) => e.nameLower === key)

  async function create() {
    if (!trimmed) return
    const exercise = await createExercise({ name: trimmed, equipment })
    onPick(exercise)
  }

  return (
    <Sheet title="Add exercise" onClose={onClose}>
      <div className="stack">
        <input
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            setCreating(false)
          }}
          placeholder="Search or type a new name"
          autoFocus
          autoCapitalize="words"
          autoCorrect="off"
          enterKeyHint="done"
        />

        {trimmed && !exactExists && (
          <div className="card" style={{ padding: 12 }}>
            {!creating ? (
              <button
                className="btn btn--primary btn--block"
                onClick={() => setCreating(true)}
              >
                <IconPlus /> Create “{trimmed}”
              </button>
            ) : (
              <div className="stack">
                <div className="fieldlabel">Equipment</div>
                <div className="chips">
                  {EQUIPMENT.map((eq) => (
                    <button
                      key={eq}
                      className={`chip chip--sm${equipment === eq ? ' chip--on' : ''}`}
                      onClick={() => setEquipment(eq)}
                    >
                      {equipmentLabel(eq)}
                    </button>
                  ))}
                </div>
                <button className="btn btn--primary btn--block" onClick={() => void create()}>
                  Add “{trimmed}”
                </button>
                <p className="tiny faint">
                  Muscles and extra fields like tempo can be set later from Library.
                </p>
              </div>
            )}
          </div>
        )}

        {matches.map((e) => (
          <button key={e.id} className="listitem" onClick={() => onPick(e)}>
            <div className="listitem__body">
              <div className="listitem__title">{e.name}</div>
              <div className="tiny faint">{equipmentLabel(e.equipment)}</div>
            </div>
          </button>
        ))}

        {!trimmed && matches.length === 0 && (
          <p className="small faint" style={{ textAlign: 'center', padding: '20px 10px' }}>
            No exercises yet. Type a name above to create your first one.
          </p>
        )}
      </div>
    </Sheet>
  )
}
