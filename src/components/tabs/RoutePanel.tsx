import { Route, Routes } from 'react-router-dom'
import type { IDockviewPanelProps } from 'dockview-react'
import { TodayPage } from '../../pages/TodayPage'
import { ThreadPage } from '../../pages/ThreadPage'
import { TasksPage } from '../../pages/TasksPage'
import { SearchPage } from '../../pages/SearchPage'
import { SettingsPage } from '../../pages/SettingsPage'
import { TemplatesPage } from '../../pages/TemplatesPage'
import { WorkoutPage } from '../../pages/WorkoutPage'
import { WorkoutOverviewPage } from '../../pages/WorkoutOverviewPage'
import { WorkoutsPage } from '../../pages/WorkoutsPage'
import { RecipesPage } from '../../pages/RecipesPage'
import { RecipePage } from '../../pages/RecipePage'
import { CookPage } from '../../pages/CookPage'
import { MealPlanPage } from '../../pages/MealPlanPage'
import { ShoppingListPage } from '../../pages/ShoppingListPage'
import { DocsPage } from '../../pages/DocsPage'
import { FeedsPage } from '../../pages/FeedsPage'

export interface RoutePanelParams {
  path: string
}

export function RoutePanel({ params }: IDockviewPanelProps<RoutePanelParams>) {
  return (
    <div className="route-panel">
      <Routes location={params.path}>
        <Route path="/" element={<TodayPage />} />
        <Route path="/thread/:threadId" element={<ThreadPage />} />
        <Route path="/workout/:day/:blockId" element={<WorkoutPage />} />
        <Route path="/workout/:day/:blockId/overview" element={<WorkoutOverviewPage />} />
        <Route path="/workouts" element={<WorkoutsPage />} />
        <Route path="/recipes" element={<RecipesPage />} />
        <Route path="/recipe/:threadId" element={<RecipePage />} />
        <Route path="/cook/:day/:blockId" element={<CookPage />} />
        <Route path="/meal-plan" element={<MealPlanPage />} />
        <Route path="/shopping-list" element={<ShoppingListPage />} />
        <Route path="/tasks" element={<TasksPage />} />
        <Route path="/search" element={<SearchPage />} />
        <Route path="/feeds" element={<FeedsPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/templates" element={<TemplatesPage />} />
        <Route path="/docs" element={<DocsPage />} />
        <Route path="/docs/:topic" element={<DocsPage />} />
      </Routes>
    </div>
  )
}
