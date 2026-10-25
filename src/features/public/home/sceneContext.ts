import { createContext } from 'react'
import type { SceneEngine } from './sceneEngine'

export const SceneContext = createContext<SceneEngine | null>(null)
