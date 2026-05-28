import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { Edit } from './routes/Edit'

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/edit" element={<Edit />} />
        <Route path="*" element={<Navigate to="/edit" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
