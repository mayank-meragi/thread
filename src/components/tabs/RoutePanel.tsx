import { Route, Routes } from 'react-router-dom'
import type { IDockviewPanelProps } from 'dockview-react'
import { TodayPage } from '../../pages/TodayPage'
import { ThreadPage } from '../../pages/ThreadPage'
import { TasksPage } from '../../pages/TasksPage'
import { SearchPage } from '../../pages/SearchPage'
import { SettingsPage } from '../../pages/SettingsPage'

export interface RoutePanelParams {
  path: string
}

export function RoutePanel({ params }: IDockviewPanelProps<RoutePanelParams>) {
  return (
    <Routes location={params.path}>
      <Route path="/" element={<TodayPage />} />
      <Route path="/thread/:threadId" element={<ThreadPage />} />
      <Route path="/tasks" element={<TasksPage />} />
      <Route path="/search" element={<SearchPage />} />
      <Route path="/settings" element={<SettingsPage />} />
    </Routes>
  )
}
