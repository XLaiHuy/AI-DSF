'use client'

import { createContext, useContext, useMemo, useState, type ReactNode } from 'react'

export type DeskPanel = 'brief' | 'topics' | 'sources' | 'quick' | 'history' | 'profile' | 'preferences'
export type RadarTab = 'articles' | 'alerts' | 'personal' | 'saved' | 'history'
type RadarDeskControls = {
  openPanel: (panel: DeskPanel) => void
  selectView: (tab: RadarTab) => void
  isAlertsTab: boolean
}

const RadarDeskContext = createContext<{ controls: RadarDeskControls | undefined; register: (value: RadarDeskControls | undefined) => void }>({
  controls: undefined, register: () => undefined,
})

export function RadarDeskProvider({ children }: { children: ReactNode }) {
  const [controls, register] = useState<RadarDeskControls>()
  const value = useMemo(() => ({ controls, register }), [controls])
  return <RadarDeskContext.Provider value={value}>{children}</RadarDeskContext.Provider>
}

export const useRadarDesk = () => useContext(RadarDeskContext)
